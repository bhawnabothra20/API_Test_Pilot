/** Read-only views over api/<name>/ for the MCP tools and resources. Outputs never contain secrets. */
import fs from 'node:fs';
import path from 'node:path';
import { apiPaths, PROJECT_ROOT, readJson } from '../shared/helpers/env';
import { CATEGORIES, OWASP_NAMES, type EndpointSummary, type TestCase, type TestCaseFile, type TriageClass, type TriageFile } from '../shared/helpers/types';
import { buildAccessMatrix, type AccessMatrix } from '../scripts/access-matrix';
import { executedPct, passRatePct, readHistory, triageMatchesRun, type Totals } from '../scripts/history';
import type { PreflightReport } from '../scripts/preflight';
import { driftFiles, readDrift, type Recommendation } from '../scripts/spec-drift';
import { readResults } from '../scripts/triage-failures';
import { apiExists, isJobRunning, listJobs, safeApiName, UserError } from './jobs';

function requireApi(name: string): ReturnType<typeof apiPaths> {
  safeApiName(name);
  if (!apiExists(name)) throw new UserError(`No API "${name}" yet - run run_api_test first (list_apis shows existing ones).`);
  return apiPaths(name);
}

const rel = (p: string) => path.relative(PROJECT_ROOT, p).replace(/\\/g, '/');

interface PwStats {
  stats?: { startTime?: string; duration?: number; expected: number; unexpected: number; flaky: number; skipped: number };
}

/** The MCP job currently running for this API, if any (results are being replaced). */
function runningJob(name: string) {
  return listJobs().find((j) => j.name === name && isJobRunning(j));
}

/** Coverage first: a pass rate without the share of tests that actually executed is misleading. */
function coverageView(t: Totals) {
  const executed = executedPct(t);
  const rate = passRatePct(t);
  return {
    executedCoverage: `${executed}% (${t.total - t.skipped} of ${t.total} tests executed)`,
    passRateOfExecuted: rate === null ? null : `${rate}%`,
    warning:
      t.total && executed < 80
        ? `Only ${executed}% of tests executed - the pass rate is not representative. See preflightWarnings / skipped reasons.`
        : undefined,
  };
}

function readPreflight(p: ReturnType<typeof apiPaths>): PreflightReport | undefined {
  const f = path.join(p.reports, 'preflight.json');
  return fs.existsSync(f) ? readJson<PreflightReport>(f) : undefined;
}

export function listApis() {
  const dir = path.join(PROJECT_ROOT, 'api');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(d.name) && fs.existsSync(path.join(dir, d.name, 'spec', 'endpoint-summary.json')))
    .map((d) => {
      const p = apiPaths(d.name);
      const summary = readJson<EndpointSummary>(p.summary);
      const results = fs.existsSync(p.resultsJson) ? readJson<PwStats>(p.resultsJson) : undefined;
      const s = results?.stats;
      const running = runningJob(d.name);
      const last = readHistory(d.name)[0];
      const t: Totals | undefined = s ? { total: s.expected + s.unexpected + s.flaky + s.skipped, passed: s.expected, failed: s.unexpected, flaky: s.flaky, skipped: s.skipped } : undefined;
      return {
        name: d.name,
        sourceUrl: summary.sourceUrl,
        endpoints: summary.endpoints.length,
        state: running ? `run in progress (job ${running.jobId})` : t ? 'results available' : 'not run yet',
        lastRun: s?.startTime ?? null,
        totals: t ?? null,
        ...(t ? coverageView(t) : {}),
        // while a run is in progress the current files are being replaced: point at the last archived run
        lastCompletedRun: last ? { startedAt: last.startedAt, executedPct: last.executedPct, passRatePct: last.passRatePct, rootCauses: last.rootCauses } : null,
        runsInHistory: readHistory(d.name).length,
      };
    });
}

export function getHistory(name: string) {
  requireApi(name);
  const runs = readHistory(name);
  return {
    name,
    runs: runs.map(({ failedIds, ...h }) => ({ ...h, failedTests: failedIds.length, report: `api/${name}/reports/history/${h.runId}/summary.html` })),
    note: runs.length ? undefined : 'No archived runs yet (runs are archived by the report stage).',
  };
}

/** Spec drift of the current run: documented vs observed behaviour, with fix-API / fix-docs recommendations. */
export function getSpecDrift(name: string, recommendation?: Recommendation) {
  const p = requireApi(name);
  const files = driftFiles(name);
  const running = runningJob(name);
  const startTime = readResults(name).report?.stats?.startTime;
  const drift = readDrift(name, startTime);
  if (!drift) {
    const stale = fs.existsSync(files.drift);
    return {
      name,
      state: running ? 'running' : 'no-drift',
      note: running
        ? 'A run is in progress - spec drift is written by its drift stage.'
        : stale
          ? 'spec-drift.json belongs to an earlier run (stale) - rerun the API to refresh it.'
          : `No spec drift yet for ${name} - run run_api_test (the drift stage runs after the report).`,
    };
  }
  const items = recommendation ? drift.items.filter((i) => i.recommendation === recommendation) : drift.items;
  return {
    name,
    runStartedAt: drift.runStartedAt,
    specSource: drift.specSource,
    totals: drift.totals,
    items,
    withheld: drift.withheld,
    confirmed: drift.confirmed,
    notes: drift.notes,
    files: {
      specDrift: rel(files.drift),
      openapiPatch: drift.patchable ? rel(files.patch) : undefined,
      openapiSuggested: drift.patchable ? rel(files.suggested) : undefined,
      patchAppliesTo: drift.specFile ? rel(path.join(p.root, drift.specFile)) : undefined,
    },
  };
}

export function getSummary(name: string) {
  const p = requireApi(name);
  const summary = readJson<EndpointSummary>(p.summary);
  const cases = fs.existsSync(p.testCasesJson) ? readJson<TestCaseFile>(p.testCasesJson).cases : [];
  const byCase = new Map(cases.map((c) => [c.id, c]));
  const { rows, report } = readResults(name);
  type Tally = { total: number; passed: number; failed: number; skipped: number; flaky: number };
  const empty = (): Tally => ({ total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 });
  const totals = empty();
  const byCategory: Record<string, Tally> = Object.fromEntries(CATEGORIES.map((c) => [c, empty()]));
  for (const r of rows) {
    const cat = byCase.get(r.id)?.category ?? 'Unknown';
    byCategory[cat] ??= empty();
    for (const t of [totals, byCategory[cat]]) {
      t.total++;
      t[r.outcome]++;
    }
  }
  const running = runningJob(name);
  const onDisk = fs.existsSync(p.triage) ? readJson<TriageFile>(p.triage) : undefined;
  // a triage from another run is never reported next to these results
  const triage = triageMatchesRun(onDisk, report?.stats?.startTime) ? onDisk : undefined;
  const byTriageClass = (triage?.items ?? []).filter((i) => !i.flaky).reduce<Record<string, number>>((acc, i) => ((acc[i.classification] = (acc[i.classification] ?? 0) + 1), acc), {});
  const authz = (triage?.items ?? []).filter((i) => i.owasp && i.classification === 'Real API defect');
  const pre = readPreflight(p);
  const notes: string[] = [];
  if (running) notes.push(`A run is in progress (job ${running.jobId}); these results are partial or from the previous run - poll get_run_status, or see get_history for the last completed run.`);
  if (!report) notes.push('No results for the current design yet.');
  else if (!triage) notes.push('Triage has not been built for this run yet (report stage pending).');
  return {
    name,
    sourceUrl: summary.sourceUrl,
    baseUrl: summary.baseUrl,
    specSource: summary.specSource,
    auth: summary.auth.type,
    endpoints: summary.endpoints.length,
    testCases: cases.length,
    state: running ? 'running' : report ? 'complete' : 'not run',
    notes: notes.length ? notes : undefined,
    lastRun: report?.stats?.startTime ?? null,
    totals,
    ...coverageView(totals),
    preflightWarnings: pre?.warnings.length ? pre.warnings : undefined,
    byCategory: Object.fromEntries(Object.entries(byCategory).filter(([, t]) => t.total)),
    failuresByTriageClass: byTriageClass,
    rootCauses: (triage?.rootCauses ?? []).map((c) => ({ id: c.id, severity: c.severity, classification: c.classification, title: c.title, checks: c.checks, tests: c.testIds.length, endpoints: c.endpoints, blockedBy: c.blockedBy, hint: c.hint })),
    authorizationFindings: authz.map((i) => ({ testId: i.testId, severity: i.severity, owasp: i.owasp, title: i.title })),
    reports: { summaryHtml: rel(p.summaryHtml), playwrightHtml: rel(path.join(p.htmlReport, 'index.html')), triage: rel(p.triage), excel: rel(p.excel) },
  };
}

export function getFailures(name: string, triageClass?: TriageClass) {
  const p = requireApi(name);
  if (!fs.existsSync(p.triage)) return { name, failures: [], note: 'No triage yet - the API has not been run.' };
  const t = readJson<TriageFile>(p.triage);
  const items = t.items.filter((i) => !triageClass || i.classification === triageClass);
  return {
    name,
    count: items.length,
    rootCauses: (t.rootCauses ?? [])
      .filter((c) => !triageClass || c.classification === triageClass)
      .map((c) => ({ id: c.id, severity: c.severity, classification: c.classification, title: c.title, checks: c.checks, testIds: c.testIds, endpoints: c.endpoints, example: c.example, blockedBy: c.blockedBy, hint: c.hint })),
    failures: items.map((i) => ({
      rootCauses: i.rootCauses,
      testId: i.testId,
      title: i.title,
      category: i.category,
      endpoint: i.endpoint,
      classification: i.classification,
      severity: i.severity,
      owasp: i.owasp ? `${i.owasp} ${OWASP_NAMES[i.owasp]}` : undefined,
      reason: i.reason,
      expected: i.expected,
      actual: i.actual,
      flaky: i.flaky,
      evidence: i.evidence
        ? { request: `${i.evidence.method} ${i.evidence.url}`, status: i.evidence.status, durationMs: i.evidence.durationMs, responseBody: i.evidence.responseBody.slice(0, 800) }
        : undefined,
    })),
  };
}

export function getAccessMatrix(name: string): AccessMatrix | { name: string; note: string } {
  const p = requireApi(name);
  const file = path.join(p.reports, 'access-matrix.json');
  if (fs.existsSync(file)) return readJson<AccessMatrix>(file);
  if (fs.existsSync(p.resultsJson) && fs.existsSync(p.testCasesJson)) return buildAccessMatrix(name);
  return { name, note: 'No access matrix yet - run the API first.' };
}

function findCase(cases: TestCase[], tcId: string): { tc: TestCase; parent?: TestCase } | undefined {
  for (const c of cases) {
    if (c.id === tcId) return { tc: c };
    const sub = c.subCases?.find((s) => s.id === tcId);
    if (sub) return { tc: sub, parent: c };
  }
  return undefined;
}

export function getTestCase(name: string, tcId: string) {
  const p = requireApi(name);
  if (!/^TC_[A-Z0-9_]+(\.\d+)?$/.test(tcId)) throw new UserError(`Invalid TC id "${tcId}".`);
  const file = readJson<TestCaseFile>(p.testCasesJson);
  const found = findCase(file.cases, tcId);
  if (!found) throw new UserError(`${tcId} not found in api/${name}/test-cases/testcases.json.`);
  const { tc, parent } = found;
  const owner = parent ?? tc;
  const spec = path.join(p.tests, `${owner.group}.spec.ts`);
  let line: number | undefined;
  if (fs.existsSync(spec)) {
    const idx = fs.readFileSync(spec, 'utf8').split('\n').findIndex((l) => l.includes(`[${owner.id}]`));
    if (idx >= 0) line = idx + 1;
  }
  const leaves = tc.subCases ?? [tc];
  return {
    id: tc.id,
    parent: parent?.id,
    title: tc.title,
    category: tc.category,
    variant: tc.variant,
    priority: tc.priority,
    owasp: tc.owasp ? `${tc.owasp} ${OWASP_NAMES[tc.owasp]}` : undefined,
    endpoint: `${tc.request.method} ${tc.request.path}`,
    identity: tc.request.identity,
    requiresCredentials: [tc.requiresCredentials].filter((k) => k !== 'none'),
    expected: tc.expected,
    assumption: tc.assumption,
    steps: tc.steps,
    dataKeys: leaves.map((l) => `test-data/${l.request.dataFile ?? 'valid'}.json#${l.request.dataKey ?? l.id}`),
    script: line ? `${rel(spec)}:${line}` : rel(spec),
  };
}

export function getQtestFile(name: string) {
  const p = requireApi(name);
  const exists = fs.existsSync(p.excel);
  return { name, exists, path: p.excel, relativePath: rel(p.excel), sizeBytes: exists ? fs.statSync(p.excel).size : 0 };
}

export function readResourceJson(name: string, which: 'summary' | 'triage' | 'endpoint-summary'): unknown {
  const p = requireApi(name);
  if (which === 'summary') return getSummary(name);
  if (which === 'triage') return fs.existsSync(p.triage) ? readJson<unknown>(p.triage) : { items: [] };
  return readJson<unknown>(p.summary);
}
