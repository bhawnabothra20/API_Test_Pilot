---
name: playwright-api-writer
description: Team coding standards for Playwright + TypeScript API tests in this project - folder rules, fixtures, title format, the five mandatory assertions, data and secrets handling, cleanup, retries/timeouts and code style. Apply whenever writing, generating, reviewing or fixing a *.spec.ts file.
---

# Playwright API test standards (team rules)

These rules are encoded in `scripts/generate-specs.ts` and the `shared/` helpers. Hand-written tests must
follow them too.

## 1. Stack
`@playwright/test` with the **`request` fixture** (no browser), `zod` for schemas, `@faker-js/faker` for
data (design time), `dotenv` for secrets, TypeScript strict mode. Must pass `npx tsc --noEmit`.

## 2. Folders
- Specs: `api/<api-name>/tests/<group>.spec.ts` - one per resource group (custom additions:
  `<group>.custom.spec.ts`).
- Schemas: `api/<api-name>/schemas/<group>.schema.ts`.
- Data: `api/<api-name>/test-data/*.json`, read through the `data` fixture - never inline in the spec.
- Shared code only from `shared/` (fixtures, helpers). Nothing API-specific in `shared/`.

## 3. Fixtures and helpers
```ts
import { test, expect, limits, fromData, requireCredentials } from '../../../shared/fixtures/api-fixture';
import { expectStatus, expectJsonContentType, expectSchema, expectResponseTime, ... } from '../../../shared/helpers/assertions';
import * as S from '../schemas/<group>.schema';
```
- `api.send({ method, path, identity, ...fromData(input, { id }) })` - builds the URL from `BASE_URL`,
  adds required headers and the identity's credentials, enforces the host allowlist, waits the polite
  delay, measures time and attaches a **redacted** request/response pair for triage.
- `api.existingId(group)`, `api.withResource(group, setupBody, fn)` (create -> fn -> delete),
  `api.create`, `api.remove`.
- `data.entry('valid' | 'invalid' | 'boundary', '<TC_ID>')`.

## 4. Structure and naming
```ts
test.describe('<api> / <group>', () => {
  test.describe('Positive-Functional', () => { ... });
  test.describe('Positive-DataValidation', () => { ... });
  test.describe('Negative', () => { ... });
  test.describe('Boundary', () => { ... });
  test.describe('Auth', () => { ... });
});
```
Title: `'[TC_ID] Short readable description'` - the ID equals the qTest Automation ID. Assumption-based
cases carry `{ annotation: { type: 'assumption', description } }`.

## 5. Mandatory assertions
Positive tests - all five:
1. status `expectStatus(res, [200])`
2. headers `expectJsonContentType(res)` (or `expectContentType(res, /text\/plain/i)`)
3. schema `const body = expectSchema(res, S.XResponse)`
4. business fields `expectEcho(input.body, body)`, `expectFields(body, { id })`, `expectNonEmptyArray`,
   `expectAllItems(body, field, value)`
5. time `expectResponseTime(res, limits.responseTimeMs)`

Negative tests: `expectNoServerError` (first), `expectStatus` (4xx), `expectErrorBody`, `expectResponseTime`.
**Never** a test that only checks `status === 200`.

## 6. Data, secrets, cleanup
- No hardcoded base URLs, tokens or passwords. Credentials only through identities / `${env:...}`.
- Tests needing credentials call `requireCredentials('admin' | 'user')` first (skip with reason).
- Every created resource is deleted (`withResource`, or `try/finally` + `api.remove`).
- Tests are independent: no shared mutable state between tests; ids are created or looked up per test.

## 7. Execution settings (`playwright.config.ts`)
`API_NAME` selects `api/<name>/tests`; reporters `list`, `html` -> `reports/html`, `json` ->
`reports/results.json`; `retries: 1` (flags flaky tests); test timeout 45 s, request timeout 20 s;
`workers` from `PW_WORKERS` (default 4); `globalSetup` logs in once.

## 8. Style
Small helpers, clear names, no `any`, comments only where they add information, one assertion concern
per line. Prefer regenerating from `testcases.json` over editing generated files.

## 9. Never
Weaken assertions or expected values to make a test pass; swallow errors; log secrets; call hosts outside
`ALLOWED_HOSTS`; generate load.
