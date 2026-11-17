import assert from 'node:assert/strict';
import fs from 'node:fs';
import { after, before, describe, test } from 'node:test';
import { apiPaths } from '../../shared/helpers/env';
import type { TestCase, TestCaseFile } from '../../shared/helpers/types';
import { buildDesign, writeDesign } from '../../scripts/design-test-cases';
import { assertionMessage, triage } from '../../scripts/triage-failures';
import { fixtureSummary, isolatedApiDir, writeResults, writeSummary } from './fixtures';

const API = 'triage-fixture';
let cleanup: () => void;
let cases: TestCase[];

/** first detailed case matching the predicate (fails the test when the generators stop producing it) */
function pick(pred: (c: TestCase) => boolean, what: string): TestCase {
  const c = cases.find(pred);
  assert.ok(c, `fixture design has no case for: ${what}`);
  return c;
}

const server500 = (method: string, path: string) => `Error: Server error (5xx) returned. ${method} https://fixture.example.test${path} -> 500 body=oops`;

describe('triage-failures: classification and root causes', () => {
  before(() => {
    cleanup = isolatedApiDir();
    writeSummary(fixtureSummary(API));
    const d = buildDesign(API);
    writeDesign(API, d); // detailed level: one test per check
    cases = d.file.cases;
  });
  after(() => cleanup());

  test('5xx on invalid input is a Real API defect, grouped into ONE root cause across endpoints', () => {
    const negPost = pick((c) => c.endpointId === 'items_POST' && c.category === 'Negative' && /without required field/.test(c.title), 'POST missing required field');
    const negPut = pick((c) => c.endpointId === 'items_id_PUT' && c.category === 'Negative' && /without required field/.test(c.title), 'PUT missing required field');
    const okGet = pick((c) => c.endpointId === 'items_GET' && c.category === 'Positive-Functional', 'GET items positive');
    writeResults(API, [
      { id: negPost.id, title: negPost.title, outcome: 'failed', error: server500('POST', '/items'), exchanges: [{ method: 'POST', status: 500, pathTemplate: '/items' }] },
      { id: negPut.id, title: negPut.title, outcome: 'failed', error: server500('PUT', '/items/1'), exchanges: [{ method: 'PUT', status: 500, pathTemplate: '/items/{id}' }] },
      { id: okGet.id, title: okGet.title, outcome: 'passed', exchanges: [{ method: 'GET', status: 200, pathTemplate: '/items' }] },
    ]);
    const t = triage(API);
    assert.equal(t.outageSuspected, undefined);
    assert.equal(t.items.length, 2);
    for (const i of t.items) {
      assert.equal(i.classification, 'Real API defect');
      assert.equal(i.severity, 'High');
      assert.match(i.reason, /invalid input/);
    }
    assert.equal(t.rootCauses?.length, 1, 'both 5xx checks share one root cause');
    const rc = t.rootCauses![0];
    assert.equal(rc.title, 'Invalid input crashes the server (5xx instead of 400/422)');
    assert.equal(rc.checks, 2);
    assert.deepEqual(rc.endpoints, ['POST /items', 'PUT /items/{id}']);
    assert.ok(rc.key, 'root causes carry a stable key for run-to-run comparison');
  });

  test('gateway statuses, timeouts and retries are environment issues, never defects', () => {
    const okGet = pick((c) => c.endpointId === 'items_GET' && c.category === 'Positive-Functional', 'GET items');
    const tags = pick((c) => c.endpointId === 'tags_GET' && c.category === 'Positive-Functional', 'GET tags');
    const view = pick((c) => c.endpointId === 'items_id_GET' && c.category === 'Positive-Functional', 'GET item');
    writeResults(API, [
      { id: okGet.id, title: okGet.title, outcome: 'failed', error: 'Error: Expected status 200 but got 503', exchanges: [{ method: 'GET', status: 503, pathTemplate: '/items' }] },
      { id: tags.id, title: tags.title, outcome: 'failed', error: 'Error: apiRequestContext.get: socket hang up' },
      { id: view.id, title: view.title, outcome: 'flaky', error: 'Error: Expected status 200 but got 404' },
    ]);
    const t = triage(API);
    assert.deepEqual(
      t.items.map((i) => i.classification),
      ['Flaky/Environment issue', 'Flaky/Environment issue', 'Flaky/Environment issue'],
    );
    assert.ok(t.rootCauses!.every((r) => r.classification === 'Flaky/Environment issue'));
  });

  test('an outage (many valid reads failing with 5xx) is not reported as defects', () => {
    const reads = cases.filter((c) => c.category === 'Positive-Functional' && c.request.method === 'GET').slice(0, 4);
    assert.ok(reads.length >= 3, 'need at least 3 positive GET cases');
    const neg = pick((c) => c.endpointId === 'items_POST' && c.category === 'Negative', 'POST negative');
    writeResults(API, [
      ...reads.map((c) => ({
        id: c.id,
        title: c.title,
        outcome: 'failed' as const,
        error: server500('GET', c.request.path),
        exchanges: [{ method: 'GET', status: 500, pathTemplate: c.request.path }],
      })),
      { id: neg.id, title: neg.title, outcome: 'failed', error: server500('POST', '/items'), exchanges: [{ method: 'POST', status: 500, pathTemplate: '/items' }] },
    ]);
    const t = triage(API);
    assert.match(t.outageSuspected ?? '', /valid read requests failed with 500/);
    assert.ok(t.items.every((i) => i.classification === 'Flaky/Environment issue'), 'no 5xx is a defect during an outage');
    assert.equal(t.rootCauses?.length, 1);
    assert.match(t.rootCauses![0].title, /API unavailable or degraded/);
  });

  test('a few 5xx among many healthy reads are still defects (no false outage)', () => {
    const reads = cases.filter((c) => c.category === 'Positive-Functional' && c.request.method === 'GET');
    const neg = pick((c) => c.endpointId === 'items_POST' && c.category === 'Negative', 'POST negative');
    writeResults(API, [
      ...reads.map((c) => ({ id: c.id, title: c.title, outcome: 'passed' as const, exchanges: [{ method: 'GET', status: 200, pathTemplate: c.request.path }] })),
      { id: neg.id, title: neg.title, outcome: 'failed', error: server500('POST', '/items'), exchanges: [{ method: 'POST', status: 500, pathTemplate: '/items' }] },
    ]);
    const t = triage(API);
    assert.equal(t.outageSuspected, undefined);
    assert.equal(t.items[0].classification, 'Real API defect');
  });

  test('an unrecognised failure is named after its assertion message, never a generic label', () => {
    const create = pick((c) => c.endpointId === 'items_POST' && c.category === 'Positive-Functional', 'POST positive');
    writeResults(API, [
      {
        id: create.id,
        title: create.title,
        outcome: 'failed',
        error: 'Error: created item is part of the list\n\nexpect(received).toBe(expected)\n\nExpected: true\nReceived: false',
        exchanges: [{ method: 'POST', status: 201, pathTemplate: '/items' }],
      },
    ]);
    const t = triage(API);
    assert.equal(t.items[0].reason, 'Expectation not met: created item is part of the list');
    assert.match(t.rootCauses![0].title, /expected "created item is part of the list" - not met/);
    assert.doesNotMatch(JSON.stringify(t), /Assertion failed against real API behaviour/);
  });

  test('a precondition failure is a Test data issue with the setup message', () => {
    const view = pick((c) => c.endpointId === 'items_id_GET' && c.category === 'Positive-Functional', 'GET item');
    writeResults(API, [{ id: view.id, title: view.title, outcome: 'failed', error: 'Error: [PRECONDITION] could not create items (status 500)' }]);
    const t = triage(API);
    assert.equal(t.items[0].classification, 'Test data issue');
    assert.match(t.items[0].reason, /could not create items \(status 500\)/);
  });

  test('a 4xx where another 4xx is expected is a Contract/Spec mismatch, not a defect', () => {
    const neg = pick((c) => c.endpointId === 'items_POST' && c.category === 'Negative' && c.expected.status.every((s) => s !== 415), 'POST negative');
    writeResults(API, [{ id: neg.id, title: neg.title, outcome: 'failed', error: `Error: Expected status ${neg.expected.status.join(' or ')} but got 415` }]);
    const t = triage(API);
    assert.equal(t.items[0].classification, 'Contract/Spec mismatch');
    assert.match(t.rootCauses![0].title, /^Answers 415 where/);
  });
});

describe('triage-failures: failed logins', () => {
  const LOGIN_API = 'login-fixture';
  let login: TestCase[];
  before(() => {
    cleanup = isolatedApiDir();
    const s = fixtureSummary(LOGIN_API);
    writeSummary({
      ...s,
      auth: {
        ...s.auth,
        type: 'cookie',
        cookieName: 'token',
        login: { method: 'POST', path: '/auth', usernameField: 'username', passwordField: 'password', tokenField: 'token', endpointId: 'auth_POST' },
      },
      endpoints: [
        ...s.endpoints,
        { ...s.endpoints[1], id: 'auth_POST', group: 'auth', path: '/auth', summary: 'Create token', isLogin: true, successStatus: 200, requestBody: { contentType: 'application/json', schema: { type: 'object', properties: { username: { type: 'string' }, password: { type: 'string' } }, required: ['username', 'password'] } }, responseSchema: { type: 'object', properties: { token: { type: 'string' } } } },
      ],
    });
    const d = buildDesign(LOGIN_API);
    writeDesign(LOGIN_API, d);
    login = d.file.cases.filter((c) => c.variant === 'login-reject');
    assert.ok(login.length >= 2, 'fixture needs rejected-login cases');
  });
  after(() => cleanup());

  test('a failed login answered with 200 but WITHOUT a token is a contract mismatch, not a security defect', () => {
    const c = login[0];
    assert.equal(c.assumptionBased, true, 'failure status is an assumption (undocumented)');
    writeResults(LOGIN_API, [{ id: c.id, title: c.title, outcome: 'failed', error: 'Error: Expected status 400 or 401 or 403 or 422 but got 200. POST https://fixture.example.test/auth -> 200 body={"reason":"Bad credentials"}' }]);
    const t = triage(LOGIN_API);
    assert.equal(t.items[0].classification, 'Contract/Spec mismatch');
    assert.doesNotMatch(t.items[0].reason, /Security/);
    assert.equal(t.rootCauses![0].title, 'Failed logins are answered with HTTP 200 (no token is issued)');
  });

  test('a failed login that RETURNS a token is a High security defect', () => {
    const c = login[0];
    writeResults(LOGIN_API, [{ id: c.id, title: c.title, outcome: 'failed', error: "Error: no token for rejected login\n\nexpect(received).toBeUndefined()\n\nReceived: \"abc\"" }]);
    const t = triage(LOGIN_API);
    assert.equal(t.items[0].classification, 'Real API defect');
    assert.equal(t.items[0].severity, 'High');
    assert.match(t.items[0].reason, /rejected login still returned a token/);
  });

  test('when the failure status IS documented, a 200 is a (Medium) defect', () => {
    const file = JSON.parse(fs.readFileSync(apiPaths(LOGIN_API).testCasesJson, 'utf8')) as TestCaseFile;
    for (const c of file.cases) if (c.variant === 'login-reject') c.assumptionBased = false;
    fs.writeFileSync(apiPaths(LOGIN_API).testCasesJson, JSON.stringify(file));
    const c = login[0];
    writeResults(LOGIN_API, [{ id: c.id, title: c.title, outcome: 'failed', error: 'Error: Expected status 400 or 401 or 403 or 422 but got 200.' }]);
    const t = triage(LOGIN_API);
    assert.equal(t.items[0].classification, 'Real API defect');
    assert.equal(t.items[0].severity, 'Medium');
    assert.match(t.rootCauses![0].title, /instead of the documented/);
  });
});

describe('assertionMessage', () => {
  test('takes the message after "• [ID] title: " in a high-level case', () => {
    const tc = { title: 'GET /booking?checkin=x returns that booking' } as TestCase;
    assert.equal(
      assertionMessage('• [TC_A_001.4] GET /booking?checkin=x returns that booking: created booking is part of the filtered result', tc),
      'created booking is part of the filtered result',
    );
  });
  test('takes the first line of a single test error', () => {
    assert.equal(assertionMessage('Error: list is sorted\n\nExpected: true', undefined), 'list is sorted');
  });
  test('ignores the generic matcher line', () => {
    assert.equal(assertionMessage('expect(received).toBe(expected) // Object.is equality', undefined), '');
  });
});
