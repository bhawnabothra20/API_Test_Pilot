/**
 * Stage 2 - API discovery. Input: a URL (spec, docs page, base URL or single endpoint).
 * Output: api/<name>/spec/endpoint-summary.json (+ the raw spec when one was found).
 *
 * Only safe methods (GET, HEAD, OPTIONS) are ever sent during discovery.
 * Every guess is appended to summary.assumptions so the report can show it.
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { apiPaths, envPrefix, numberEnv, writeJson } from '../shared/helpers/env';
import { getAtPath, inferSchema, toRequestSchema, typeOf } from '../shared/helpers/json-schema';
import { assertUrlAllowed, isHostAllowed } from '../shared/helpers/safety-guard';
import type {
  AuthScheme,
  EndpointSpec,
  EndpointSummary,
  HttpMethod,
  JsonFormat,
  JsonSchema,
  ParamSpec,
  ResourceSpec,
  SpecSource,
} from '../shared/helpers/types';

const COMMON_SPEC_PATHS = [
  '/openapi.json',
  '/swagger.json',
  '/v3/api-docs',
  '/swagger/v1/swagger.json',
  '/v2/swagger.json',
  '/api-docs',
  '/api/swagger.json',
  '/openapi.yaml',
  '/swagger.yaml',
  '/apidoc/api_data.json',
];
const DOC_PAGES = ['/guide', '/guide/', '/docs', '/apidoc/index.html'];
const SIMULATED_WRITES =
  /not really (created|updated|patched|deleted|persisted|saved)|faked as if|(changes|data|writes) (are|is|will) not (be )?(persisted|saved|stored)/i;
const DELAY_MS = numberEnv('POLITE_DELAY_MS', 150);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Fetched {
  url: string;
  status: number;
  contentType: string;
  headers: Headers;
  text: string;
}

type Method = Extract<HttpMethod, 'GET' | 'HEAD' | 'OPTIONS'>;

/** Allowlisted, rate-limited, safe-method-only fetch. */
async function safeFetch(url: string, method: Method = 'GET', headers: Record<string, string> = {}): Promise<Fetched | undefined> {
  try {
    if (!isHostAllowed(new URL(url).hostname)) return undefined;
    await sleep(DELAY_MS);
    const res = await fetch(url, {
      method,
      headers: { Accept: 'application/json, application/yaml, text/html;q=0.9, */*;q=0.8', 'User-Agent': 'api-test-pilot/1.0', ...headers },
      redirect: 'follow',
      signal: AbortSignal.timeout(20_000),
    });
    const text = method === 'GET' ? await res.text() : '';
    return { url: res.url || url, status: res.status, contentType: res.headers.get('content-type') ?? '', headers: res.headers, text };
  } catch {
    return undefined;
  }
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function tryYaml(text: string): unknown {
  if (!/^\s*(openapi|swagger)\s*:/m.test(text)) return undefined;
  try {
    return YAML.parse(text);
  } catch {
    return undefined;
  }
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

function specKind(doc: unknown): 'openapi3' | 'swagger2' | 'apidoc' | undefined {
  if (isObj(doc) && typeof doc.openapi === 'string' && isObj(doc.paths)) return 'openapi3';
  if (isObj(doc) && typeof doc.swagger === 'string' && isObj(doc.paths)) return 'swagger2';
  if (Array.isArray(doc) && doc.length > 0 && doc.every((e) => isObj(e) && typeof e.type === 'string' && typeof e.url === 'string')) {
    return 'apidoc';
  }
  return undefined;
}

function parseDoc(f: Fetched): { kind: 'openapi3' | 'swagger2' | 'apidoc'; doc: unknown } | undefined {
  if (f.status >= 400) return undefined;
  const doc = tryJson(f.text) ?? tryYaml(f.text);
  const kind = specKind(doc);
  return kind ? { kind, doc } : undefined;
}

// ----------------------------------------------------------------------------- helpers

function groupOf(p: string): string {
  const seg = p.split('/').filter(Boolean).find((s) => !s.startsWith('{'));
  return (seg ?? 'root').replace(/[^a-zA-Z0-9_-]/g, '');
}

function endpointId(method: string, p: string): string {
  const slug = p
    .split('/')
    .filter(Boolean)
    .map((s) => s.replace(/[{}]/g, ''))
    .join('_')
    .replace(/[^a-zA-Z0-9_]/g, '');
  return `${slug || 'root'}_${method}`;
}

function newEndpoint(method: HttpMethod, p: string, partial: Partial<EndpointSpec>): EndpointSpec {
  const pathParams = [...p.matchAll(/\{([^}]+)\}/g)].map<ParamSpec>((m) => ({
    name: m[1],
    in: 'path',
    required: true,
    schema: { type: 'integer' },
  }));
  return {
    id: endpointId(method, p),
    group: groupOf(p),
    method,
    path: p,
    summary: `${method} ${p}`,
    pathParams,
    queryParams: [],
    requiredHeaders: {},
    successStatus: method === 'POST' ? 201 : 200,
    responseContentType: 'application/json',
    requiresAuth: false,
    adminOnly: false,
    isLogin: false,
    notFoundStatus: 404,
    badRequestStatus: 400,
    inferred: false,
    ...partial,
  };
}

function defaultAuth(): AuthScheme {
  return {
    type: 'none',
    unauthenticatedStatus: 401,
    forbiddenStatus: 403,
    statusDocumented: false,
    roles: [],
    notes: [],
  };
}

const LOGIN_PATH = /(^|\/)(login|auth|token|signin|sign-in|authenticate)(\/|$)/i;

function detectLogin(endpoints: EndpointSpec[], auth: AuthScheme): void {
  for (const e of endpoints) {
    if (e.method !== 'POST' || !LOGIN_PATH.test(e.path)) continue;
    const props = e.requestBody?.schema.properties ?? {};
    const userField = Object.keys(props).find((k) => /^(username|user|email|login)$/i.test(k));
    const passField = Object.keys(props).find((k) => /pass/i.test(k));
    const tokenField = Object.keys(e.responseSchema?.properties ?? {}).find((k) => /token/i.test(k)) ?? 'token';
    if (userField && passField) {
      e.isLogin = true;
      auth.login = { method: 'POST', path: e.path, usernameField: userField, passwordField: passField, tokenField, endpointId: e.id };
      return;
    }
  }
}

/** Builds resource descriptions (collection + item path, id field, create response shape). */
export function buildResources(endpoints: EndpointSpec[], sampleIds: Record<string, string | number> = {}, persists = true): ResourceSpec[] {
  const resources: ResourceSpec[] = [];
  const collections = new Set(
    endpoints
      .filter((e) => !e.isLogin && !/\{[^}]+\}$/.test(e.path) && (e.method === 'POST' || (e.method === 'GET' && typeOf(e.responseSchema) === 'array')))
      .map((e) => e.path),
  );
  for (const collectionPath of collections) {
    const item = endpoints.find((e) => {
      const m = new RegExp(`^${collectionPath.replace(/[.*+?^$()|[\]\\]/g, '\\$&')}/\\{([^}]+)\\}$`).exec(e.path);
      return !!m;
    });
    const itemPath = item?.path;
    const idParam = itemPath ? /\{([^}]+)\}$/.exec(itemPath)?.[1] : undefined;
    const getItem = endpoints.find((e) => e.method === 'GET' && e.path === itemPath);
    const list = endpoints.find((e) => e.method === 'GET' && e.path === collectionPath);
    const create = endpoints.find((e) => e.method === 'POST' && e.path === collectionPath);

    const listItem = list?.responseSchema?.items;
    const idCandidates = Object.keys(listItem?.properties ?? getItem?.responseSchema?.properties ?? {});
    const bodyFields = Object.keys(create?.requestBody?.schema.properties ?? {});
    // the path parameter names the identifying field when the resource has it (/user/{username} -> username)
    const idField =
      (idParam && (idCandidates.includes(idParam) || bodyFields.includes(idParam)) ? idParam : undefined) ??
      idCandidates.find((k) => k === 'id') ??
      idCandidates.find((k) => /id$/i.test(k)) ??
      'id';

    const createProps = create?.responseSchema?.properties ?? {};
    const createIdPath = createProps[idField] ? idField : (Object.keys(createProps).find((k) => /id$/i.test(k)) ?? idField);
    const reqFields = Object.keys(create?.requestBody?.schema.properties ?? {});
    // entity is the root unless the root carries none of the request fields (e.g. {bookingid, booking:{...}})
    const rootHasEntity = reqFields.some((f) => f in createProps);
    const entityKey = rootHasEntity
      ? undefined
      : Object.entries(createProps).find(([, s]) => typeOf(s) === 'object' && reqFields.some((f) => f in (s.properties ?? {})))?.[0];

    resources.push({
      name: groupOf(collectionPath),
      collectionPath,
      itemPath,
      idParam,
      idField,
      createIdPath,
      createEntityPath: entityKey ?? '',
      sampleId: sampleIds[collectionPath],
      persistsWrites: persists,
      schema: getItem?.responseSchema ?? listItem,
    });
  }
  // one resource per group name: the real CRUD collection wins over action paths such as
  // /pet/{petId}/uploadImage or /user/createWithList - item path first, then a create (POST), then a
  // list, then the shortest path; spec order only breaks ties
  const hasPost = (p: string) => endpoints.some((e) => e.method === 'POST' && e.path === p);
  const hasList = (p: string) => endpoints.some((e) => e.method === 'GET' && e.path === p);
  const score = (r: ResourceSpec) => (r.itemPath ? 1000 : 0) + (hasPost(r.collectionPath) ? 100 : 0) + (hasList(r.collectionPath) ? 10 : 0) - r.collectionPath.split('/').length;
  const best = new Map<string, ResourceSpec>();
  for (const r of resources) {
    const cur = best.get(r.name);
    if (!cur || score(r) > score(cur)) best.set(r.name, r);
  }
  return resources.filter((r) => best.get(r.name) === r);
}

// ----------------------------------------------------------------------------- OpenAPI / Swagger

class RefResolver {
  constructor(private readonly root: Obj) {}
  /** Inlines local $refs. Only $ref hops count towards the limit; a ref already on the stack (cycle) becomes {}. */
  resolve(node: unknown, refStack: string[] = []): unknown {
    if (Array.isArray(node)) return node.map((n) => this.resolve(n, refStack));
    if (!isObj(node)) return node;
    if (typeof node.$ref === 'string') {
      const ref = node.$ref;
      if (refStack.includes(ref) || refStack.length >= 12) return {};
      const target = ref
        .replace(/^#\//, '')
        .split('/')
        .reduce<unknown>((acc, k) => (isObj(acc) ? acc[k.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined), this.root);
      return this.resolve(target ?? {}, [...refStack, ref]);
    }
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, this.resolve(v, refStack)]));
  }
}

const FORMATS: JsonFormat[] = ['date', 'date-time', 'email', 'uri', 'uuid'];

function toSchema(raw: unknown): JsonSchema {
  if (!isObj(raw)) return {};
  if (Array.isArray(raw.allOf)) {
    const merged: JsonSchema = { type: 'object', properties: {}, required: [] };
    for (const part of raw.allOf.map(toSchema)) {
      Object.assign(merged.properties!, part.properties ?? {});
      merged.required!.push(...(part.required ?? []));
    }
    return merged;
  }
  const alt = (raw.oneOf ?? raw.anyOf) as unknown[] | undefined;
  if (Array.isArray(alt) && alt.length) return toSchema(alt[0]);
  const s: JsonSchema = {};
  let type = raw.type;
  if (Array.isArray(type)) {
    if (type.includes('null')) s.nullable = true;
    type = type.find((t) => t !== 'null');
  }
  if (typeof type === 'string') s.type = type as JsonSchema['type'];
  if (isObj(raw.properties)) {
    s.type = s.type ?? 'object';
    s.properties = Object.fromEntries(Object.entries(raw.properties).map(([k, v]) => [k, toSchema(v)]));
    s.required = Array.isArray(raw.required) ? (raw.required as string[]) : [];
  }
  if (raw.items) s.items = toSchema(raw.items);
  if (Array.isArray(raw.enum)) s.enum = raw.enum.filter((x): x is string | number => typeof x === 'string' || typeof x === 'number');
  if (typeof raw.format === 'string' && (FORMATS as string[]).includes(raw.format)) s.format = raw.format as JsonFormat;
  for (const k of ['minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems'] as const) {
    if (typeof raw[k] === 'number') s[k] = raw[k] as number;
  }
  if (raw.nullable === true || raw['x-nullable'] === true) s.nullable = true;
  if (raw.readOnly === true) s.readOnly = true;
  if (raw.example !== undefined) s.example = raw.example;
  if (typeof raw.description === 'string') s.description = raw.description;
  return s;
}

export function fromOpenApi(kind: 'openapi3' | 'swagger2', raw: Obj, specUrl: string, assumptions: string[]) {
  const doc = new RefResolver(raw).resolve(raw) as Obj;
  const info = (doc.info ?? {}) as Obj;
  let baseUrl: string;
  if (kind === 'swagger2') {
    const schemes = (doc.schemes as string[] | undefined) ?? ['https'];
    const host = (doc.host as string | undefined) ?? new URL(specUrl).host;
    baseUrl = `${schemes.includes('https') ? 'https' : schemes[0]}://${host}${(doc.basePath as string | undefined) ?? ''}`;
  } else {
    const server = ((doc.servers as Obj[] | undefined) ?? [])[0];
    baseUrl = new URL((server?.url as string | undefined) ?? '/', specUrl).toString();
  }
  baseUrl = baseUrl.replace(/\/+$/, '');

  const securityDefs = (kind === 'swagger2' ? doc.securityDefinitions : (doc.components as Obj | undefined)?.securitySchemes) as
    | Record<string, Obj>
    | undefined;
  const globalSecurity = (doc.security as Obj[] | undefined) ?? [];
  const schemeUse = new Map<string, number>();
  const auth = defaultAuth();

  const endpoints: EndpointSpec[] = [];
  for (const [p, item] of Object.entries((doc.paths ?? {}) as Record<string, Obj>)) {
    const shared = (item.parameters as Obj[] | undefined) ?? [];
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const op = item[method] as Obj | undefined;
      if (!op) continue;
      const M = method.toUpperCase() as HttpMethod;
      const params = [...shared, ...((op.parameters as Obj[] | undefined) ?? [])];
      const e = newEndpoint(M, p, { summary: (op.summary as string | undefined) ?? (op.operationId as string | undefined) ?? `${M} ${p}` });
      e.pathParams = params
        .filter((x) => x.in === 'path')
        .map((x) => ({ name: x.name as string, in: 'path', required: true, schema: toSchema(x.schema ?? x) }));
      e.queryParams = params
        .filter((x) => x.in === 'query')
        .map((x) => ({ name: x.name as string, in: 'query', required: x.required === true, schema: toSchema(x.schema ?? x) }));
      for (const h of params.filter((x) => x.in === 'header' && x.required === true)) {
        const s = toSchema(h.schema ?? h);
        if (s.enum?.length) e.requiredHeaders[h.name as string] = String(s.enum[0]);
      }
      // request body
      const bodyParam = params.find((x) => x.in === 'body');
      if (bodyParam) e.requestBody = { contentType: 'application/json', schema: toSchema(bodyParam.schema) };
      if (params.some((x) => x.in === 'formData')) {
        const consumes = ((op.consumes ?? doc.consumes) as string[] | undefined) ?? [];
        e.requestContentType = consumes.find((c) => /form/.test(c)) ?? (params.some((x) => x.type === 'file') ? 'multipart/form-data' : 'application/x-www-form-urlencoded');
      }
      const rb = op.requestBody as Obj | undefined;
      const rbContent = rb?.content as Record<string, Obj> | undefined;
      if (rbContent) {
        const ct = Object.keys(rbContent).find((c) => /json/.test(c)) ?? Object.keys(rbContent)[0];
        if (/json/.test(ct)) e.requestBody = { contentType: ct, schema: toSchema(rbContent[ct]?.schema) };
        else e.requestContentType = ct;
      }
      // responses
      const responses = (op.responses ?? {}) as Record<string, Obj>;
      const codes = Object.keys(responses).filter((c) => /^\d{3}$/.test(c)).map(Number).sort((a, b) => a - b);
      const ok = codes.find((c) => c >= 200 && c < 300);
      if (ok) e.successStatus = ok;
      else assumptions.push(`${M} ${p}: no 2xx response documented, assuming ${e.successStatus}.`);
      const okResp = responses[String(ok ?? 'default')] ?? responses.default;
      if (okResp) {
        const content = okResp.content as Record<string, Obj> | undefined;
        if (content) {
          const ct = Object.keys(content).find((c) => /json/.test(c)) ?? Object.keys(content)[0];
          e.responseContentType = ct ?? 'application/json';
          if (content[ct]?.schema) e.responseSchema = toSchema(content[ct].schema);
        } else if (okResp.schema) {
          e.responseSchema = toSchema(okResp.schema);
        }
      }
      if (!e.responseSchema && e.method !== 'DELETE') e.responseContentType = 'application/json';
      const fourxx = codes.filter((c) => c >= 400 && c < 500);
      if (fourxx.includes(404)) e.notFoundStatus = 404;
      e.badRequestStatus = fourxx.find((c) => ![401, 403, 404].includes(c)) ?? 400;
      if (fourxx.includes(401)) {
        auth.unauthenticatedStatus = 401;
        auth.statusDocumented = true;
      } else if (fourxx.includes(403) && !auth.statusDocumented) {
        auth.forbiddenStatus = 403;
      }
      const errResp = responses[String(fourxx[0])];
      const errSchema = errResp && ((errResp.content as Record<string, Obj> | undefined)?.['application/json']?.schema ?? errResp.schema);
      if (errSchema) e.errorSchema = toSchema(errSchema);
      // security
      const security = (op.security as Obj[] | undefined) ?? globalSecurity;
      const names = security.flatMap((s) => Object.keys(s));
      e.requiresAuth = names.length > 0;
      if (names.length) e.securitySchemes = [...new Set(names)];
      names.forEach((n) => schemeUse.set(n, (schemeUse.get(n) ?? 0) + 1));
      if (Array.isArray(op.tags) && op.tags.some((t) => /admin/i.test(String(t)))) e.adminOnly = true;
      endpoints.push(e);
    }
  }

  // choose the most used security scheme as "the" auth scheme. The agent does not run OAuth2/OpenID flows:
  // when the spec also declares another scheme (e.g. PetStore's api_key), that one is used instead.
  const isOAuth = (n: string) => ['oauth2', 'openIdConnect'].includes(String(securityDefs?.[n]?.type));
  const ranked = [...schemeUse.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
  const declared = Object.keys(securityDefs ?? {});
  const primary = ranked.find((n) => !isOAuth(n)) ?? declared.find((n) => !isOAuth(n)) ?? ranked[0];
  const def = primary ? securityDefs?.[primary] : undefined;
  if (def) {
    const t = String(def.type);
    if (t === 'apiKey') {
      auth.type = def.in === 'cookie' ? 'cookie' : 'apiKey';
      if (def.in === 'cookie') auth.cookieName = def.name as string;
      else auth.headerName = def.name as string;
      if (def.in === 'query') auth.notes.push('API key documented as query parameter; tests send it as a header of the same name.');
    } else if (t === 'basic' || (t === 'http' && def.scheme === 'basic')) {
      auth.type = 'basic';
    } else if (t === 'oauth2' || t === 'openIdConnect') {
      auth.type = 'bearer';
      auth.prefix = 'Bearer';
      auth.notes.push('Only OAuth2/OpenID is documented. The agent does not run OAuth flows: put a ready access token in <API>_ADMIN_TOKEN (sent as a Bearer token).');
    } else {
      auth.type = 'bearer';
      auth.prefix = 'Bearer';
    }
    auth.notes.push(`Primary security scheme "${primary}" (${t}).`);
  }
  // every declared scheme (names and types only; OAuth2 flows and scopes are not used)
  if (securityDefs) {
    auth.declaredSchemes = Object.fromEntries(Object.entries(securityDefs).map(([k, v]) => [k, String(v.type)]));
    const oauth = Object.keys(securityDefs).filter(isOAuth);
    if (oauth.length && primary && !isOAuth(primary)) {
      assumptions.push(`OAuth2/OpenID scheme(s) ${oauth.join(', ')} declared but not used: the agent does not run OAuth flows; every protected endpoint is tested with "${primary}".`);
    }
  }
  if (!auth.statusDocumented && auth.type !== 'none') {
    assumptions.push('Unauthenticated status not documented: expecting 401 for missing/invalid credentials (RFC 7235).');
  }
  detectLogin(endpoints, auth);
  return { title: (info.title as string | undefined) ?? new URL(specUrl).hostname, baseUrl, endpoints, auth };
}

// ----------------------------------------------------------------------------- apiDoc (apidocjs)

function apidocType(t: string | undefined): JsonSchema {
  const x = (t ?? 'String').toLowerCase();
  if (x.endsWith('[]')) return { type: 'array', items: apidocType(x.slice(0, -2)) };
  if (x === 'number') return { type: 'number' };
  if (x === 'integer' || x === 'int') return { type: 'integer' };
  if (x === 'boolean') return { type: 'boolean' };
  if (x === 'date') return { type: 'string', format: 'date' };
  if (x === 'object') return { type: 'object', properties: {}, required: [] };
  return { type: 'string' };
}

interface ApidocField {
  field: string;
  type?: string;
  optional?: boolean;
  defaultValue?: string;
  group?: string;
}

/** Turns dotted apidoc fields into a nested object schema. */
function fieldsToSchema(fields: ApidocField[]): JsonSchema {
  const root: JsonSchema = { type: 'object', properties: {}, required: [] };
  for (const f of fields) {
    const keys = f.field.split('.');
    let node = root;
    keys.forEach((key, i) => {
      const last = i === keys.length - 1;
      node.properties = node.properties ?? {};
      if (last) {
        const existing = node.properties[key];
        const s = apidocType(f.type);
        node.properties[key] = existing && existing.properties ? { ...s, properties: existing.properties, required: existing.required } : s;
        if (!f.optional) node.required = [...new Set([...(node.required ?? []), key])];
      } else {
        let child = node.properties[key];
        if (!child) child = node.properties[key] = { type: 'object', properties: {}, required: [] };
        // an implicit parent of a required field is itself required
        if (!f.optional) node.required = [...new Set([...(node.required ?? []), key])];
        if (child.type === 'array') {
          child.items = child.items?.properties ? child.items : { type: 'object', properties: {}, required: [] };
          node = child.items;
        } else {
          node = child;
        }
      }
    });
  }
  return root;
}

function fromApidoc(entries: Obj[], specUrl: string, assumptions: string[]) {
  const origin = new URL(specUrl).origin;
  const auth = defaultAuth();
  const endpoints: EndpointSpec[] = [];
  for (const entry of entries) {
    const M = String(entry.type).toUpperCase() as HttpMethod;
    if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(M)) continue;
    const paramGroups = ((entry.parameter as Obj | undefined)?.fields ?? {}) as Record<string, ApidocField[]>;
    const urlParams = Object.entries(paramGroups)
      .filter(([g]) => /url/i.test(g))
      .flatMap(([, f]) => f);
    const queryFields = Object.entries(paramGroups)
      .filter(([g]) => /^parameter$/i.test(g) || /query/i.test(g))
      .flatMap(([, f]) => f);
    const bodyFields = Object.entries(paramGroups)
      .filter(([g]) => /body/i.test(g))
      .flatMap(([, f]) => f);
    // "booking/:id" and "booking/1" both become "/booking/{id}"
    let p = '/' + String(entry.url).replace(/^\/+/, '');
    p = p.replace(/:([A-Za-z_]\w*)/g, '{$1}');
    if (urlParams.length && !/\{/.test(p)) p = p.replace(/\/[^/]+$/, `/{${urlParams[0].field}}`);

    const e = newEndpoint(M, p, { summary: String(entry.title ?? `${M} ${p}`) });
    e.pathParams = urlParams.map((f) => ({ name: f.field, in: 'path', required: true, schema: apidocType(f.type) }));
    e.queryParams = queryFields.map((f) => ({ name: f.field, in: 'query', required: !f.optional, schema: apidocType(f.type) }));
    if (bodyFields.length) e.requestBody = { contentType: 'application/json', schema: fieldsToSchema(bodyFields) };

    const headers = Object.values(((entry.header as Obj | undefined)?.fields ?? {}) as Record<string, ApidocField[]>).flat();
    for (const h of headers) {
      const value = (h.defaultValue ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
      if (/^accept$/i.test(h.field) && value) e.requiredHeaders.Accept = value;
      if (/^cookie$/i.test(h.field)) {
        auth.type = 'cookie';
        auth.cookieName = value.split('=')[0] || 'token';
        e.requiresAuth = true;
      }
      if (/^authorization$/i.test(h.field)) {
        e.requiresAuth = true;
        if (/basic/i.test(value)) auth.alternative = 'basic';
      }
    }

    const successFields = Object.values(((entry.success as Obj | undefined)?.fields ?? {}) as Record<string, ApidocField[]>).flat();
    const examples = (((entry.success as Obj | undefined)?.examples ?? []) as Obj[]).map((x) => String(x.content ?? ''));
    const statusMatch = examples.map((c) => /HTTP\/\d(?:\.\d)?\s+(\d{3})/.exec(c)).find(Boolean);
    if (statusMatch) e.successStatus = Number(statusMatch[1]);
    else {
      e.successStatus = M === 'POST' ? 200 : 200;
      assumptions.push(`${M} ${p}: no success status documented, assuming 200.`);
    }
    if (successFields.length === 1 && /^ok$/i.test(successFields[0].field) && /string/i.test(successFields[0].type ?? '')) {
      e.responseContentType = 'text/plain';
    } else if (successFields.length) {
      const listField = successFields.find((f) => /\[\]$/.test(f.type ?? '') && !f.field.includes('.'));
      if (listField) {
        const inner = successFields
          .filter((f) => f.field.startsWith(`${listField.field}.`))
          .map((f) => ({ ...f, field: f.field.slice(listField.field.length + 1) }));
        e.responseSchema = { type: 'array', items: fieldsToSchema(inner) };
      } else {
        e.responseSchema = fieldsToSchema(successFields);
      }
    }
    // enrich from JSON success example (catches formats like dates)
    const exampleJson = examples.map((c) => tryJson(c.replace(/^HTTP\/[^\n]*\n/, '').trim())).find((x) => x !== undefined);
    if (exampleJson !== undefined && !e.responseSchema) e.responseSchema = inferSchema([exampleJson]);
    endpoints.push(e);
  }
  if (auth.type !== 'none') {
    assumptions.push(
      `apiDoc does not document error status codes: expecting ${auth.unauthenticatedStatus} for missing/invalid credentials, 404 for unknown ids, 400 for invalid input.`,
    );
    if (auth.alternative === 'basic') auth.notes.push('Protected endpoints also accept "Authorization: Basic <base64 user:pass>".');
  }
  detectLogin(endpoints, auth);
  return { title: `${new URL(specUrl).hostname} (apiDoc)`, baseUrl: origin, endpoints, auth };
}

// ----------------------------------------------------------------------------- probing (no spec)

async function allowedMethods(url: string): Promise<HttpMethod[] | undefined> {
  const res = await safeFetch(url, 'OPTIONS', { Origin: 'http://localhost', 'Access-Control-Request-Method': 'POST' });
  const raw = res?.headers.get('allow') ?? res?.headers.get('access-control-allow-methods');
  if (!raw) return undefined;
  return raw
    .split(',')
    .map((m) => m.trim().toUpperCase())
    .filter((m): m is HttpMethod => ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(m));
}

interface ProbeResult {
  endpoints: EndpointSpec[];
  sampleIds: Record<string, string | number>;
}

/** Probes a JSON collection or item URL with GET/OPTIONS and derives CRUD endpoints from the observed shape. */
async function probeResource(url: URL, baseUrl: string, assumptions: string[], first: Fetched): Promise<ProbeResult> {
  const rel = url.pathname.replace(new URL(baseUrl).pathname.replace(/\/+$/, ''), '') || '/';
  const segments = rel.split('/').filter(Boolean);
  const json = tryJson(first.text);
  const out: ProbeResult = { endpoints: [], sampleIds: {} };
  let collectionPath: string;
  let listSample: unknown[] | undefined;
  let itemSample: unknown;

  if (Array.isArray(json)) {
    collectionPath = '/' + segments.join('/');
    listSample = json;
  } else {
    // an item URL like /posts/1 -> collection /posts
    collectionPath = '/' + segments.slice(0, -1).join('/');
    itemSample = json;
    const parent = await safeFetch(baseUrl + collectionPath);
    const pj = parent ? tryJson(parent.text) : undefined;
    if (Array.isArray(pj)) listSample = pj;
  }
  const itemsForSchema = (listSample ?? []).slice(0, 50);
  const itemSchema = inferSchema(itemsForSchema.length ? itemsForSchema : [itemSample]);
  const keys = Object.keys(itemSchema.properties ?? {});
  const idField = keys.find((k) => k === 'id') ?? keys.find((k) => /id$/i.test(k)) ?? 'id';
  const firstItem = (listSample?.[0] ?? itemSample) as unknown;
  const sampleId = getAtPath(firstItem, idField);
  if (typeof sampleId === 'string' || typeof sampleId === 'number') out.sampleIds[collectionPath] = sampleId;
  const itemPath = `${collectionPath}/{id}`;

  if (!itemSample && out.sampleIds[collectionPath] !== undefined) {
    const it = await safeFetch(`${baseUrl}${collectionPath}/${out.sampleIds[collectionPath]}`);
    itemSample = it && it.status < 300 ? tryJson(it.text) : undefined;
  }
  const entitySchema = itemSample ? inferSchema([itemSample, ...itemsForSchema.slice(0, 10)]) : itemSchema;
  if (entitySchema.properties?.[idField]) entitySchema.properties[idField].readOnly = true;
  const reqSchema = toRequestSchema(entitySchema, idField);
  const patchSchema: JsonSchema = { ...reqSchema, required: [] };

  let collMethods: HttpMethod[] | undefined = await allowedMethods(baseUrl + collectionPath);
  if (!collMethods) {
    assumeRest('collection', collectionPath, assumptions);
    collMethods = ['GET', 'POST'];
  }
  let itemMethods: HttpMethod[] | undefined =
    out.sampleIds[collectionPath] !== undefined ? await allowedMethods(`${baseUrl}${collectionPath}/${out.sampleIds[collectionPath]}`) : undefined;
  if (!itemMethods) {
    assumeRest('item', itemPath, assumptions);
    itemMethods = ['GET', 'PUT', 'PATCH', 'DELETE'];
  }

  const common: Partial<EndpointSpec> = { inferred: true };
  if (collMethods.includes('GET')) {
    out.endpoints.push(newEndpoint('GET', collectionPath, { ...common, summary: `List ${groupOf(collectionPath)}`, responseSchema: { type: 'array', items: itemSchema } }));
  }
  if (collMethods.includes('POST')) {
    out.endpoints.push(
      newEndpoint('POST', collectionPath, {
        ...common,
        summary: `Create ${groupOf(collectionPath)}`,
        requestBody: { contentType: 'application/json', schema: reqSchema },
        responseSchema: entitySchema,
        successStatus: 201,
      }),
    );
  }
  const itemCommon = { ...common, pathParams: [{ name: 'id', in: 'path' as const, required: true, schema: inferSchema([sampleId]) }] };
  if (itemMethods.includes('GET')) {
    out.endpoints.push(newEndpoint('GET', itemPath, { ...itemCommon, summary: `Get one ${groupOf(collectionPath)}`, responseSchema: entitySchema }));
  }
  if (itemMethods.includes('PUT')) {
    out.endpoints.push(
      newEndpoint('PUT', itemPath, { ...itemCommon, summary: `Replace ${groupOf(collectionPath)}`, requestBody: { contentType: 'application/json', schema: reqSchema }, responseSchema: entitySchema }),
    );
  }
  if (itemMethods.includes('PATCH')) {
    out.endpoints.push(
      newEndpoint('PATCH', itemPath, { ...itemCommon, summary: `Update part of ${groupOf(collectionPath)}`, requestBody: { contentType: 'application/json', schema: patchSchema }, responseSchema: entitySchema }),
    );
  }
  if (itemMethods.includes('DELETE')) {
    out.endpoints.push(newEndpoint('DELETE', itemPath, { ...itemCommon, summary: `Delete ${groupOf(collectionPath)}` }));
  }
  assumptions.push(
    `${collectionPath}: schema inferred from ${itemsForSchema.length || 1} sample object(s); every observed field treated as required, "${idField}" treated as server-generated id.`,
  );
  return out;
}

function assumeRest(kind: string, p: string, assumptions: string[]): void {
  assumptions.push(`${p}: OPTIONS gave no Allow header; assuming REST conventions for the ${kind} methods.`);
}

const ASSET = /\.(css|js|png|jpe?g|gif|svg|ico|woff2?|ttf|map|txt|xml|pdf|zip)$/i;

function sameOriginLinks(html: string, pageUrl: string): URL[] {
  const urls: URL[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      const u = new URL(m[1], pageUrl);
      if (u.origin !== new URL(pageUrl).origin) continue;
      if (ASSET.test(u.pathname) || /cdn-cgi|\.html?$/i.test(u.pathname) || u.pathname === '/') continue;
      urls.push(u);
    } catch {
      /* ignore bad links */
    }
  }
  const seen = new Set<string>();
  return urls.filter((u) => (seen.has(u.href) ? false : (seen.add(u.href), true))).slice(0, 40);
}

async function docsMentionSimulatedWrites(origin: string, html: string): Promise<boolean> {
  if (SIMULATED_WRITES.test(html)) return true;
  for (const p of DOC_PAGES) {
    const page = await safeFetch(origin + p);
    if (page && page.status < 400 && SIMULATED_WRITES.test(page.text)) return true;
  }
  return false;
}

async function fromHtmlLinks(rootUrl: string, html: string, assumptions: string[]) {
  const origin = new URL(rootUrl).origin;
  const baseUrl = origin;
  const links = sameOriginLinks(html, rootUrl);
  const endpoints: EndpointSpec[] = [];
  const sampleIds: Record<string, string | number> = {};
  const probedCollections = new Set<string>();
  const queryHints = new Map<string, Map<string, string>>();
  const nested: URL[] = [];

  for (const link of links) {
    const segs = link.pathname.split('/').filter(Boolean);
    if (link.search) {
      const m = queryHints.get(link.pathname) ?? new Map<string, string>();
      link.searchParams.forEach((v, k) => m.set(k, v));
      queryHints.set(link.pathname, m);
    }
    if (segs.length === 1 && !probedCollections.has(link.pathname)) {
      const res = await safeFetch(origin + link.pathname);
      if (!res || res.status >= 400 || !Array.isArray(tryJson(res.text))) continue;
      probedCollections.add(link.pathname);
      const r = await probeResource(new URL(origin + link.pathname), baseUrl, assumptions, res);
      endpoints.push(...r.endpoints);
      Object.assign(sampleIds, r.sampleIds);
    } else if (segs.length >= 3) {
      nested.push(link);
    }
  }
  // nested read-only routes, e.g. /posts/1/comments -> GET /posts/{id}/comments
  for (const link of nested) {
    const res = await safeFetch(link.href);
    const json = res && res.status < 400 ? tryJson(res.text) : undefined;
    if (json === undefined) continue;
    const segs = link.pathname.split('/').filter(Boolean);
    const template = '/' + segs.map((s, i) => (i === 1 && /^\d+$/.test(s) ? '{id}' : s)).join('/');
    if (endpoints.some((e) => e.path === template)) continue;
    endpoints.push(
      newEndpoint('GET', template, {
        inferred: true,
        summary: `List ${segs[2]} of one ${segs[0]}`,
        responseSchema: inferSchema([json]),
        pathParams: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
      }),
    );
    assumptions.push(`${template}: nested route found in documentation links; tested read-only (GET).`);
  }
  // documented query filters, e.g. /comments?postId=1
  for (const [p, params] of queryHints) {
    const e = endpoints.find((x) => x.method === 'GET' && x.path === p);
    if (!e) continue;
    for (const [name, sample] of params) {
      e.queryParams.push({ name, in: 'query', required: false, schema: { ...inferSchema([Number.isNaN(Number(sample)) ? sample : Number(sample)]), example: sample } });
    }
  }
  return { endpoints, sampleIds, baseUrl };
}

// ----------------------------------------------------------------------------- main

// ----------------------------------------------------------------------------- spec search (walk up to the root)

type FoundSpec = { kind: 'openapi3' | 'swagger2' | 'apidoc'; doc: unknown; url: string };

/** Max extra requests spent looking for a spec (polite: each one waits POLITE_DELAY_MS). */
const SPEC_SEARCH_BUDGET = 40;
/** Input paths that point at documentation rather than at an endpoint. */
const DOC_LIKE = /(swagger|openapi|api-docs|apidoc|\/docs?\b|\/guide\b|redoc|\.json$|\.ya?ml$|\.html?$)/i;

function isHtmlPage(f: Fetched): boolean {
  return /html/i.test(f.contentType) || /^\s*<(!doctype|html)/i.test(f.text);
}

/** Spec URLs referenced by an HTML page (Swagger UI config, links to swagger/openapi/apidoc). */
function specLinks(html: string, pageUrl: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/url\s*:\s*["']([^"']+\.(json|ya?ml))["']/gi)) out.push(new URL(m[1], pageUrl).href);
  for (const m of html.matchAll(/href\s*=\s*["']([^"']*(swagger|openapi|api-docs|apidoc)[^"']*)["']/gi)) {
    const u = new URL(m[1], pageUrl);
    out.push(u.href);
    if (/apidoc/i.test(u.pathname)) out.push(new URL('api_data.json', u).href);
  }
  return out;
}

/** "/a/b/c" -> ["https://h/a/b/c", "https://h/a/b", "https://h/a", "https://h"] (deepest first). */
export function ancestorUrls(url: string): string[] {
  const u = new URL(url);
  const segs = u.pathname.split('/').filter(Boolean);
  const out: string[] = [];
  for (let i = segs.length; i >= 0; i--) out.push(u.origin + (i ? `/${segs.slice(0, i).join('/')}` : ''));
  return [...new Set(out)];
}

/**
 * Finds a machine-readable spec for the input URL regardless of where in the API it points:
 * 1. the input itself, 2. spec links on the input page, 3. for every ancestor path up to the root
 * (deepest first): the known spec paths below it and the spec links on its HTML page.
 * GET only, allowlisted, polite, at most SPEC_SEARCH_BUDGET requests.
 */
async function findSpec(inputUrl: string, first: Fetched, assumptions: string[]): Promise<FoundSpec | undefined> {
  const direct = parseDoc(first);
  if (direct) return { ...direct, url: first.url };
  const tried = new Set<string>([first.url, inputUrl]);
  let budget = SPEC_SEARCH_BUDGET;
  const tryUrl = async (c: string): Promise<{ spec?: FoundSpec; page?: Fetched }> => {
    if (tried.has(c) || budget <= 0) return {};
    tried.add(c);
    budget--;
    const f = await safeFetch(c);
    if (!f) return {};
    const parsed = parseDoc(f);
    return parsed ? { spec: { ...parsed, url: f.url } } : { page: f };
  };
  const fromLinks = async (page: Fetched): Promise<FoundSpec | undefined> => {
    for (const c of specLinks(page.text, page.url)) {
      const { spec } = await tryUrl(c);
      if (spec) return spec;
    }
    return undefined;
  };

  if (isHtmlPage(first)) {
    const s = await fromLinks(first);
    if (s) return s;
  }
  const levels = ancestorUrls(first.url);
  for (const level of levels) {
    for (const p of COMMON_SPEC_PATHS) {
      const { spec } = await tryUrl(level + p);
      if (spec) return note(spec, level);
    }
    const { page } = await tryUrl(level === new URL(level).origin ? `${level}/` : level);
    if (page && page.status < 400 && isHtmlPage(page)) {
      const s = await fromLinks(page);
      if (s) return note(s, level);
    }
  }
  if (budget <= 0) assumptions.push(`Spec search stopped after ${SPEC_SEARCH_BUDGET} requests (polite limit).`);
  return undefined;

  function note(spec: FoundSpec, level: string): FoundSpec {
    if (level !== first.url.replace(/\/+$/, '')) assumptions.push(`Input ${inputUrl} is not a spec; the spec was found by walking up to ${level}.`);
    return spec;
  }
}

/** true when the input URL names an endpoint (not the root, a docs page or the spec itself). */
export function isEndpointInput(inputUrl: string, specUrl?: string): boolean {
  const u = new URL(inputUrl);
  if (u.pathname.replace(/\/+$/, '') === '' || DOC_LIKE.test(u.pathname)) return false;
  return !specUrl || new URL(specUrl).href !== u.href;
}

/**
 * When the user gave an endpoint URL (e.g. /booking) and the spec covers the whole API, keep only the
 * endpoints of that resource - plus login/logout, which auth needs. Path params match any segment.
 */
function scopeToInput(endpoints: EndpointSpec[], inputUrl: string, specUrl: string, baseUrl: string, assumptions: string[]): EndpointSpec[] {
  if (!isEndpointInput(inputUrl, specUrl)) return endpoints;
  const basePath = new URL(baseUrl).pathname.replace(/\/+$/, '');
  let rel = new URL(inputUrl).pathname.replace(/\/+$/, '');
  if (basePath && rel.startsWith(basePath)) rel = rel.slice(basePath.length);
  const want = rel.split('/').filter(Boolean);
  if (!want.length) return endpoints;
  const matches = (p: string) => {
    const have = p.split('/').filter(Boolean);
    const n = Math.min(have.length, want.length);
    return n > 0 && have.slice(0, n).every((s, i) => /^\{.+\}$/.test(s) || s === want[i]);
  };
  const scoped = endpoints.filter((e) => matches(e.path) || e.isLogin || /\/(logout|signout|sign-out|log-out)$/i.test(e.path));
  if (!scoped.some((e) => matches(e.path))) return endpoints;
  assumptions.push(`Input URL targets ${rel}: scoped to ${scoped.filter((e) => matches(e.path)).length} of ${endpoints.length} documented endpoints (login/logout kept for authentication).`);
  return scoped;
}

/**
 * API folder name. Host based ("restful-booker"); an endpoint URL adds its first path segment
 * ("restful-booker-booking") so a scoped run never overwrites the full-API results.
 */
export function deriveApiName(url: string, title?: string): string {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  const labels = host.split('.').filter((l) => !['www', 'api', 'docs'].includes(l));
  const fromHost = labels[0] ?? host;
  const seg = isEndpointInput(url)
    ? u.pathname.split('/').filter((s) => s && !/^(v\d+(\.\d+)?|api|rest)$/i.test(s))[0]
    : undefined;
  const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  const name = clean([fromHost || title || 'api', seg].filter(Boolean).join('-')).slice(0, 63).replace(/-+$/, '');
  return name || 'api';
}

export async function discover(inputUrl: string, apiName: string): Promise<EndpointSummary> {
  assertUrlAllowed(inputUrl);
  const paths = apiPaths(apiName);
  fs.mkdirSync(paths.spec, { recursive: true });
  const assumptions: string[] = [];
  const first = await safeFetch(inputUrl);
  if (!first) throw new Error(`Could not reach ${inputUrl}`);

  const isHtml = isHtmlPage(first);
  const found = await findSpec(inputUrl, first, assumptions);

  let title: string;
  let baseUrl: string;
  let endpoints: EndpointSpec[];
  let auth: AuthScheme;
  let specSource: SpecSource;
  let specFile: string | undefined;
  let sampleIds: Record<string, string | number> = {};
  let persists = true;

  if (found) {
    specSource = found.kind;
    specFile = path.join(paths.spec, found.kind === 'apidoc' ? 'api_data.json' : 'openapi.json');
    fs.writeFileSync(specFile, JSON.stringify(found.doc, null, 2));
    const r =
      found.kind === 'apidoc'
        ? fromApidoc(found.doc as Obj[], found.url, assumptions)
        : fromOpenApi(found.kind, found.doc as Obj, found.url, assumptions);
    ({ title, baseUrl, endpoints, auth } = r);
    assumptions.unshift(`Spec found at ${found.url} (${found.kind}).`);
    endpoints = scopeToInput(endpoints, inputUrl, found.url, baseUrl, assumptions);
    // safe probe of collections for sample ids
    for (const e of endpoints.filter((x) => x.method === 'GET' && !x.path.includes('{') && !x.requiresAuth)) {
      const res = await safeFetch(baseUrl + e.path, 'GET');
      const json = res && res.status < 300 ? tryJson(res.text) : undefined;
      if (Array.isArray(json) && json.length && isObj(json[0])) {
        const idKey = Object.keys(json[0]).find((k) => k === 'id') ?? Object.keys(json[0]).find((k) => /id$/i.test(k));
        if (idKey) sampleIds[e.path] = json[0][idKey] as string | number;
        if (!e.responseSchema?.items?.properties) e.responseSchema = { type: 'array', items: inferSchema(json.slice(0, 20)) };
      }
    }
  } else if (!isHtml && tryJson(first.text) !== undefined) {
    specSource = 'endpoint-probe';
    const u = new URL(first.url);
    baseUrl = u.origin;
    title = `${u.hostname}${u.pathname}`;
    assumptions.push(`No spec found; probing single endpoint ${u.pathname} with GET/OPTIONS only.`);
    const r = await probeResource(u, baseUrl, assumptions, first);
    endpoints = r.endpoints;
    sampleIds = r.sampleIds;
    auth = defaultAuth();
    if (first.status === 401 || first.status === 403) {
      auth.type = 'bearer';
      auth.unauthenticatedStatus = first.status;
      auth.statusDocumented = true;
      endpoints.forEach((e) => (e.requiresAuth = true));
      assumptions.push(`Endpoint answered ${first.status} without credentials: treated as bearer-protected.`);
    }
    persists = !(await docsMentionSimulatedWrites(u.origin, ''));
  } else {
    specSource = 'html-links';
    title = /<title>([^<]+)<\/title>/i.exec(first.text)?.[1]?.trim() ?? new URL(inputUrl).hostname;
    assumptions.push('No machine-readable spec found; endpoints inferred from links on the documentation page and safe GET/OPTIONS probes.');
    const r = await fromHtmlLinks(first.url, first.text, assumptions);
    endpoints = r.endpoints;
    sampleIds = r.sampleIds;
    baseUrl = r.baseUrl;
    auth = defaultAuth();
    assumptions.push('No authentication scheme documented: all endpoints treated as public.');
    persists = !(await docsMentionSimulatedWrites(new URL(inputUrl).origin, first.text));
  }

  if (!persists) {
    assumptions.push('Documentation states writes are simulated (not persisted): mutation tests target existing ids; lifecycle tests still verify persistence and will surface it.');
  }
  if (endpoints.length === 0) throw new Error(`No endpoints could be discovered from ${inputUrl}`);

  const resources = buildResources(endpoints, sampleIds, persists);
  // a run scoped to one endpoint uses the same .env credentials as the whole API (host-level prefix)
  const hostPrefix = envPrefix(deriveApiName(new URL(inputUrl).origin));
  const credPrefix = isEndpointInput(inputUrl, found?.url) && hostPrefix !== envPrefix(apiName) ? hostPrefix : envPrefix(apiName);
  if (credPrefix !== envPrefix(apiName)) assumptions.push(`Credentials are read from ${credPrefix}_* in .env (same API as the root URL); ${envPrefix(apiName)}_* values take precedence if set.`);
  const summary: EndpointSummary = {
    apiName,
    envPrefix: credPrefix,
    title,
    sourceUrl: inputUrl,
    baseUrl,
    specSource,
    specFile: specFile ? path.relative(paths.root, specFile).replace(/\\/g, '/') : undefined,
    discoveredAt: new Date().toISOString(),
    auth,
    endpoints,
    resources,
    defaults: {
      responseTimeMs: numberEnv('RESPONSE_TIME_MS', 2000),
      stringMinLength: 1,
      stringMaxLength: 255,
      numberMin: 0,
      numberMax: 2147483647,
      arrayMaxItems: 100,
    },
    assumptions: [...new Set(assumptions)],
  };
  writeJson(paths.summary, summary);
  return summary;
}

// CLI: tsx scripts/discover.ts <url> <apiName>
if (require.main === module) {
  const [url, name] = process.argv.slice(2);
  if (!url || !name) {
    console.error('usage: tsx scripts/discover.ts <url> <api-name>');
    process.exit(2);
  }
  discover(url, name)
    .then((s) => console.log(`discovered ${s.endpoints.length} endpoints (${s.specSource}) -> ${apiPaths(name).summary}`))
    .catch((e: unknown) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}
