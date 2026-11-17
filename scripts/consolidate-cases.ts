/**
 * High-level test cases (default level).
 * Groups the detailed checks produced by design-test-cases.ts into ONE test case per endpoint + scenario,
 * e.g. "POST /booking rejects missing, null and empty required fields". Coverage is unchanged: every
 * detailed check becomes a step of its high-level case (a test.step in the generated spec, a step row in
 * the qTest Excel).
 *
 * Input/Output: api/<name>/test-cases/testcases.json and api/<name>/test-data/{valid,invalid,boundary}.json
 * (rewritten in place; data keys become "<HIGH_LEVEL_ID>.<n>").
 */
import path from 'node:path';
import { apiPaths, readJson, writeJson } from '../shared/helpers/env';
import type { Category, EndpointSummary, TestCase, TestCaseFile, TestDataFile, TestStep } from '../shared/helpers/types';
import { businessKeep, businessScenario, finalizeBusinessTitle, scenarioRank } from './design/business';

interface Scenario {
  key: string;
  title: string;
}

const REJECT_IDENTITIES = ['none', 'invalid', 'expired', 'malformed', 'wrongScheme'];

/** Maps a detailed case onto its high-level scenario. Unique scenarios keep their own key. */
function scenarioOf(c: TestCase, ep: string): Scenario {
  const t = c.title;
  const own = { key: c.id, title: t };
  switch (c.category) {
    case 'Authorization':
      return own; // each authorization scenario (data exposure, mass assignment, token hygiene ...) is its own case
    case 'Positive-Functional':
      if (c.variant === 'filter-all' || c.variant === 'filter-contains') return { key: 'filters', title: `${ep} query filters return only matching items` };
      return own;
    case 'Positive-DataValidation':
      return { key: 'contract', title: '' }; // title built from the members (see contractTitle)
    case 'Negative':
      if (/^Unsupported method/.test(t)) return own;
      if (c.request.idSource === 'literal') return { key: 'ids', title: `${ep} rejects unknown and malformed ids` };
      if (/without required field|: null is rejected|empty string for required|empty JSON object/.test(t)) {
        return { key: 'required', title: `${ep} rejects missing, null and empty required fields` };
      }
      if (/with no body|malformed JSON|JSON array instead|Content-Type text\/plain/.test(t)) {
        return { key: 'body', title: `${ep} rejects empty, malformed and wrongly typed request bodies` };
      }
      if (/wrong type for|invalid enum value|with invalid (date|date-time|email|uri|uuid) for/.test(t)) {
        return { key: 'types', title: `${ep} rejects wrong data types, invalid enum values and invalid formats` };
      }
      if (/injection|special characters/.test(t)) return { key: 'inject', title: `${ep} handles SQL, script and special-character input safely (never 5xx)` };
      if (/query|\?[\w.-]+=/.test(t)) return { key: 'query', title: `${ep} handles invalid and unknown query parameters (4xx or ignored, never 5xx)` };
      return own;
    case 'Boundary':
      if (c.request.idSource === 'literal') return { key: 'ids', title: `${ep} path id boundary values (out of range, very long, unusual formats) are rejected` };
      if (/query value|pagination/.test(t)) return { key: 'query', title: `${ep} query value and pagination boundaries are handled (never 5xx)` };
      if (/length|unicode|whitespace/.test(t)) return { key: 'strings', title: `${ep} string boundaries: empty, min/max and +/-1, 10,000 chars, unicode, whitespace` };
      if (/leap day|impossible date|far future|epoch/.test(t)) return { key: 'dates', title: `${ep} date boundaries: leap day, impossible date, far future, epoch` };
      if (/array|items/.test(t)) return { key: 'arrays', title: `${ep} array size boundaries: empty, one, max, max+1` };
      if (/minimum|maximum|zero|negative|very large|decimal/.test(t)) return { key: 'numbers', title: `${ep} numeric boundaries: min/max and +/-1, zero, negative, decimal, very large` };
      return own;
    case 'Auth':
      if (c.variant === 'auth-reject' && REJECT_IDENTITIES.includes(c.request.identity)) {
        return { key: 'reject', title: `${ep} rejects missing, invalid, expired, malformed and wrong-scheme credentials` };
      }
      if (c.variant === 'positive' && /^Public /.test(t)) return { key: 'public', title: `Public ${ep} is accessible without credentials` };
      if (c.request.identity === 'admin' && c.variant !== 'auth-reject') {
        return { key: 'valid', title: `${ep} accepts valid admin credentials` };
      }
      if (c.variant === 'login-reject') return { key: 'login-reject', title: `${ep} rejects wrong, missing and empty credentials without issuing a token` };
      return own;
  }
}

/** "GET /ping response contract: Content-Type and response time" - names only what the checks verify. */
function contractTitle(ep: string, members: TestCase[]): string {
  const aspects: string[] = [];
  if (members.some((m) => m.expected.schema)) aspects.push('schema of every field');
  if (members.some((m) => /formatted fields/.test(m.title))) aspects.push('formats/enums/ranges');
  aspects.push('Content-Type', 'response time');
  if (members.some((m) => m.expected.echo)) aspects.push('exact echo of request values');
  return `${ep} response contract: ${aspects.slice(0, -1).join(', ')} and ${aspects[aspects.length - 1]}`;
}

const PRIORITY = { High: 3, Medium: 2, Low: 1 } as const;

function sendStep(c: TestCase): TestStep {
  return c.steps.find((s) => s.action.startsWith('Send')) ?? c.steps[0];
}

function checkText(c: TestCase): string {
  const parts = [sendStep(c).expected];
  if (c.expected.json) parts.push('JSON Content-Type');
  if (c.expected.schema) parts.push(`body matches ${c.expected.schema}`);
  if (c.expected.echo) parts.push('values echoed exactly');
  if (c.expected.errorBody) parts.push('leak-free error body');
  return parts.join('; ');
}

/**
 * Test case names must be unique (qTest import, Playwright titles). Business titles come from the spec's
 * operation summaries, which APIs reuse (ReqRes: GET/POST/PUT/PATCH/DELETE /api/custom/{path} are all
 * "Execute custom endpoint"), so every repeated title gets its endpoint appended: "... (POST /api/custom/{path})".
 */
export function uniqueTitles(cases: TestCase[]): void {
  const count = new Map<string, number>();
  for (const c of cases) count.set(c.title, (count.get(c.title) ?? 0) + 1);
  const seen = new Set<string>();
  for (const c of cases) {
    if ((count.get(c.title) ?? 0) < 2) continue;
    let title = `${c.title} (${c.request.method} ${c.request.path})`;
    for (let i = 2; seen.has(title); i++) title = `${c.title} (${c.request.method} ${c.request.path}, ${i})`;
    seen.add(title);
    c.title = title;
  }
}

/**
 * level "business" (default): low-value technical checks are left out (scripts/design/business.ts) and the
 * rest are grouped into business scenarios per resource. level "high": every check, grouped per endpoint +
 * technical scenario.
 */
export function consolidate(apiName: string, level: 'high' | 'business' = 'business'): TestCaseFile {
  const paths = apiPaths(apiName);
  const loaded = readJson<TestCaseFile>(paths.testCasesJson);
  if (loaded.level === 'high' || loaded.level === 'business') return loaded; // already consolidated
  const summary = readJson<EndpointSummary>(paths.summary);
  const business = level === 'business';
  const kept = business ? loaded.cases.filter(businessKeep) : loaded.cases;
  const omitted = loaded.cases.length - kept.length;
  const file: TestCaseFile = {
    ...loaded,
    cases: kept,
    assumptions: business
      ? [
          ...loaded.assumptions,
          `Business-level test cases: ${omitted} low-value technical checks were left out (idempotency repeats, malformed/empty bodies, injection strings, exotic boundaries, expired/malformed/wrong-scheme tokens, token-hygiene tricks). Run with --level high for every check.`,
        ]
      : loaded.assumptions,
  };
  const data: Record<'valid' | 'invalid' | 'boundary', TestDataFile> = {
    valid: readJson<TestDataFile>(path.join(paths.testData, 'valid.json')),
    invalid: readJson<TestDataFile>(path.join(paths.testData, 'invalid.json')),
    boundary: readJson<TestDataFile>(path.join(paths.testData, 'boundary.json')),
  };
  const out: Record<'valid' | 'invalid' | 'boundary', TestDataFile> = { valid: {}, invalid: {}, boundary: {} };

  // group, preserving first-appearance order
  const groups = new Map<string, { scenario: Scenario; members: TestCase[] }>();
  const businessCategory = new Map<string, Category>();
  for (const c of file.cases) {
    if (business) {
      // business scenarios span the endpoints of one resource group
      const b = businessScenario(c, summary);
      const k = `${c.group}|${b.key}`;
      if (!groups.has(k)) groups.set(k, { scenario: { key: b.key, title: b.title }, members: [] });
      groups.get(k)!.members.push(c);
      businessCategory.set(k, b.key === 'access' && c.category === 'Authorization' ? 'Authorization' : (businessCategory.get(k) ?? b.category));
      continue;
    }
    const e = summary.endpoints.find((x) => x.id === c.endpointId);
    const ep = e ? `${e.method} ${e.path}` : `${c.request.method} ${c.request.path}`;
    const s = scenarioOf(c, ep);
    const k = `${c.endpointId}|${c.category}|${s.key}`;
    if (!groups.has(k)) groups.set(k, { scenario: s, members: [] });
    groups.get(k)!.members.push(c);
  }

  const counters = new Map<string, number>();
  const prefix = (c: TestCase) => c.id.replace(/_\d{3}$/, '');
  const cases: TestCase[] = [];
  // business level: resources in order of first appearance, scenarios in reading order within a resource
  const resourceOrder = [...new Set([...groups.keys()].map((k) => k.split('|')[0]))];
  const ordered = business
    ? [...groups.entries()].sort(([a, x], [b, y]) => resourceOrder.indexOf(a.split('|')[0]) - resourceOrder.indexOf(b.split('|')[0]) || scenarioRank(x.scenario.key) - scenarioRank(y.scenario.key))
    : [...groups.entries()];
  for (const [groupKey, { scenario, members }] of ordered) {
    const first = members[0];
    const category = business ? (businessCategory.get(groupKey) ?? first.category) : first.category;
    if (business) {
      scenario.title = finalizeBusinessTitle({ key: scenario.key, title: scenario.title, category }, members, summary);
      // a business case is never titled after one of its checks, even when it has only one
      if (scenario.key === first.id) scenario.key = `single:${first.id}`;
    }
    if (scenario.key === 'contract') {
      const e = summary.endpoints.find((x) => x.id === first.endpointId);
      scenario.title = contractTitle(e ? `${e.method} ${e.path}` : first.request.path, members);
    }
    const n = (counters.get(prefix(first)) ?? 0) + 1;
    counters.set(prefix(first), n);
    const id = `${prefix(first)}_${String(n).padStart(3, '0')}`;
    const rekey = (c: TestCase, key: string): TestCase => {
      const f = c.request.dataFile ?? 'valid';
      out[f][key] = data[f][c.request.dataKey ?? c.id];
      return { ...c, id: key, request: { ...c.request, dataKey: key } };
    };

    if (members.length === 1) {
      const single = rekey(first, id);
      // a lone member of a shared scenario still gets the scenario's high-level title
      cases.push(scenario.key === first.id ? single : { ...single, category, title: scenario.title, description: first.title });
      continue;
    }
    const subs = members.map((m, i) => rekey(m, `${id}.${i + 1}`));
    const assumptions = [...new Set(members.map((m) => m.assumption).filter((a): a is string => !!a))];
    const pre = first.steps[0] && !first.steps[0].action.startsWith('Send') ? [first.steps[0]] : [];
    // groups whose rules are all undocumented verify safe handling, not rejection
    const title = members.every((m) => m.expected.robust) ? scenario.title.replace(/ rejects /, ' safely handles ') : scenario.title;
    cases.push({
      ...first,
      id,
      title,
      category,
      description: `${business ? 'Business scenario' : 'High-level scenario'} with ${members.length} checks: ${members.map((m) => m.title).join('; ')}.`,
      priority: members.reduce<TestCase['priority']>((p, m) => (PRIORITY[m.priority] > PRIORITY[p] ? m.priority : p), 'Low'),
      precondition: [...new Set(members.map((m) => m.precondition))].join(' '),
      // the case needs a credential only when every check needs it; otherwise checks skip individually
      requiresCredentials: members.every((m) => m.requiresCredentials === first.requiresCredentials) ? first.requiresCredentials : 'none',
      assumptionBased: assumptions.length > 0,
      assumption: assumptions.join(' ') || undefined,
      request: { ...first.request, dataKey: undefined },
      steps: [...pre, ...members.map((m) => ({ action: `${m.title}: ${sendStep(m).action}`, expected: checkText(m) }))],
      subCases: subs,
    });
  }

  uniqueTitles(cases);
  const result: TestCaseFile = { ...file, level, generatedAt: new Date().toISOString(), cases };
  writeJson(paths.testCasesJson, result);
  for (const f of ['valid', 'invalid', 'boundary'] as const) writeJson(path.join(paths.testData, `${f}.json`), out[f]);
  return result;
}

if (require.main === module) {
  const name = process.argv[2];
  if (!name) {
    console.error('usage: tsx scripts/consolidate-cases.ts <api-name>');
    process.exit(2);
  }
  const before = readJson<TestCaseFile>(apiPaths(name).testCasesJson);
  const checks = before.cases.reduce((n, c) => n + (c.subCases?.length ?? 1), 0);
  const f = consolidate(name);
  console.log(`high-level: ${f.cases.length} test cases covering ${checks} checks -> ${apiPaths(name).testCasesJson}`);
}
