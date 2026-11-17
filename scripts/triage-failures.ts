/**
 * Stage 9a - failure triage.
 * Reads Playwright's JSON report + testcases.json and classifies every failure as one of:
 *   Real API defect | Test data issue | Flaky/Environment issue | Contract/Spec mismatch
 * with evidence (the last request/response the test made). Output: reports/triage.json
 */
import fs from 'node:fs';
import { apiPaths, readJson, redact, writeJson } from '../shared/helpers/env';
import { OWASP_NAMES } from '../shared/helpers/types';
import type { EndpointSummary, Exchange, OwaspApiId, RootCause, Severity, TestCase, TestCaseFile, TriageClass, TriageFile, TriageItem } from '../shared/helpers/types';

// ----------------------------------------------------------------------------- Playwright JSON report

interface PwAttachment {
  name: string;
  contentType: string;
  body?: string;
  path?: string;
}
interface PwResult {
  status: 'passed' | 'failed' | 'timedOut' | 'skipped' | 'interrupted';
  duration: number;
  error?: { message?: string };
  errors?: Array<{ message?: string }>;
  attachments?: PwAttachment[];
  annotations?: Array<{ type: string; description?: string }>;
  retry: number;
}
interface PwTest {
  status: 'expected' | 'unexpected' | 'flaky' | 'skipped';
  annotations?: Array<{ type: string; description?: string }>;
  results: PwResult[];
}
interface PwSpec {
  title: string;
  tests: PwTest[];
}
interface PwSuite {
  title: string;
  specs?: PwSpec[];
  suites?: PwSuite[];
}
interface PwReport {
  suites: PwSuite[];
  errors?: Array<{ message?: string }>;
  stats?: { startTime?: string; duration?: number; expected: number; unexpected: number; flaky: number; skipped: number };
}

export type Outcome = 'passed' | 'failed' | 'skipped' | 'flaky';

export interface TestResultRow {
  id: string;
  title: string;
  outcome: Outcome;
  durationMs: number;
  error: string;
  skipReason: string;
  exchange?: Exchange;
  /** every request under test of the final attempt (for the access matrix) */
  exchanges: Exchange[];
  timedOut: boolean;
  /** annotations such as skipped-check / assumption */
  annotations: Array<{ type: string; description?: string }>;
}

const ANSI = /\u001b\[[0-9;]*m/g;

function parseExchange(att: PwAttachment): Exchange | undefined {
  try {
    const text = att.body ? Buffer.from(att.body, 'base64').toString('utf8') : att.path && fs.existsSync(att.path) ? fs.readFileSync(att.path, 'utf8') : '';
    return text ? (JSON.parse(text) as Exchange) : undefined;
  } catch {
    return undefined;
  }
}

/** Exchanges of the request(s) under test (setup-/cleanup- exchanges excluded), in order. */
function testExchanges(result: PwResult | undefined): Exchange[] {
  return (result?.attachments ?? [])
    .filter((a) => a.name.startsWith('exchange-'))
    .map(parseExchange)
    .filter((x): x is Exchange => !!x);
}

function lastExchange(result: PwResult | undefined): Exchange | undefined {
  const all = testExchanges(result);
  return all[all.length - 1];
}

export function readResults(apiName: string): { rows: TestResultRow[]; report?: PwReport } {
  const file = apiPaths(apiName).resultsJson;
  if (!fs.existsSync(file)) return { rows: [] };
  const report = readJson<PwReport>(file);
  const rows: TestResultRow[] = [];
  const walk = (s: PwSuite) => {
    for (const spec of s.specs ?? []) {
      for (const t of spec.tests) {
        const final = t.results[t.results.length - 1];
        const id = /^\[(TC_[A-Z0-9_]+)\]/.exec(spec.title)?.[1] ?? spec.title;
        const outcome: Outcome = t.status === 'expected' ? 'passed' : t.status === 'flaky' ? 'flaky' : t.status === 'skipped' ? 'skipped' : 'failed';
        const failing = t.status === 'flaky' ? t.results.find((r) => r.status !== 'passed') : final;
        const message = (failing?.error?.message ?? failing?.errors?.[0]?.message ?? '').replace(ANSI, '');
        rows.push({
          id,
          title: spec.title,
          outcome,
          durationMs: t.results.reduce((n, r) => n + r.duration, 0),
          error: redact(message),
          skipReason: t.annotations?.find((a) => a.type === 'skip')?.description ?? '',
          exchange: lastExchange(failing),
          exchanges: testExchanges(final),
          timedOut: failing?.status === 'timedOut',
          annotations: [...(t.annotations ?? []), ...(final?.annotations ?? [])],
        });
      }
    }
    (s.suites ?? []).forEach(walk);
  };
  report.suites.forEach(walk);
  return { rows, report };
}

// ----------------------------------------------------------------------------- classification

function parseExpectedActual(error: string, tc: TestCase | undefined): { expected: string; actual: string } {
  const status = /Expected status ([\d or]+) but got (\d+)/.exec(error);
  if (status) return { expected: `HTTP ${status[1]}`, actual: `HTTP ${status[2]}` };
  if (/Server error \(5xx\)/.test(error)) {
    const got = /-> (\d{3})/.exec(error)?.[1];
    return { expected: `HTTP ${tc?.expected.status.join(' or ') ?? '4xx'} (never 5xx)`, actual: `HTTP ${got ?? '5xx'}` };
  }
  const schema = /Schema validation failed: ([^\n]+)/.exec(error);
  if (schema) return { expected: `body matches ${tc?.expected.schema ?? 'schema'}`, actual: schema[1].slice(0, 400) };
  const field = /Field "([^"]+)"[^\n]*/.exec(error);
  const exp = /Expected: ([^\n]+)/.exec(error)?.[1];
  const rec = /Received: ([^\n]+)/.exec(error)?.[1];
  if (field) return { expected: `${field[1]} = ${exp ?? '(request value)'}`, actual: `${rec ?? '(different)'}` };
  if (/Response took (\d+) ms \(limit (\d+) ms\)/.test(error)) {
    const m = /Response took (\d+) ms \(limit (\d+) ms\)/.exec(error)!;
    return { expected: `<= ${m[2]} ms`, actual: `${m[1]} ms` };
  }
  return { expected: exp ?? (tc ? `HTTP ${tc.expected.status.join(' or ')}` : ''), actual: rec ?? error.split('\n')[0].slice(0, 300) };
}

interface Classification {
  cls: TriageClass;
  reason: string;
  severity?: Severity;
  owasp?: OwaspApiId;
}

/** Authorization findings (OWASP API Top 10) - recognised by the stable markers in shared/helpers/authz.ts. */
function classifyAuthorization(e: string, tc: TestCase | undefined): Classification | undefined {
  const owasp = tc?.owasp;
  const tag = (id: OwaspApiId) => `${id} ${OWASP_NAMES[id]}`;
  if (/Sensitive field exposed/.test(e)) {
    return { cls: 'Real API defect', severity: 'High', owasp: 'API3:2023', reason: `Security (${tag('API3:2023')}): response exposes sensitive fields - ${/Sensitive field exposed in response: ([^\n]+)/.exec(e)?.[1] ?? ''}` };
  }
  if (/Mass assignment:/.test(e)) {
    return { cls: 'Real API defect', severity: 'High', owasp: 'API3:2023', reason: `Security (${tag('API3:2023')}): client-supplied privileged fields were stored.` };
  }
  if (/Undocumented field returned/.test(e)) {
    return { cls: 'Contract/Spec mismatch', severity: 'Low', owasp: 'API3:2023', reason: `Response carries fields outside the documented schema (${tag('API3:2023')} review): ${/schema\): ([^\n]+)/.exec(e)?.[1] ?? ''}` };
  }
  if (/Authorization bypass/.test(e)) {
    // only token-hygiene checks (API2) can report a bypass now: there are no BOLA/BFLA identities
    const id = owasp ?? 'API2:2023';
    return { cls: 'Real API defect', severity: 'High', owasp: id, reason: `Security (${tag(id)}): ${/Authorization bypass: ([^\n(]+)/.exec(e)?.[1]?.trim() ?? 'access was granted'}.` };
  }
  return undefined;
}

function severityOf(c: Classification, status: number): Severity {
  if (c.severity) return c.severity;
  switch (c.cls) {
    case 'Real API defect':
      return /Security/.test(c.reason) ? 'High' : status >= 500 ? 'High' : 'Medium';
    case 'Contract/Spec mismatch':
      return 'Low';
    default:
      return 'Low';
  }
}

/**
 * The assertion's own message for a failed check: the part after "• [ID] <title>: " in a high-level case, or
 * the first line of a single test's error ("Error: " stripped).
 */
export function assertionMessage(e: string, tc: TestCase | undefined): string {
  const first = e.split('\n').find((l) => l.trim()) ?? '';
  const bullet = /^• \[[^\]]+\] (.*)$/.exec(first)?.[1];
  let msg = bullet ?? first.replace(/^Error: /, '');
  if (bullet && tc && msg.startsWith(`${tc.title}: `)) msg = msg.slice(tc.title.length + 2);
  else if (bullet) msg = msg.replace(/^.*?: /, '');
  return msg.replace(/^expect\(received\)\.\w+\(expected\).*$/, '').trim().slice(0, 200);
}

/**
 * Run-level availability: when a large share of VALID read requests (GET in positive cases) failed with a
 * 5xx, the API was down or degraded during the run - its 5xx failures are then environment, not defects.
 */
export interface RunEnvironment {
  /** set when an outage is suspected: the evidence, ready to print */
  outage?: string;
}

const OUTAGE_MIN_READS = 3;
const OUTAGE_RATIO = 0.3;

export function detectOutage(rows: TestResultRow[], cases: Map<string, TestCase>): RunEnvironment {
  const reads = rows
    .filter((r) => r.outcome !== 'skipped' && /^Positive/.test(cases.get(r.id)?.category ?? ''))
    .flatMap((r) => r.exchanges.filter((x) => x.method === 'GET'));
  const failed = reads.filter((x) => x.status >= 500);
  if (failed.length >= OUTAGE_MIN_READS && failed.length / reads.length >= OUTAGE_RATIO) {
    const statuses = [...new Set(failed.map((x) => x.status))].sort().join('/');
    return { outage: `${failed.length} of ${reads.length} valid read requests failed with ${statuses} during this run` };
  }
  return {};
}

function classify(row: TestResultRow, tc: TestCase | undefined, summary: EndpointSummary, env: RunEnvironment = {}): Classification {
  const authz = classifyAuthorization(row.error, tc);
  if (authz) return authz;
  const e = row.error;
  // status of the asserted response: from the assertion message first, then the captured exchange
  const fromMessage = /but got (\d{3})/.exec(e)?.[1] ?? /-> (\d{3}) body=/.exec(e)?.[1];
  const status = fromMessage ? Number(fromMessage) : (row.exchange?.status ?? NaN);
  const endpoint = summary.endpoints.find((x) => x.id === tc?.endpointId);
  const resource = summary.resources.find((r) => r.name === tc?.group);
  const negativeKind = tc && ['negative', 'tolerant', 'auth-reject', 'login-reject', 'duplicate'].includes(tc.variant);

  if (row.outcome === 'flaky') return { cls: 'Flaky/Environment issue', reason: 'Failed first, passed on retry.' };
  if (/\[PRECONDITION\]/.test(e)) {
    const what = /\[PRECONDITION\] ([^\n]+)/.exec(e)?.[1]?.trim();
    return { cls: 'Test data issue', reason: `Precondition could not be met (fixture / setup data)${what ? `: ${what}` : '.'}` };
  }
  if (row.timedOut || /timed? ?out|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|ECONNREFUSED/i.test(e)) {
    return { cls: 'Flaky/Environment issue', reason: 'Network error or timeout talking to the API.' };
  }
  if ([429, 502, 503, 504].includes(status)) return { cls: 'Flaky/Environment issue', reason: `Gateway/rate-limit status ${status}.` };
  if (/Response took \d+ ms/.test(e)) return { cls: 'Flaky/Environment issue', reason: 'Response time over threshold; re-run to confirm before raising a performance defect.' };
  if (/Test data ".*" not found/.test(e)) return { cls: 'Test data issue', reason: 'Test data key missing from test-data files.' };
  if (/Server error \(5xx\)/.test(e) || status >= 500) {
    if (env.outage) {
      return { cls: 'Flaky/Environment issue', reason: `API unavailable during the run (${env.outage}); server errors are not reported as defects - re-run to confirm.` };
    }
    return { cls: 'Real API defect', reason: `Server error ${Number.isFinite(status) ? status : '5xx'} for ${negativeKind ? 'invalid input - input validation is missing' : 'a valid request'}.` };
  }
  if (/leaks internals/.test(e)) return { cls: 'Real API defect', reason: 'Response leaks stack trace / internal details.' };

  if (tc?.category === 'Auth' && negativeKind) {
    // a token in a rejected login's response is the real breach (checked before the status)
    if (/no token for rejected login/.test(e)) return { cls: 'Real API defect', severity: 'High', reason: 'Security: rejected login still returned a token.' };
    if (tc.variant === 'login-reject' && status >= 200 && status < 300) {
      // the token check ran first and passed: no token was issued - only the status is unconventional
      return tc.assumptionBased
        ? { cls: 'Contract/Spec mismatch', reason: `Failed login answered with ${status} (no token issued); the failure status is not documented.` }
        : { cls: 'Real API defect', severity: 'Medium', reason: `Failed login answered with ${status} instead of the documented ${tc.expected.status.join('/')} (no token issued).` };
    }
    if (status >= 200 && status < 300) return { cls: 'Real API defect', reason: `Security: request without valid credentials was answered with ${status}.` };
    if (status === 403 && tc.expected.status.includes(401)) return { cls: 'Contract/Spec mismatch', reason: 'API answers 403 where 401 is expected for missing/invalid credentials.' };
  }
  if (tc?.variant === 'lifecycle' && resource && !resource.persistsWrites) {
    return { cls: 'Contract/Spec mismatch', reason: 'The API does not follow its own documented simulated-write behaviour (see evidence).' };
  }
  if (tc?.expected.robust && /was not persisted\/echoed exactly/.test(e)) {
    return { cls: 'Real API defect', reason: 'Input was accepted but stored/returned differently (silent truncation, trimming or type change).' };
  }
  if (/was not persisted\/echoed exactly/.test(e)) {
    return resource && !resource.persistsWrites
      ? { cls: 'Contract/Spec mismatch', reason: 'Writes are simulated; echoed data differs from the request.' }
      : { cls: 'Real API defect', reason: 'Sent value not persisted/returned exactly (truncation, trimming or type change).' };
  }
  if (/Repeated request returned a different body/.test(e) && tc?.request.path && !/\{/.test(tc.request.path)) {
    return { cls: 'Flaky/Environment issue', reason: 'Shared collection changed between the two calls (other clients write to this demo API); re-run to confirm.' };
  }
  if (/Schema validation failed/.test(e)) return { cls: 'Contract/Spec mismatch', reason: 'Response body does not match the documented/inferred schema.' };
  if (/content-type/i.test(e)) return { cls: 'Contract/Spec mismatch', reason: 'Unexpected Content-Type header.' };
  if (negativeKind && status >= 200 && status < 300) {
    // undocumented rules run as robustness checks (see scripts/contract.ts), so a strict check that gets a
    // 2xx is a documented rule (required field, type, enum, format, id) that the API does not enforce
    return endpoint?.inferred
      ? { cls: 'Contract/Spec mismatch', reason: `Invalid input accepted with ${status}; the rule comes from inferred behaviour, not documentation.` }
      : { cls: 'Real API defect', reason: `Documented rule not enforced: invalid input accepted with ${status}.` };
  }
  if (negativeKind && status >= 400 && status < 500) return { cls: 'Contract/Spec mismatch', reason: `Rejected with ${status} instead of the expected ${tc?.expected.status.join('/')}.` };
  if (!negativeKind && status >= 400 && status < 500) {
    if (status === 404 && tc?.request.idSource !== 'none') return { cls: 'Test data issue', reason: 'Resource used by the test was not found (shared demo data may have changed).' };
    return endpoint?.inferred
      ? { cls: 'Contract/Spec mismatch', reason: `Valid request (per inferred contract) rejected with ${status}.` }
      : { cls: 'Real API defect', reason: `Valid, documented request rejected with ${status}.` };
  }
  if (!negativeKind && status >= 200 && status < 300 && /Expected status/.test(e)) {
    return { cls: 'Contract/Spec mismatch', reason: `Success code ${status} differs from the documented one.` };
  }
  const msg = assertionMessage(e, tc);
  if (tc?.variant.startsWith('filter')) {
    return { cls: 'Real API defect', reason: `Query filter does not return the matching items${msg ? `: ${msg}` : '.'}` };
  }
  // name the expectation that failed instead of a generic label
  return { cls: 'Real API defect', reason: msg ? `Expectation not met: ${msg}` : 'Expectation not met (no assertion message - see evidence).' };
}

const SEVERITY: Record<TriageClass, number> = {
  'Real API defect': 4,
  'Contract/Spec mismatch': 3,
  'Test data issue': 2,
  'Flaky/Environment issue': 1,
};

/**
 * High-level cases fail with "N of M checks failed:\n• [ID.n] title: message" - classify every failed check
 * on its own (with its detailed case) and report the most severe class, listing the per-class counts.
 */
function classifyComposite(
  row: TestResultRow,
  tc: TestCase,
  summary: EndpointSummary,
  subs: Map<string, TestCase>,
  env: RunEnvironment = {},
): (Classification & { expected: string; actual: string; checks: CheckFailure[] }) | undefined {
  const lines = row.error.split('\n').filter((l) => l.startsWith('• '));
  if (!lines.length) return undefined;
  const results = lines.map((line) => {
    const subId = /^• \[([^\]]+)\]/.exec(line)?.[1] ?? '';
    const sub = subs.get(subId) ?? tc;
    const pseudo: TestResultRow = { ...row, error: line, exchange: undefined, outcome: 'failed', timedOut: false };
    const c = classify(pseudo, sub, summary, env);
    const ea = parseExpectedActual(line, sub);
    const status = Number(/but got (\d{3})/.exec(line)?.[1] ?? /-> (\d{3})/.exec(line)?.[1] ?? 0);
    const check: CheckFailure = { testId: row.id, checkId: subId || row.id, endpoint: `${sub.request.method} ${sub.request.path}`, cls: c.cls, reason: c.reason, severity: severityOf(c, status), owasp: c.owasp, ...ea };
    return { ...c, ...ea, line, check };
  });
  results.sort((a, b) => SEVERITY[b.cls] - SEVERITY[a.cls]);
  const worst = results[0];
  const counts = results.reduce<Record<string, number>>((acc, r) => ((acc[r.cls] = (acc[r.cls] ?? 0) + 1), acc), {});
  const header = /(\d+ of \d+ checks failed)/.exec(row.error)?.[1] ?? `${lines.length} checks failed`;
  return {
    cls: worst.cls,
    severity: worst.severity,
    owasp: worst.owasp,
    reason: `${header} (${Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(', ')}). Most severe: ${worst.reason}`,
    expected: worst.expected,
    actual: worst.actual,
    checks: results.map((r) => r.check),
  };
}

// ----------------------------------------------------------------------------- root causes

/** One failed check (a sub-check of a high-level case, or the whole test for single-check cases). */
interface CheckFailure {
  testId: string;
  checkId: string;
  endpoint: string;
  cls: TriageClass;
  reason: string;
  severity: Severity;
  owasp?: OwaspApiId;
  expected: string;
  actual: string;
}

interface CauseRule {
  test: RegExp;
  key: (m: RegExpExecArray, c: CheckFailure) => string;
  title: (m: RegExpExecArray, c: CheckFailure) => string;
  hint: string;
}

/**
 * Maps the classifier's reason to the underlying problem. Ordered; the first match wins. Checks with the
 * same key are one root cause, whatever endpoint or test they belong to.
 */
const CAUSE_RULES: CauseRule[] = [
  {
    test: /^Security \((API\d+:\d{4})[^)]*\): ([^.\n]+)/,
    key: (m) => `security:${m[1]}:${m[2].replace(/ - .*$/, '').replace(/\d+/g, 'N')}`,
    title: (m) => `Security (${m[1]}): ${m[2].replace(/ - .*$/, '')}`,
    hint: 'Enforce object/function/property-level authorization on the server for every request.',
  },
  {
    test: /Server error (\d{3}|5xx) for invalid input/,
    key: () => '5xx-invalid-input',
    title: () => 'Invalid input crashes the server (5xx instead of 400/422)',
    hint: 'Validate request bodies, parameters and ids before processing; map validation errors to 400/422.',
  },
  {
    test: /Server error (\d{3}|5xx) for a valid request/,
    key: (_m, c) => `5xx-valid-request:${c.endpoint}`,
    title: (_m, c) => `Valid requests to ${c.endpoint} fail with a server error`,
    hint: 'Check the server logs for this endpoint. Tests that need it as setup are blocked until it works.',
  },
  {
    test: /(?:Documented rule not enforced: invalid|Invalid) input accepted with (\d{3})(; the rule comes from inferred)?/,
    key: (m, c) => `accepts-invalid:${c.cls}:${m[1]}`,
    title: (m) => `Invalid input is accepted with HTTP ${m[1]} - validation is missing${m[2] ? ' (rule inferred, not documented)' : ''}`,
    hint: 'Reject missing, null, wrongly typed, out-of-range and badly formatted fields with 400/422.',
  },
  {
    test: /(not persisted\/returned exactly|stored\/returned differently|echoed data differs)/,
    key: (_m, c) => `not-stored-exactly:${c.cls}`,
    title: () => 'Values are not stored or returned exactly as sent (truncated, trimmed, converted)',
    hint: 'Store and return values unchanged, or reject input the API cannot store with 400/422.',
  },
  {
    test: /Rejected with (\d{3}) instead of the expected ([\d/]+)/,
    key: (m) => `status:${m[1]}-vs-${m[2]}`,
    title: (m) => `Answers ${m[1]} where ${m[2]} is expected`,
    hint: 'Align the status codes with the spec - or, if the behaviour is intended, pin it in spec/contract-overrides.json.',
  },
  {
    test: /403 where 401 is expected/,
    key: () => 'status:403-vs-401',
    title: () => 'Answers 403 where 401 is expected for missing/invalid credentials',
    hint: 'Use 401 for unauthenticated requests and 403 for authenticated-but-forbidden ones.',
  },
  {
    test: /Precondition could not be met[^:]*: (.+)/,
    key: (m) => `blocked:${m[1].replace(/\b\d{2,}\b(?! ?\))/g, 'N')}`,
    title: (m) => `Blocked - test setup failed: ${m[1].replace(/\.$/, '')}`,
    hint: 'Not an independent defect: fix the setup failure (see "blocked by") and these tests will run.',
  },
  {
    test: /Response time over threshold/,
    key: () => 'slow-response',
    title: () => 'Responses slower than the RESPONSE_TIME_MS limit',
    hint: 'Re-run to confirm; shared demo hosts are often slow. Raise RESPONSE_TIME_MS if the limit is too strict.',
  },
  {
    test: /Shared collection changed/,
    key: () => 'shared-data-changed',
    title: () => 'Shared demo data changed between two calls (other clients write to it)',
    hint: 'Environment noise on a public demo API; re-run to confirm.',
  },
  { test: /Failed first, passed on retry/, key: () => 'flaky-retry', title: () => 'Failed once, passed on retry', hint: 'Intermittent; re-run to confirm.' },
  { test: /Network error or timeout/, key: () => 'network', title: () => 'Network errors or timeouts', hint: 'Check connectivity / API availability and re-run.' },
  {
    test: /Failed login answered with (\d{3})(?: instead of the documented ([\d/]+))?/,
    key: (m, c) => `login-status:${c.cls}:${m[1]}`,
    title: (m) => `Failed logins are answered with HTTP ${m[1]}${m[2] ? ` instead of the documented ${m[2]}` : ''} (no token is issued)`,
    hint: 'Answer failed logins with 401 (400 for missing fields) and document it; clients cannot tell success from failure by status today.',
  },
  {
    test: /API unavailable during the run/,
    key: () => 'outage',
    title: () => 'API unavailable or degraded during the run (many valid requests failed with 5xx)',
    hint: 'Not reported as a defect: re-run when the API is healthy; persistent 5xx then become real findings.',
  },
  {
    test: /Query filter does not return the matching items/,
    key: (_m, c) => `filter:${c.endpoint}`,
    title: (_m, c) => `Filtering ${c.endpoint} does not return the matching items`,
    hint: 'Check the filter implementation (and indexing delay, if any) for this query parameter.',
  },
  {
    test: /^Expectation not met: (.+)/,
    key: (m, c) => `expectation:${c.endpoint}:${m[1].replace(/\d+/g, 'N')}`,
    title: (m, c) => `${c.endpoint}: expected "${m[1].replace(/\.$/, '')}" - not met`,
    hint: 'See the evidence of the listed tests: the API answered, but not with the expected content.',
  },
  {
    test: /does not match the documented\/inferred schema/,
    key: (_m, c) => `schema:${c.cls}`,
    title: () => 'Response bodies do not match the documented schema',
    hint: 'Fix the response shape or update the spec; see the failing fields in each test.',
  },
  { test: /Content-Type/, key: () => 'content-type', title: () => 'Unexpected Content-Type header', hint: 'Return the documented media type (e.g. application/json).' },
];

const SEV_RANK: Record<Severity, number> = { Critical: 4, High: 3, Medium: 2, Low: 1 };

export function rootCausesOf(checks: CheckFailure[]): { causes: RootCause[]; byCheck: Map<CheckFailure, string> } {
  const groups = new Map<string, { title: string; hint: string; members: CheckFailure[] }>();
  const keyOf = new Map<CheckFailure, string>();
  for (const c of checks) {
    const rule = CAUSE_RULES.map((r) => ({ r, m: r.test.exec(c.reason) })).find((x) => x.m);
    const key = rule ? rule.r.key(rule.m!, c) : `${c.cls}:${c.reason.replace(/\d+/g, 'N')}`;
    const g = groups.get(key) ?? { title: rule ? rule.r.title(rule.m!, c) : c.reason, hint: rule?.r.hint ?? 'See the evidence of the listed tests.', members: [] };
    g.members.push(c);
    groups.set(key, g);
    keyOf.set(c, key);
  }
  const causes: Array<RootCause & { key: string }> = [...groups.entries()].map(([key, g]) => {
    const sev = g.members.reduce<Severity>((s, m) => (SEV_RANK[m.severity] > SEV_RANK[s] ? m.severity : s), 'Low');
    const worst = g.members.find((m) => m.severity === sev) ?? g.members[0];
    return {
      key,
      id: '',
      classification: worst.cls,
      severity: sev,
      title: g.title,
      hint: g.hint,
      checks: g.members.length,
      testIds: [...new Set(g.members.map((m) => m.testId))],
      endpoints: [...new Set(g.members.map((m) => m.endpoint))].sort(),
      example: { testId: worst.checkId, expected: worst.expected, actual: worst.actual },
      owasp: worst.owasp,
    };
  });
  const CLASS_RANK: Record<TriageClass, number> = SEVERITY;
  causes.sort((a, b) => CLASS_RANK[b.classification] - CLASS_RANK[a.classification] || SEV_RANK[b.severity] - SEV_RANK[a.severity] || b.checks - a.checks);
  causes.forEach((c, i) => (c.id = `RC${i + 1}`));
  // setup failures "could not create X (status 5xx)" are consequences of a server error on that create endpoint
  for (const c of causes.filter((x) => x.key.startsWith('blocked:'))) {
    const status = /status (\d{3})/.exec(c.title)?.[1];
    const resource = /could not (?:create|find|read) (\w+)/.exec(c.title)?.[1];
    const cause = causes.find(
      (x) => x !== c && x.key.startsWith('5xx-valid-request:POST') && (!resource || x.endpoints.some((e) => e.toLowerCase().includes(resource.toLowerCase()))) && (!status || Number(status) >= 500),
    );
    if (cause) c.blockedBy = cause.id;
  }
  const idOf = new Map(causes.map((c) => [c.key, c.id]));
  const byCheck = new Map<CheckFailure, string>([...keyOf.entries()].map(([chk, key]) => [chk, idOf.get(key)!]));
  return { causes, byCheck };
}

export function triage(apiName: string): TriageFile {
  const paths = apiPaths(apiName);
  const summary = readJson<EndpointSummary>(paths.summary);
  const all = readJson<TestCaseFile>(paths.testCasesJson).cases;
  const cases = new Map(all.map((c) => [c.id, c]));
  const subs = new Map(all.flatMap((c) => c.subCases ?? []).map((s) => [s.id, s]));
  const { rows, report } = readResults(apiName);
  const checksOf = new Map<string, CheckFailure[]>();
  const env = detectOutage(rows, cases);
  const items: TriageItem[] = rows
    .filter((r) => r.outcome === 'failed' || r.outcome === 'flaky')
    .map((r) => {
      const tc = cases.get(r.id);
      const composite = tc?.subCases?.length && r.outcome === 'failed' ? classifyComposite(r, tc, summary, subs, env) : undefined;
      const c = composite ?? classify(r, tc, summary, env);
      const { cls, reason } = c;
      const { expected, actual } = composite ?? parseExpectedActual(r.error, tc);
      const status = r.exchange?.status ?? Number(/but got (\d{3})/.exec(r.error)?.[1] ?? 0);
      const endpoint = tc ? `${tc.request.method} ${tc.request.path}` : '';
      checksOf.set(
        r.id,
        composite?.checks ?? [{ testId: r.id, checkId: r.id, endpoint, cls, reason, severity: severityOf(c, status), owasp: c.owasp, expected, actual }],
      );
      return {
        severity: severityOf(c, status),
        owasp: c.owasp ?? (cls === 'Real API defect' && tc?.category === 'Authorization' ? tc.owasp : undefined),
        testId: r.id,
        title: tc?.title ?? r.title,
        category: tc?.category ?? 'Unknown',
        endpoint: tc ? `${tc.request.method} ${tc.request.path}` : '',
        classification: cls,
        reason,
        expected,
        actual,
        error: r.error.split('\n').slice(0, composite ? 40 : 6).join('\n').slice(0, composite ? 6000 : 1500),
        evidence: r.exchange,
        flaky: r.outcome === 'flaky',
      };
    });
  const { causes, byCheck } = rootCausesOf([...checksOf.values()].flat());
  for (const i of items) i.rootCauses = [...new Set((checksOf.get(i.testId) ?? []).map((c) => byCheck.get(c)!))];
  const file: TriageFile = { apiName, generatedAt: new Date().toISOString(), runStartedAt: report?.stats?.startTime, outageSuspected: env.outage, items, rootCauses: causes };
  writeJson(paths.triage, file);
  return file;
}

if (require.main === module) {
  const name = process.argv[2];
  if (!name) {
    console.error('usage: tsx scripts/triage-failures.ts <api-name>');
    process.exit(2);
  }
  const t = triage(name);
  const by = t.items.reduce<Record<string, number>>((acc, i) => ((acc[i.classification] = (acc[i.classification] ?? 0) + 1), acc), {});
  console.log(`triaged ${t.items.length} failures -> ${apiPaths(name).triage}`, by);
}
