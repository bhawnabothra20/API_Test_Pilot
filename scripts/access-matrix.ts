/**
 * Access matrix: endpoints x identities, expected vs actual status, from the Auth + Authorization checks
 * of the last run. Output: api/<name>/reports/access-matrix.json (rendered in summary.html).
 * Contains status codes, check ids and OWASP ids only - never tokens or other credential values.
 */
import { apiPaths, readJson, writeJson } from '../shared/helpers/env';
import type { EndpointSummary, OwaspApiId, TestCase, TestCaseFile } from '../shared/helpers/types';
import { readResults } from './triage-failures';

export type CellOutcome = 'pass' | 'fail' | 'skipped' | 'not-run';

export interface MatrixCell {
  expected: number[];
  actual?: number;
  outcome: CellOutcome;
  checks: string[];
  owasp?: OwaspApiId;
  /** a failed credential / token-hygiene check answered with 2xx */
  finding?: string;
}

export interface AccessMatrix {
  apiName: string;
  generatedAt: string;
  identities: string[];
  rows: Array<{ endpoint: string; cells: Record<string, MatrixCell> }>;
}

const IDENTITY_ORDER = [
  'admin',
  'none',
  'invalid',
  'expired',
  'malformed',
  'wrongScheme',
  'admin+token-in-query',
  'admin+alg-none',
  'admin+tampered',
  'admin+fresh-token',
];

/** Identity label a check uses - must match the labels written by ApiClient into exchanges. */
function labelOf(c: TestCase, summary: EndpointSummary): string | undefined {
  const e = summary.endpoints.find((x) => x.id === c.endpointId);
  let id: string = c.request.identity;
  if (id === 'default') id = e?.requiresAuth ? 'admin' : 'none';
  if (c.request.tokenTest === 'query') return 'admin+token-in-query';
  if (c.request.tokenTest === 'algNone') return 'admin+alg-none';
  if (c.request.tokenTest === 'tampered') return 'admin+tampered';
  if (c.request.tokenTest === 'afterLogout') return 'admin+fresh-token';
  return id;
}

const PERMISSION_VARIANTS = new Set(['positive', 'auth-reject', 'token-hygiene']);

export function buildAccessMatrix(apiName: string): AccessMatrix {
  const paths = apiPaths(apiName);
  const summary = readJson<EndpointSummary>(paths.summary);
  const file = readJson<TestCaseFile>(paths.testCasesJson);
  const { rows } = readResults(apiName);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const matrix = new Map<string, Map<string, MatrixCell>>();

  for (const parent of file.cases) {
    const row = byId.get(parent.id);
    for (const leaf of parent.subCases ?? [parent]) {
      if (leaf.category !== 'Auth' && leaf.category !== 'Authorization') continue;
      if (!PERMISSION_VARIANTS.has(leaf.variant)) continue;
      const identity = labelOf(leaf, summary);
      if (!identity) continue;
      const endpoint = `${leaf.request.method} ${leaf.request.path}`;

      let outcome: CellOutcome = 'not-run';
      if (row) {
        const failedLine = parent.subCases ? row.error.split('\n').find((l) => l.startsWith(`• [${leaf.id}]`)) : row.outcome === 'failed' ? row.error : undefined;
        const skippedCheck = row.annotations.some((a) => a.type === 'skipped-check' && a.description?.startsWith(`${leaf.id}:`));
        outcome = row.outcome === 'skipped' || skippedCheck ? 'skipped' : failedLine ? 'fail' : row.outcome === 'failed' && !parent.subCases ? 'fail' : 'pass';
      }
      // actual status: the request under test with this method/path/identity 
      const exchanges = (row?.exchanges ?? []).filter((x) => x.method === leaf.request.method && x.pathTemplate === leaf.request.path && x.identity === identity);
      const actual = exchanges[exchanges.length - 1]?.status;

      const cells = matrix.get(endpoint) ?? new Map<string, MatrixCell>();
      const cell = cells.get(identity) ?? { expected: [], outcome: 'not-run' as CellOutcome, checks: [] };
      cell.expected = [...new Set([...cell.expected, ...leaf.expected.status])].sort((a, b) => a - b);
      cell.checks.push(leaf.id);
      if (actual !== undefined) cell.actual = actual;
      const rank: Record<CellOutcome, number> = { fail: 3, pass: 2, skipped: 1, 'not-run': 0 };
      if (rank[outcome] > rank[cell.outcome]) cell.outcome = outcome;
      if (leaf.owasp) cell.owasp = leaf.owasp;
      if (outcome === 'fail' && actual !== undefined && actual >= 200 && actual < 300 && leaf.variant !== 'positive') {
        cell.finding = leaf.variant === 'token-hygiene' ? 'Token hygiene' : 'Auth bypass';
      }
      cells.set(identity, cell);
      matrix.set(endpoint, cells);
    }
  }

  const used = new Set([...matrix.values()].flatMap((m) => [...m.keys()]));
  const identities = [...IDENTITY_ORDER.filter((i) => used.has(i)), ...[...used].filter((i) => !IDENTITY_ORDER.includes(i))];
  const result: AccessMatrix = {
    apiName,
    generatedAt: new Date().toISOString(),
    identities,
    rows: [...matrix.entries()].map(([endpoint, cells]) => ({ endpoint, cells: Object.fromEntries(cells) })),
  };
  writeJson(paths.root + '/reports/access-matrix.json', result);
  return result;
}

if (require.main === module) {
  const name = process.argv[2];
  if (!name) {
    console.error('usage: tsx scripts/access-matrix.ts <api-name>');
    process.exit(2);
  }
  const m = buildAccessMatrix(name);
  console.log(`access matrix: ${m.rows.length} endpoints x ${m.identities.length} identities`);
}
