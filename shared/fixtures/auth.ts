import crypto from 'node:crypto';
import type { APIRequestContext } from '@playwright/test';
import { apiEnv, credentialPrefix } from '../helpers/env';
import { getAtPath } from '../helpers/json-schema';
import type { AuthScheme, CredentialKind, EndpointSpec, EndpointSummary, Identity, TokenMutation } from '../helpers/types';

/**
 * Credentials: ONE identity (admin). Values come ONLY from .env (process.env); a token obtained at runtime
 * lives in process.env.__API_TOKEN_ADMIN for the duration of the run - never on disk.
 *
 * | kind  | direct token / key           | login                      |
 * |-------|------------------------------|----------------------------|
 * | admin | <API>_ADMIN_TOKEN, _API_KEY  | <API>_USERNAME / _PASSWORD |
 *
 * The agent does not run OAuth2 flows: for an OAuth2-only API put a ready access token in <API>_ADMIN_TOKEN.
 */
const KIND_ENV: Record<CredentialKind, { token: string[]; userPrefix: string }> = {
  admin: { token: ['ADMIN_TOKEN', 'API_KEY'], userPrefix: '' },
};

export const TOKEN_ENV: Record<CredentialKind, string> = {
  admin: '__API_TOKEN_ADMIN',
};

export const CREDENTIAL_KINDS: CredentialKind[] = ['admin'];

export interface TokenResult {
  token: string;
}

function directToken(name: string, kind: CredentialKind): string | undefined {
  for (const suffix of KIND_ENV[kind].token) {
    const v = apiEnv(name, suffix);
    if (v) return v;
  }
  return undefined;
}

function passwordCreds(name: string, kind: CredentialKind): { username: string; password: string } | undefined {
  const p = KIND_ENV[kind].userPrefix;
  const username = apiEnv(name, `${p}USERNAME`);
  const password = apiEnv(name, `${p}PASSWORD`);
  return username && password ? { username, password } : undefined;
}

/**
 * Obtains the admin token: direct token/key from .env, Basic credentials, or the documented login endpoint.
 * Undefined when not configured.
 */
export async function obtainToken(
  request: APIRequestContext,
  summary: EndpointSummary,
  baseUrl: string,
  kind: CredentialKind,
): Promise<TokenResult | undefined> {
  const name = summary.apiName;
  const direct = directToken(name, kind);
  if (direct) return { token: direct };
  const auth = summary.auth;
  // an API-key scheme needs the key itself; a login session token in the key header would be wrong
  if (auth.type === 'apiKey') return undefined;

  const creds = passwordCreds(name, kind);
  if (!creds) return undefined;
  if (auth.type === 'basic') return { token: Buffer.from(`${creds.username}:${creds.password}`).toString('base64') };
  const login = auth.login;
  if (!login) return undefined;
  const res = await request.fetch(`${baseUrl}${login.path}`, {
    method: login.method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    data: { [login.usernameField]: creds.username, [login.passwordField]: creds.password },
    failOnStatusCode: false,
  });
  const body: unknown = await res.json().catch(() => undefined);
  const token = getAtPath(body, login.tokenField);
  return typeof token === 'string' && token.length > 0 ? { token } : undefined;
}

/**
 * Which .env entries would provide this identity - the offline mirror of obtainToken(). Returns variable
 * NAMES only (never values): `via` = what is configured, `missing` = what to set when nothing is.
 */
export function credentialSource(summary: EndpointSummary, kind: CredentialKind): { configured: boolean; via?: string; missing: string } {
  const name = summary.apiName;
  const p = credentialPrefix(name);
  const token = KIND_ENV[kind].token.find((s) => apiEnv(name, s));
  const missing = missingCredentialsReason(name, kind).replace(/^Skipped: /, '');
  if (token) return { configured: true, via: `${p}_${token}`, missing };
  if (summary.auth.type === 'apiKey') return { configured: false, missing: `no API key. Set ${p}_API_KEY (or ${p}_ADMIN_TOKEN) in .env.` };
  const pw = passwordCreds(name, kind) ? `${p}_${KIND_ENV[kind].userPrefix}USERNAME/${p}_${KIND_ENV[kind].userPrefix}PASSWORD` : undefined;
  if (!pw) return { configured: false, missing };
  if (summary.auth.type === 'basic') return { configured: true, via: `Basic ${pw}`, missing };
  return summary.auth.login
    ? { configured: true, via: `login ${summary.auth.login.method} ${summary.auth.login.path} with ${pw}`, missing }
    : { configured: false, missing: `${pw} set, but no login endpoint is documented to exchange them for a token. Set a token variable instead.` };
}

/** True when the token was obtained by a login (so it can be refreshed after a 401). */
export function canRefresh(summary: EndpointSummary, kind: CredentialKind): boolean {
  const name = summary.apiName;
  if (directToken(name, kind)) return false;
  return !!summary.auth.login && !!passwordCreds(name, kind);
}

/** Stores a token for the run (memory only). */
export function storeToken(kind: CredentialKind, t: TokenResult): void {
  process.env[TOKEN_ENV[kind]] = t.token;
}

export function tokenFor(kind: CredentialKind): string | undefined {
  return process.env[TOKEN_ENV[kind]] || undefined;
}

export class PreconditionError extends Error {
  constructor(message: string) {
    super(`[PRECONDITION] ${message}`);
    this.name = 'PreconditionError';
  }
}

export function adminToken(): string | undefined {
  return tokenFor('admin');
}

export function hasCredentials(kind: CredentialKind): boolean {
  return !!tokenFor(kind);
}

/** Human readable reason used for test.skip when credentials are missing (names only, never values). */
export function missingCredentialsReason(apiName: string, kind: CredentialKind): string {
  const p = credentialPrefix(apiName);
  void kind; // one credential kind: admin
  return `Skipped: no admin credentials. Set ${p}_USERNAME/${p}_PASSWORD, ${p}_ADMIN_TOKEN or ${p}_API_KEY in .env (for an OAuth2 API: a ready access token in ${p}_ADMIN_TOKEN).`;
}

/** Unsigned JWT whose exp is in the past - stands in for an expired token when none is configured. */
export function syntheticExpiredJwt(): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 'expired-user', iat: now - 7200, exp: now - 3600 })}.${crypto
    .randomBytes(16)
    .toString('base64url')}`;
}

function randomToken(): string {
  return crypto.randomBytes(20).toString('hex');
}

function isJwt(token: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/.test(token);
}

/**
 * Token-hygiene manipulations of a real token:
 *  - algNone : JWT re-issued with {"alg":"none"} and an empty signature (claims kept when the token is a JWT)
 *  - tampered: JWT with a changed signature, or an opaque token with one character changed
 */
export function mutateToken(token: string, mutation: Exclude<TokenMutation, 'query'>): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  if (mutation === 'algNone') {
    let claims: object = { sub: 'admin', role: 'admin', iat: Math.floor(Date.now() / 1000) };
    if (isJwt(token)) {
      try {
        claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as object;
      } catch {
        /* keep synthetic claims */
      }
    }
    return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
  }
  const flip = (s: string) => {
    const i = Math.max(0, s.length - 2);
    const c = s.charAt(i);
    return s.slice(0, i) + (c === 'A' ? 'B' : 'A') + s.slice(i + 1);
  };
  if (isJwt(token)) {
    const [h, p, sig] = token.split('.');
    return `${h}.${p}.${sig ? flip(sig) : crypto.randomBytes(16).toString('base64url')}`;
  }
  return flip(token);
}

/** Name of the query parameter used for the "token in query string" check. */
export function queryTokenParam(auth: AuthScheme): string {
  if (auth.type === 'apiKey') return (auth.headerName ?? 'api_key').toLowerCase().replace(/^x-/, '').replace(/-/g, '_');
  if (auth.type === 'cookie') return auth.cookieName ?? 'token';
  return 'access_token';
}

/** Places a token according to the scheme. */
export function applyToken(auth: AuthScheme, token: string): Record<string, string> {
  switch (auth.type) {
    case 'bearer':
      return { [auth.headerName ?? 'Authorization']: `${auth.prefix ?? 'Bearer'} ${token}` };
    case 'basic':
      return { [auth.headerName ?? 'Authorization']: `Basic ${token}` };
    case 'apiKey':
      return { [auth.headerName ?? 'X-API-Key']: token };
    case 'cookie':
      return { Cookie: `${auth.cookieName ?? 'token'}=${token}` };
    default:
      return {};
  }
}

/** The identity actually used: "default" means admin on protected endpoints, otherwise none. */
export function resolveIdentity(identity: Identity | undefined, endpoint?: EndpointSpec): Exclude<Identity, 'default'> {
  if (identity === undefined || identity === 'default') return endpoint?.requiresAuth ? 'admin' : 'none';
  return identity;
}

export function isCredentialKind(identity: Identity): identity is CredentialKind {
  return (CREDENTIAL_KINDS as Identity[]).includes(identity);
}

/**
 * Headers for an identity. Throws PreconditionError when a real credential is needed but missing (the spec
 * skips first, so this only fires when a test is mis-generated).
 */
export function identityHeaders(
  apiName: string,
  auth: AuthScheme,
  identity: Identity,
  endpoint?: EndpointSpec,
): Record<string, string> {
  const scheme: AuthScheme = auth.type === 'none' ? { ...auth, type: 'bearer' } : auth;
  // API keys identify the client and raise its quota: send a configured key on public endpoints too
  if (identity === 'default' && !endpoint?.requiresAuth && auth.type === 'apiKey') {
    const key = adminToken();
    return key ? applyToken(scheme, key) : {};
  }
  const resolved = resolveIdentity(identity, endpoint);
  if (isCredentialKind(resolved)) {
    const t = tokenFor(resolved);
    if (!t) throw new PreconditionError(missingCredentialsReason(apiName, resolved));
    return applyToken(scheme, t);
  }
  switch (resolved) {
    case 'none':
      return {};
    case 'invalid':
      return applyToken(scheme, randomToken());
    case 'expired':
      return applyToken(scheme, apiEnv(apiName, 'EXPIRED_TOKEN') ?? syntheticExpiredJwt());
    case 'malformed': {
      const t = adminToken() ?? randomToken();
      if (scheme.type === 'cookie') return { Cookie: `${scheme.cookieName ?? 'token'}` };
      if (scheme.type === 'apiKey') return { [scheme.headerName ?? 'X-API-Key']: `${t} %%malformed%%` };
      if (scheme.type === 'basic') return { Authorization: 'Basic not-base64!!' };
      return { [scheme.headerName ?? 'Authorization']: t }; // bearer without prefix
    }
    case 'wrongScheme': {
      const t = adminToken() ?? randomToken();
      if (scheme.type === 'bearer') return { Authorization: `Basic ${Buffer.from(t).toString('base64')}` };
      return { Authorization: `Bearer ${t}` }; // basic / cookie / apiKey token presented as Bearer header
    }
  }
}
