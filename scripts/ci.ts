/**
 * CI gate for `npm run api-test -- <url> --ci`: writes api/<name>/reports/ci-summary.md (PR comment /
 * job summary) and decides the exit code.
 *
 *   0  no new failures compared with the previous complete run (or, on a first run, no Critical/High root cause)
 *   4  new failures or new Critical authorization findings (first run: any Critical/High root cause)
 *   5  executed coverage below CI_MIN_COVERAGE (default 80) - the pass rate is not representative
 *   1  no results to judge (the run stage did not produce results.json)
 *
 * When both 4 and 5 apply, 4 wins: a regression that was observed is more actionable than missing coverage;
 * the summary lists both. Exit codes 1/2/3 for pipeline errors are unchanged (scripts/api-test.ts).
 * Flaky tests (failed, then passed on retry) never count as failures; Flaky/Environment root causes
 * never block a first run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { apiPaths, numberEnv, readJson, redact } from '../shared/helpers/env';
import { OWASP_NAMES, type RootCause, type TriageFile } from '../shared/helpers/types';
import { compareWithPrevious, executedPct, passRatePct, runIdOf, type HistoryEntry, type Totals } from './history';
import type { PreflightReport } from './preflight';
import { readDrift } from './spec-drift';
import { readResults } from './triage-failures';

export const CI_EXIT = { pass: 0, noResults: 1, regression: 4, lowCoverage: 5 } as const;

export interface CiResult {
  exitCode: number;
  verdict: string;
  reasons: string[];
  file: string;
}

const MAX_LIST = 25;
const md = (s: string): string => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
const sameCause = (a: RootCause, b: RootCause): boolean => (!!a.key && a.key === b.key) || a.title === b.title;

function previousTriage(apiName: string, previous: HistoryEntry | undefined): TriageFile | undefined {
  if (!previous || !/^[0-9TZ-]+$/.test(previous.runId)) return undefined;
  const f = path.join(apiPaths(apiName).reports, 'history', previous.runId, 'triage.json');
  return fs.existsSync(f) ? readJson<TriageFile>(f) : undefined;
}

export function ciGate(apiName: string, sourceUrl: string): CiResult {
  const paths = apiPaths(apiName);
  const file = path.join(paths.reports, 'ci-summary.md');
  const minCoverage = numberEnv('CI_MIN_COVERAGE', 80);
  const { rows, report } = readResults(apiName);
  const marker = `<!-- api-test:${apiName} -->`;

  if (!report || !rows.length) {
    const text = `${marker}\n## API test \`${apiName}\`: no results\n\nThe run produced no results.json - see run-log.txt in the job artifacts.\n`;
    fs.writeFileSync(file, redact(text), 'utf8');
    return { exitCode: CI_EXIT.noResults, verdict: 'NO RESULTS', reasons: ['no results.json'], file };
  }

  const count = (o: string) => rows.filter((r) => r.outcome === o).length;
  const totals: Totals = { total: rows.length, passed: count('passed'), failed: count('failed'), skipped: count('skipped'), flaky: count('flaky') };
  const executed = executedPct(totals);
  const passRate = passRatePct(totals);
  const titleOf = new Map(rows.map((r) => [r.id, r.title]));
  const failedIds = rows.filter((r) => r.outcome === 'failed').map((r) => r.id);

  const triage = fs.existsSync(paths.triage) ? readJson<TriageFile>(paths.triage) : undefined;
  const causes = triage?.runStartedAt === report.stats?.startTime ? (triage?.rootCauses ?? []) : [];
  const runId = runIdOf(report.stats?.startTime);
  const cmp = compareWithPrevious(apiName, runId, failedIds, rows.filter((r) => r.outcome !== 'skipped').map((r) => r.id));
  const prevCauses = previousTriage(apiName, cmp.previous)?.rootCauses ?? [];

  const criticalAuthz = causes.filter((c) => c.severity === 'Critical' && c.owasp);
  const newCriticalAuthz = cmp.previous ? criticalAuthz.filter((c) => !prevCauses.some((p) => sameCause(c, p))) : criticalAuthz;
  const blocking = causes.filter((c) => (c.severity === 'Critical' || c.severity === 'High') && c.classification !== 'Flaky/Environment issue');

  const reasons: string[] = [];
  let regression = false;
  if (cmp.previous) {
    if (cmp.newFailures.length) {
      regression = true;
      reasons.push(`${cmp.newFailures.length} new failing test${cmp.newFailures.length === 1 ? '' : 's'} compared with run ${cmp.previous.runId}`);
    }
    if (newCriticalAuthz.length) {
      regression = true;
      reasons.push(`${newCriticalAuthz.length} new Critical authorization finding${newCriticalAuthz.length === 1 ? '' : 's'} (${[...new Set(newCriticalAuthz.map((c) => c.owasp))].join(', ')})`);
    }
  } else if (blocking.length) {
    regression = true;
    reasons.push(`first run without history: ${blocking.length} Critical/High root cause${blocking.length === 1 ? '' : 's'}`);
  }
  const lowCoverage = executed < minCoverage;
  if (lowCoverage) reasons.push(`executed coverage ${executed}% is below CI_MIN_COVERAGE ${minCoverage}%`);

  const exitCode = regression ? CI_EXIT.regression : lowCoverage ? CI_EXIT.lowCoverage : CI_EXIT.pass;
  const verdict = regression
    ? cmp.previous
      ? 'FAILED - new failures'
      : 'FAILED - Critical/High root causes (first run)'
    : lowCoverage
      ? 'FAILED - low coverage'
      : 'PASSED';
  const icon = exitCode === 0 ? '✅' : regression ? '❌' : '⚠️';

  const out: string[] = [
    marker,
    `## ${icon} API test \`${apiName}\`: ${verdict}`,
    '',
    `Source: ${sourceUrl} · Run: \`${runId ?? '-'}\` · Exit code: \`${exitCode}\``,
    '',
    '| Total | Passed | Failed | Skipped | Flaky | Executed | Pass rate (of executed) |',
    '|---:|---:|---:|---:|---:|---:|---:|',
    `| ${totals.total} | ${totals.passed} | ${totals.failed} | ${totals.skipped} | ${totals.flaky} | ${executed}%${lowCoverage ? ' ⚠️' : ''} | ${passRate ?? '-'}% |`,
    '',
    reasons.length ? `**Gate:** ${reasons.map(md).join('; ')}.` : cmp.previous ? '**Gate:** no new failures compared with the previous run.' : '**Gate:** first run without history; no Critical/High root causes.',
    lowCoverage ? `\n> Only ${executed}% of the tests executed, so the pass rate is not representative. See the pre-run warnings below and the skipped reasons in junit.xml.` : '',
    '',
  ];

  if (cmp.previous) {
    out.push(`### Compared with the previous run (\`${cmp.previous.runId}\`)`, '');
    out.push(`- **New failures (${cmp.newFailures.length})**${cmp.newFailures.length ? ':' : ''}`);
    for (const id of cmp.newFailures.slice(0, MAX_LIST)) out.push(`  - ${md(titleOf.get(id) ?? id)}`);
    if (cmp.newFailures.length > MAX_LIST) out.push(`  - ... and ${cmp.newFailures.length - MAX_LIST} more`);
    out.push(`- **Fixed (${cmp.fixed.length})**${cmp.fixed.length ? ':' : ''}`);
    for (const id of cmp.fixed.slice(0, MAX_LIST)) out.push(`  - ${md(titleOf.get(id) ?? id)}`);
    if (cmp.fixed.length > MAX_LIST) out.push(`  - ... and ${cmp.fixed.length - MAX_LIST} more`);
    out.push(`- Still failing: ${failedIds.length - cmp.newFailures.length}`);
    if (cmp.notRun.length) out.push(`- Not run this time (not counted as fixed): ${cmp.notRun.length} previously failing tests - test level, spec or credentials changed`);
    out.push('');
  } else {
    out.push('### Compared with the previous run', '', 'No previous complete run in history - this run is the baseline.', '');
  }

  if (newCriticalAuthz.length) {
    out.push('### New Critical authorization findings', '');
    for (const c of newCriticalAuthz) out.push(`- **${c.id}** ${c.owasp} ${c.owasp ? OWASP_NAMES[c.owasp] : ''}: ${md(c.title)} (${c.endpoints.map(md).join(', ')})`);
    out.push('');
  }

  if (causes.length) {
    out.push(`### Top root causes (${causes.length} behind ${failedIds.length} failing tests)`, '');
    out.push('| ID | Severity | Class | Root cause | Checks | Endpoints | New |', '|---|---|---|---|---:|---|---|');
    for (const c of causes.slice(0, 10)) {
      const isNew = cmp.previous ? (prevCauses.some((p) => sameCause(c, p)) ? '' : 'new') : '';
      const eps = c.endpoints.slice(0, 4).map(md).join(', ') + (c.endpoints.length > 4 ? ` +${c.endpoints.length - 4}` : '');
      out.push(`| ${c.id} | ${c.severity} | ${c.classification} | ${md(c.title)}${c.owasp ? ` (${c.owasp})` : ''}${c.blockedBy ? ` - caused by ${c.blockedBy}` : ''} | ${c.checks} | ${eps} | ${isNew} |`);
    }
    if (causes.length > 10) out.push('', `... and ${causes.length - 10} more in summary.html.`);
    out.push('');
  }

  const drift = readDrift(apiName, report.stats?.startTime);
  if (drift?.items.length) {
    out.push(`### Spec drift (${drift.totals.fixApi} fix API, ${drift.totals.fixDocs} fix docs)`, '');
    out.push('| ID | Fix | Kind | Endpoint | Documented | Observed |', '|---|---|---|---|---|---|');
    for (const d of drift.items.slice(0, 8)) out.push(`| ${d.id} | ${d.recommendation} | ${d.kind} | ${md(d.endpoint)} | ${md(d.documented)} | ${md(d.observed)} |`);
    if (drift.items.length > 8) out.push('', `... and ${drift.items.length - 8} more in spec-drift.json.`);
    if (drift.patchable && drift.totals.patchOps) out.push('', `Suggested documentation changes: \`openapi-patch.json\` (${drift.totals.patchOps} JSON Patch operations) and \`openapi-suggested.yaml\`.`);
    out.push('');
  }

  const preflightFile = path.join(paths.reports, 'preflight.json');
  const warnings = fs.existsSync(preflightFile) ? readJson<PreflightReport>(preflightFile).warnings : [];
  if (warnings.length) {
    out.push('### Pre-run warnings', '');
    for (const w of warnings) out.push(`- ${md(w)}`);
    out.push('');
  }

  out.push('Full reports (summary.html, Playwright report, junit.xml, spec-drift.json, qTest Excel) are in the job artifacts.', '');
  fs.writeFileSync(file, redact(out.filter((l, i, a) => !(l === '' && a[i - 1] === '')).join('\n')), 'utf8');
  return { exitCode, verdict, reasons, file };
}
