/**
 * Shared fixtures for the unit tests: an isolated api/ folder (API_TEST_API_DIR, inside the project under
 * .unit-test-tmp/ and removed afterwards), a small hand-written EndpointSummary, and builders for Playwright
 * JSON results. Nothing here touches the network or the real api/ folders.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { apiPaths, PROJECT_ROOT, writeJson } from '../../shared/helpers/env';
import type { EndpointSpec, EndpointSummary, Exchange, JsonSchema } from '../../shared/helpers/types';

const TMP = path.join(PROJECT_ROOT, '.unit-test-tmp');

/** Points apiPaths() at a fresh folder; returns a cleanup function. */
export function isolatedApiDir(): () => void {
  const dir = path.join(TMP, `${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  const before = process.env.API_TEST_API_DIR;
  process.env.API_TEST_API_DIR = dir;
  return () => {
    if (before === undefined) delete process.env.API_TEST_API_DIR;
    else process.env.API_TEST_API_DIR = before;
    // only ever delete inside .unit-test-tmp
    if (path.dirname(dir) === TMP) fs.rmSync(dir, { recursive: true, force: true });
  };
}

const ITEM: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer', readOnly: true },
    name: { type: 'string', minLength: 1, maxLength: 20 },
    price: { type: 'number', minimum: 0, maximum: 1000 },
    status: { type: 'string', enum: ['active', 'retired'] },
    email: { type: 'string', format: 'email' },
  },
  required: ['name', 'price'],
};
const TAG: JsonSchema = { type: 'object', properties: { id: { type: 'integer' }, label: { type: 'string' } }, required: ['id', 'label'] };

function endpoint(partial: Partial<EndpointSpec> & Pick<EndpointSpec, 'id' | 'group' | 'method' | 'path'>): EndpointSpec {
  return {
    summary: '',
    pathParams: partial.path.includes('{id}') ? [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }] : [],
    queryParams: [],
    requiredHeaders: {},
    successStatus: 200,
    responseContentType: 'application/json',
    requiresAuth: false,
    adminOnly: false,
    isLogin: false,
    notFoundStatus: 404,
    badRequestStatus: 400,
    inferred: false,
    ...partial,
  };
}

/** A small API: items (full CRUD, persisted) and tags (list only). No auth. */
export function fixtureSummary(apiName: string, overrides: Partial<EndpointSummary> = {}): EndpointSummary {
  return {
    apiName,
    envPrefix: apiName.toUpperCase().replace(/[^A-Z0-9]+/g, '_'),
    title: 'Fixture API',
    sourceUrl: 'https://fixture.example.test/',
    baseUrl: 'https://fixture.example.test',
    specSource: 'openapi3',
    discoveredAt: '2026-01-01T00:00:00.000Z',
    auth: { type: 'none', unauthenticatedStatus: 401, forbiddenStatus: 403, statusDocumented: false, roles: [], notes: [] },
    endpoints: [
      endpoint({ id: 'items_GET', group: 'items', method: 'GET', path: '/items', summary: 'List items', responseSchema: { type: 'array', items: ITEM } }),
      endpoint({ id: 'items_POST', group: 'items', method: 'POST', path: '/items', summary: 'Create an item', successStatus: 201, requestBody: { contentType: 'application/json', schema: ITEM }, responseSchema: ITEM }),
      endpoint({ id: 'items_id_GET', group: 'items', method: 'GET', path: '/items/{id}', summary: 'Get an item', responseSchema: ITEM }),
      endpoint({ id: 'items_id_PUT', group: 'items', method: 'PUT', path: '/items/{id}', summary: 'Replace an item', requestBody: { contentType: 'application/json', schema: ITEM }, responseSchema: ITEM }),
      endpoint({ id: 'items_id_DELETE', group: 'items', method: 'DELETE', path: '/items/{id}', summary: 'Delete an item' }),
      endpoint({ id: 'tags_GET', group: 'tags', method: 'GET', path: '/tags', summary: 'List tags', responseSchema: { type: 'array', items: TAG } }),
    ],
    resources: [
      { name: 'items', collectionPath: '/items', itemPath: '/items/{id}', idParam: 'id', idField: 'id', createIdPath: 'id', persistsWrites: true, schema: ITEM, sampleId: 1 },
      { name: 'tags', collectionPath: '/tags', idField: 'id', persistsWrites: true, schema: TAG },
    ],
    defaults: { responseTimeMs: 2000, stringMinLength: 1, stringMaxLength: 255, numberMin: 0, numberMax: 1000000, arrayMaxItems: 100 },
    assumptions: [],
    ...overrides,
  };
}

export function writeSummary(summary: EndpointSummary): void {
  const p = apiPaths(summary.apiName);
  for (const d of [p.spec, p.testData, p.testCases, p.tests, p.schemas, p.reports]) fs.mkdirSync(d, { recursive: true });
  writeJson(p.summary, summary);
}

// ----------------------------------------------------------------------------- Playwright JSON results

export interface FakeTest {
  id: string;
  title: string;
  outcome: 'passed' | 'failed' | 'flaky' | 'skipped';
  error?: string;
  exchanges?: Array<Partial<Exchange> & Pick<Exchange, 'method' | 'status'>>;
}

export const START = '2026-11-10T10:00:00.000Z';

/** Writes reports/results.json in the shape the Playwright JSON reporter produces. */
export function writeResults(apiName: string, tests: FakeTest[], startTime = START): void {
  const attachments = (t: FakeTest) =>
    (t.exchanges ?? []).map((x, i) => ({
      name: `exchange-${String(i + 1).padStart(2, '0')}`,
      contentType: 'application/json',
      body: Buffer.from(JSON.stringify({ url: 'https://fixture.example.test', requestHeaders: {}, responseHeaders: {}, responseBody: '', durationMs: 5, ...x })).toString('base64'),
    }));
  const result = (t: FakeTest, failed: boolean) => ({
    status: failed ? 'failed' : t.outcome === 'skipped' ? 'skipped' : 'passed',
    duration: 5,
    error: failed ? { message: t.error ?? 'Error: failed' } : undefined,
    attachments: attachments(t),
    annotations: [],
  });
  const specs = tests.map((t) => ({
    title: `[${t.id}] ${t.title}`,
    tests: [
      {
        status: t.outcome === 'passed' ? 'expected' : t.outcome === 'failed' ? 'unexpected' : t.outcome,
        annotations: [],
        results: t.outcome === 'flaky' ? [result(t, true), result(t, false)] : [result(t, t.outcome === 'failed')],
      },
    ],
  }));
  writeJson(apiPaths(apiName).resultsJson, {
    suites: [{ title: 'fixture', specs }],
    errors: [],
    stats: { startTime, duration: 100, expected: 0, unexpected: 0, flaky: 0, skipped: 0 },
  });
}
