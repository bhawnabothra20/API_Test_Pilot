import { test as base, expect, type APIRequestContext, type TestInfo } from '@playwright/test';
import { apiPaths, loadEnv, numberEnv, readJson, redact, registerSecret } from '../helpers/env';
import { getAtPath } from '../helpers/json-schema';
import { markQuotaExhausted, quotaExhausted, quotaReason } from '../helpers/quota';
import { assertUrlAllowed } from '../helpers/safety-guard';
import { TestData } from '../helpers/test-data';
import type {
  CredentialKind,
  EndpointSpec,
  EndpointSummary,
  Exchange,
  HttpMethod,
  Identity,
  ResourceSpec,
  TestDataEntry,
  TokenMutation,
} from '../helpers/types';
import {
  applyToken,
  canRefresh,
  hasCredentials,
  identityHeaders,
  isCredentialKind,
  missingCredentialsReason,
  mutateToken,
  obtainToken,
  PreconditionError,
  queryTokenParam,
  resolveIdentity,
  storeToken,
  tokenFor,
} from './auth';

loadEnv();

export interface SendOptions {
  method: HttpMethod;
  path: string;
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number>;
  headers?: Record<string, string>;
  body?: unknown;
  rawBody?: string;
  contentType?: string;
  identity?: Identity;
  /** token hygiene: manipulate the identity's real token (query string, alg:none, tampered signature) */
  tokenMutation?: TokenMutation;
  /** explicit token (e.g. a fresh login token for the logout check) - runtime only, never in test data */
  token?: string;
}

export interface ApiResponse {
  method: string;
  url: string;
  status: number;
  headers: Record<string, string>;
  text: string;
  durationMs: number;
  /** parsed JSON body, or undefined when the body is not valid JSON */
  json: unknown;
}

const SENSITIVE_HEADERS = /^(authorization|cookie|set-cookie|x-api-key|api[-_]?key)$/i;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function currentApiName(): string {
  const name = process.env.API_NAME;
  if (!name) throw new Error('API_NAME is not set. Run through "npm run api-test -- <url>" or set API_NAME.');
  return name;
}

let cachedSummary: EndpointSummary | undefined;
export function loadSummary(): EndpointSummary {
  if (!cachedSummary) cachedSummary = readJson<EndpointSummary>(apiPaths(currentApiName()).summary);
  return cachedSummary;
}

export function baseUrl(): string {
  return (process.env.BASE_URL || loadSummary().baseUrl).replace(/\/+$/, '');
}

export const limits = {
  get responseTimeMs(): number {
    return numberEnv('RESPONSE_TIME_MS', loadSummary().defaults.responseTimeMs);
  },
};

/** Request parts of a test-data entry, with optional path-param overrides (e.g. a freshly created id). */
export function fromData(input: TestDataEntry, pathParams: Record<string, string | number> = {}): Omit<SendOptions, 'method' | 'path'> {
  return {
    pathParams: { ...(input.pathParams ?? {}), ...pathParams },
    query: input.query,
    headers: input.headers,
    body: input.body,
    rawBody: input.rawBody,
    contentType: input.contentType,
  };
}

/** Skips the current test with a clear reason when a credential is required but not configured. */
export function requireCredentials(kind: CredentialKind): void {
  base.skip(!hasCredentials(kind), missingCredentialsReason(currentApiName(), kind));
}

/**
 * Inside a high-level case: true (and an annotation with the reason) when one check needs a credential
 * that is not configured - that check is skipped, the other checks of the case still run.
 */
export function skipCheck(kind: CredentialKind, checkId: string): boolean {
  if (hasCredentials(kind)) return false;
  base.info().annotations.push({ type: 'skipped-check', description: `${checkId}: ${missingCredentialsReason(currentApiName(), kind)}` });
  return true;
}

/** Thin, logged, rate-limited wrapper around Playwright's request fixture. */
export class ApiClient {
  private readonly summary = loadSummary();
  private readonly delayMs = numberEnv('POLITE_DELAY_MS', 150);
  private exchangeCount = 0;
  /** setup/cleanup exchanges are attached under a different name so triage only uses the request under test */
  private phase: 'test' | 'setup' | 'cleanup' = 'test';
  private static idCache = new Map<string, string | number>();

  private async inPhase<T>(phase: 'setup' | 'cleanup', fn: () => Promise<T>): Promise<T> {
    const previous = this.phase;
    this.phase = phase;
    try {
      return await fn();
    } finally {
      this.phase = previous;
    }
  }

  constructor(
    private readonly request: APIRequestContext,
    private readonly testInfo: TestInfo,
  ) {}

  endpoint(method: HttpMethod, pathTemplate: string): EndpointSpec | undefined {
    return this.summary.endpoints.find((e) => e.method === method && e.path === pathTemplate);
  }

  resource(group: string): ResourceSpec {
    const r = this.summary.resources.find((x) => x.name === group);
    if (!r) throw new PreconditionError(`resource "${group}" is not described in endpoint-summary.json`);
    return r;
  }

  buildUrl(pathTemplate: string, pathParams: Record<string, string | number> = {}, query: SendOptions['query'] = {}): string {
    const filled = pathTemplate.replace(/\{([^}]+)\}/g, (_, name: string) => {
      if (!(name in pathParams)) throw new PreconditionError(`missing path parameter "${name}" for ${pathTemplate}`);
      return encodeURIComponent(String(pathParams[name]));
    });
    const url = new URL(baseUrl() + filled);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, String(v));
    return url.toString();
  }

  /**
   * Sends a request. When a real credential (admin from a login) is rejected with 401/403, the token
   * is refreshed by logging in again and the request is repeated ONCE - demo servers reset and drop
   * sessions. If the fresh token is rejected too, that response is returned and the test fails on it.
   */
  private async refreshToken(kind: CredentialKind): Promise<boolean> {
    if (!canRefresh(this.summary, kind)) return false;
    const fresh = await this.inPhase('setup', () => obtainToken(this.request, this.summary, baseUrl(), kind));
    if (!fresh) return false;
    storeToken(kind, fresh);
    return true;
  }

  /** A NEW token for a kind (not the shared one) - for checks that invalidate it, e.g. logout. */
  async freshToken(kind: CredentialKind): Promise<string> {
    const t = await this.inPhase('setup', () => obtainToken(this.request, this.summary, baseUrl(), kind));
    if (!t) throw new PreconditionError(`could not obtain a fresh ${kind} token (login not configured)`);
    registerSecret(t.token);
    return t.token;
  }

  async send(opts: SendOptions): Promise<ApiResponse> {
    // quota already used up in this worker: skip instead of producing a false failure
    const exhausted = quotaExhausted();
    if (exhausted) this.testInfo.skip(true, exhausted);
    const endpointSpec = this.endpoint(opts.method, opts.path);
    const kind = resolveIdentity(opts.identity, endpointSpec);
    const res = await this.sendOnce(opts);
    if (res.status === 429) {
      const remaining = res.headers['x-ratelimit-remaining'] ?? res.headers['ratelimit-remaining'];
      if (remaining === '0' || res.headers['retry-after'] || /rate.?limit/i.test(res.text)) {
        const p = this.summary.envPrefix;
        const hint =
          this.summary.auth.type === 'apiKey' && !hasCredentials('admin')
            ? `No API key configured: add ${p}_API_KEY to .env for a higher quota, then re-run.`
            : 'Re-run after the reset or use a key with a higher quota.';
        markQuotaExhausted(quotaReason(new URL(res.url).hostname, res.headers, hint));
        this.testInfo.skip(true, quotaExhausted());
      }
    }
    // a real, unmodified credential rejected: refresh ONCE (expired / reset sessions) and repeat
    const unmodified = !opts.token && !opts.tokenMutation;
    if (unmodified && isCredentialKind(kind) && (res.status === 401 || res.status === 403)) {
      if (await this.refreshToken(kind)) return this.sendOnce(opts);
    }
    return res;
  }

  /** Auth headers + query for a request, including token-hygiene manipulations. */
  private authParts(opts: SendOptions, endpoint: EndpointSpec | undefined): { headers: Record<string, string>; query: Record<string, string | number>; label: string } {
    const auth = this.summary.auth;
    const scheme = auth.type === 'none' ? { ...auth, type: 'bearer' as const } : auth;
    const kind = resolveIdentity(opts.identity, endpoint);
    if (opts.token) return { headers: applyToken(scheme, opts.token), query: {}, label: `${kind}+fresh-token` };
    if (!opts.tokenMutation) {
      return { headers: identityHeaders(this.summary.apiName, auth, opts.identity ?? 'default', endpoint), query: {}, label: kind };
    }
    const real = isCredentialKind(kind) ? tokenFor(kind) : undefined;
    if (!real) throw new PreconditionError(missingCredentialsReason(this.summary.apiName, isCredentialKind(kind) ? kind : 'admin'));
    if (opts.tokenMutation === 'query') {
      return { headers: {}, query: { [queryTokenParam(auth)]: real }, label: `${kind}+token-in-query` };
    }
    const mutated = mutateToken(real, opts.tokenMutation);
    registerSecret(mutated); // derived from a real token: redact it everywhere
    return { headers: applyToken(scheme, mutated), query: {}, label: `${kind}+${opts.tokenMutation === 'algNone' ? 'alg-none' : 'tampered'}` };
  }

  private async sendOnce(opts: SendOptions): Promise<ApiResponse> {
    const endpoint = this.endpoint(opts.method, opts.path);
    const auth = this.authParts(opts, endpoint);
    const url = this.buildUrl(opts.path, opts.pathParams, { ...(opts.query ?? {}), ...auth.query });
    assertUrlAllowed(url); // guardrail on every single request
    const headers: Record<string, string> = {
      ...(endpoint?.requiredHeaders ?? {}),
      ...auth.headers,
      ...(opts.headers ?? {}),
    };
    let data: string | undefined;
    if (opts.rawBody !== undefined) {
      data = opts.rawBody;
      headers['Content-Type'] = opts.contentType ?? headers['Content-Type'] ?? 'application/json';
    } else if (opts.body !== undefined) {
      data = JSON.stringify(opts.body);
      headers['Content-Type'] = opts.contentType ?? headers['Content-Type'] ?? 'application/json';
    }
    if (!headers['Content-Type'] && !headers['content-type']) delete headers['Content-Type'];

    if (this.delayMs > 0) await sleep(this.delayMs);
    const started = Date.now();
    const res = await this.request.fetch(url, {
      method: opts.method,
      headers,
      data,
      failOnStatusCode: false,
      timeout: 20_000,
    });
    const durationMs = Date.now() - started;
    const text = opts.method === 'HEAD' ? '' : await res.text();
    let json: unknown;
    try {
      json = text.trim() === '' ? undefined : JSON.parse(text);
    } catch {
      json = undefined;
    }
    const response: ApiResponse = {
      method: opts.method,
      url: redact(url), // a token in the query string must never reach messages or reports
      status: res.status(),
      headers: res.headers(),
      text,
      durationMs,
      json,
    };
    // a token issued by the login endpoint is a credential: mask it before the exchange is recorded
    const login = this.summary.auth.login;
    if (login && opts.method === login.method && opts.path === login.path) {
      const issued = getAtPath(json, login.tokenField);
      if (typeof issued === 'string') registerSecret(issued);
    }
    await this.attach(headers, data, response, auth.label, opts.path);
    return response;
  }

  /** Attaches a redacted request/response pair to the test result - used by triage and the access matrix. */
  private async attach(
    reqHeaders: Record<string, string>,
    reqBody: string | undefined,
    res: ApiResponse,
    identity: string,
    pathTemplate: string,
  ): Promise<void> {
    const mask = (h: Record<string, string>) =>
      Object.fromEntries(Object.entries(h).map(([k, v]) => [k, SENSITIVE_HEADERS.test(k) ? '***' : v]));
    const cap = (s: string | undefined) => (s && s.length > 4000 ? `${s.slice(0, 4000)}...[truncated ${s.length} chars]` : s);
    const exchange: Exchange = {
      method: res.method,
      url: res.url,
      requestHeaders: mask(reqHeaders),
      requestBody: cap(reqBody),
      status: res.status,
      responseHeaders: mask(res.headers),
      responseBody: cap(res.text) ?? '',
      durationMs: res.durationMs,
      identity,
      pathTemplate,
    };
    this.exchangeCount += 1;
    const prefix = this.phase === 'test' ? '' : `${this.phase}-`;
    await this.testInfo.attach(`${prefix}exchange-${String(this.exchangeCount).padStart(2, '0')}`, {
      body: redact(JSON.stringify(exchange, null, 2)),
      contentType: 'application/json',
    });
  }

  /** An id that exists right now: first item of the collection, falling back to the discovered sample id. */
  async existingId(group: string): Promise<string | number> {
    const cached = ApiClient.idCache.get(group);
    if (cached !== undefined) return cached;
    const r = this.resource(group);
    const list = this.endpoint('GET', r.collectionPath);
    if (list) {
      const res = await this.inPhase('setup', () => this.send({ method: 'GET', path: r.collectionPath, identity: 'default' }));
      const first = Array.isArray(res.json) ? (res.json[0] as unknown) : undefined;
      const id = getAtPath(first, r.idField);
      if (typeof id === 'string' || typeof id === 'number') {
        ApiClient.idCache.set(group, id);
        return id;
      }
    }
    if (r.sampleId !== undefined) return r.sampleId;
    throw new PreconditionError(`could not find an existing ${group} id`);
  }

  /** Creates a resource through its POST endpoint and returns the new id plus the create response. */
  async create(group: string, body: unknown, identity: Identity = 'default'): Promise<{ id: string | number; response: ApiResponse }> {
    const r = this.resource(group);
    const response = await this.inPhase('setup', () => this.send({ method: 'POST', path: r.collectionPath, body, identity }));
    // server-assigned id from the response; for client-assigned ids (e.g. username) fall back to the request
    const id = getAtPath(response.json, r.createIdPath ?? r.idField) ?? getAtPath(body, r.idField);
    if (response.status >= 300 || (typeof id !== 'string' && typeof id !== 'number')) {
      throw new PreconditionError(`could not create ${group} (status ${response.status})`);
    }
    return { id, response };
  }

  /**
   * Deletes a resource as its owner (default identity unless given), falling back to admin when the owner
   * cannot delete it. Never throws (cleanup must not mask the real result).
   */
  async remove(group: string, id: string | number, owner: Identity = 'default'): Promise<void> {
    const r = this.resource(group);
    if (!r.itemPath || !r.idParam) return;
    const del = this.endpoint('DELETE', r.itemPath);
    if (!del) return;
    const attempt = async (identity: Identity) =>
      this.inPhase('cleanup', () => this.send({ method: 'DELETE', path: r.itemPath!, pathParams: { [r.idParam!]: id }, identity }));
    try {
      const ownerKind = resolveIdentity(owner, del);
      const ownerUsable = !isCredentialKind(ownerKind) || hasCredentials(ownerKind);
      const first = ownerUsable && (!del.requiresAuth || isCredentialKind(ownerKind)) ? await attempt(owner) : undefined;
      if ((!first || first.status >= 400) && hasCredentials('admin') && ownerKind !== 'admin') await attempt('admin');
    } catch {
      /* best-effort cleanup */
    }
  }

  /**
   * Runs fn with an id to act on. If the API persists writes and cleanup is possible, a fresh resource is
   * created and deleted afterwards; otherwise (simulated writes, or no credentials to clean up) an existing
   * id is used, which is safe because nothing is persisted or the request is expected to be rejected.
   */
  async withResource(group: string, setupBody: unknown, fn: (id: string | number) => Promise<void>): Promise<void> {
    const r = this.resource(group);
    const del = r.itemPath ? this.endpoint('DELETE', r.itemPath) : undefined;
    const canCleanup = !del?.requiresAuth || hasCredentials('admin');
    if (!r.persistsWrites || !canCleanup || setupBody === undefined) {
      await fn(await this.existingId(group));
      return;
    }
    const { id } = await this.create(group, setupBody);
    try {
      await fn(id);
    } finally {
      await this.remove(group, id);
    }
  }
}

export interface ApiFixtures {
  api: ApiClient;
  data: TestData;
}

export const test = base.extend<ApiFixtures>({
  api: async ({ request }, use, testInfo) => {
    await use(new ApiClient(request, testInfo));
  },
  data: async ({}, use) => {
    await use(new TestData(currentApiName()));
  },
});

export { expect };
