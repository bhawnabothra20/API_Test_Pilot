/**
 * Stage 9b - custom summary report: api/<name>/reports/summary.html
 * One self-contained page (inline CSS/JS): totals, results by category and endpoint, failure table with
 * triage class and evidence, skipped tests with reasons, assumptions, and links to the Excel file and the
 * Playwright HTML report.
 */
import fs from 'node:fs';
import path from 'node:path';
import { apiPaths, readJson } from '../shared/helpers/env';
import { CATEGORIES, OWASP_NAMES, type EndpointSummary, type TestCaseFile, type TriageFile } from '../shared/helpers/types';
import { buildAccessMatrix, type AccessMatrix } from './access-matrix';
import { compareWithPrevious, executedPct, passRatePct, readHistory, runIdOf, triageMatchesRun, type HistoryEntry } from './history';
import type { PreflightReport } from './preflight';
import { readDrift, type SpecDriftReport } from './spec-drift';
import { readResults, triage, type Outcome, type TestResultRow } from './triage-failures';

function rootCausesHtml(t: TriageFile): string {
  const rcs = t.rootCauses ?? [];
  if (!rcs.length) return '<p class="muted">No failures.</p>';
  const rows = rcs
    .map(
      (c) => `<tr><td class="mono">${esc(c.id)}</td><td><span class="tag sev-${esc(c.severity)}">${esc(c.severity)}</span></td>
<td><span class="tag cls-${esc(c.classification.replace(/[^A-Za-z]/g, ''))}">${esc(c.classification)}</span>${c.owasp ? ` <span class="tag owasp">${esc(c.owasp)}</span>` : ''}</td>
<td><b>${esc(c.title)}</b>${c.blockedBy ? ` <span class="small muted">(consequence of ${esc(c.blockedBy)})</span>` : ''}<div class="small muted">${esc(c.hint)}</div>
<details><summary>${c.endpoints.length} endpoint(s), ${c.testIds.length} test(s)</summary><div class="small mono">${c.endpoints.map(esc).join('<br>')}</div><div class="small mono" style="margin-top:6px">${c.testIds.map(esc).join(', ')}</div></details></td>
<td class="n">${c.checks}</td><td class="small"><span class="mono">${esc(c.example.testId)}</span><br><b>Expected:</b> ${esc(c.example.expected)}<br><b>Actual:</b> ${esc(c.example.actual)}</td></tr>`,
    )
    .join('\n');
  return `<div class="tablewrap"><table><thead><tr><th>ID</th><th>Severity</th><th>Class</th><th>Root cause</th><th>Failed checks</th><th>Example</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="small muted">Failed checks with the same underlying problem are grouped, whatever endpoint they hit. Fix a root cause and all its checks should pass.</p>`;
}

function preflightHtml(p: PreflightReport | undefined): string {
  if (!p) return '<p class="muted">No pre-run check recorded for this run.</p>';
  const rows = p.credentials
    .filter((c) => c.neededBy || c.configured)
    .map((c) => {
      const state = !c.configured ? '<span class="bad">missing</span>' : c.verified === 'failed' ? '<span class="bad">login failed</span>' : c.verified === 'ok' ? '<span class="ok">token obtained</span>' : '<span class="ok">configured</span>';
      return `<tr><td>${esc(c.kind)}</td><td>${state}</td><td class="n">${c.neededBy}</td><td class="small mono">${esc(c.via ?? '')}</td><td class="small">${esc(c.action ?? '')}</td></tr>`;
    })
    .join('');
  return `<div class="tablewrap"><table><thead><tr><th>Identity</th><th>Status</th><th>Checks needing it</th><th>Provided by (.env names)</th><th>Action</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">No credentials needed.</td></tr>'}</tbody></table></div>
<p class="small">Quota: <b>${esc(p.quota.status)}</b> - ${esc(p.quota.detail)} &middot; Expected before the run: ${p.runnableChecks} of ${p.totalChecks} checks executable.</p>`;
}

function driftHtml(d: SpecDriftReport | undefined): string {
  if (!d) return '<p class="muted">Spec drift is computed by the drift stage after this report; re-open this page after the run finishes.</p>';
  const head = `<p class="small">Documented behaviour (spec source: ${esc(d.specSource)}) compared with what the API did in this run. <b>${d.totals.fixApi}</b> fix API, <b>${
    d.totals.fixDocs
  }</b> fix docs${d.patchable ? ` &middot; <a href="openapi-patch.json">openapi-patch.json</a> (${d.totals.patchOps} JSON Patch operations) &middot; <a href="openapi-suggested.yaml">openapi-suggested.yaml</a>` : ''} &middot; <a href="spec-drift.json">spec-drift.json</a>.
Where the documentation is silent, consistent behaviour is suggested for the docs; where it is explicit, the API must comply.</p>`;
  if (!d.items.length) return `${head}<p class="muted">No drift found${d.confirmed.length ? `; ${d.confirmed.length} documented behaviours confirmed` : ''}.</p>`;
  const rows = d.items
    .map(
      (i) => `<tr><td class="mono">${esc(i.id)}</td><td><span class="tag ${i.recommendation === 'fix API' ? 'sev-High' : 'sev-Low'}">${esc(i.recommendation)}</span></td><td class="small">${esc(i.kind)}</td><td class="mono small">${esc(i.endpoint)}</td>
<td class="small">${esc(i.documented)}</td><td class="small">${esc(i.observed)}</td><td class="small">${esc(i.confidence)} (${i.checks})${i.patchOps?.length ? ' &middot; patched' : ''}</td><td class="mono small">${esc(i.evidence.slice(0, 3).join(', '))}${i.evidence.length > 3 ? ` +${i.evidence.length - 3}` : ''}</td></tr>`,
    )
    .join('');
  const withheld = d.withheld.length
    ? `<details><summary class="small">${d.withheld.length} documentation change(s) withheld - evidence not clean enough</summary><ul class="assume">${d.withheld
        .slice(0, 50)
        .map((w) => `<li><span class="mono">${esc(w.endpoint)}</span>: ${esc(w.candidate)} - ${esc(w.reason)}</li>`)
        .join('')}</ul></details>`
    : '';
  return `${head}<div class="tablewrap"><table><thead><tr><th>ID</th><th>Fix</th><th>Kind</th><th>Endpoint</th><th>Documented</th><th>Observed</th><th>Confidence (checks)</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table></div>${withheld}`;
}

function historyHtml(current: HistoryEntry, previous: HistoryEntry[]): string {
  const rows = [current, ...previous]
    .map((h, i) => {
      const link = i === 0 ? '<i>this run</i>' : `<a href="history/${esc(h.runId)}/summary.html">report</a>`;
      const cls = Object.entries(h.failuresByClass).map(([k, v]) => `${k}: ${v}`).join(', ');
      return `<tr><td class="small">${esc(h.startedAt.replace('T', ' ').slice(0, 16))}${h.partial ? ' <span class="tag">partial</span>' : ''}</td><td class="n">${h.totals.total}</td><td class="n">${h.executedPct}%</td><td class="n">${h.passRatePct ?? '-'}%</td><td class="n">${h.totals.failed}</td><td class="n">${h.rootCauses}</td><td class="small">${esc(cls)}</td><td class="small">${link}</td></tr>`;
    })
    .join('');
  return `<div class="tablewrap"><table><thead><tr><th>Run (UTC)</th><th>Tests</th><th>Executed</th><th>Pass rate</th><th>Failed</th><th>Root causes</th><th>By class</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

function accessMatrixHtml(m: AccessMatrix): string {
  if (!m.rows.length) return '<p class="muted">No authentication/authorization checks for this API.</p>';
  const head = m.identities.map((i) => `<th>${esc(i)}</th>`).join('');
  const body = m.rows
    .map((row) => {
      const cells = m.identities
        .map((i) => {
          const c = row.cells[i];
          if (!c) return '<td class="mx none">-</td>';
          const exp = c.expected.join('/');
          const act = c.actual !== undefined ? String(c.actual) : c.outcome === 'skipped' ? 'skipped' : '?';
          const tag = c.finding ? `<div class="tag finding">${esc(c.finding)}${c.owasp ? ` ${esc(c.owasp)}` : ''}</div>` : '';
          const title = `${c.checks.join(', ')}${c.owasp ? ` - ${c.owasp} ${OWASP_NAMES[c.owasp]}` : ''}`;
          return `<td class="mx ${c.finding ? 'finding' : c.outcome}" title="${esc(title)}">exp ${esc(exp)}<br>act ${esc(act)}${tag}</td>`;
        })
        .join('');
      return `<tr><td class="mono">${esc(row.endpoint)}</td>${cells}</tr>`;
    })
    .join('\n');
  return `<div class="tablewrap"><table class="matrix"><thead><tr><th>Endpoint</th>${head}</tr></thead><tbody>${body}</tbody></table></div>
<p class="small muted">Cell: expected vs actual status of the request under test. Green pass, red fail, grey skipped (credentials not configured).
Highlighted cells are authorization bypasses (2xx where access must be denied) with their OWASP API Top 10 id. No token values are stored.</p>`;
}

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

interface Tally {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
}
const empty = (): Tally => ({ total: 0, passed: 0, failed: 0, skipped: 0, flaky: 0 });
function add(t: Tally, o: Outcome): void {
  t.total++;
  t[o]++;
}

function bar(t: Tally): string {
  const pct = (n: number) => (t.total ? (n / t.total) * 100 : 0).toFixed(2);
  return `<div class="bar" role="img" aria-label="${t.passed} passed, ${t.failed} failed, ${t.skipped} skipped">
    <span class="p" style="width:${pct(t.passed + t.flaky)}%"></span><span class="f" style="width:${pct(t.failed)}%"></span><span class="s" style="width:${pct(t.skipped)}%"></span></div>`;
}

function tallyRow(label: string, t: Tally): string {
  const rate = passRatePct(t);
  return `<tr><td>${esc(label)}</td><td class="n">${t.total}</td><td class="n ok">${t.passed + t.flaky}</td><td class="n bad">${t.failed}</td><td class="n muted">${t.skipped}</td><td class="n">${executedPct(t)}%</td><td class="n">${rate === null ? '-' : `${rate}%`}</td><td class="barcell">${bar(t)}</td></tr>`;
}

export function buildSummaryReport(apiName: string): { file: string; totals: Tally; triage: TriageFile } {
  const paths = apiPaths(apiName);
  const summary = readJson<EndpointSummary>(paths.summary);
  const tcFile = readJson<TestCaseFile>(paths.testCasesJson);
  const cases = new Map(tcFile.cases.map((c) => [c.id, c]));
  const { rows, report } = readResults(apiName);
  const existing = fs.existsSync(paths.triage) ? readJson<TriageFile>(paths.triage) : undefined;
  // never show a triage from another run (or one without root causes) next to these results
  const tri = existing && triageMatchesRun(existing, report?.stats?.startTime) && existing.rootCauses ? existing : triage(apiName);
  const preflightFile = path.join(paths.reports, 'preflight.json');
  const pre = fs.existsSync(preflightFile) ? readJson<PreflightReport>(preflightFile) : undefined;
  const matrix = buildAccessMatrix(apiName);
  const drift = readDrift(apiName, report?.stats?.startTime);
  const authzFindings = tri.items.filter((i) => i.owasp && i.classification === 'Real API defect');
  const triMap = new Map(tri.items.map((i) => [i.testId, i]));

  const totals = empty();
  const byCat = new Map<string, Tally>(CATEGORIES.map((c) => [c, empty()]));
  const byEndpoint = new Map<string, Tally>();
  const byClass = new Map<string, number>();
  for (const r of rows) {
    add(totals, r.outcome);
    const tc = cases.get(r.id);
    const cat = tc?.category ?? 'Unknown';
    if (!byCat.has(cat)) byCat.set(cat, empty());
    add(byCat.get(cat)!, r.outcome);
    const endpoint = tc ? summary.endpoints.find((e) => e.id === tc.endpointId) : undefined;
    const ep = endpoint ? `${endpoint.method} ${endpoint.path}` : 'unknown';
    if (!byEndpoint.has(ep)) byEndpoint.set(ep, empty());
    add(byEndpoint.get(ep)!, r.outcome);
  }
  for (const i of tri.items.filter((x) => !x.flaky)) byClass.set(i.classification, (byClass.get(i.classification) ?? 0) + 1);

  const failures = rows.filter((r) => r.outcome === 'failed' || r.outcome === 'flaky');
  const skipped = rows.filter((r) => r.outcome === 'skipped');
  const ranAt = report?.stats?.startTime ? new Date(report.stats.startTime) : new Date();
  const duration = report?.stats?.duration ? `${Math.round(report.stats.duration / 1000)} s` : '-';
  const excelRel = path.relative(paths.reports, paths.excel).replace(/\\/g, '/');
  const assumptions = [...summary.assumptions, ...tcFile.assumptions];
  const runId = runIdOf(report?.stats?.startTime);
  const failedIds = tri.items.filter((i) => !i.flaky).map((i) => i.testId);
  const current: HistoryEntry = {
    runId: runId ?? 'current',
    startedAt: ranAt.toISOString(),
    sourceUrl: summary.sourceUrl,
    partial: rows.length < tcFile.cases.length,
    testCases: tcFile.cases.length,
    totals,
    executedPct: executedPct(totals),
    passRatePct: passRatePct(totals),
    failuresByClass: Object.fromEntries(byClass),
    rootCauses: tri.rootCauses?.length ?? 0,
    failedIds,
  };
  const previousRuns = readHistory(apiName).filter((h) => h.runId !== runId);
  const executedIds = rows.filter((r) => r.outcome !== 'skipped').map((r) => r.id);
  const diff = compareWithPrevious(apiName, runId, failedIds, executedIds);
  const coverage = executedPct(totals);
  const passRate = passRatePct(totals);
  const lowCoverage = totals.total > 0 && coverage < 80;
  const defectCauses = (tri.rootCauses ?? []).filter((c) => c.classification === 'Real API defect').length;

  const failureRows = failures
    .map((r: TestResultRow) => {
      const t = triMap.get(r.id);
      const tc = cases.get(r.id);
      const ev = t?.evidence;
      const evidence = ev
        ? `<details><summary>${esc(ev.method)} ${esc(ev.url)} &rarr; ${ev.status} (${ev.durationMs} ms)</summary><pre>Request headers: ${esc(JSON.stringify(ev.requestHeaders))}
Request body: ${esc(ev.requestBody ?? '(none)')}

Response headers: ${esc(JSON.stringify(ev.responseHeaders))}
Response body: ${esc(ev.responseBody)}</pre></details>`
        : '<span class="muted">no exchange captured</span>';
      return `<tr data-class="${esc(t?.classification ?? '')}" data-cat="${esc(tc?.category ?? '')}">
  <td class="mono">${esc(r.id)}${r.outcome === 'flaky' ? ' <span class="tag flaky">flaky</span>' : ''}</td>
  <td>${esc(tc?.title ?? r.title)}<div class="muted small">${esc(tc?.category ?? '')} &middot; ${esc(tc ? `${tc.request.method} ${tc.request.path}` : '')}</div></td>
  <td><span class="tag cls-${esc((t?.classification ?? '').replace(/[^A-Za-z]/g, ''))}">${esc(t?.classification ?? '-')}</span>${t?.severity ? ` <span class="tag sev-${esc(t.severity)}">${esc(t.severity)}</span>` : ''}${t?.owasp ? ` <span class="tag owasp">${esc(t.owasp)}</span>` : ''}<div class="small">${esc(t?.reason ?? '')}</div></td>
  <td class="small"><b>Expected:</b> ${esc(t?.expected ?? '')}<br><b>Actual:</b> ${esc(t?.actual ?? '')}</td>
  <td class="small">${evidence}<details><summary>error</summary><pre>${esc(t?.error ?? r.error)}</pre></details></td>
</tr>`;
    })
    .join('\n');

  const skippedRows = skipped
    .map((r) => `<tr><td class="mono">${esc(r.id)}</td><td>${esc(cases.get(r.id)?.title ?? r.title)}</td><td class="small">${esc(r.skipReason || 'skipped')}</td></tr>`)
    .join('\n');

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(summary.apiName)} API test summary</title>
<style>
:root{--bg:#f7f7f5;--card:#fff;--fg:#1d1d1b;--muted:#6b6b66;--line:#e3e2dc;--ok:#1f7a4d;--bad:#b42318;--skip:#9a9a92;--accent:#2f5bd3;--warn:#b26b00}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--card:#1f1f1d;--fg:#ecebe6;--muted:#a3a29b;--line:#34332f;--ok:#4cc38a;--bad:#ff6b5e;--skip:#77766f;--accent:#7d9bff;--warn:#e0a640}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
main{max-width:1280px;margin:0 auto;padding:24px 16px 64px}h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:32px 0 10px}
a{color:var(--accent)}.muted{color:var(--muted)}.small{font-size:12px}.mono{font-family:ui-monospace,Consolas,monospace;font-size:12px;word-break:break-all}
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-top:18px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.card .v{font-size:26px;font-weight:650}.card .k{color:var(--muted);font-size:12px;text-transform:uppercase;letter-spacing:.04em}
.ok{color:var(--ok)}.bad{color:var(--bad)}.links{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.links a{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:6px 10px;text-decoration:none}
.tablewrap{overflow-x:auto;background:var(--card);border:1px solid var(--line);border-radius:10px}
table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}th{font-size:12px;color:var(--muted);font-weight:600;white-space:nowrap}
td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.barcell{min-width:140px}
.bar{display:flex;height:8px;border-radius:4px;overflow:hidden;background:var(--line)}.bar .p{background:var(--ok)}.bar .f{background:var(--bad)}.bar .s{background:var(--skip)}
.tag{display:inline-block;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:600;border:1px solid currentColor;white-space:nowrap}
.cls-RealAPIdefect{color:var(--bad)}.cls-ContractSpecmismatch{color:var(--warn)}.cls-Testdataissue{color:var(--accent)}.cls-FlakyEnvironmentissue,.flaky{color:var(--skip)}
pre{white-space:pre-wrap;word-break:break-word;max-height:320px;overflow:auto;background:var(--bg);padding:8px;border-radius:6px;font-size:11px}
details summary{cursor:pointer;color:var(--accent)}.filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px}
input,select{background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:6px 8px;font:inherit}
ul.assume li{margin:4px 0}
table.matrix td.mx{font-size:11px;text-align:center;white-space:nowrap;min-width:72px}
td.mx.pass{background:color-mix(in srgb,var(--ok) 14%,transparent)}td.mx.fail{background:color-mix(in srgb,var(--bad) 14%,transparent)}
td.mx.skipped,td.mx.not-run,td.mx.none{color:var(--muted)}
td.mx.finding{background:color-mix(in srgb,var(--bad) 32%,transparent);font-weight:700;outline:2px solid var(--bad);outline-offset:-2px}
.tag.finding{color:var(--bad);margin-top:3px}.tag.owasp{color:var(--accent)}
.banner{margin-top:16px;padding:12px 14px;border-radius:10px;border:1px solid var(--warn);background:color-mix(in srgb,var(--warn) 12%,transparent)}.banner ul{margin:6px 0 0;padding-left:18px}
.sev-Critical{color:var(--bad);font-weight:700}.sev-High{color:var(--bad)}.sev-Medium{color:var(--warn)}.sev-Low{color:var(--muted)}
</style>
</head>
<body><main>
<h1>${esc(summary.title)}</h1>
<div class="muted">API <b>${esc(summary.apiName)}</b> &middot; input <a href="${esc(summary.sourceUrl)}">${esc(summary.sourceUrl)}</a> &middot; base URL <span class="mono">${esc(summary.baseUrl)}</span> &middot; spec source ${esc(summary.specSource)} &middot; auth ${esc(summary.auth.type)}</div>
<div class="muted">Run ${esc(ranAt.toISOString().replace('T', ' ').slice(0, 19))} UTC &middot; duration ${esc(duration)} &middot; ${summary.endpoints.length} endpoints &middot; ${tcFile.cases.length} test cases</div>
<div class="links"><a href="html/index.html">Playwright HTML report</a><a href="${esc(excelRel)}">qTest Excel import file</a><a href="triage.json">triage.json</a><a href="run-log.txt">run-log.txt</a></div>

${
  lowCoverage
    ? `<div class="banner"><b>Only ${coverage}% of the tests executed</b> (${totals.skipped} of ${totals.total} skipped) - the pass rate below covers the executed tests only and is not representative of the API.${
        pre?.warnings.length ? `<ul>${pre.warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ' See "Skipped" for the reasons.'
      }</div>`
    : ''
}
<div class="cards">
<div class="card"><div class="k">Total</div><div class="v">${totals.total}</div></div>
<div class="card"><div class="k">Executed</div><div class="v ${lowCoverage ? 'bad' : ''}">${coverage}%</div><div class="small muted">${totals.total - totals.skipped} of ${totals.total}</div></div>
<div class="card"><div class="k">Pass rate</div><div class="v">${passRate === null ? '-' : `${passRate}%`}</div><div class="small muted">of executed tests</div></div>
<div class="card"><div class="k">Passed</div><div class="v ok">${totals.passed}</div></div>
<div class="card"><div class="k">Failed</div><div class="v bad">${totals.failed}</div></div>
<div class="card"><div class="k">Skipped</div><div class="v muted">${totals.skipped}</div></div>
<div class="card"><div class="k">Flaky</div><div class="v">${totals.flaky}</div></div>
<div class="card"><div class="k">Root causes</div><div class="v">${tri.rootCauses?.length ?? 0}</div><div class="small muted">${defectCauses} real defect${defectCauses === 1 ? '' : 's'}</div></div>
</div>
${
  diff.previous
    ? `<p class="small">Compared with the previous full run (${esc(diff.previous.startedAt.replace('T', ' ').slice(0, 16))} UTC): <b>${diff.newFailures.length}</b> new failure(s), <b>${diff.fixed.length}</b> fixed (ran and passed)${
        diff.notRun.length ? `, <b>${diff.notRun.length}</b> previously failing test(s) not run this time (test level, spec or credentials changed) - <i>not</i> counted as fixed` : ''
      }.${diff.newFailures.length ? ` New: <span class="mono">${diff.newFailures.slice(0, 15).map(esc).join(', ')}</span>` : ''}</p>`
    : ''
}

<h2>Root causes (${tri.rootCauses?.length ?? 0} behind ${failures.length} failing tests)</h2>
${rootCausesHtml(tri)}

<h2>Spec drift${drift ? ` (${drift.totals.items})` : ''}</h2>
${driftHtml(drift)}

<h2>Pre-run checks</h2>
${preflightHtml(pre)}

<h2>Results by category</h2>
<div class="tablewrap"><table><thead><tr><th>Category</th><th>Total</th><th>Passed</th><th>Failed</th><th>Skipped</th><th>Executed</th><th>Pass rate</th><th></th></tr></thead><tbody>
${[...byCat.entries()].filter(([, t]) => t.total).map(([k, t]) => tallyRow(k, t)).join('\n')}
</tbody></table></div>

<h2>Results by endpoint</h2>
<div class="tablewrap"><table><thead><tr><th>Endpoint</th><th>Total</th><th>Passed</th><th>Failed</th><th>Skipped</th><th>Executed</th><th>Pass rate</th><th></th></tr></thead><tbody>
${[...byEndpoint.entries()].map(([k, t]) => tallyRow(k, t)).join('\n')}
</tbody></table></div>

<h2>Access matrix</h2>
${accessMatrixHtml(matrix)}

<h2>Authorization findings (${authzFindings.length})</h2>
${
  authzFindings.length
    ? `<div class="tablewrap"><table><thead><tr><th>Severity</th><th>OWASP API Top 10</th><th>Test</th><th>Finding</th></tr></thead><tbody>${authzFindings
        .map(
          (f) =>
            `<tr><td><span class="tag sev-${esc(f.severity ?? '')}">${esc(f.severity ?? '')}</span></td><td>${esc(f.owasp ?? '')} ${esc(f.owasp ? OWASP_NAMES[f.owasp] : '')}</td><td><span class="mono">${esc(f.testId)}</span><div class="small">${esc(f.title)}</div></td><td class="small">${esc(f.reason)}</td></tr>`,
        )
        .join('')}</tbody></table></div>`
    : '<p class="muted">No authorization defects found in the checks that ran (see the access matrix for skipped identities).</p>'
}

<h2>Failures (${failures.length})</h2>
<div class="filters"><input id="q" type="search" placeholder="Filter by id, title, endpoint..." aria-label="Filter failures">
<select id="cls" aria-label="Triage class"><option value="">All triage classes</option>${['Real API defect', 'Contract/Spec mismatch', 'Test data issue', 'Flaky/Environment issue'].map((c) => `<option>${c}</option>`).join('')}</select>
<select id="cat" aria-label="Category"><option value="">All categories</option>${CATEGORIES.map((c) => `<option>${c}</option>`).join('')}</select></div>
<div class="tablewrap"><table id="fail"><thead><tr><th>Test ID</th><th>Test</th><th>Triage</th><th>Expected vs actual</th><th>Evidence</th></tr></thead><tbody>
${failureRows || '<tr><td colspan="5" class="muted">No failures.</td></tr>'}
</tbody></table></div>

<h2>Skipped (${skipped.length})</h2>
<div class="tablewrap"><table><thead><tr><th>Test ID</th><th>Test</th><th>Reason</th></tr></thead><tbody>
${skippedRows || '<tr><td colspan="3" class="muted">Nothing skipped.</td></tr>'}
</tbody></table></div>

<h2>Run history</h2>
${historyHtml(current, previousRuns)}

<h2>Assumptions</h2>
<ul class="assume">${assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>
<h2>Not applicable to this API</h2>
<ul class="assume">${tcFile.notApplicable.map((a) => `<li>${esc(a)}</li>`).join('') || '<li class="muted">None</li>'}</ul>
</main>
<script>
(function(){var q=document.getElementById('q'),c=document.getElementById('cls'),k=document.getElementById('cat');
function f(){var t=q.value.toLowerCase();document.querySelectorAll('#fail tbody tr[data-class]').forEach(function(r){
var ok=(!t||r.textContent.toLowerCase().indexOf(t)>=0)&&(!c.value||r.dataset.class===c.value)&&(!k.value||r.dataset.cat===k.value);r.style.display=ok?'':'none';});}
[q,c,k].forEach(function(el){el.addEventListener('input',f);});})();
</script>
</body></html>
`;
  fs.mkdirSync(paths.reports, { recursive: true });
  fs.writeFileSync(paths.summaryHtml, html, 'utf8');
  return { file: paths.summaryHtml, totals, triage: tri };
}

if (require.main === module) {
  const name = process.argv[2];
  if (!name) {
    console.error('usage: tsx scripts/build-summary-report.ts <api-name>');
    process.exit(2);
  }
  triage(name);
  const r = buildSummaryReport(name);
  console.log(`summary report -> ${r.file}`, r.totals);
}
