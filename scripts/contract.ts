/**
 * Contract calibration + human contract overrides - resolves Contract/Spec mismatches WITHOUT weakening tests.
 *
 * 1. calibrate(apiName)   (stage "calibrate", after "run")
 *    Learns status-code CONVENTIONS the documentation is silent about, from the run results:
 *      - unauthenticated : status for missing/invalid/expired/malformed/wrong-scheme credentials (401 vs 403)
 *      - unknownId       : status for unknown / malformed / out-of-range ids, per endpoint (404 vs 400 vs 405...)
 *      - validation      : status for rejected invalid input, per endpoint (400 vs 422 vs 415...)
 *    A convention is adopted only when ALL of these hold:
 *      - the expectation was an assumption (not documented),
 *      - every check of that convention failed with the SAME observed status (consistent behaviour),
 *      - at least 2 checks (3 for credentials) were observed,
 *      - the observed status is a rejection (4xx from an allowed list) - never a 2xx or 5xx.
 *    Accepting invalid input (2xx) or crashing (5xx) is never learned; those stay findings. Endpoints that
 *    consistently accept invalid input are written to spec/suggested-overrides.json for a human decision.
 *    Output: spec/calibration.json (kept across runs; delete it to reset).
 *
 * 2. contract-overrides.json (optional, written by a human who knows the real contract), e.g.
 *    { "unauthenticatedStatus": 403,
 *      "endpoints": { "booking_id_PUT": { "unknownIdStatus": 405, "validationStatus": 400 } },
 *      "noValidation": ["posts_POST"]  // or ["*"]: the API intentionally does not validate input
 *    }
 *    noValidation turns "rejected with 4xx" checks of those endpoints into "handled safely" checks
 *    (any 2xx/4xx, still never 5xx and never leaking internals).
 *
 * applyContract(apiName) (called by the design stage, before consolidation) applies both to testcases.json.
 */
import fs from 'node:fs';
import path from 'node:path';
import { apiPaths, readJson, writeJson } from '../shared/helpers/env';
import type { EndpointSummary, TestCase, TestCaseFile } from '../shared/helpers/types';
import { readResults } from './triage-failures';

export type ConventionKind = 'unauthenticated' | 'unknownId' | 'validation';

export interface Convention {
  kind: ConventionKind;
  /** endpoint id; undefined for API-wide conventions */
  endpointId?: string;
  assumed: number[];
  observed: number;
  checks: string[];
  learnedAt: string;
}

export interface Calibration {
  apiName: string;
  updatedAt: string;
  conventions: Convention[];
}

export interface ContractOverrides {
  unauthenticatedStatus?: number;
  endpoints?: Record<string, { unknownIdStatus?: number; validationStatus?: number; successStatus?: number }>;
  noValidation?: string[];
  notes?: string;
}

const ALLOWED: Record<ConventionKind, number[]> = {
  unauthenticated: [401, 403],
  unknownId: [400, 404, 405, 410, 422],
  validation: [400, 409, 413, 415, 422],
};
const MIN_CHECKS: Record<ConventionKind, number> = { unauthenticated: 3, unknownId: 2, validation: 2 };
const REJECT_IDENTITIES = ['none', 'invalid', 'expired', 'malformed', 'wrongScheme'];

const files = (apiName: string) => {
  const spec = apiPaths(apiName).spec;
  return {
    calibration: path.join(spec, 'calibration.json'),
    overrides: path.join(spec, 'contract-overrides.json'),
    suggested: path.join(spec, 'suggested-overrides.json'),
  };
};

function readOptional<T>(file: string): T | undefined {
  return fs.existsSync(file) ? readJson<T>(file) : undefined;
}

/** Which convention a detailed check exercises (undefined = not a convention check). */
export function kindOf(c: TestCase): ConventionKind | undefined {
  if (c.variant === 'auth-reject' && REJECT_IDENTITIES.includes(c.request.identity)) return 'unauthenticated';
  if (c.variant !== 'negative') return undefined;
  if (c.request.idSource === 'literal' && !/^Unsupported method/.test(c.title)) return 'unknownId';
  if (c.category === 'Negative' || c.category === 'Boundary') return 'validation';
  return undefined;
}

export function isDocumented(summary: EndpointSummary, c: TestCase, kind: ConventionKind): boolean {
  if (kind === 'unauthenticated') return summary.auth.statusDocumented;
  const e = summary.endpoints.find((x) => x.id === c.endpointId);
  const specDocumentsErrors = summary.specSource === 'openapi3' || summary.specSource === 'swagger2';
  return specDocumentsErrors && !e?.inferred && !c.assumptionBased;
}

function leafCases(file: TestCaseFile): TestCase[] {
  return file.cases.flatMap((c) => c.subCases ?? [c]);
}

// ----------------------------------------------------------------------------- undocumented rules

const ASSUMED_LIMIT = /limits? not documented|range not documented|max (length|items) assumed|assumed \d+\.\.|assumed to allow|Date range limits not documented/i;

/**
 * True when the RULE itself (not just its status code) was invented by the agent: validation/boundary
 * checks on endpoints inferred without a spec, checks against assumed limits, and id checks on resources
 * whose writes are documented as simulated. Such checks cannot be contract violations.
 */
export function ruleAssumed(summary: EndpointSummary, c: TestCase): boolean {
  const e = summary.endpoints.find((x) => x.id === c.endpointId);
  const resource = summary.resources.find((r) => r.name === c.group);
  const kind = kindOf(c);
  const acceptedBoundary = c.category === 'Boundary' && c.variant === 'positive';
  if (kind === 'validation' || acceptedBoundary) {
    return !!e?.inferred || ASSUMED_LIMIT.test(c.assumption ?? '');
  }
  if (kind === 'unknownId') {
    if (!e?.inferred) return false;
    // inferred nested collection routes (/posts/{id}/comments) may answer an unknown parent with an empty list
    if (c.request.method === 'GET' && e.responseSchema?.type === 'array') return true;
    return !!resource && !resource.persistsWrites && c.request.method !== 'GET';
  }
  // uniqueness was guessed (inferred endpoint or "assumed to be unique")
  if (c.variant === 'duplicate') return !!e?.inferred || /assumed to be unique/i.test(c.assumption ?? '');
  return false;
}

const ROBUST_NOTE =
  'Robustness check: this validation rule/limit is not documented, so the check requires safe handling - a 4xx rejection, or a 2xx that stores the sent values exactly - and never a 5xx, leaked internals or silent data change.';

function toRobust(c: TestCase, ok: number[]): void {
  if (c.variant !== 'duplicate') c.variant = 'tolerant'; // duplicate keeps its two-request flow
  c.expected = {
    ...c.expected,
    status: [...new Set([...ok, 200, 201, 204, 400, 404, 405, 409, 413, 414, 415, 422])].sort((a, b) => a - b),
    errorBody: undefined,
    robust: true,
    echo: undefined,
  };
  c.assumptionBased = false;
  c.assumption = ROBUST_NOTE;
  c.title = c.title
    .replace(/ is rejected( with [\d/ or]+)?$/, ' is rejected or stored exactly (rule undocumented), never a 5xx')
    .replace(/ returns [\d/]+$/, ' is handled safely (rule undocumented), never a 5xx')
    .replace(/ is accepted$/, ' is accepted and stored exactly, or rejected cleanly (limit undocumented)')
    .replace(/ is rejected as a duplicate \([^)]*\)$/, ' is handled safely - accepted or rejected as a duplicate (uniqueness undocumented), never a 5xx');
  const send = c.steps.find((s) => s.action.startsWith('Send'));
  if (send) send.expected = `HTTP 2xx with every sent value stored exactly, or a 4xx rejection; never a 5xx; within ${c.expected.maxResponseTimeMs} ms`;
}

/** Lifecycle on a resource documented as "writes are simulated": verify that contract, not persistence. */
function toSimulatedLifecycle(c: TestCase, summary: EndpointSummary): boolean {
  const r = summary.resources.find((x) => x.name === c.group);
  if (c.variant !== 'lifecycle' || !r || r.persistsWrites || /simulated-write contract/.test(c.title)) return false;
  c.title = `CRUD lifecycle for ${r.name} follows the documented simulated-write contract: writes answered and echoed, nothing persisted`;
  c.description = 'Documentation states writes are simulated: create/update/delete must be answered as if they happened (status, echo, id), the created id must not be retrievable and a "deleted" resource must still exist.';
  c.assumptionBased = false;
  c.assumption = undefined;
  c.steps = [
    { action: `POST ${summary.baseUrl}${r.collectionPath} with a valid body`, expected: 'Success status, JSON body echoes the payload and carries an id' },
    { action: `GET ${summary.baseUrl}${r.itemPath} with the returned id`, expected: 'Not found - the create was simulated' },
    { action: `PUT / PATCH ${summary.baseUrl}${r.itemPath} on an existing id`, expected: 'Success status; response echoes the sent values' },
    { action: `DELETE ${summary.baseUrl}${r.itemPath} on that id, then GET it`, expected: 'Delete answers success; the resource is still retrievable (simulated delete)' },
  ];
  return true;
}

// ----------------------------------------------------------------------------- apply

export function applyContract(apiName: string): { changed: number; notes: string[] } {
  const paths = apiPaths(apiName);
  const f = files(apiName);
  const file = readJson<TestCaseFile>(paths.testCasesJson);
  const summary = readJson<EndpointSummary>(paths.summary);
  const calibration = readOptional<Calibration>(f.calibration);
  const overrides = readOptional<ContractOverrides>(f.overrides);

  const notes: string[] = [];
  let changed = 0;
  let robust = 0;
  let simulated = 0;

  // 1. undocumented rules -> robustness checks; simulated writes -> simulation contract (always applied)
  for (const c of leafCases(file)) {
    const e = summary.endpoints.find((x) => x.id === c.endpointId);
    if (toSimulatedLifecycle(c, summary)) simulated++;
    else if (c.variant !== 'tolerant' && !c.expected.robust && ruleAssumed(summary, c)) {
      toRobust(c, e ? [e.successStatus] : [200]);
      robust++;
    }
  }
  if (robust) notes.push(`${robust} checks target validation rules/limits that are not documented; they run as robustness checks (4xx, or 2xx storing values exactly; never 5xx).`);
  if (simulated) notes.push(`${simulated} lifecycle checks verify the documented simulated-write contract instead of persistence.`);
  changed += robust + simulated;
  if (!calibration && !overrides) {
    file.assumptions = [...new Set([...file.assumptions, ...notes])];
    writeJson(paths.testCasesJson, file);
    return { changed, notes };
  }
  const learned = (kind: ConventionKind, endpointId?: string) =>
    calibration?.conventions.find((v) => v.kind === kind && (kind === 'unauthenticated' || v.endpointId === endpointId));

  for (const c of leafCases(file)) {
    const kind = kindOf(c);
    const e = summary.endpoints.find((x) => x.id === c.endpointId);
    const ok = e ? [e.successStatus] : [200];
    const noValidation = overrides?.noValidation?.some((id) => id === '*' || id === c.endpointId);

    // human overrides win over calibration
    const ep = overrides?.endpoints?.[c.endpointId];
    const overridden =
      kind === 'unauthenticated' ? overrides?.unauthenticatedStatus : kind === 'unknownId' ? ep?.unknownIdStatus : kind === 'validation' ? ep?.validationStatus : undefined;
    const calibrated = kind && !isDocumented(summary, c, kind) ? learned(kind, c.endpointId)?.observed : undefined;
    const status = overridden ?? calibrated;
    const source: 'override' | 'calibration' = overridden !== undefined ? 'override' : 'calibration';

    if (kind === 'validation' && noValidation) {
      c.variant = 'tolerant';
      c.expected = { ...c.expected, status: [...new Set([...ok, 200, 201, 204, ...c.expected.status])], errorBody: undefined };
      c.assumptionBased = false;
      c.assumption = 'Contract override: this endpoint intentionally does not validate input; the check requires safe handling (no 5xx, no leaked internals).';
      changed++;
      continue;
    }
    if (status !== undefined && !(c.expected.status.length === 1 && c.expected.status[0] === status)) {
      const before = c.expected.status.join('/');
      c.expected = { ...c.expected, status: [status] };
      if (source === 'override') {
        c.assumptionBased = false;
        c.assumption = `Contract override: ${kind} status is ${status} (was ${before}).`;
      } else {
        c.assumption = `Calibrated convention: the API consistently answers ${status} for ${kind === 'unauthenticated' ? 'rejected credentials' : kind === 'unknownId' ? 'unknown/invalid ids' : 'invalid input'} (assumed ${before}). Undocumented - confirm in contract-overrides.json.`;
      }
      c.title = c.title.replace(new RegExp(`(rejected with |returns )${before.replace(/\//g, '\\/')}`), `$1${status}`);
      changed++;
    }
  }
  if (calibration?.conventions.length) {
    notes.push(
      ...calibration.conventions.map(
        (v) => `Calibrated convention (${v.kind}${v.endpointId ? `, ${v.endpointId}` : ''}): ${v.observed} instead of assumed ${v.assumed.join('/')} - consistent across ${v.checks.length} checks.`,
      ),
    );
  }
  if (overrides) notes.push(`Contract overrides applied from spec/contract-overrides.json${overrides.notes ? ` (${overrides.notes})` : ''}.`);
  file.assumptions = [...new Set([...file.assumptions, ...notes])];
  writeJson(paths.testCasesJson, file);
  return { changed, notes };
}

// ----------------------------------------------------------------------------- calibrate

interface Observation {
  id: string;
  kind: ConventionKind;
  endpointId: string;
  assumed: number[];
  passed: boolean;
  observed?: number;
}

export function calibrate(apiName: string): { learned: Convention[]; suggestions: string[] } {
  const paths = apiPaths(apiName);
  const f = files(apiName);
  const summary = readJson<EndpointSummary>(paths.summary);
  const file = readJson<TestCaseFile>(paths.testCasesJson);
  const { rows } = readResults(apiName);
  const byId = new Map(rows.map((r) => [r.id, r]));

  // observed status per detailed check
  const obs: Observation[] = [];
  const accepted = new Map<string, string[]>(); // endpointId -> validation checks answered with 2xx
  for (const c of file.cases) {
    const row = byId.get(c.id);
    if (!row || row.outcome === 'skipped') continue;
    for (const leaf of c.subCases ?? [c]) {
      const kind = kindOf(leaf);
      if (!kind) continue;
      let line = '';
      if (row.outcome === 'failed') {
        line = c.subCases ? (row.error.split('\n').find((l) => l.startsWith(`• [${leaf.id}]`)) ?? '') : row.error;
      }
      if (isDocumented(summary, leaf, kind)) continue; // documented expectations are never calibrated
      const got = /but got (\d{3})/.exec(line)?.[1];
      const passed = row.outcome !== 'failed' || line === '';
      // a passing check with a single expected code is evidence that the API answered exactly that code
      const observed = got ? Number(got) : passed && leaf.expected.status.length === 1 ? leaf.expected.status[0] : undefined;
      obs.push({ id: leaf.id, kind, endpointId: leaf.endpointId, assumed: leaf.expected.status, passed, observed });
      if (kind === 'validation' && got && Number(got) >= 200 && Number(got) < 300) {
        accepted.set(leaf.endpointId, [...(accepted.get(leaf.endpointId) ?? []), leaf.id]);
      }
    }
  }

  // group: credentials API-wide, the rest per endpoint
  const groups = new Map<string, Observation[]>();
  for (const o of obs) {
    const key = o.kind === 'unauthenticated' ? o.kind : `${o.kind}|${o.endpointId}`;
    groups.set(key, [...(groups.get(key) ?? []), o]);
  }
  const existing = readOptional<Calibration>(f.calibration)?.conventions ?? [];
  const learned: Convention[] = [];
  for (const [key, list] of groups) {
    const kind = list[0].kind;
    // need at least one failed check (something to learn), enough evidence, and ONE code across all checks
    if (list.every((o) => o.passed) || list.length < MIN_CHECKS[kind]) continue;
    // candidate = the single code seen in all checks with a known code; a passing check that allowed
    // several codes is consistent when the candidate is one of them
    const codes = new Set(list.filter((o) => o.observed !== undefined).map((o) => o.observed));
    if (codes.size !== 1) continue;
    const observed = [...codes][0];
    if (list.some((o) => o.observed === undefined && !o.assumed.includes(observed as number))) continue;
    if (observed === undefined || !ALLOWED[kind].includes(observed)) continue; // never learn 2xx/5xx
    const conv: Convention = {
      kind,
      endpointId: kind === 'unauthenticated' ? undefined : key.split('|')[1],
      assumed: [...new Set(list.flatMap((o) => o.assumed))],
      observed,
      checks: list.map((o) => o.id),
      learnedAt: new Date().toISOString(),
    };
    learned.push(conv);
  }
  const merged = [
    ...existing.filter((x) => !learned.some((l) => l.kind === x.kind && l.endpointId === x.endpointId)),
    ...learned,
  ];
  if (learned.length) writeJson(f.calibration, { apiName, updatedAt: new Date().toISOString(), conventions: merged } satisfies Calibration);

  // suggestions for a human: endpoints that consistently accept invalid input
  const suggestions = [...accepted.entries()].filter(([, ids]) => ids.length >= 3).map(([id]) => id);
  if (suggestions.length) {
    writeJson(f.suggested, {
      note:
        'These endpoints accepted invalid input (2xx) in 3+ validation checks while no validation rule is documented. ' +
        'This is NOT applied automatically. If your team confirms the endpoints are not meant to validate input, copy ' +
        '"noValidation" into spec/contract-overrides.json; checks then require safe handling (no 5xx, no leaks) instead of a 4xx. ' +
        'Otherwise these are validation gaps to raise with the API owners.',
      noValidation: suggestions,
      evidence: Object.fromEntries(suggestions.map((id) => [id, accepted.get(id)])),
    });
  }
  return { learned, suggestions };
}

if (require.main === module) {
  const [cmd, name] = process.argv.slice(2);
  if (!name || !['calibrate', 'apply'].includes(cmd)) {
    console.error('usage: tsx scripts/contract.ts <calibrate|apply> <api-name>');
    process.exit(2);
  }
  if (cmd === 'calibrate') {
    const r = calibrate(name);
    console.log(`learned ${r.learned.length} conventions; ${r.suggestions.length} endpoints suggested for human review`);
  } else {
    console.log(applyContract(name));
  }
}
