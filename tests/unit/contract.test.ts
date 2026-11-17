import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { apiPaths, readJson } from '../../shared/helpers/env';
import type { EndpointSummary, TestCase, TestCaseFile } from '../../shared/helpers/types';
import { applyContract, calibrate, isDocumented, kindOf, ruleAssumed, type Calibration } from '../../scripts/contract';
import { buildDesign, writeDesign } from '../../scripts/design-test-cases';
import { fixtureSummary, isolatedApiDir, writeResults, writeSummary, type FakeTest } from './fixtures';

const API = 'contract-fixture';
let cleanup: () => void;
let summary: EndpointSummary;
let cases: TestCase[];

/** the unknown-id checks of GET /items/{id} (calibration group "unknownId|items_id_GET") */
const unknownIdChecks = () => cases.filter((c) => c.endpointId === 'items_id_GET' && kindOf(c) === 'unknownId');
const calibrationFile = () => path.join(apiPaths(API).spec, 'calibration.json');
const failWith = (c: TestCase, got: number): FakeTest => ({ id: c.id, title: c.title, outcome: 'failed', error: `Error: Expected status ${c.expected.status.join(' or ')} but got ${got}` });

describe('contract: calibration of undocumented status conventions', () => {
  beforeEach(() => {
    cleanup = isolatedApiDir();
    // html-links: nothing is documented, so status conventions may be learned
    summary = fixtureSummary(API, { specSource: 'html-links' });
    writeSummary(summary);
    const d = buildDesign(API);
    writeDesign(API, d);
    cases = d.file.cases;
    assert.ok(unknownIdChecks().length >= 2, 'fixture must produce >= 2 unknown-id checks');
  });
  afterEach(() => cleanup());

  test('learns a status that is consistent across >= 2 checks and applies it', () => {
    const checks = unknownIdChecks();
    const observed = checks[0].expected.status.includes(410) ? 422 : 410;
    writeResults(API, checks.map((c) => failWith(c, observed)));
    const r = calibrate(API);
    assert.equal(r.learned.length, 1);
    assert.deepEqual({ kind: r.learned[0].kind, endpointId: r.learned[0].endpointId, observed: r.learned[0].observed }, { kind: 'unknownId', endpointId: 'items_id_GET', observed });
    assert.ok(fs.existsSync(calibrationFile()));

    applyContract(API);
    const after = readJson<TestCaseFile>(apiPaths(API).testCasesJson).cases.filter((c) => checks.some((x) => x.id === c.id));
    for (const c of after) assert.deepEqual(c.expected.status, [observed], `${c.id} now expects the calibrated status`);
  });

  test('never learns a 2xx (accepting bad ids is a finding, not a convention)', () => {
    writeResults(API, unknownIdChecks().map((c) => failWith(c, 200)));
    assert.equal(calibrate(API).learned.length, 0);
    assert.equal(fs.existsSync(calibrationFile()), false);
  });

  test('never learns a 5xx', () => {
    writeResults(API, unknownIdChecks().map((c) => failWith(c, 500)));
    assert.equal(calibrate(API).learned.length, 0);
  });

  test('needs consistent evidence: one check, or two different codes, teach nothing', () => {
    const [a, b] = unknownIdChecks();
    writeResults(API, [failWith(a, 410)]);
    assert.equal(calibrate(API).learned.length, 0, 'a single observation is not enough');
    writeResults(API, [failWith(a, 410), failWith(b, 422)]);
    assert.equal(calibrate(API).learned.length, 0, 'inconsistent codes are not a convention');
  });

  test('documented expectations are never calibrated', () => {
    // openapi3 + not inferred + not assumption-based = documented
    writeSummary(fixtureSummary(API, { specSource: 'openapi3' }));
    const file = readJson<TestCaseFile>(apiPaths(API).testCasesJson);
    for (const c of file.cases) c.assumptionBased = false;
    fs.writeFileSync(apiPaths(API).testCasesJson, JSON.stringify(file));
    writeResults(API, unknownIdChecks().map((c) => failWith(c, 410)));
    assert.equal(calibrate(API).learned.length, 0);
    const cal = fs.existsSync(calibrationFile()) ? readJson<Calibration>(calibrationFile()) : undefined;
    assert.equal(cal, undefined);
  });
});

describe('contract: rule classification', () => {
  beforeEach(() => {
    cleanup = isolatedApiDir();
    summary = fixtureSummary(API);
    writeSummary(summary);
    cases = buildDesign(API).file.cases;
  });
  afterEach(() => cleanup());

  test('kindOf maps checks to conventions', () => {
    const neg = cases.find((c) => c.endpointId === 'items_POST' && c.category === 'Negative' && c.request.idSource !== 'literal')!;
    assert.equal(kindOf(neg), 'validation');
    assert.equal(kindOf({ ...neg, variant: 'auth-reject', request: { ...neg.request, identity: 'none' } }), 'unauthenticated');
    const pos = cases.find((c) => c.category === 'Positive-Functional')!;
    assert.equal(kindOf(pos), undefined);
  });

  test('isDocumented: only an OpenAPI/Swagger, non-inferred, non-assumed expectation is documented', () => {
    const neg = cases.find((c) => c.endpointId === 'items_POST' && kindOf(c) === 'validation')!;
    assert.equal(isDocumented(summary, { ...neg, assumptionBased: false }, 'validation'), true);
    assert.equal(isDocumented(summary, { ...neg, assumptionBased: true }, 'validation'), false);
    assert.equal(isDocumented({ ...summary, specSource: 'html-links' }, { ...neg, assumptionBased: false }, 'validation'), false);
    const inferred = { ...summary, endpoints: summary.endpoints.map((e) => ({ ...e, inferred: true })) };
    assert.equal(isDocumented(inferred, { ...neg, assumptionBased: false }, 'validation'), false);
  });

  test('ruleAssumed: validation on an inferred endpoint is a robustness check', () => {
    const neg = cases.find((c) => c.endpointId === 'items_POST' && kindOf(c) === 'validation')!;
    assert.equal(ruleAssumed(summary, neg), false);
    const inferred = { ...summary, endpoints: summary.endpoints.map((e) => ({ ...e, inferred: true })) };
    assert.equal(ruleAssumed(inferred, neg), true);
  });

  test('applyContract turns invented rules into robustness checks that still forbid 5xx', () => {
    const inferred = { ...summary, endpoints: summary.endpoints.map((e) => ({ ...e, inferred: true })) };
    writeSummary(inferred);
    writeDesign(API, buildDesign(API));
    applyContract(API);
    const robust = readJson<TestCaseFile>(apiPaths(API).testCasesJson).cases.filter((c) => c.expected.robust);
    assert.ok(robust.length > 0);
    for (const c of robust) {
      assert.ok(c.expected.status.every((s) => s < 500), `${c.id} never accepts a 5xx`);
      assert.ok(c.expected.status.some((s) => s >= 400), `${c.id} still accepts a rejection`);
    }
  });
});
