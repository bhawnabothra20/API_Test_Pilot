import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { apiPaths, readJson } from '../../shared/helpers/env';
import type { EndpointSummary, TestCase, TestCaseFile, TestDataFile } from '../../shared/helpers/types';
import { consolidate } from '../../scripts/consolidate-cases';
import { buildDesign, writeDesign } from '../../scripts/design-test-cases';
import { businessKeep, groupNouns, nouns } from '../../scripts/design/business';
import { fixtureSummary, isolatedApiDir, writeSummary } from './fixtures';

const API = 'consolidate-fixture';
let cleanup: () => void;
let detailed: TestCase[];

const LOW_VALUE = /malformed JSON|with no body|JSON array instead|Content-Type text\/plain|injection|special characters|idempotent|unicode|whitespace|very large|very long|decimal|expired token|malformed Authorization|wrong auth scheme|alg:none|tampered|Unsupported method|responds within/;
const leaves = (f: TestCaseFile) => f.cases.flatMap((c) => c.subCases ?? [c]);
const data = (name: string) => readJson<TestDataFile>(path.join(apiPaths(API).testData, `${name}.json`));

describe('consolidate-cases', () => {
  beforeEach(() => {
    cleanup = isolatedApiDir();
    writeSummary(fixtureSummary(API));
    const d = buildDesign(API);
    writeDesign(API, d);
    detailed = d.file.cases;
  });
  afterEach(() => cleanup());

  test('business level (default): business scenarios per resource, no low-value checks', () => {
    const f = consolidate(API);
    assert.equal(f.level, 'business');
    assert.ok(f.cases.length < 20, `a small API gets a handful of business cases, got ${f.cases.length}`);
    const kept = leaves(f);
    assert.ok(kept.length < detailed.length, 'low-value checks are left out');
    for (const c of kept) assert.doesNotMatch(c.title, LOW_VALUE, `low-value check kept: ${c.title}`);
    const titles = f.cases.map((c) => c.title);
    for (const expected of [
      'Browse the list of items',
      'View an item by its id; an unknown item is not found',
      'Create an item with valid details; the saved values match what was sent',
      'Creating an item with missing or invalid details is rejected',
      'Delete an item; deleting an item that does not exist is rejected',
    ]) {
      assert.ok(titles.includes(expected), `missing business case "${expected}" in:\n${titles.join('\n')}`);
    }
    assert.match(f.assumptions.join(' '), /low-value technical checks were left out/);
  });

  test('ids follow TC_<API>_<ENDPOINT>_<NNN>, steps are <id>.<n>, and every step keeps its test data', () => {
    const f = consolidate(API, 'business');
    const ids = new Set<string>();
    const files: Record<string, TestDataFile> = { valid: data('valid'), invalid: data('invalid'), boundary: data('boundary') };
    for (const c of f.cases) {
      assert.match(c.id, /^TC_CONSOLIDATE_FIXTURE_[A-Z0-9_]+_\d{3}$/);
      assert.ok(!ids.has(c.id), `duplicate id ${c.id}`);
      ids.add(c.id);
      (c.subCases ?? []).forEach((s, i) => {
        assert.equal(s.id, `${c.id}.${i + 1}`);
        if (s.request.dataFile) assert.ok(s.request.dataKey && s.request.dataKey in files[s.request.dataFile], `data for ${s.id} (${s.request.dataFile}/${s.request.dataKey})`);
      });
    }
  });

  test('level high keeps every check (coverage unchanged, only grouped)', () => {
    const f = consolidate(API, 'high');
    assert.equal(f.level, 'high');
    assert.equal(leaves(f).length, detailed.length);
    assert.ok(f.cases.length < detailed.length);
  });

  test('operations that share a summary still get unique case names (qTest rejects duplicates)', () => {
    const s = fixtureSummary(API);
    const custom = (method: 'GET' | 'POST') => ({ ...s.endpoints[5], id: `custom_${method}`, group: 'custom', method, path: '/custom/run', summary: 'Execute custom endpoint', responseSchema: undefined });
    writeSummary({ ...s, endpoints: [...s.endpoints, custom('GET'), custom('POST')] });
    writeDesign(API, buildDesign(API));
    const f = consolidate(API);
    const titles = f.cases.map((c) => c.title);
    assert.equal(new Set(titles).size, titles.length, `duplicate titles: ${titles.filter((t, i) => titles.indexOf(t) !== i).join(', ')}`);
    assert.ok(titles.includes('Execute custom endpoint (GET /custom/run)'), titles.join('\n'));
    assert.ok(titles.includes('Execute custom endpoint (POST /custom/run)'), titles.join('\n'));
  });

  test('consolidating an already consolidated file is a no-op', () => {
    const once = consolidate(API);
    const twice = consolidate(API);
    assert.deepEqual(twice.cases.map((c) => c.id), once.cases.map((c) => c.id));
  });
});

describe('business rules', () => {
  const base = (over: Partial<TestCase>): TestCase =>
    ({
      id: 'TC_X_001',
      variant: 'negative',
      title: '',
      category: 'Negative',
      request: { method: 'POST', path: '/items', identity: 'default', idSource: 'none' },
      expected: { status: [400], json: true, maxResponseTimeMs: 2000 },
      ...over,
    }) as TestCase;

  test('businessKeep keeps business-relevant checks and drops low-value ones', () => {
    assert.equal(businessKeep(base({ title: 'POST /items without required field "name" is rejected with 400' })), true);
    assert.equal(businessKeep(base({ title: 'POST /items with malformed JSON is rejected with 400' })), false);
    assert.equal(businessKeep(base({ title: 'POST /items with SQL injection input in "name" is rejected or stored safely, never a 5xx', variant: 'tolerant' })), false);
    assert.equal(businessKeep(base({ category: 'Positive-Functional', variant: 'idempotent-read', title: 'GET /items is idempotent' })), false);
    assert.equal(businessKeep(base({ category: 'Boundary', title: 'POST /items "name" length 21 (max+1) is rejected' })), true);
    assert.equal(businessKeep(base({ category: 'Boundary', title: 'POST /items "name" length 21 (max+1) is rejected', expected: { status: [400], json: true, maxResponseTimeMs: 2000, robust: true } })), false, 'undocumented limits are not business rules');
    assert.equal(businessKeep(base({ category: 'Boundary', variant: 'tolerant', title: 'POST /items "name" with unicode and emoji is accepted' })), false);
    const auth = (identity: TestCase['request']['identity']) => base({ category: 'Auth', variant: 'auth-reject', request: { method: 'GET', path: '/items', identity, idSource: 'none' } });
    assert.equal(businessKeep(auth('none')), true);
    assert.equal(businessKeep(auth('invalid')), true);
    assert.equal(businessKeep(auth('expired')), false);
    assert.equal(businessKeep(auth('wrongScheme')), false);
    assert.equal(businessKeep(base({ category: 'Authorization', variant: 'mass-assignment' })), true);
    assert.equal(businessKeep(base({ category: 'Authorization', variant: 'data-exposure' })), true);
    assert.equal(businessKeep(base({ category: 'Authorization', variant: 'token-hygiene' })), false);
  });

  test('nouns come from the business object, not from action paths', () => {
    const s = fixtureSummary('n') as EndpointSummary;
    const ep = (p: string) => ({ ...s.endpoints[0], path: p, group: p.split('/')[1] });
    const withUser: EndpointSummary = { ...s, resources: [{ name: 'user', collectionPath: '/user/createWithList', idField: 'id', persistsWrites: true }] };
    assert.deepEqual(nouns(withUser, ep('/user/createWithList')), { one: 'user', many: 'users' });
    assert.deepEqual(nouns(s, ep('/store/inventory')), { one: 'inventory', many: 'inventories' });
    assert.deepEqual(nouns(s, ep('/items')), { one: 'item', many: 'items' });
    assert.deepEqual(groupNouns(s, 'items'), { one: 'item', many: 'items' });
  });
});
