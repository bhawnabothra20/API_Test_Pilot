/**
 * Shared design context used by every category generator: the Ctx being filled, case ids, data-file routing,
 * expectations, preconditions and default qTest steps. Generators only call addCase() - they never write files.
 */
import { leafFields, setAtPath, typeOf } from '../../shared/helpers/json-schema';
import type {
  CaseExpectation, CaseRequest, Category, CredentialKind, EndpointSpec, EndpointSummary, Flow, HttpMethod, Identity,
  IdSource, JsonSchema, OwaspApiId, ResourceSpec, TestCase, TestDataEntry, TestDataFile, TestStep, Variant,
} from '../../shared/helpers/types';
import { numberFor, objectFor, stringFor, valueFor } from './values';

export interface Ctx {
  summary: EndpointSummary;
  cases: TestCase[];
  valid: TestDataFile;
  invalid: TestDataFile;
  boundary: TestDataFile;
  counters: Map<string, number>;
  names: Set<string>;
  assumptions: string[];
  notApplicable: string[];
}

export const PREFIX = (api: string) => api.toUpperCase().replace(/[^A-Z0-9]+/g, '_');

export function caseId(ctx: Ctx, e: EndpointSpec): string {
  const key = e.id.toUpperCase();
  const n = (ctx.counters.get(key) ?? 0) + 1;
  ctx.counters.set(key, n);
  return `TC_${PREFIX(ctx.summary.apiName)}_${key}_${String(n).padStart(3, '0')}`;
}

export function resourceOf(summary: EndpointSummary, e: EndpointSpec): ResourceSpec | undefined {
  return (
    summary.resources.find((r) => r.collectionPath === e.path || r.itemPath === e.path) ??
    summary.resources.find((r) => r.itemPath && e.path.startsWith(r.itemPath))
  );
}

export function createEndpoint(summary: EndpointSummary, r: ResourceSpec | undefined): EndpointSpec | undefined {
  return r ? summary.endpoints.find((x) => x.method === 'POST' && x.path === r.collectionPath) : undefined;
}

export function validBody(e: EndpointSpec, requiredOnly = false): unknown {
  if (!e.requestBody) return undefined;
  const s = e.requestBody.schema;
  if (typeOf(s) === 'object') return objectFor(s, requiredOnly);
  return valueFor('body', s, requiredOnly);
}

/** A valid value for a query parameter (array params are sent as a single value). */
export function queryValue(name: string, s: JsonSchema): string | number {
  const scalar = typeOf(s) === 'array' && s.items ? s.items : s;
  if (scalar.enum?.length) return scalar.enum[0] as string | number;
  if (s.example !== undefined && typeof s.example !== 'object') return s.example as string | number;
  const t = typeOf(scalar);
  if (t === 'integer' || t === 'number') return numberFor(name, scalar, t === 'integer');
  if (t === 'boolean') return 'true';
  return stringFor(name, { ...scalar, type: 'string' });
}

/** Values for every documented required query parameter. */
export function requiredQuery(e: EndpointSpec): Record<string, string | number> | undefined {
  const req = e.queryParams.filter((q) => q.required);
  if (!req.length) return undefined;
  return Object.fromEntries(req.map((q) => [q.name, queryValue(q.name, q.schema)]));
}

export function isStringId(e: EndpointSpec): boolean {
  const s = e.pathParams[0]?.schema;
  return typeOf(s) === 'string' && !s?.format;
}

/** For PATCH: a partial body with the first writable scalar field. */
export function patchBody(e: EndpointSpec): Record<string, unknown> | undefined {
  if (!e.requestBody) return undefined;
  const field = leafFields(e.requestBody.schema).find((f) => ['string', 'number', 'integer', 'boolean'].includes(typeOf(f.schema) ?? '') && !/id$/i.test(f.path));
  if (!field) return undefined;
  return setAtPath({}, field.path, valueFor(field.path.split('.').pop() ?? field.path, field.schema, false));
}

export function successStatuses(e: EndpointSpec): number[] {
  if (e.inferred && e.method === 'DELETE') return [e.successStatus, 204].filter((v, i, a) => a.indexOf(v) === i);
  return [e.successStatus];
}

export function isJson(e: EndpointSpec): boolean {
  return /json/i.test(e.responseContentType);
}

export function needsAdmin(summary: EndpointSummary, e: EndpointSpec, r: ResourceSpec | undefined, idSource: IdSource): boolean {
  if (e.requiresAuth) return true;
  if (idSource !== 'created' || !r?.persistsWrites || !r.itemPath) return false;
  return !!summary.endpoints.find((x) => x.method === 'DELETE' && x.path === r.itemPath)?.requiresAuth;
}

export function idSourceFor(summary: EndpointSummary, e: EndpointSpec, r: ResourceSpec | undefined): IdSource {
  if (e.pathParams.length === 0) return 'none';
  const canCreate = !!createEndpoint(summary, r) && !!r?.persistsWrites;
  if (e.method === 'GET') return canCreate && r?.itemPath === e.path ? 'created' : 'existing';
  return canCreate ? 'created' : 'existing';
}

export function abbreviate(value: unknown): unknown {
  if (typeof value === 'string' && value.length > 80) return `<${value.length} chars: "${value.slice(0, 12)}...">`;
  if (Array.isArray(value)) return value.length > 5 ? [`<array of ${value.length} items>`] : value.map(abbreviate);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, abbreviate(v)]));
  return value;
}

export function describeData(entry: TestDataEntry | undefined): string {
  if (!entry) return '';
  const view: Record<string, unknown> = {};
  if (entry.pathParams) view.pathParams = entry.pathParams;
  if (entry.query) view.query = abbreviate(entry.query);
  if (entry.headers) view.headers = entry.headers;
  if (entry.body !== undefined) view.body = abbreviate(entry.body);
  if (entry.rawBody !== undefined) view.rawBody = abbreviate(entry.rawBody);
  if (entry.contentType) view.contentType = entry.contentType;
  if (entry.updateBody !== undefined) view.updateBody = abbreviate(entry.updateBody);
  if (entry.patchBody !== undefined) view.patchBody = abbreviate(entry.patchBody);
  return JSON.stringify(view);
}

export interface AddOptions {
  e: EndpointSpec;
  category: Category;
  variant: Variant;
  title: string;
  description?: string;
  priority?: TestCase['priority'];
  flow?: Flow;
  identity?: Identity;
  idSource?: IdSource;
  method?: HttpMethod;
  data: TestDataEntry;
  status: number[];
  schema?: boolean;
  echo?: boolean;
  matchId?: boolean;
  nonEmptyArray?: boolean;
  assumption?: string;
  requiresCredentials?: TestCase['requiresCredentials'];
  owasp?: OwaspApiId;
  precondition?: string;
  steps?: TestStep[];
}

export function schemaName(e: EndpointSpec): string {
  return (
    e.id
      .split('_')
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join('') + 'Response'
  );
}

export function addCase(ctx: Ctx, o: AddOptions): TestCase {
  const { summary } = ctx;
  const r = resourceOf(summary, o.e);
  const id = caseId(ctx, o.e);
  const idSource = o.idSource ?? idSourceFor(summary, o.e, r);
  const method = o.method ?? o.e.method;
  const identity = o.identity ?? 'default';
  const file: CaseRequest['dataFile'] =
    o.category === 'Boundary'
      ? 'boundary'
      : ['negative', 'auth-reject', 'login-reject', 'duplicate', 'tolerant', 'mass-assignment', 'token-hygiene'].includes(o.variant)
        ? 'invalid'
        : 'valid';
  // every request carries the documented required query params unless the case sets its own query
  if (o.data.query === undefined && method === o.e.method) {
    const rq = requiredQuery(o.e);
    if (rq) o.data.query = rq;
  }
  if (idSource === 'created' && o.data.setupBody === undefined) {
    const ce = createEndpoint(summary, r);
    if (ce) o.data.setupBody = validBody(ce);
  }
  const target = file === 'valid' ? ctx.valid : file === 'invalid' ? ctx.invalid : ctx.boundary;
  target[id] = o.data;

  const positive = ['positive', 'login-valid', 'filter-all', 'filter-contains', 'idempotent-read', 'idempotent-put', 'idempotent-delete', 'lifecycle', 'data-exposure'].includes(o.variant);
  const expected: CaseExpectation = {
    status: o.status,
    json: positive && isJson(o.e) && method === o.e.method,
    maxResponseTimeMs: summary.defaults.responseTimeMs,
  };
  if (positive && o.schema !== false && o.e.responseSchema && isJson(o.e)) expected.schema = schemaName(o.e);
  if (o.echo) expected.echo = true;
  if (o.nonEmptyArray) expected.nonEmptyArray = true;
  if (o.matchId && r && o.e.responseSchema?.properties?.[r.idField]) expected.fields = { [r.idField]: '$id' };
  if (!positive) expected.errorBody = o.e.errorSchema ? 'json' : 'safe';

  let title = o.title;
  if (ctx.names.has(title)) {
    let i = 2;
    while (ctx.names.has(`${o.title} (${i})`)) i++;
    title = `${o.title} (${i})`;
  }
  ctx.names.add(title);

  const requiresCredentials: TestCase['requiresCredentials'] =
    o.requiresCredentials ??
    (identity === 'admin' || (identity === 'default' && needsAdmin(summary, o.e, r, idSource)) ? 'admin' : 'none');
  const tc: TestCase = {
    id,
    variant: o.variant,
    title,
    description: o.description ?? title,
    module: `${summary.apiName}/${o.e.group}`,
    endpointId: o.e.id,
    group: o.e.group,
    category: o.category,
    priority: o.priority ?? (o.category === 'Positive-Functional' || o.category === 'Auth' ? 'High' : o.category === 'Boundary' ? 'Low' : 'Medium'),
    precondition: o.precondition ?? precondition(summary, o.e, r, idSource, requiresCredentials),
    flow: o.flow ?? 'single',
    request: { method, path: o.e.path, identity, idSource, dataFile: file, dataKey: id },
    expected,
    steps: [],
    requiresCredentials,
    assumptionBased: !!o.assumption,
    assumption: o.assumption,
  };
  if (o.owasp) tc.owasp = o.owasp;
  tc.steps = o.steps ?? defaultSteps(summary, tc, o.e, r, o.data);
  ctx.cases.push(tc);
  return tc;
}

export function precondition(summary: EndpointSummary, e: EndpointSpec, r: ResourceSpec | undefined, idSource: IdSource, creds: TestCase['requiresCredentials']): string {
  const parts = [`${summary.baseUrl} is reachable.`];
  if (idSource === 'existing') parts.push(`An existing ${r?.name ?? e.group} id is read via GET ${r?.collectionPath ?? e.path}.`);
  if (idSource === 'created') parts.push(`A fresh ${r?.name ?? e.group} is created via POST ${r?.collectionPath} and deleted after the test.`);
  if (creds === 'admin') parts.push(`Admin credentials configured in .env (${summary.envPrefix}_USERNAME/_PASSWORD or ${summary.envPrefix}_ADMIN_TOKEN).`);
  return parts.join(' ');
}

export function identityText(summary: EndpointSummary, identity: Identity, e: EndpointSpec): string {
  const a = summary.auth;
  const where = a.type === 'cookie' ? `Cookie ${a.cookieName}=<token>` : a.type === 'apiKey' ? `${a.headerName}: <key>` : a.type === 'basic' ? 'Authorization: Basic <credentials>' : 'Authorization: Bearer <token>';
  switch (identity) {
    case 'default':
      return e.requiresAuth ? `${where} (admin token from .env)` : 'no auth header';
    case 'admin':
      return `${where} (admin token from .env)`;
    case 'none':
      return 'no auth header/cookie';
    case 'invalid':
      return `${where} with a random invalid token`;
    case 'expired':
      return `${where} with an expired token`;
    case 'malformed':
      return a.type === 'cookie' ? `Cookie "${a.cookieName}" without a value` : 'Authorization header without scheme prefix';
    case 'wrongScheme':
      return a.type === 'bearer' ? 'Authorization: Basic <token> (wrong scheme)' : 'Authorization: Bearer <token> (wrong scheme)';
  }
}

export function defaultSteps(summary: EndpointSummary, tc: TestCase, e: EndpointSpec, r: ResourceSpec | undefined, data: TestDataEntry): TestStep[] {
  const steps: TestStep[] = [];
  const idParam = e.pathParams[0]?.name;
  if (tc.request.idSource === 'existing') {
    steps.push({ action: `GET ${summary.baseUrl}${r?.collectionPath ?? ''} and take the first item's "${r?.idField}" as {${idParam}}`, expected: 'An existing id is obtained' });
  } else if (tc.request.idSource === 'created') {
    steps.push({ action: `POST ${summary.baseUrl}${r?.collectionPath} with a valid body to create the test ${r?.name} and capture {${idParam}}`, expected: 'Resource created; id captured (deleted again after the test)' });
  }
  const headers = { ...e.requiredHeaders, ...(data.headers ?? {}) };
  const headerText = Object.keys(headers).length ? ` headers ${JSON.stringify(headers)},` : '';
  const ct = data.rawBody !== undefined || data.body !== undefined ? ` Content-Type ${data.contentType ?? 'application/json'},` : '';
  const pathShown = tc.request.path.replace(/\{([^}]+)\}/g, (_, n: string) => String(data.pathParams?.[n] ?? `{${n}}`));
  const query = data.query ? `?${new URLSearchParams(Object.entries(abbreviate(data.query) as Record<string, string>)).toString()}` : '';
  const bodyText =
    data.rawBody !== undefined ? ` raw body ${JSON.stringify(abbreviate(data.rawBody))}` : data.body !== undefined ? ` body ${JSON.stringify(abbreviate(data.body))}` : ' no body';
  steps.push({
    action: `Send ${tc.request.method} ${summary.baseUrl}${pathShown}${query} with ${identityText(summary, tc.request.identity, e)},${headerText}${ct}${bodyText}`,
    expected: `HTTP ${tc.expected.status.join(' or ')} returned within ${tc.expected.maxResponseTimeMs} ms${tc.expected.errorBody ? '; never a 5xx' : ''}`,
  });
  if (tc.expected.json) {
    steps.push({ action: 'Check the Content-Type response header', expected: 'Content-Type is application/json' });
  } else if (!tc.expected.errorBody && !isJson(e)) {
    steps.push({ action: 'Check the Content-Type response header', expected: `Content-Type matches ${e.responseContentType}` });
  }
  if (tc.expected.schema) {
    steps.push({
      action: `Validate the response body against schema ${tc.expected.schema}${typeOf(e.responseSchema) === 'array' ? ' (every array item)' : ''}`,
      expected: 'All required fields present with correct type, format, enum and range',
    });
  }
  if (tc.expected.errorBody) {
    steps.push({
      action: 'Inspect the error body',
      expected: tc.expected.errorBody === 'json' ? 'Structured JSON error object; no stack trace or internal paths' : 'Error body is leak free: no stack trace, internal path or SQL error',
    });
  }
  if (tc.expected.echo) steps.push({ action: 'Compare response fields with the request body', expected: 'Every sent field is returned with the same value and type (no truncation)' });
  if (tc.expected.fields) steps.push({ action: `Check key business fields ${Object.keys(tc.expected.fields).join(', ')}`, expected: 'Values equal the requested id' });
  if (tc.expected.nonEmptyArray) steps.push({ action: 'Check the collection size', expected: 'At least one item is returned' });
  return steps;
}
