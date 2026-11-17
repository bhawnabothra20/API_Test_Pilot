import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { apiPaths, readJson } from '../../shared/helpers/env';
import type { EndpointSummary, TestCase, TestDataFile } from '../../shared/helpers/types';
import { fingerprints, incrementalDesign } from '../../scripts/spec-diff';
import { fixtureSummary, isolatedApiDir, writeSummary } from './fixtures';

const API = 'specdiff-fixture';
let cleanup: () => void;

/** as serialized on disk (undefined properties dropped) */
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const byGroup = (cases: TestCase[], g: string) => json(cases.filter((c) => c.group === g));
const dataOf = (name: 'valid' | 'invalid' | 'boundary') => readJson<TestDataFile>(path.join(apiPaths(API).testData, `${name}.json`));
const keysOf = (data: TestDataFile, prefix: string) => Object.fromEntries(Object.entries(data).filter(([k]) => k.includes(prefix)));

describe('spec-diff: regenerate only what changed', () => {
  beforeEach(() => {
    cleanup = isolatedApiDir();
    writeSummary(fixtureSummary(API));
  });
  afterEach(() => cleanup());

  test('first design generates everything; an unchanged spec reuses every group', () => {
    const first = incrementalDesign(API);
    assert.equal(first.diff.mode, 'first-design');
    assert.deepEqual(first.diff.groups.regenerated.sort(), ['items', 'tags']);

    const second = incrementalDesign(API);
    assert.equal(second.diff.mode, 'incremental');
    assert.deepEqual(second.diff.groups.regenerated, []);
    assert.deepEqual(second.diff.groups.unchanged.sort(), ['items', 'tags']);
    assert.deepEqual(json(second.design.file.cases), json(first.design.file.cases), 'same cases, same ids');
    assert.deepEqual(json(second.design.valid), json(first.design.valid), 'same test data values');
  });

  test('a changed endpoint regenerates only its group; other groups keep cases and data exactly', () => {
    const first = incrementalDesign(API);
    const tagsBefore = byGroup(first.design.file.cases, 'tags');
    const tagDataBefore = keysOf(dataOf('valid'), 'TAGS');

    const changed = fixtureSummary(API);
    const post = changed.endpoints.find((e) => e.id === 'items_POST')!;
    post.requestBody!.schema.properties!.name.maxLength = 50;
    writeSummary(changed);
    const second = incrementalDesign(API);

    assert.deepEqual(second.diff.groups.regenerated, ['items']);
    assert.deepEqual(second.diff.groups.unchanged, ['tags']);
    assert.deepEqual(byGroup(second.design.file.cases, 'tags'), tagsBefore);
    assert.deepEqual(keysOf(dataOf('valid'), 'TAGS'), tagDataBefore);
    const change = second.diff.endpoints.changed.find((c) => c.id === 'items_POST');
    assert.ok(change, 'POST /items is reported as changed');
    assert.ok(change.changes.some((c) => c === 'requestBody.schema.properties.name.maxLength: 20 -> 50'), change.changes.join('; '));
    assert.ok(second.diff.checks.changed.length > 0, 'checks whose content changed are listed');
  });

  test('added and removed groups are reported', () => {
    incrementalDesign(API);
    const s = fixtureSummary(API);
    const withoutTags: EndpointSummary = { ...s, endpoints: s.endpoints.filter((e) => e.group !== 'tags'), resources: s.resources.filter((r) => r.name !== 'tags') };
    writeSummary(withoutTags);
    const removed = incrementalDesign(API);
    assert.deepEqual(removed.diff.groups.removed, ['tags']);
    assert.deepEqual(removed.diff.endpoints.removed, ['GET /tags']);
    assert.ok(removed.diff.checks.removed.length > 0);
    assert.equal(byGroup(removed.design.file.cases, 'tags').length, 0);

    writeSummary(s);
    const added = incrementalDesign(API);
    assert.deepEqual(added.diff.endpoints.added, ['GET /tags']);
    assert.deepEqual(added.diff.groups.regenerated, ['tags']);
  });

  test('API-wide changes and --full regenerate everything', () => {
    incrementalDesign(API);
    writeSummary(fixtureSummary(API, { baseUrl: 'https://other.example.test' }));
    const global = incrementalDesign(API);
    assert.equal(global.diff.mode, 'full');
    assert.match(global.diff.reason, /API-wide settings changed/);
    const full = incrementalDesign(API, { full: true });
    assert.equal(full.diff.mode, 'full');
    assert.deepEqual(full.diff.groups.regenerated.sort(), ['items', 'tags']);
  });

  test('the calibration re-run (writeDiff: false) keeps the run\'s spec-diff.json', () => {
    incrementalDesign(API);
    const file = path.join(apiPaths(API).spec, 'spec-diff.json');
    const before = fs.readFileSync(file, 'utf8');
    incrementalDesign(API, { writeDiff: false });
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });

  test('fingerprints ignore the re-probed sampleId but see real changes', () => {
    const a = fixtureSummary(API);
    const b = fixtureSummary(API);
    b.resources[0].sampleId = 999;
    assert.deepEqual(fingerprints(a).groups, fingerprints(b).groups);
    b.resources[0].persistsWrites = false;
    assert.notEqual(fingerprints(a).groups.items, fingerprints(b).groups.items);
    assert.equal(fingerprints(a).groups.tags, fingerprints(b).groups.tags);
  });
});
