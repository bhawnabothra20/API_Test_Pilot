/**
 * Shared data model for the whole pipeline.
 * endpoint-summary.json  -> EndpointSummary   (written by api-analyst)
 * testcases.json         -> TestCaseFile      (written by test-designer)
 * test-data/*.json       -> TestDataFile      (written by test-designer)
 * triage.json            -> TriageFile        (written by report-builder)
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

export type JsonType = 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';

export type JsonFormat = 'date' | 'date-time' | 'email' | 'uri' | 'uuid';

/** Minimal JSON-schema subset that the agent understands end to end. */
export interface JsonSchema {
  type?: JsonType;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: Array<string | number>;
  format?: JsonFormat;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
  nullable?: boolean;
  example?: unknown;
  description?: string;
  /** server generated (ids, timestamps) - never sent in request bodies */
  readOnly?: boolean;
}

export interface ParamSpec {
  name: string;
  in: 'path' | 'query' | 'header';
  required: boolean;
  schema: JsonSchema;
  description?: string;
}

/**
 * OAuth2 / OpenID Connect is not run by the agent: a spec that only declares OAuth2 is treated as "bearer"
 * (a ready access token in <API>_ADMIN_TOKEN).
 */
export type AuthType = 'none' | 'bearer' | 'basic' | 'apiKey' | 'cookie';

export interface LoginSpec {
  method: HttpMethod;
  path: string;
  usernameField: string;
  passwordField: string;
  /** dotted path of the token in the login response */
  tokenField: string;
  endpointId: string;
}

export interface AuthScheme {
  type: AuthType;
  /** header name for apiKey / bearer / basic (default Authorization) */
  headerName?: string;
  /** prefix for header tokens, e.g. "Bearer" */
  prefix?: string;
  /** cookie name for cookie-token auth */
  cookieName?: string;
  /** an additional scheme the API also accepts (e.g. Basic as alternative to cookie) */
  alternative?: AuthType;
  login?: LoginSpec;
  /** every scheme declared by the spec: name -> type (apiKey, http, oauth2, openIdConnect ...) */
  declaredSchemes?: Record<string, string>;
  /** status for missing/invalid credentials (documented or assumed) */
  unauthenticatedStatus: number;
  /** status for authenticated-but-not-allowed */
  forbiddenStatus: number;
  /** true when unauthenticatedStatus comes from documentation, false when assumed */
  statusDocumented: boolean;
  roles: string[];
  notes: string[];
}

export interface EndpointSpec {
  /** stable slug, e.g. "posts_id_GET" */
  id: string;
  /** resource group, first path segment, e.g. "posts" */
  group: string;
  method: HttpMethod;
  /** path template relative to baseUrl, e.g. "/posts/{id}" */
  path: string;
  summary: string;
  pathParams: ParamSpec[];
  queryParams: ParamSpec[];
  /** request headers the API requires (Accept, Content-Type ...) */
  requiredHeaders: Record<string, string>;
  requestBody?: { contentType: string; schema: JsonSchema };
  /** set when the endpoint consumes a non-JSON body (multipart/form-data, x-www-form-urlencoded) */
  requestContentType?: string;
  successStatus: number;
  responseSchema?: JsonSchema;
  /** "application/json" or "text/plain" ... */
  responseContentType: string;
  requiresAuth: boolean;
  adminOnly: boolean;
  /** security scheme names required by this operation (per-operation or global security) */
  securitySchemes?: string[];
  isLogin: boolean;
  notFoundStatus: number;
  badRequestStatus: number;
  /** documented error body schema, if any */
  errorSchema?: JsonSchema;
  /** names of query params used for pagination, when known */
  pagination?: { pageParam?: string; limitParam?: string; maxLimit?: number; firstPage: number };
  /** true when this endpoint (or its limits) was inferred rather than documented */
  inferred: boolean;
}

export interface ResourceSpec {
  name: string;
  collectionPath: string;
  itemPath?: string;
  idParam?: string;
  /** field holding the id in item / list objects */
  idField: string;
  /** dotted path of id in the create response ("id", "bookingid") */
  createIdPath?: string;
  /** dotted path of the entity in the create response ("" = root, "booking") */
  createEntityPath?: string;
  /** a known existing id (from a safe GET probe) */
  sampleId?: string | number;
  /** false when the API only simulates writes (documented) */
  persistsWrites: boolean;
  schema?: JsonSchema;
}

export type SpecSource = 'openapi3' | 'swagger2' | 'apidoc' | 'html-links' | 'endpoint-probe';

export interface EndpointSummary {
  apiName: string;
  envPrefix: string;
  title: string;
  sourceUrl: string;
  baseUrl: string;
  specSource: SpecSource;
  specFile?: string;
  discoveredAt: string;
  auth: AuthScheme;
  endpoints: EndpointSpec[];
  resources: ResourceSpec[];
  defaults: {
    responseTimeMs: number;
    stringMinLength: number;
    stringMaxLength: number;
    numberMin: number;
    numberMax: number;
    arrayMaxItems: number;
  };
  assumptions: string[];
}

// ---------------------------------------------------------------- test cases

export type Category = 'Positive-Functional' | 'Positive-DataValidation' | 'Negative' | 'Boundary' | 'Auth' | 'Authorization';

export const CATEGORIES: Category[] = [
  'Positive-Functional',
  'Positive-DataValidation',
  'Negative',
  'Boundary',
  'Auth',
  'Authorization',
];

export type Identity =
  | 'default'
  | 'admin'
  | 'none'
  | 'invalid'
  | 'expired'
  | 'malformed'
  | 'wrongScheme';

/**
 * Identities backed by real credentials from .env. Only one: the agent tests as admin (or anonymously);
 * there are no normal-user / second-user / limited-scope identities.
 */
export type CredentialKind = 'admin';

/** Token-hygiene manipulations of a real token (applied at runtime; tokens never stored). */
export type TokenMutation = 'query' | 'algNone' | 'tampered';

/** OWASP API Security Top 10 (2023) ids used in authorization findings. */
export type OwaspApiId = 'API2:2023' | 'API3:2023';

export const OWASP_NAMES: Record<OwaspApiId, string> = {
  'API2:2023': 'Broken Authentication',
  'API3:2023': 'Broken Object Property Level Authorization',
};

export type Severity = 'Critical' | 'High' | 'Medium' | 'Low';

/** How the generated test obtains the id for item endpoints. */
export type IdSource = 'none' | 'existing' | 'created' | 'literal';

export type Flow =
  | 'single'
  | 'idempotent'
  | 'crud-lifecycle'
  | 'filter-subset'
  | 'pagination'
  | 'login';

export interface TestStep {
  action: string;
  expected: string;
}

export interface CaseRequest {
  method: HttpMethod;
  path: string;
  identity: Identity;
  idSource: IdSource;
  /** key into test-data/<file>.json */
  dataFile?: 'valid' | 'invalid' | 'boundary';
  dataKey?: string;
  /** token hygiene check kind (Authorization category) */
  tokenTest?: TokenMutation | 'afterLogout';
}

export interface CaseExpectation {
  status: number[];
  /** assert application/json content type */
  json: boolean;
  /** zod export name in schemas/<group>.schema.ts */
  schema?: string;
  /** compare request body fields with response entity */
  echo?: boolean;
  /** dotted field -> expected value */
  fields?: Record<string, string | number | boolean | null>;
  /** assert leak-free error body */
  errorBody?: 'json' | 'safe';
  maxResponseTimeMs: number;
  /** response must be a non-empty array */
  nonEmptyArray?: boolean;
  /**
   * Robustness check (the validation rule / limit is NOT documented): a 4xx rejection or a 2xx that stores
   * the sent values exactly both pass; a 5xx, leaked internals or silent data change fail.
   */
  robust?: boolean;
}

/** Fine-grained template selector for the spec generator. */
export type Variant =
  | 'positive'
  | 'negative'
  | 'tolerant'
  | 'auth-reject'
  | 'login-valid'
  | 'login-reject'
  | 'filter-all'
  | 'filter-contains'
  | 'idempotent-read'
  | 'idempotent-put'
  | 'idempotent-delete'
  | 'lifecycle'
  | 'duplicate'
  // Authorization category
  | 'mass-assignment'
  | 'data-exposure'
  | 'token-hygiene';

export interface TestCase {
  id: string;
  variant: Variant;
  title: string;
  description: string;
  module: string;
  endpointId: string;
  group: string;
  category: Category;
  priority: 'High' | 'Medium' | 'Low';
  precondition: string;
  flow: Flow;
  request: CaseRequest;
  expected: CaseExpectation;
  steps: TestStep[];
  requiresCredentials: 'none' | CredentialKind;
  /** OWASP API Top 10 mapping for authorization cases */
  owasp?: OwaspApiId;
  /** expectation derived from an assumption rather than documentation */
  assumptionBased: boolean;
  assumption?: string;
  /** high-level cases: the detailed checks this scenario runs (one test.step each) */
  subCases?: TestCase[];
}

export interface TestCaseFile {
  apiName: string;
  baseUrl: string;
  generatedAt: string;
  /** "high" = one case per endpoint + scenario (default); "detailed" = one case per check */
  level?: 'business' | 'high' | 'detailed';
  /** design-time assumptions (merged with discovery assumptions in reports) */
  assumptions: string[];
  /** coverage items that do not apply to this API, with the reason */
  notApplicable: string[];
  cases: TestCase[];
}

export interface TestDataEntry {
  note: string;
  body?: unknown;
  /** raw body sent as-is (malformed JSON, wrong content type) */
  rawBody?: string;
  contentType?: string;
  pathParams?: Record<string, string | number>;
  query?: Record<string, string | number>;
  headers?: Record<string, string>;
  /** for PUT/PATCH flows: body used to create the resource first */
  setupBody?: unknown;
  /** CRUD lifecycle: full replacement body (PUT) and partial body (PATCH) */
  updateBody?: unknown;
  patchBody?: unknown;
  /** filter flows: query field to verify on every item / on the created item */
  filterField?: string;
  /** mass assignment: privileged / read-only fields added to the body (must be ignored or rejected) */
  privilegedFields?: Record<string, unknown>;
  /** token hygiene: how the real token is manipulated, or 'afterLogout' */
  tokenTest?: TokenMutation | 'afterLogout';
}

export type TestDataFile = Record<string, TestDataEntry>;

// ---------------------------------------------------------------- triage

export type TriageClass = 'Real API defect' | 'Test data issue' | 'Flaky/Environment issue' | 'Contract/Spec mismatch';

export interface Exchange {
  method: string;
  url: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  status: number;
  responseHeaders: Record<string, string>;
  responseBody: string;
  durationMs: number;
  /** identity label used for the request (admin, none, admin+query-token ...) - for the access matrix */
  identity?: string;
  /** path template of the endpoint, e.g. /booking/{id} */
  pathTemplate?: string;
}

export interface TriageItem {
  testId: string;
  title: string;
  category: Category | 'Unknown';
  endpoint: string;
  classification: TriageClass;
  reason: string;
  expected: string;
  actual: string;
  error: string;
  evidence?: Exchange;
  flaky: boolean;
  severity?: Severity;
  owasp?: OwaspApiId;
  /** ids of the root causes (TriageFile.rootCauses) behind this test's failed checks */
  rootCauses?: string[];
}

/**
 * One underlying problem behind many failed checks (e.g. "Invalid input accepted with 200" on 9 endpoints).
 * Developers act on root causes, not on individual failures.
 */
export interface RootCause {
  /** RC1, RC2 ... - position in this run only */
  id: string;
  /** stable grouping key (same problem = same key in every run); used to compare runs in CI */
  key?: string;
  classification: TriageClass;
  severity: Severity;
  /** short developer-facing statement of the problem */
  title: string;
  /** suggested fix / next step */
  hint: string;
  /** failed checks (leaf level) with this cause */
  checks: number;
  testIds: string[];
  endpoints: string[];
  example: { testId: string; expected: string; actual: string };
  owasp?: OwaspApiId;
  /** a precondition/setup failure caused by another root cause (e.g. create returns 500) */
  blockedBy?: string;
}

export interface TriageFile {
  apiName: string;
  generatedAt: string;
  /** Playwright stats.startTime of the run this triage describes (stale when it differs from results.json) */
  runStartedAt?: string;
  /** set when many valid requests failed with 5xx during the run: 5xx are then environment, not defects */
  outageSuspected?: string;
  items: TriageItem[];
  rootCauses?: RootCause[];
}
