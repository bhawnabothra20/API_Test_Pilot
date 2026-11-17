/**
 * Orchestration entry used by /api-test-pilot (and runnable directly):
 *
 *   npm run api-test -- <url> [--name <api-name>] [--only <stage,...>] [--from <stage>] [--ci] [--full]
 *
 * --full: regenerate every resource group. By default only groups whose endpoints/resource changed since the
 *         previous design are regenerated (spec/spec-diff.json, scripts/spec-diff.ts).
 *
 * Stages (in order): setup, safety, discover, design, excel, scripts, typecheck, preflight, run, calibrate, report, drift, final
 * Exit codes: 0 = pipeline finished (test failures are findings, not errors)
 *             2 = bad usage / safety gate refused the host
 *             3 = script error (typecheck or runner could not execute) - the test-runner agent self-heals
 *             1 = any other pipeline error
 * With --ci (scripts/ci.ts): non-interactive output, reports/ci-summary.md, and test results gate the exit code:
 *             0 = no new failures vs the previous run, 4 = new failures or new Critical authorization findings
 *             (first run: any Critical/High root cause), 5 = executed coverage < CI_MIN_COVERAGE (default 80).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { apiPaths, loadEnv, PROJECT_ROOT, readJson, redact } from '../shared/helpers/env';
import { assertUrlAllowed, HostNotAllowedError } from '../shared/helpers/safety-guard';
import type { EndpointSummary, TestCaseFile } from '../shared/helpers/types';
import { buildExcel, validateExcel, validateTraceability } from './build-qtest-excel';
import { buildSummaryReport } from './build-summary-report';
import { consolidate } from './consolidate-cases';
import { applyContract, calibrate } from './contract';
import { deriveApiName, discover } from './discover';
import { describeDiff, incrementalDesign, readSpecDiff } from './spec-diff';
import { generateSpecs } from './generate-specs';
import { ciGate, type CiResult } from './ci';
import { archiveFiles, archiveRun, clearCurrentRun, executedPct, passRatePct, runIdOf } from './history';
import { writeJunit } from './junit';
import { preflight } from './preflight';
import { driftFiles, readDrift, specDrift } from './spec-drift';
import { readResults, triage } from './triage-failures';

import { STAGES, TC_ID, type RunStatus, type Stage } from './stages';

/** stages repeated once after calibration learned new conventions */
const RERUN: Stage[] = ['design', 'excel', 'scripts', 'typecheck', 'run'];

/** Progress for callers such as the MCP server (API_TEST_STATUS_FILE); contains no secrets. */
let statusState: RunStatus = { state: 'running', totalStages: STAGES.length, pid: process.pid, updatedAt: new Date().toISOString() };
function writeStatus(update: Partial<RunStatus>): void {
  const file = process.env.API_TEST_STATUS_FILE;
  statusState = { ...statusState, ...update, updatedAt: new Date().toISOString() };
  if (file) fs.writeFileSync(file, JSON.stringify(statusState, null, 2), 'utf8');
}

class ScriptError extends Error {}

interface Args {
  url: string;
  name: string;
  stages: Stage[];
  /** high = one test case per endpoint + scenario (default); detailed = one test case per check */
  level: 'business' | 'high' | 'detailed';
  /** set once the calibration re-run happened (prevents loops) */
  recalibrated?: boolean;
  /** run only these TC ids (Playwright --grep on the [TC_ID] title prefix) */
  tcIds?: string[];
  /** CI mode: non-interactive output, ci-summary.md, exit code gated on new failures / coverage */
  ci: boolean;
  /** regenerate every group even when its part of the spec did not change */
  full: boolean;
  /** CI verdict, computed in the report stage (before archiving) or after the last stage */
  ciResult?: CiResult;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let name: string | undefined;
  let only: Stage[] | undefined;
  let from: Stage | undefined;
  let level: Args['level'] = 'business';
  let tcIds: string[] | undefined;
  let ci = false;
  let full = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--name') name = argv[++i];
    else if (a === '--ci') ci = true;
    else if (a === '--full') full = true;
    else if (a === '--tc') {
      // sub-check ids (TC_X_001.3) run as part of their high-level case
      tcIds = [...new Set(argv[++i].split(',').map((s) => s.trim().replace(/\.\d+$/, '')).filter(Boolean))];
      const bad = tcIds.filter((id) => !TC_ID.test(id));
      if (bad.length) {
        console.error(`invalid TC id(s): ${bad.join(', ')}`);
        process.exit(2);
      }
    }
    else if (a === '--level') { const v = argv[++i]; level = v === 'detailed' || v === 'high' ? v : 'business'; }
    else if (a === '--only') only = argv[++i].split(',').map((s) => s.trim() as Stage);
    else if (a === '--from') from = argv[++i] as Stage;
    else positional.push(a);
  }
  const url = positional[0];
  if (!url) {
    console.error('usage: npm run api-test -- <API_URL_OR_ENDPOINT_URL> [--name <api-name>] [--level business|high|detailed] [--only stage,..] [--from stage] [--ci] [--full]');
    process.exit(2);
  }
  for (const s of [...(only ?? []), ...(from ? [from] : [])]) {
    if (!STAGES.includes(s)) {
      console.error(`unknown stage "${s}". Stages: ${STAGES.join(', ')}`);
      process.exit(2);
    }
  }
  const stages = only ?? (from ? STAGES.slice(STAGES.indexOf(from)) : [...STAGES]);
  let derived: string;
  try {
    derived = name ?? deriveApiName(url);
  } catch {
    console.error(`Invalid URL "${url}".`);
    process.exit(2);
  }
  return { url, name: derived.toLowerCase().replace(/[^a-z0-9-]+/g, '-'), stages, level, tcIds, ci, full };
}

let logFile = '';
function log(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  console.log(line);
  if (logFile) fs.appendFileSync(logFile, redact(stamped) + '\n', 'utf8');
}

function run(cmd: string, env: NodeJS.ProcessEnv = {}): { code: number; output: string } {
  const r = spawnSync(cmd, { cwd: PROJECT_ROOT, shell: true, encoding: 'utf8', env: { ...process.env, ...env, FORCE_COLOR: '0' }, maxBuffer: 256 * 1024 * 1024 });
  return { code: r.status ?? 1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}

async function stage(name: Stage, args: Args): Promise<void> {
  const paths = apiPaths(args.name);
  const started = Date.now();
  log(`--- [${STAGES.indexOf(name)}] ${name}`);
  writeStatus({ stage: name, stageIndex: STAGES.indexOf(name) });
  switch (name) {
    case 'setup': {
      if (!fs.existsSync(path.join(PROJECT_ROOT, 'node_modules', '@playwright', 'test'))) {
        log('node_modules missing - running npm install');
        const r = run('npm install --no-audit --no-fund');
        if (r.code !== 0) throw new Error(`npm install failed:\n${r.output.slice(-2000)}`);
      }
      // API tests use the request fixture only, so no browser download is needed.
      for (const d of [paths.spec, paths.testData, paths.testCases, paths.tests, paths.schemas, paths.reports]) fs.mkdirSync(d, { recursive: true });
      log(`api name: ${args.name} -> ${paths.root}`);
      break;
    }
    case 'safety':
      assertUrlAllowed(args.url);
      log(`host allowed: ${new URL(args.url).hostname}`);
      break;
    case 'discover': {
      const s = await discover(args.url, args.name);
      log(`discovered ${s.endpoints.length} endpoints, ${s.resources.length} resources (source: ${s.specSource}, auth: ${s.auth.type}); ${s.assumptions.length} assumptions`);
      const hostOfBase = new URL(s.baseUrl).hostname;
      assertUrlAllowed(s.baseUrl); // spec may point at another host - it must be allowlisted too
      log(`base URL: ${s.baseUrl} (${hostOfBase})`);
      break;
    }
    case 'design': {
      // spec-diff updates: unchanged resource groups keep their previous cases and data (scripts/spec-diff.ts)
      const { design, diff } = incrementalDesign(args.name, { full: args.full && !args.recalibrated, writeDiff: !args.recalibrated });
      const detailed = design.file;
      if (!args.recalibrated) {
        log(`spec diff: ${describeDiff(diff)}`);
        for (const c of diff.endpoints.changed.slice(0, 10)) log(`  changed ${c.endpoint}: ${c.changes.slice(0, 3).join('; ')}${c.changes.length > 3 ? ` (+${c.changes.length - 3})` : ''}`);
        if (diff.endpoints.added.length) log(`  added   ${diff.endpoints.added.join(', ')}`);
        if (diff.endpoints.removed.length) log(`  removed ${diff.endpoints.removed.join(', ')}`);
      }
      const contract = applyContract(args.name); // calibrated conventions + human overrides
      if (contract.changed) log(`contract: ${contract.changed} checks use calibrated/overridden expectations (${contract.notes.length} notes)`);
      const f = args.level === 'detailed' ? readJson<TestCaseFile>(paths.testCasesJson) : consolidate(args.name, args.level);
      const by = f.cases.reduce<Record<string, number>>((acc, c) => ((acc[c.category] = (acc[c.category] ?? 0) + 1), acc), {});
      const checks = f.cases.reduce((n, c) => n + (c.subCases?.length ?? 1), 0);
      const left = detailed.cases.length - checks;
      log(
        `designed ${f.cases.length} ${args.level}-level test cases covering ${checks} checks${left > 0 ? ` (${left} low-value technical checks left out; --level high runs all ${detailed.cases.length})` : ''} ${JSON.stringify(by)}; test data written to ${paths.testData}`,
      );
      break;
    }
    case 'excel': {
      await buildExcel(args.name);
      const v = await validateExcel(args.name);
      log(`excel ${v.ok ? 'valid' : 'INVALID'}: ${v.cases} cases / ${v.rows} step rows -> ${paths.excel}`);
      if (!v.ok) throw new Error(`Excel validation failed:\n - ${v.errors.join('\n - ')}`);
      break;
    }
    case 'scripts': {
      const r = generateSpecs(args.name);
      const t = validateTraceability(args.name);
      log(
        `generated ${r.files.length} spec files (${r.tests} tests): ${r.written.length} rewritten${r.written.length ? ` (${r.written.join(', ')})` : ''}, ${r.unchanged.length} unchanged` +
          `${r.removed.length ? `, removed ${r.removed.join(', ')}` : ''}${r.schemasWritten.length ? `; schemas written: ${r.schemasWritten.join(', ')}` : ''}; traceability ${t.ok ? 'OK' : 'MISMATCH'}`,
      );
      if (!t.ok) throw new ScriptError(`Automation IDs mismatch. Missing in specs: ${t.missingInSpecs.slice(0, 10).join(', ')}; missing in Excel: ${t.missingInExcel.slice(0, 10).join(', ')}`);
      break;
    }
    case 'typecheck': {
      const r = run('npx tsc --noEmit -p tsconfig.json');
      if (r.code !== 0) {
        log(r.output.slice(0, 8000));
        throw new ScriptError('TypeScript errors (see above). Fix the script error and re-run with --from typecheck.');
      }
      log('tsc --noEmit: OK');
      break;
    }
    case 'preflight': {
      const p = await preflight(args.name);
      for (const c of p.credentials.filter((x) => x.neededBy || x.configured)) {
        const state = !c.configured ? 'MISSING' : c.verified === 'failed' ? 'LOGIN FAILED' : c.verified === 'ok' ? 'ok (token obtained)' : 'configured';
        log(`credentials ${c.kind.padEnd(17)} ${state.padEnd(20)} needed by ${c.neededBy} checks${c.via ? ` - via ${c.via}` : ''}`);
      }
      log(`quota: ${p.quota.status} - ${p.quota.detail}`);
      const pct = p.totalChecks ? Math.round((p.runnableChecks / p.totalChecks) * 100) : 0;
      log(`expected coverage: ${p.runnableChecks} of ${p.totalChecks} checks can execute (${pct}%)`);
      for (const w of p.warnings) log(`WARNING ${w}`);
      break;
    }
    case 'run': {
      const summary = readJson<EndpointSummary>(paths.summary);
      if (fs.existsSync(paths.resultsJson)) fs.rmSync(paths.resultsJson);
      clearCurrentRun(args.name); // previous triage/matrix stay in reports/history, never mixed with this run
      const env = {
        API_NAME: args.name,
        BASE_URL: process.env[`${summary.envPrefix}_BASE_URL`] || summary.baseUrl,
        // CI: compact 'dot' progress instead of the per-test list (playwright.config.ts)
        ...(args.ci ? { API_TEST_CI: '1' } : {}),
      };
      if (summary.auth.type === 'apiKey') {
        const keySet = !!(process.env[`${summary.envPrefix}_API_KEY`] || process.env[`${summary.envPrefix}_ADMIN_TOKEN`]);
        log(
          keySet
            ? `API key ${summary.envPrefix}_API_KEY: configured (sent as ${summary.auth.headerName ?? 'x-api-key'} on every request)`
            : `API key ${summary.envPrefix}_API_KEY: NOT configured - anonymous quota only; tests needing the key are skipped and tests past the quota are skipped with the reset time`,
        );
      }
      // TC ids are validated against ^TC_[A-Z0-9_]+$ in parseArgs, so the pattern is shell-safe
      const grep = args.tcIds?.length ? ` --grep "\\[(${args.tcIds.join('|')})\\]"` : '';
      log(`running: API_NAME=${args.name} npx playwright test${grep}`);
      const r = run(`npx playwright test${grep}`, env);
      fs.appendFileSync(logFile, redact(r.output) + '\n', 'utf8');
      const tail = r.output.trim().split('\n').slice(-8).join('\n');
      log(tail);
      const results = fs.existsSync(paths.resultsJson) ? readJson<{ stats?: { expected: number }; suites?: unknown[]; errors?: Array<{ message?: string }> }>(paths.resultsJson) : undefined;
      const globalErrors = results?.errors?.filter((e) => e.message) ?? [];
      if (!results || (globalErrors.length && !(results.suites ?? []).length)) {
        throw new ScriptError(`Playwright could not execute the suite (exit ${r.code}). ${globalErrors.map((e) => e.message).join(' | ').slice(0, 2000)}`);
      }
      // Load-time problems (bad import, syntax error in a spec) surface as top-level report errors or
      // "No tests found"; response bodies printed by failing tests must not be mistaken for them.
      if (globalErrors.length || /^Error: No tests found/m.test(r.output)) {
        throw new ScriptError(`Runner reported a script error: ${globalErrors.map((e) => e.message).join(' | ').slice(0, 2000) || 'No tests found'}`);
      }
      break;
    }
    case 'calibrate': {
      const r = calibrate(args.name);
      for (const c of r.learned) {
        log(`learned convention ${c.kind}${c.endpointId ? ` (${c.endpointId})` : ''}: ${c.observed} instead of assumed ${c.assumed.join('/')} - consistent across ${c.checks.length} checks`);
      }
      if (r.suggestions.length) log(`suggested-overrides.json: ${r.suggestions.length} endpoints accept invalid input - needs a human decision (not applied)`);
      if (r.learned.length && !args.recalibrated) {
        args.recalibrated = true;
        log('re-running design -> run once with the calibrated conventions');
        for (const s of RERUN) await stage(s, args);
        calibrate(args.name); // records evidence from the second run; no further re-run
      } else if (!r.learned.length) {
        log('no new conventions to learn');
      }
      break;
    }
    case 'report': {
      const t = triage(args.name);
      const r = buildSummaryReport(args.name);
      log(`triaged ${t.items.length} failures into ${t.rootCauses?.length ?? 0} root causes; summary -> ${r.file}`);
      const j = writeJunit(args.name);
      log(`junit: ${j.tests} tests, ${j.failures} failures, ${j.skipped} skipped -> ${j.file}`);
      if (args.ci) {
        // before archiving, so ci-summary.md is kept with the run; the previous run is read from history
        args.ciResult = ciGate(args.name, args.url);
        log(`ci-summary -> ${args.ciResult.file}`);
      }
      const { report } = readResults(args.name);
      const h = report?.stats?.startTime
        ? archiveRun(args.name, {
            startedAt: report.stats.startTime,
            sourceUrl: args.url,
            partial: !!args.tcIds?.length,
            testCases: readJson<TestCaseFile>(paths.testCasesJson).cases.length,
            totals: r.totals,
            executedPct: executedPct(r.totals),
            passRatePct: passRatePct(r.totals),
            failuresByClass: t.items.filter((i) => !i.flaky).reduce<Record<string, number>>((acc, i) => ((acc[i.classification] = (acc[i.classification] ?? 0) + 1), acc), {}),
            rootCauses: t.rootCauses?.length ?? 0,
            failedIds: t.items.filter((i) => !i.flaky).map((i) => i.testId),
          })
        : undefined;
      if (h) log(`run archived -> reports/history/${h.runId}/`);
      break;
    }
    case 'drift': {
      const { report } = readResults(args.name);
      if (!report) {
        log('no results.json - spec drift needs a completed run; skipped');
        break;
      }
      const d = specDrift(args.name);
      log(`spec drift: ${d.totals.items} items (${d.totals.fixApi} fix API, ${d.totals.fixDocs} fix docs), ${d.totals.withheld} doc changes withheld for unclean evidence -> ${driftFiles(args.name).drift}`);
      if (d.patchable) log(`openapi patch: ${d.totals.patchOps} operations -> ${driftFiles(args.name).patch} (+ openapi-suggested.yaml)`);
      buildSummaryReport(args.name); // adds the Spec drift section
      if (args.ci) args.ciResult = ciGate(args.name, args.url); // ci-summary.md now lists the drift too
      archiveFiles(args.name, runIdOf(report.stats?.startTime), ['spec-drift.json', 'openapi-patch.json', 'openapi-suggested.yaml', 'summary.html', 'ci-summary.md']);
      break;
    }
    case 'final': {
      const tc = readJson<TestCaseFile>(paths.testCasesJson);
      const r = fs.existsSync(paths.resultsJson) ? buildSummaryReport(args.name) : undefined;
      const specDiff = readSpecDiff(args.name);
      const drift = r ? readDrift(args.name, readResults(args.name).report?.stats?.startTime) : undefined;
      const classes = r ? r.triage.items.filter((i) => !i.flaky).reduce<Record<string, number>>((acc, i) => ((acc[i.classification] = (acc[i.classification] ?? 0) + 1), acc), {}) : {};
      const lines = [
        '',
        '================ API TEST RUN COMPLETE ================',
        `API            : ${args.name}  (${args.url})`,
        `Test cases     : ${tc.cases.length}`,
        specDiff ? `Spec changes   : ${describeDiff(specDiff)}` : '',
        r ? `Results        : total ${r.totals.total} | passed ${r.totals.passed} | failed ${r.totals.failed} | skipped ${r.totals.skipped} | flaky ${r.totals.flaky}` : 'Results        : (not run)',
        r ? `Coverage       : ${executedPct(r.totals)}% of tests executed | pass rate ${passRatePct(r.totals) ?? '-'}% of executed${executedPct(r.totals) < 80 ? '  <-- LOW COVERAGE: see the preflight warnings / skipped reasons' : ''}` : '',
        Object.keys(classes).length ? `Failure triage : ${Object.entries(classes).map(([k, v]) => `${k}: ${v}`).join(' | ')}` : '',
        r?.triage.rootCauses?.length ? `Root causes    : ${r.triage.rootCauses.length} distinct problems behind ${r.triage.items.length} failing tests` : '',
        ...(r?.triage.rootCauses ?? []).filter((c) => c.classification === 'Real API defect').slice(0, 5).map((c) => `  ${c.id.padEnd(5)}${c.severity.padEnd(9)}${c.title} (${c.checks} checks, ${c.endpoints.length} endpoints)`),
        drift
          ? `Spec drift     : ${drift.totals.items} items - ${drift.totals.fixApi} fix API, ${drift.totals.fixDocs} fix docs${drift.patchable ? ` (${drift.totals.patchOps} JSON Patch ops)` : ''} -> ${driftFiles(args.name).drift}`
          : '',
        `qTest Excel    : ${paths.excel}`,
        `Summary report : ${paths.summaryHtml}`,
        `Playwright     : ${path.join(paths.htmlReport, 'index.html')}`,
        `Triage         : ${paths.triage}`,
        `Run log        : ${paths.runLog}`,
        '=======================================================',
      ].filter(Boolean);
      lines.forEach((l) => log(l));
      if (r) writeStatus({ totals: r.totals });
      break;
    }
  }
  log(`    ${name} done in ${((Date.now() - started) / 1000).toFixed(1)} s`);
}

async function main(): Promise<void> {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));
  // the safety gate runs before anything touches the network, even when only later stages were requested
  try {
    assertUrlAllowed(args.url);
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(2);
  }
  const paths = apiPaths(args.name);
  fs.mkdirSync(paths.reports, { recursive: true });
  logFile = paths.runLog;
  if (args.stages[0] === 'setup' || !fs.existsSync(logFile)) fs.writeFileSync(logFile, '', 'utf8');
  log(`/api-test-pilot ${args.url} --name ${args.name} (stages: ${args.stages.join(', ')})`);
  for (const s of args.stages) {
    try {
      await stage(s, args);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof HostNotAllowedError) {
        log(msg);
        writeStatus({ state: 'failed', exitCode: 2, message: redact(msg) });
        process.exit(2);
      }
      log(`STAGE "${s}" FAILED: ${msg}`);
      const code = e instanceof ScriptError ? 3 : 1;
      writeStatus({ state: 'failed', exitCode: code, message: redact(`stage ${s} failed: ${msg}`).slice(0, 2000) });
      process.exit(code);
    }
  }
  if (!args.ci) {
    writeStatus({ state: 'done', exitCode: 0 });
    return;
  }
  const ci = args.ciResult ?? ciGate(args.name, args.url);
  log(`CI gate        : ${ci.verdict} (exit ${ci.exitCode})${ci.reasons.length ? ` - ${ci.reasons.join('; ')}` : ''}`);
  log(`CI summary     : ${ci.file}`);
  writeStatus({ state: 'done', exitCode: ci.exitCode, message: redact(`CI gate: ${ci.verdict}`) });
  process.exit(ci.exitCode);
}

void main();
