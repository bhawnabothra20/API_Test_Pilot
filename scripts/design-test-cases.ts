/**
 * Stages 3+4 - test design and test data.
 * Input : api/<name>/spec/endpoint-summary.json
 * Output: api/<name>/test-cases/testcases.json (source of truth)
 *         api/<name>/test-data/{valid,invalid,boundary,auth-identities}.json
 *
 * The cases themselves come from category plugins in scripts/design/generators/ (registered in
 * scripts/design/generators/index.ts). This file only orchestrates them and writes the files.
 */
import { apiPaths, readJson, writeJson } from '../shared/helpers/env';
import type { EndpointSummary, TestCaseFile, TestDataFile } from '../shared/helpers/types';
import type { Ctx } from './design/context';
import { GENERATORS } from './design/generators';

export { describeData } from './design/context';

/** The complete (detailed-level, pre-contract) design of one API, in memory. */
export interface Design {
  file: TestCaseFile;
  valid: TestDataFile;
  invalid: TestDataFile;
  boundary: TestDataFile;
}

export function designTestCases(apiName: string): TestCaseFile {
  const d = buildDesign(apiName);
  writeDesign(apiName, d);
  return d.file;
}

/** Writes testcases.json and the test-data files of a design. */
export function writeDesign(apiName: string, d: Design): void {
  const paths = apiPaths(apiName);
  writeJson(paths.testCasesJson, d.file);
  writeJson(`${paths.testData}/valid.json`, d.valid);
  writeJson(`${paths.testData}/invalid.json`, d.invalid);
  writeJson(`${paths.testData}/boundary.json`, d.boundary);
  writeJson(`${paths.testData}/auth-identities.json`, authIdentities(readJson<EndpointSummary>(paths.summary)));
}

/** Runs every category generator over the current endpoint-summary.json without writing anything. */
export function buildDesign(apiName: string): Design {
  const paths = apiPaths(apiName);
  const summary = readJson<EndpointSummary>(paths.summary);
  // pagination detection from documented query params
  for (const e of summary.endpoints) {
    const page = e.queryParams.find((q) => /^_?page$/i.test(q.name));
    const limit = e.queryParams.find((q) => /^(_?limit|per_page|size|pagesize)$/i.test(q.name));
    if (!e.pagination && (page || limit)) e.pagination = { pageParam: page?.name, limitParam: limit?.name, maxLimit: limit?.schema.maximum, firstPage: page?.schema.minimum ?? 1 };
  }
  const ctx: Ctx = { summary, cases: [], valid: {}, invalid: {}, boundary: {}, counters: new Map(), names: new Set(), assumptions: [], notApplicable: [] };
  const seenPaths = new Set<string>();
  for (const e of summary.endpoints) {
    const firstOnPath = !seenPaths.has(e.path);
    seenPaths.add(e.path);
    if (e.requestContentType && !/json/i.test(e.requestContentType)) {
      // multipart / urlencoded endpoints: the JSON request client cannot build a valid request, so any
      // result would be a test artefact (415), not an API finding
      ctx.notApplicable.push(`${e.method} ${e.path}: consumes ${e.requestContentType}; not exercised by the JSON-based generated tests (test manually or extend the client).`);
      continue;
    }
    for (const g of GENERATORS) g.forEndpoint?.(ctx, e, { firstOnPath });
  }
  for (const g of GENERATORS) g.forApi?.(ctx);
  if (summary.auth.type === 'none') ctx.notApplicable.push('Token/role authorization matrix - the API documents no authentication; public-endpoint checks are generated instead.');
  if (summary.auth.type !== 'none' && summary.auth.roles.length === 0) {
    ctx.notApplicable.push('Wrong-role (403) checks - the API documents no roles; normal-user cases are skipped unless USER credentials are configured.');
  }
  ctx.assumptions.push(`Response-time threshold: ${summary.defaults.responseTimeMs} ms (RESPONSE_TIME_MS).`);
  ctx.assumptions.push(`Where limits are undocumented: strings ${summary.defaults.stringMinLength}..${summary.defaults.stringMaxLength} chars, numbers ${summary.defaults.numberMin}..${summary.defaults.numberMax}, arrays up to ${summary.defaults.arrayMaxItems} items.`);
  ctx.assumptions.push('Negative tests without a documented error schema assert a leak-free error body rather than a specific JSON structure.');

  const file: TestCaseFile = {
    apiName,
    baseUrl: summary.baseUrl,
    generatedAt: new Date().toISOString(),
    assumptions: ctx.assumptions,
    notApplicable: [...new Set(ctx.notApplicable)],
    cases: ctx.cases,
  };
  return { file, valid: ctx.valid, invalid: ctx.invalid, boundary: ctx.boundary };
}

function authIdentities(summary: EndpointSummary) {
  const p = summary.envPrefix;
  return {
    scheme: summary.auth.type,
    note: 'Values are NEVER stored here. They are read from .env at runtime by shared/global-setup.ts.',
    identities: {
      admin: { source: [`${p}_ADMIN_TOKEN`, `${p}_API_KEY`, `${p}_USERNAME + ${p}_PASSWORD (login once)`], whenMissing: 'tests needing it are skipped with a reason' },
      expired: { source: [`${p}_EXPIRED_TOKEN`, 'synthetic expired JWT (exp in the past)'] },
      invalid: { source: ['random 40-char hex token generated per request'] },
      malformed: { source: ['valid-looking token in a broken header/cookie'] },
      wrongScheme: { source: ['token presented with the wrong scheme'] },
      none: { source: ['no credentials'] },
    },
  };
}

if (require.main === module) {
  const name = process.argv[2];
  if (!name) {
    console.error('usage: tsx scripts/design-test-cases.ts <api-name>');
    process.exit(2);
  }
  const f = designTestCases(name);
  console.log(`designed ${f.cases.length} test cases -> ${apiPaths(name).testCasesJson}`);
}
