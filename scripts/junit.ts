/**
 * JUnit XML for CI systems: api/<name>/reports/junit.xml.
 *
 * Written by the report stage (after triage) rather than by Playwright's built-in junit reporter, so every
 * failure message can name its root cause. One <testsuite> per test category; each <testcase> is named
 * "[TC_ID] title" (the qTest Automation ID). Failure message: "RC3 (High, Real API defect): <root cause>".
 * All text comes from results.json / triage.json, which are already redacted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { apiPaths, readJson, redact } from '../shared/helpers/env';
import type { RootCause, TestCase, TestCaseFile, TriageFile, TriageItem } from '../shared/helpers/types';
import { readResults, type TestResultRow } from './triage-failures';

const xml = (s: string): string =>
  s
    // characters not allowed in XML 1.0
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const seconds = (ms: number): string => (ms / 1000).toFixed(3);

function failureMessage(item: TriageItem | undefined, causes: Map<string, RootCause>): string {
  if (!item) return 'Test failed (not triaged).';
  const rcs = (item.rootCauses ?? []).map((id) => causes.get(id)).filter((c): c is RootCause => !!c);
  if (rcs.length) {
    return rcs.map((c) => `${c.id} (${c.severity}, ${c.classification}${c.owasp ? `, ${c.owasp}` : ''}): ${c.title}`).join(' | ');
  }
  return `${item.classification}${item.severity ? ` (${item.severity})` : ''}: ${item.reason}`;
}

function failureBody(row: TestResultRow, item: TriageItem | undefined): string {
  const head = item
    ? [
        `Classification: ${item.classification}`,
        `Reason: ${item.reason}`,
        `Expected: ${item.expected}`,
        `Actual: ${item.actual}`,
        item.evidence ? `Request: ${item.evidence.method} ${item.evidence.url} -> ${item.evidence.status}` : '',
      ].filter(Boolean)
    : [];
  return [...head, '', row.error.slice(0, 4000)].join('\n').trim();
}

export function writeJunit(apiName: string): { file: string; tests: number; failures: number; skipped: number } {
  const paths = apiPaths(apiName);
  const file = path.join(paths.reports, 'junit.xml');
  const { rows, report } = readResults(apiName);
  const triage = fs.existsSync(paths.triage) ? readJson<TriageFile>(paths.triage) : undefined;
  const items = new Map((triage?.items ?? []).map((i) => [i.testId, i]));
  const causes = new Map((triage?.rootCauses ?? []).map((c) => [c.id, c]));
  const cases = new Map<string, TestCase>(fs.existsSync(paths.testCasesJson) ? readJson<TestCaseFile>(paths.testCasesJson).cases.map((c) => [c.id, c]) : []);

  const byCategory = new Map<string, TestResultRow[]>();
  for (const r of rows) {
    const cat = cases.get(r.id)?.category ?? 'Other';
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), r]);
  }

  let failures = 0;
  let skipped = 0;
  const suites = [...byCategory.entries()].map(([category, list]) => {
    const f = list.filter((r) => r.outcome === 'failed').length;
    const s = list.filter((r) => r.outcome === 'skipped').length;
    failures += f;
    skipped += s;
    const time = list.reduce((n, r) => n + r.durationMs, 0);
    const testcases = list.map((r) => {
      const open = `    <testcase name="${xml(r.title)}" classname="${xml(`${apiName}.${category}`)}" time="${seconds(r.durationMs)}"`;
      if (r.outcome === 'failed') {
        const item = items.get(r.id);
        return `${open}>\n      <failure message="${xml(failureMessage(item, causes))}" type="${xml(item?.classification ?? 'Failure')}">${xml(failureBody(r, item))}</failure>\n    </testcase>`;
      }
      if (r.outcome === 'skipped') return `${open}>\n      <skipped message="${xml(r.skipReason || 'skipped')}"/>\n    </testcase>`;
      if (r.outcome === 'flaky') return `${open}>\n      <system-out>${xml('Flaky: failed first, passed on retry.')}</system-out>\n    </testcase>`;
      return `${open}/>`;
    });
    return `  <testsuite name="${xml(`${apiName} / ${category}`)}" tests="${list.length}" failures="${f}" errors="0" skipped="${s}" time="${seconds(time)}"${
      report?.stats?.startTime ? ` timestamp="${xml(report.stats.startTime)}"` : ''
    }>\n${testcases.join('\n')}\n  </testsuite>`;
  });

  const totalTime = rows.reduce((n, r) => n + r.durationMs, 0);
  const out = `<?xml version="1.0" encoding="UTF-8"?>\n<testsuites name="${xml(apiName)}" tests="${rows.length}" failures="${failures}" errors="0" skipped="${skipped}" time="${seconds(
    report?.stats?.duration ?? totalTime,
  )}">\n${suites.join('\n')}\n</testsuites>\n`;
  fs.writeFileSync(file, redact(out), 'utf8');
  return { file, tests: rows.length, failures, skipped };
}
