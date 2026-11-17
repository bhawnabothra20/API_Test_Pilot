/**
 * Stage "drift" (after "report"): documented behaviour vs observed behaviour.
 *
 *   documented: spec/endpoint-summary.json + the original spec (spec/openapi.json for OpenAPI/Swagger)
 *   observed  : results.json (every recorded request/response of the run, failed check lines),
 *               spec/calibration.json, spec/suggested-overrides.json
 *
 * Outputs (api/<name>/reports/):
 *   spec-drift.json          one item per drift: endpoint, kind, documented, observed, evidence TC ids,
 *                            confidence, recommendation "fix API" | "fix docs"
 *   openapi-patch.json       RFC 6902 JSON Patch against spec/openapi.json (OpenAPI/Swagger sources only)
 *   openapi-suggested.yaml   the original spec with the patch applied (OpenAPI/Swagger sources only)
 *
 * The rule: where the documentation is SILENT, document what was consistently observed ("fix docs", with a
 * patch); where it is EXPLICIT, the API must comply ("fix API", never a patch). Documented rules are never
 * rewritten to match a broken API - those stay Real API defects. A doc change is suggested only from
 * consistent evidence: >= 2 checks, none of them a 5xx, and never from an endpoint that answered 5xx or
 * accepted invalid input with 2xx (those candidates are listed under `withheld`, not patched).
 */
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { apiPaths, readJson, redact, writeJson } from '../shared/helpers/env';
import { inferSchema, SENSITIVE_FIELD } from '../shared/helpers/json-schema';
import type { EndpointSpec, EndpointSummary, Exchange, JsonSchema, TestCase, TestCaseFile } from '../shared/helpers/types';
import { isDocumented, kindOf, type Calibration } from './contract';
import { readResults, type TestResultRow } from './triage-failures';

export type DriftKind =
  | 'server-error'
  | 'validation-not-enforced'
  | 'status-mismatch'
  | 'sensitive-field'
  | 'missing-field'
  | 'type-mismatch'
  | 'content-type-mismatch'
  | 'simulated-writes'
  | 'undocumented-status'
  | 'undocumented-field'
  | 'undocumented-content-type';

export type Recommendation = 'fix API' | 'fix docs';
export type Confidence = 'high' | 'medium' | 'low';

export interface DriftItem {
  id: string;
  /** "GET /pet/{petId}" or "all protected endpoints" */
  endpoint: string;
  endpointId?: string;
  kind: DriftKind;
  documented: string;
  observed: string;
  /** TC ids (high-level, or detailed check ids from calibration) that show the behaviour */
  evidence: string[];
  /** number of observations (checks / responses) behind the item */
  checks: number;
  confidence: Confidence;
  recommendation: Recommendation;
  rationale: string;
  /** indexes of the operations in openapi-patch.json that implement this item */
  patchOps?: number[];
}

export interface JsonPatchOp {
  op: 'add';
  path: string;
  value: unknown;
}

export interface SpecDriftReport {
  apiName: string;
  generatedAt: string;
  /** Playwright stats.startTime of the run this drift report describes (stale when it differs) */
  runStartedAt?: string;
  specSource: string;
  /** the document openapi-patch.json applies to (relative to api/<name>/) */
  specFile?: string;
  patchable: boolean;
  totals: { items: number; fixApi: number; fixDocs: number; patchOps: number; withheld: number };
  items: DriftItem[];
  /** doc-change candidates NOT suggested because the evidence is not clean (5xx / accepted invalid input / < 2 checks) */
  withheld: Array<{ endpoint: string; candidate: string; reason: string }>;
  /** documented behaviour the run confirmed */
  confirmed: string[];
  notes: string[];
}

type Obj = Record<string, unknown>;

const POSITIVE = new Set(['Positive-Functional', 'Positive-DataValidation']);
const MAX_EVIDENCE = 20;
const ENV_STATUSES = new Set([408, 429]);

const confidenceOf = (n: number): Confidence => (n >= 5 ? 'high' : n >= 2 ? 'medium' : 'low');
const label = (e: EndpointSpec): string => `${e.method} ${e.path}`;
const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];
const ptrEsc = (s: string): string => s.replace(/~/g, '~0').replace(/\//g, '~1');
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

export function driftFiles(apiName: string) {
  const reports = apiPaths(apiName).reports;
  return {
    drift: path.join(reports, 'spec-drift.json'),
    patch: path.join(reports, 'openapi-patch.json'),
    suggested: path.join(reports, 'openapi-suggested.yaml'),
  };
}

// ----------------------------------------------------------------------------- JSON pointer helpers

function getAt(doc: unknown, pointer: string): unknown {
  if (pointer === '') return doc;
  let node: unknown = doc;
  for (const raw of pointer.slice(1).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (Array.isArray(node)) node = node[Number(key)];
    else if (isObj(node)) node = node[key];
    else return undefined;
  }
  return node;
}

/** Follows local $refs ("#/definitions/Pet") to the pointer of the actual schema. */
function deref(doc: unknown, pointer: string, hops = 0): string {
  const node = getAt(doc, pointer);
  if (hops < 10 && isObj(node) && typeof node.$ref === 'string' && node.$ref.startsWith('#/')) return deref(doc, node.$ref.slice(1), hops + 1);
  return pointer;
}

/** Applies "add" operations (RFC 6902 semantics for object members) to a copy of the document. */
export function applyPatch(doc: unknown, ops: JsonPatchOp[]): unknown {
  const out = JSON.parse(JSON.stringify(doc)) as unknown;
  for (const op of ops) {
    const idx = op.path.lastIndexOf('/');
    const parent = getAt(out, op.path.slice(0, idx));
    const key = op.path.slice(idx + 1).replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isObj(parent)) throw new Error(`JSON Patch: parent of ${op.path} does not exist`);
    parent[key] = JSON.parse(JSON.stringify(op.value));
  }
  return out;
}

// ----------------------------------------------------------------------------- original spec access

interface SpecDoc {
  doc: Obj;
  swagger2: boolean;
}

function operationPointer(spec: SpecDoc, e: EndpointSpec): string | undefined {
  const paths = spec.doc.paths;
  if (!isObj(paths)) return undefined;
  const norm = (p: string) => p.replace(/\{[^}]+\}/g, '{}').replace(/\/+$/, '') || '/';
  const target = norm(e.path);
  const keys = Object.keys(paths);
  const key = keys.find((k) => norm(k) === target) ?? keys.find((k) => norm(k).endsWith(target) && target !== '/');
  if (!key) return undefined;
  const ptr = `/paths/${ptrEsc(key)}/${e.method.toLowerCase()}`;
  return isObj(getAt(spec.doc, ptr)) ? ptr : undefined;
}

function documentedStatuses(spec: SpecDoc, opPtr: string): string[] {
  const responses = getAt(spec.doc, `${opPtr}/responses`);
  return isObj(responses) ? Object.keys(responses) : [];
}

function responsePointer(spec: SpecDoc, opPtr: string, status: number): string | undefined {
  const ptr = `${opPtr}/responses/${status}`;
  return getAt(spec.doc, ptr) === undefined ? undefined : deref(spec.doc, ptr);
}

/** Pointer of the response body schema (refs followed), or undefined. */
function responseSchemaPointer(spec: SpecDoc, opPtr: string, status: number): string | undefined {
  const resp = responsePointer(spec, opPtr, status);
  if (!resp) return undefined;
  if (spec.swagger2) return getAt(spec.doc, `${resp}/schema`) ? deref(spec.doc, `${resp}/schema`) : undefined;
  const content = getAt(spec.doc, `${resp}/content`);
  if (!isObj(content)) return undefined;
  const mime = Object.keys(content).find((k) => /json/i.test(k)) ?? Object.keys(content)[0];
  const ptr = `${resp}/content/${ptrEsc(mime)}/schema`;
  return mime && getAt(spec.doc, ptr) ? deref(spec.doc, ptr) : undefined;
}

function documentedMediaTypes(spec: SpecDoc, opPtr: string, status: number): string[] {
  if (spec.swagger2) {
    const own = getAt(spec.doc, `${opPtr}/produces`);
    const global = spec.doc.produces;
    return (Array.isArray(own) ? own : Array.isArray(global) ? global : []).map(String);
  }
  const resp = responsePointer(spec, opPtr, status);
  const content = resp ? getAt(spec.doc, `${resp}/content`) : undefined;
  return isObj(content) ? Object.keys(content) : [];
}

/** Schema pointer of the object that holds `segments` (field path; "[]" = array items). */
function parentSchemaPointer(spec: SpecDoc, root: string, segments: string[]): string | undefined {
  let ptr = root;
  for (const seg of segments) {
    ptr = deref(spec.doc, seg === '[]' ? `${ptr}/items` : `${ptr}/properties/${ptrEsc(seg)}`);
    if (getAt(spec.doc, ptr) === undefined) return undefined;
  }
  return ptr;
}

/** OpenAPI-compatible schema for an observed field (no `required`, no nullable in Swagger 2). */
function suggestedSchema(values: unknown[], swagger2: boolean): JsonSchema {
  const strip = (s: JsonSchema): JsonSchema => {
    const { required: _r, nullable, readOnly: _ro, example: _ex, ...rest } = s;
    const out: JsonSchema = { ...rest };
    if (nullable && !swagger2) out.nullable = true;
    if (out.type === 'null') delete out.type;
    if (out.properties) out.properties = Object.fromEntries(Object.entries(out.properties).map(([k, v]) => [k, strip(v)]));
    if (out.items) out.items = strip(out.items);
    return out;
  };
  return { ...strip(inferSchema(values)), description: 'Observed in API responses (suggested by api-test-pilot spec drift - please verify).' };
}

// ----------------------------------------------------------------------------- observed behaviour

interface Observation {
  endpoint: EndpointSpec;
  ex: Exchange;
  row: TestResultRow;
  category: string;
}

interface LeafResult {
  leaf: TestCase;
  row: TestResultRow;
  line?: string;
  got?: number;
}

const actualType = (v: unknown): string => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v);
const typeMatches = (want: string | undefined, got: string): boolean => !want || want === got || (want === 'number' && got === 'integer');

interface BodyDiff {
  extra: Map<string, unknown[]>;
  missing: Set<string>;
  mismatch: Map<string, string>;
}

/** Compares one observed value with the documented schema; field paths use "." and "[]" for array items. */
function diffBody(schema: JsonSchema | undefined, value: unknown, at: string[], out: BodyDiff, depth = 0): void {
  if (!schema || depth > 6) return;
  const key = at.join('.');
  const got = actualType(value);
  if (value === null) {
    if (!schema.nullable && schema.type && schema.type !== 'null') out.mismatch.set(key, 'null');
    return;
  }
  if (!typeMatches(schema.type, got)) {
    out.mismatch.set(key, got);
    return;
  }
  if (isObj(value) && schema.properties && Object.keys(schema.properties).length) {
    for (const [k, v] of Object.entries(value)) {
      const p = [...at, k];
      if (!(k in schema.properties)) out.extra.set(p.join('.'), [...(out.extra.get(p.join('.')) ?? []), v]);
      else diffBody(schema.properties[k], v, p, out, depth + 1);
    }
    for (const r of schema.required ?? []) if (!(r in value)) out.missing.add([...at, r].join('.'));
  }
  if (Array.isArray(value) && schema.items) for (const item of value.slice(0, 20)) diffBody(schema.items, item, [...at, '[]'], out, depth + 1);
}

function parseJson(text: string): unknown {
  if (!text || /\.\.\.\[truncated \d+ chars\]$/.test(text)) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

// ----------------------------------------------------------------------------- analysis

export function specDrift(apiName: string): SpecDriftReport {
  const paths = apiPaths(apiName);
  const summary = readJson<EndpointSummary>(paths.summary);
  const tcFile = readJson<TestCaseFile>(paths.testCasesJson);
  const { rows, report } = readResults(apiName);
  const calibration = fs.existsSync(path.join(paths.spec, 'calibration.json')) ? readJson<Calibration>(path.join(paths.spec, 'calibration.json')) : undefined;
  const suggestedFile = path.join(paths.spec, 'suggested-overrides.json');
  const noValidation = new Set(fs.existsSync(suggestedFile) ? (readJson<{ noValidation?: string[] }>(suggestedFile).noValidation ?? []) : []);

  const isSpec = summary.specSource === 'openapi3' || summary.specSource === 'swagger2';
  const specPath = summary.specFile ? path.join(paths.root, summary.specFile) : undefined;
  const spec: SpecDoc | undefined =
    isSpec && specPath && fs.existsSync(specPath) ? { doc: readJson<Obj>(specPath), swagger2: summary.specSource === 'swagger2' } : undefined;
  const schemaDocumented = isSpec || summary.specSource === 'apidoc';

  const endpointById = new Map(summary.endpoints.map((e) => [e.id, e]));
  const endpointOf = (method: string, tpl: string | undefined) => summary.endpoints.find((e) => e.method === method && e.path === tpl);
  const caseById = new Map(tcFile.cases.map((c) => [c.id, c]));

  // every request under test, mapped to its endpoint
  const observations: Observation[] = [];
  for (const row of rows) {
    if (row.outcome === 'skipped') continue;
    const category = caseById.get(row.id)?.category ?? 'Unknown';
    for (const ex of row.exchanges) {
      const endpoint = endpointOf(ex.method, ex.pathTemplate);
      if (endpoint) observations.push({ endpoint, ex, row, category });
    }
  }

  // every detailed check with its failure line (if any) and observed status
  const leaves: LeafResult[] = [];
  for (const c of tcFile.cases) {
    const row = rows.find((r) => r.id === c.id);
    if (!row || row.outcome === 'skipped') continue;
    for (const leaf of c.subCases ?? [c]) {
      const line = row.outcome === 'failed' ? (c.subCases ? row.error.split('\n').find((l) => l.startsWith(`• [${leaf.id}]`)) : row.error) : undefined;
      const got = line ? Number(/but got (\d{3})/.exec(line)?.[1] ?? /-> (\d{3})/.exec(line)?.[1] ?? NaN) : NaN;
      leaves.push({ leaf, row, line, got: Number.isFinite(got) ? got : undefined });
    }
  }

  const has5xx = new Set(observations.filter((o) => o.ex.status >= 500).map((o) => o.endpoint.id));
  const acceptedInvalid = new Set([
    ...noValidation,
    ...leaves.filter((l) => kindOf(l.leaf) === 'validation' && l.got !== undefined && l.got >= 200 && l.got < 300).map((l) => l.leaf.endpointId),
  ]);
  const docBlocker = (endpointId: string): string | undefined =>
    has5xx.has(endpointId) ? 'endpoint answered 5xx in this run' : acceptedInvalid.has(endpointId) ? 'endpoint accepted invalid input with 2xx' : undefined;

  const items: Array<Omit<DriftItem, 'id'>> = [];
  const withheld: SpecDriftReport['withheld'] = [];
  const confirmed: string[] = [];
  const notes: string[] = [];
  const ops: JsonPatchOp[] = [];
  const opIndex = new Map<string, number>();
  const addOp = (p: string, value: unknown): number => {
    if (opIndex.has(p)) return opIndex.get(p)!;
    ops.push({ op: 'add', path: p, value });
    opIndex.set(p, ops.length - 1);
    return ops.length - 1;
  };
  const evidenceOf = (rs: TestResultRow[]) => uniq(rs.map((r) => r.id)).slice(0, MAX_EVIDENCE);

  // 1. server errors - never documented, always the API's to fix
  for (const [id, list] of groupBy(observations.filter((o) => o.ex.status >= 500), (o) => o.endpoint.id)) {
    const e = endpointById.get(id)!;
    const statuses = uniq(list.map((o) => o.ex.status)).sort();
    items.push({
      endpoint: label(e),
      endpointId: id,
      kind: 'server-error',
      documented: 'No 5xx response documented for client input',
      observed: `HTTP ${statuses.join('/')} in ${list.length} response${list.length === 1 ? '' : 's'}`,
      evidence: evidenceOf(list.map((o) => o.row)),
      checks: list.length,
      confidence: confidenceOf(list.length),
      recommendation: 'fix API',
      rationale: 'A server error is never a contract to document: the API must handle this input (400/422 for invalid input, success for valid input).',
    });
  }

  // 2. documented validation not enforced (invalid input accepted with 2xx)
  const accepted = leaves.filter((l) => kindOf(l.leaf) === 'validation' && l.got !== undefined && l.got >= 200 && l.got < 300 && isDocumented(summary, l.leaf, 'validation'));
  for (const [id, list] of groupBy(accepted, (l) => l.leaf.endpointId)) {
    const e = endpointById.get(id);
    if (!e) continue;
    const expected = uniq(list.flatMap((l) => l.leaf.expected.status)).join('/');
    items.push({
      endpoint: label(e),
      endpointId: id,
      kind: 'validation-not-enforced',
      documented: `Invalid input is rejected with ${expected}`,
      observed: `Accepted with HTTP ${uniq(list.map((l) => l.got)).join('/')} in ${list.length} check${list.length === 1 ? '' : 's'} (e.g. ${list[0].leaf.title})`,
      evidence: uniq(list.map((l) => l.leaf.id)).slice(0, MAX_EVIDENCE),
      checks: list.length,
      confidence: confidenceOf(list.length),
      recommendation: 'fix API',
      rationale: 'The documented validation rule is not enforced. Documented rules are never relaxed to match the API.',
    });
  }

  // 3. documented status contradicted by a different 4xx
  const contradicted = new Set<string>(); // endpointId|status - never suggested as documentation
  const mismatched = leaves.filter((l) => {
    if (!l.line || l.got === undefined || l.got < 400 || l.got >= 500 || l.leaf.expected.status.includes(l.got)) return false;
    if (l.leaf.expected.robust || l.leaf.variant === 'tolerant') return false;
    const kind = kindOf(l.leaf);
    const e = endpointById.get(l.leaf.endpointId);
    return kind ? isDocumented(summary, l.leaf, kind) : isSpec && !!e && !e.inferred && !l.leaf.assumptionBased;
  });
  for (const [k, list] of groupBy(mismatched, (l) => `${l.leaf.endpointId}|${l.leaf.expected.status.join('/')}|${l.got}`)) {
    const [id, expected, got] = k.split('|');
    const e = endpointById.get(id);
    if (!e) continue;
    contradicted.add(`${id}|${got}`);
    items.push({
      endpoint: label(e),
      endpointId: id,
      kind: 'status-mismatch',
      documented: `HTTP ${expected}`,
      observed: `HTTP ${got} in ${list.length} check${list.length === 1 ? '' : 's'} (e.g. ${list[0].leaf.title})`,
      evidence: uniq(list.map((l) => l.leaf.id)).slice(0, MAX_EVIDENCE),
      checks: list.length,
      confidence: confidenceOf(list.length),
      recommendation: 'fix API',
      rationale: 'The documentation states a different status for this case; documented behaviour wins.',
    });
  }

  // 4. response bodies vs the documented schema (valid requests with a success status only)
  if (schemaDocumented) {
    for (const e of summary.endpoints.filter((x) => !x.inferred && x.responseSchema)) {
      const bodies = observations
        .filter((o) => o.endpoint.id === e.id && o.ex.status === e.successStatus && POSITIVE.has(o.category))
        .map((o) => ({ o, json: parseJson(o.ex.responseBody) }))
        .filter((b) => b.json !== undefined);
      if (!bodies.length) continue;
      const extra = new Map<string, { values: unknown[]; rows: TestResultRow[] }>();
      const missing = new Map<string, TestResultRow[]>();
      const mismatch = new Map<string, { types: string[]; rows: TestResultRow[] }>();
      for (const b of bodies) {
        const d: BodyDiff = { extra: new Map(), missing: new Set(), mismatch: new Map() };
        diffBody(e.responseSchema, b.json, [], d);
        for (const [p, vs] of d.extra) extra.set(p, { values: [...(extra.get(p)?.values ?? []), ...vs], rows: [...(extra.get(p)?.rows ?? []), b.o.row] });
        for (const p of d.missing) missing.set(p, [...(missing.get(p) ?? []), b.o.row]);
        for (const [p, t] of d.mismatch) mismatch.set(p, { types: [...(mismatch.get(p)?.types ?? []), t], rows: [...(mismatch.get(p)?.rows ?? []), b.o.row] });
      }
      const n = bodies.length;
      const consistent = (count: number) => count >= 2 && count === n; // in every observed response

      for (const [field, v] of extra) {
        const count = v.rows.length;
        const name = field.split('.').pop() ?? field;
        if (SENSITIVE_FIELD.test(name)) {
          items.push({
            endpoint: label(e),
            endpointId: e.id,
            kind: 'sensitive-field',
            documented: `Field "${field}" is not documented`,
            observed: `Response contains sensitive field "${field}" (${count} of ${n} responses)`,
            evidence: evidenceOf(v.rows),
            checks: count,
            confidence: confidenceOf(count),
            recommendation: 'fix API',
            rationale: 'Excessive data exposure (OWASP API3:2023): remove the field from the response instead of documenting it.',
          });
          continue;
        }
        if (!consistent(count)) {
          withheld.push({ endpoint: label(e), candidate: `document response field "${field}"`, reason: `seen in ${count} of ${n} responses (needs >= 2 and every response)` });
          continue;
        }
        const item: Omit<DriftItem, 'id'> = {
          endpoint: label(e),
          endpointId: e.id,
          kind: 'undocumented-field',
          documented: `Field "${field}" is not in the documented response schema`,
          observed: `Present in all ${n} successful responses (type ${actualType(v.values[0])})`,
          evidence: evidenceOf(v.rows),
          checks: count,
          confidence: confidenceOf(count),
          recommendation: 'fix docs',
          rationale: 'The documentation is silent about a field the API consistently returns: document it (or remove it from the response if it is not meant to be public).',
        };
        if (spec) {
          const op = operationPointer(spec, e);
          const root = op ? responseSchemaPointer(spec, op, e.successStatus) : undefined;
          const segs = field.split('.');
          const parent = root ? parentSchemaPointer(spec, root, segs.slice(0, -1)) : undefined;
          if (parent) {
            const idx: number[] = [];
            if (!isObj(getAt(spec.doc, `${parent}/properties`))) idx.push(addOp(`${parent}/properties`, {}));
            idx.push(addOp(`${parent}/properties/${ptrEsc(segs[segs.length - 1])}`, suggestedSchema(v.values, spec.swagger2)));
            item.patchOps = idx;
          } else {
            notes.push(`No patch for ${label(e)} field "${field}": its schema location in the original spec could not be resolved.`);
          }
        }
        items.push(item);
      }
      for (const [field, rs] of missing) {
        if (!consistent(rs.length)) continue;
        items.push({
          endpoint: label(e),
          endpointId: e.id,
          kind: 'missing-field',
          documented: `Required field "${field}"`,
          observed: `Missing in all ${n} successful responses`,
          evidence: evidenceOf(rs),
          checks: rs.length,
          confidence: confidenceOf(rs.length),
          recommendation: 'fix API',
          rationale: 'A documented required field is never returned. Return it - or, if the field was dropped on purpose, change the documentation explicitly (not suggested automatically).',
        });
      }
      for (const [field, v] of mismatch) {
        if (!consistent(v.rows.length)) continue;
        const want = schemaAt(e.responseSchema, field)?.type ?? 'documented type';
        items.push({
          endpoint: label(e),
          endpointId: e.id,
          kind: 'type-mismatch',
          documented: `"${field || '<body>'}" is ${want}`,
          observed: `${uniq(v.types).join('/')} in all ${n} successful responses`,
          evidence: evidenceOf(v.rows),
          checks: v.rows.length,
          confidence: confidenceOf(v.rows.length),
          recommendation: 'fix API',
          rationale: 'The documented type is contradicted. Documented types are never changed to match the API automatically.',
        });
      }

      // content type of successful responses
      if (spec) {
        const op = operationPointer(spec, e);
        const observed = uniq(bodies.map((b) => (b.o.ex.responseHeaders['content-type'] ?? '').split(';')[0].trim().toLowerCase()).filter(Boolean));
        if (op && observed.length === 1 && n >= 2) {
          const documented = documentedMediaTypes(spec, op, e.successStatus).map((m) => m.toLowerCase());
          if (!documented.length) {
            const item: Omit<DriftItem, 'id'> = {
              endpoint: label(e),
              endpointId: e.id,
              kind: 'undocumented-content-type',
              documented: 'No response media type documented',
              observed: `${observed[0]} in all ${n} successful responses`,
              evidence: evidenceOf(bodies.map((b) => b.o.row)),
              checks: n,
              confidence: confidenceOf(n),
              recommendation: 'fix docs',
              rationale: 'Document the media type the API consistently returns.',
            };
            if (spec.swagger2) item.patchOps = [addOp(`${op}/produces`, [observed[0]])];
            else {
              const resp = responsePointer(spec, op, e.successStatus);
              if (resp && getAt(spec.doc, `${resp}/content`) === undefined) item.patchOps = [addOp(`${resp}/content`, { [observed[0]]: {} })];
            }
            items.push(item);
          } else if (!documented.includes(observed[0]) && !documented.some((d) => d === '*/*')) {
            items.push({
              endpoint: label(e),
              endpointId: e.id,
              kind: 'content-type-mismatch',
              documented: documented.join(', '),
              observed: `${observed[0]} in all ${n} successful responses`,
              evidence: evidenceOf(bodies.map((b) => b.o.row)),
              checks: n,
              confidence: confidenceOf(n),
              recommendation: 'fix API',
              rationale: 'The API returns a media type the documentation does not list.',
            });
          }
        }
      }
    }
  }

  // 5. undocumented 4xx status codes: calibrated conventions + responses missing from the spec
  interface StatusCandidate {
    endpoints: EndpointSpec[];
    status: number;
    evidence: string[];
    checks: number;
    source: string;
  }
  const candidates = new Map<string, StatusCandidate>();
  for (const conv of calibration?.conventions ?? []) {
    const eps = conv.kind === 'unauthenticated' ? summary.endpoints.filter((x) => x.requiresAuth) : [endpointById.get(conv.endpointId ?? '')].filter((x): x is EndpointSpec => !!x);
    for (const e of eps) {
      candidates.set(`${e.id}|${conv.observed}`, {
        endpoints: [e],
        status: conv.observed,
        evidence: conv.checks.slice(0, MAX_EVIDENCE),
        checks: conv.checks.length,
        source: `calibrated convention (${conv.kind}): assumed ${conv.assumed.join('/')}, observed ${conv.observed} consistently`,
      });
    }
  }
  if (spec) {
    for (const [k, list] of groupBy(
      observations.filter((o) => o.ex.status >= 400 && o.ex.status < 500 && !ENV_STATUSES.has(o.ex.status)),
      (o) => `${o.endpoint.id}|${o.ex.status}`,
    )) {
      const e = list[0].endpoint;
      const op = operationPointer(spec, e);
      if (!op || documentedStatuses(spec, op).includes(String(list[0].ex.status))) continue;
      const prev = candidates.get(k);
      candidates.set(k, {
        endpoints: [e],
        status: list[0].ex.status,
        evidence: uniq([...(prev?.evidence ?? []), ...evidenceOf(list.map((o) => o.row))]).slice(0, MAX_EVIDENCE),
        checks: Math.max(prev?.checks ?? 0, list.length),
        source: prev?.source ?? `observed in ${list.length} responses; not listed in the operation's responses`,
      });
    }
  }
  for (const [k, c] of candidates) {
    const e = c.endpoints[0];
    const op = spec ? operationPointer(spec, e) : undefined;
    if (spec && op && documentedStatuses(spec, op).includes(String(c.status))) {
      confirmed.push(`${label(e)}: ${c.status} is documented and observed`);
      continue;
    }
    const blocker = contradicted.has(k) ? 'contradicts a documented status (see status-mismatch)' : c.checks < 2 ? `only ${c.checks} check` : docBlocker(e.id);
    if (blocker) {
      withheld.push({ endpoint: label(e), candidate: `document HTTP ${c.status}`, reason: blocker });
      continue;
    }
    const item: Omit<DriftItem, 'id'> = {
      endpoint: label(e),
      endpointId: e.id,
      kind: 'undocumented-status',
      documented: 'Not documented',
      observed: `HTTP ${c.status} - ${c.source}`,
      evidence: c.evidence,
      checks: c.checks,
      confidence: confidenceOf(c.checks),
      recommendation: 'fix docs',
      rationale: `The documentation is silent and the API consistently answers ${c.status}: document it.`,
    };
    if (spec && op) item.patchOps = [addOp(`${op}/responses/${c.status}`, { description: `${statusText(c.status)} (observed; suggested by api-test-pilot spec drift - please verify).` })];
    items.push(item);
  }

  // 6. documented simulated writes
  for (const r of summary.resources.filter((x) => !x.persistsWrites)) {
    const lifecycle = tcFile.cases.filter((c) => c.group === r.name && /simulated-write contract/.test(c.title));
    for (const c of lifecycle) {
      const row = rows.find((x) => x.id === c.id);
      if (!row || row.outcome === 'skipped') continue;
      if (row.outcome !== 'failed') {
        confirmed.push(`${r.name}: documented simulated writes confirmed (${c.id})`);
        continue;
      }
      const e = summary.endpoints.find((x) => x.method === 'POST' && x.path === r.collectionPath);
      items.push({
        endpoint: e ? label(e) : `${r.name} (lifecycle)`,
        endpointId: e?.id,
        kind: 'simulated-writes',
        documented: 'Writes are simulated: answered and echoed, nothing persisted',
        observed: (row.error.split('\n').find((l) => l.trim()) ?? 'lifecycle check failed').slice(0, 300),
        evidence: [c.id],
        checks: 1,
        confidence: 'low',
        recommendation: 'fix API',
        rationale: 'The documented simulation contract does not hold. If the API now persists writes on purpose, change the documentation explicitly.',
      });
    }
  }

  // order: fix API first (most observations first), then fix docs
  items.sort((a, b) => (a.recommendation === b.recommendation ? b.checks - a.checks : a.recommendation === 'fix API' ? -1 : 1));
  const numbered: DriftItem[] = items.map((it, i) => ({ id: `D${i + 1}`, ...it }));

  if (!spec) notes.push(isSpec ? 'Original spec file not found - no JSON Patch written.' : `Spec source is ${summary.specSource}: no OpenAPI document to patch; drift items only.`);
  if (summary.specSource === 'endpoint-probe' || summary.specSource === 'html-links') {
    notes.push('Most of the documented model was inferred, so only calibrated conventions, server errors and simulated writes can be compared.');
  }

  const out: SpecDriftReport = {
    apiName,
    generatedAt: new Date().toISOString(),
    runStartedAt: report?.stats?.startTime,
    specSource: summary.specSource,
    specFile: spec ? summary.specFile : undefined,
    patchable: !!spec,
    totals: {
      items: numbered.length,
      fixApi: numbered.filter((i) => i.recommendation === 'fix API').length,
      fixDocs: numbered.filter((i) => i.recommendation === 'fix docs').length,
      patchOps: ops.length,
      withheld: withheld.length,
    },
    items: numbered,
    withheld,
    confirmed,
    notes,
  };

  const f = driftFiles(apiName);
  fs.writeFileSync(f.drift, redact(JSON.stringify(out, null, 2)) + '\n', 'utf8');
  for (const file of [f.patch, f.suggested]) if (fs.existsSync(file)) fs.rmSync(file);
  if (spec) {
    writeJson(f.patch, ops);
    const patched = applyPatch(spec.doc, ops); // throws when an op does not apply - the patch is always valid
    fs.writeFileSync(f.suggested, YAML.stringify(patched), 'utf8');
  }
  return out;
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const x of xs) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return m;
}

function schemaAt(schema: JsonSchema | undefined, field: string): JsonSchema | undefined {
  let s = schema;
  for (const seg of field ? field.split('.') : []) s = seg === '[]' ? s?.items : s?.properties?.[seg];
  return s;
}

function statusText(status: number): string {
  const t: Record<number, string> = {
    400: 'Bad request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not found',
    405: 'Method not allowed',
    409: 'Conflict',
    410: 'Gone',
    413: 'Payload too large',
    414: 'URI too long',
    415: 'Unsupported media type',
    422: 'Unprocessable entity',
  };
  return t[status] ?? `HTTP ${status}`;
}

/** Reads the drift report of the CURRENT run (undefined when missing or stale). */
export function readDrift(apiName: string, runStartedAt: string | undefined): SpecDriftReport | undefined {
  const f = driftFiles(apiName).drift;
  if (!fs.existsSync(f)) return undefined;
  const d = readJson<SpecDriftReport>(f);
  return runStartedAt && d.runStartedAt === runStartedAt ? d : undefined;
}

if (require.main === module) {
  const name = process.argv[2];
  if (!name) {
    console.error('usage: tsx scripts/spec-drift.ts <api-name>');
    process.exit(2);
  }
  const r = specDrift(name);
  console.log(`spec drift: ${r.totals.items} items (${r.totals.fixApi} fix API, ${r.totals.fixDocs} fix docs), ${r.totals.patchOps} patch ops, ${r.totals.withheld} withheld`);
}
