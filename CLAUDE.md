# API Test Pilot - project rules

This project is a fully autonomous API testing agent. The user runs **one command**:

```
/api-test-pilot <API_URL_OR_ENDPOINT_URL> [--name <api-name>]
```

and the pipeline in `.claude/commands/api-test-pilot.md` runs end to end: discover -> design -> test data ->
qTest Excel -> Playwright+TS scripts -> typecheck -> preflight (credentials, quota) -> execute -> triage (root causes) -> HTML reports + history -> spec drift -> final message.
**Never ask the user questions or wait for approval.** Make reasonable decisions, record them as
assumptions, continue.

## Structure
- `.claude/` - command (`commands/api-test-pilot.md`), sub-agents (`agents/`), skills (`skills/*/SKILL.md`), permissions.
- `api/<api-name>/` - everything generated for one API: `spec/`, `test-data/`, `test-cases/`, `tests/`, `schemas/`, `reports/`.
- `shared/` - reusable, API-agnostic code: fixtures (request client, auth identities), helpers (assertions, mutators, env, safety guard), `global-setup.ts`.
- `scripts/` - deterministic stage implementations; `scripts/api-test.ts` is the orchestrator (`--only`, `--from`).
  Test design = one **plugin per category** in `scripts/design/generators/` (contract `scripts/design/plugin.ts`);
  add a category by adding a plugin, not by growing `design-test-cases.ts`.

## Discovery
Any URL works - spec, docs page, base URL or a single endpoint. Discovery walks from the URL up to the root
trying spec links and known spec paths at every level (`skills/api-discovery`), so `/booking` finds the
same spec and auth as `/`. An endpoint URL scopes the run to that resource (+ login) under its own name
(`restful-booker-booking`). Endpoint probing is the last resort.

## Test case level - BUSINESS by default (user decision, do not ask again)
The user wants **business-level test cases only, no unnecessary test cases**. Default `--level business`
(`scripts/design/business.ts`, applied by `scripts/consolidate-cases.ts`):
- **Only business-relevant checks are kept** (explicit allowlist `businessKeep`): valid requests, required-only
  bodies, filters, CRUD lifecycle, schema/format/exact-storage checks, missing/empty required fields, wrong
  types, invalid enum/format, unknown id -> not found, duplicates, documented min/max +/-1, no token, invalid
  token, valid admin, public access, login, mass assignment/data exposure.
- **Left out as low-value**: idempotency repeats, separate Content-Type/response-time checks (every test
  asserts them anyway), null/{}/no-body/malformed-JSON/text-plain bodies, malformed ids, unsupported
  methods, injection strings, unknown query params, undocumented limits, decimal/huge/10,000-char/unicode/
  whitespace/date/array/id boundaries, expired/malformed/wrong-scheme tokens, token-hygiene tricks.
- **One case per business scenario per resource**, worded for a business reader: browse (and filter),
  view (unknown -> not found), create, invalid create, duplicate, update, invalid update, delete, end-to-end
  lifecycle, one per non-CRUD operation, access control, login (e.g. "Create a booking with valid details;
  the saved values match what was sent"). ~6-12 cases per resource; the checks run as steps.
- When adding generators or categories, keep this default: new checks must be classified in `businessKeep`
  and mapped by `businessScenario`, never surfaced as extra technical test cases.
- `--level high` (every check, one case per endpoint + technical scenario) and `--level detailed` (one case
  per check) exist only for an explicit request for full technical coverage. The list below describes that
  full coverage.

## Coverage at `--level high` / `detailed` (every endpoint and method, where applicable - else listed under notApplicable)
- **Positive-Functional**: success code + required fields, CRUD lifecycle with 404 after delete, filters/pagination, idempotency of GET/PUT/DELETE, optional fields omitted/included, created data retrievable and equal.
- **Positive-DataValidation**: zod schema of every field and every array item (type/format/presence), enums, ISO dates, email/URL/UUID, ranges, Content-Type, response time (`RESPONSE_TIME_MS`, default 2000), exact echo.
- **Negative**: missing required (one at a time), null, empty string/body, malformed JSON, wrong types, invalid enum/format, unsupported method, wrong Content-Type, unknown id 404, bad id 400, duplicates, injection strings as input. Assert correct 4xx, leak-free error body, never 5xx.
- **Boundary**: string 0/1/min-1/min/max/max+1/10,000, numeric min/min-1/max/max+1/0/negative/decimal/huge, arrays empty/1/max/max+1, pagination edges, dates, unicode/emoji, whitespace.
- **Auth**: admin, none, invalid, expired, malformed, wrong scheme, login valid/wrong password/missing fields, public endpoints without token. 401 vs 403 per spec.
- **Authorization** (OWASP API Top 10, `skills/authorization-tests`): mass assignment (privileged/read-only fields ignored or rejected, verified by re-reading), excessive data exposure (no sensitive or undocumented fields), token hygiene (token in query, alg:none, tampered signature, reuse after logout -> 401/403). Bypass = Real API defect (High) with OWASP id. Access matrix in `reports/access-matrix.json` + summary.html.

## One identity, no OAuth (user decision)
The agent tests with **one credential identity: admin** (plus anonymous / invalid / expired / malformed /
wrong-scheme credentials, which need no configuration). There are **no normal-user identities** (`user`,
`user2`) and therefore no wrong-role, BOLA or BFLA checks. The agent **does not run OAuth2/OpenID flows**:
discovery prefers any other declared scheme (PetStore: `api_key`); an OAuth2-only API is treated as `bearer`
with a ready access token in `<API>_ADMIN_TOKEN`; no scope checks. Do not reintroduce these identities or
OAuth flows unless the user asks.

**Test case level**: business by default (see above). `--level high` gives one case per endpoint +
technical scenario with every check; `--level detailed` one case per check.

Every test asserts status, headers, schema, key business fields and response time (negative: status,
error body, no 5xx). Never a status-only test. IDs `TC_<API>_<ENDPOINT>_<NNN>`; test titles
`[TC_ID] description`; the same ID is the qTest Automation ID.

## qTest Excel
`test-cases/<api-name>_qtest_import.xlsx`, sheet `Test Cases`, single header row, one row per step,
columns: Module, Test Case Name, Description, Precondition, Priority, Type, Status, Test Step Number,
Step Description, Step Expected Result, Automation ID, Requirement/Endpoint, Category, Test Data; plus an
`Import Notes` sheet. Re-opened and validated after writing (see `skills/qtest-excel-format`).

## Execution and self-healing
`API_NAME=<api-name> npx playwright test` (request fixture, retries 1, HTML + JSON + list reporters into
`api/<api-name>/reports/`; the report stage adds `junit.xml` with the root cause in each failure message). Self-heal **only script errors** (TS errors, imports, paths, data-key typos),
max 3 attempts. **Never weaken an assertion or change an expected value to make a test pass** - a
failure caused by API behaviour is a finding. Triage every failure: Real API defect, Test data issue,
Flaky/Environment issue, Contract/Spec mismatch - with evidence - and **group failed checks into root
causes** (`triage.json.rootCauses`); report root causes first, individual failures second.

**Coverage before pass rate**: the `preflight` stage (before `run`) lists the admin identity the cases need,
whether it is configured (.env names only), whether login returns a token, and the quota state
(`reports/preflight.json`). Always report executed coverage (executed / total) next to the pass rate; a
run with < 80% executed is flagged as not representative.

**History**: runs never overwrite each other - the `run` stage clears the previous run's derived files and
the `report` stage archives each run in `reports/history/<runId>/` (+ `index.json`). A triage whose
`runStartedAt` differs from `results.json` is stale and never shown with the new results.

**CI mode** (`--ci`, `scripts/ci.ts`, `.github/workflows/api-test.yml`): non-interactive output and
`reports/ci-summary.md`. Exit 0 = no new failures vs the previous run, 4 = new failures or new Critical
authorization findings (first run: Critical/High root causes), 5 = executed coverage < `CI_MIN_COVERAGE`
(default 80); 1/2/3 unchanged. In CI, credentials come from repository secrets with the `.env` names, never
from committed files.

**Contract handling** (`scripts/contract.ts`, see `skills/failure-triage`): undocumented status codes are
calibrated from consistent 4xx behaviour (`calibrate` stage -> `spec/calibration.json`, one re-run);
rules the agent invented become robustness checks (4xx or exact 2xx, never 5xx); documented simulated
writes are verified as such; humans may pin the contract in `spec/contract-overrides.json`. Documented
rules are never relaxed automatically, and a 2xx or 5xx is never learned.

**Spec-diff updates** (`scripts/spec-diff.ts`, design stage): when the spec changes, only what changed is
regenerated. The unit is a resource group (endpoints + resource -> cases, test data, `tests/<group>.spec.ts`,
`schemas/<group>.schema.ts`). Unchanged groups keep their cases and data exactly (same TC ids, same values)
from `spec/design-cache.json`; changed/new groups are regenerated, removed groups' files are deleted, and
generated files are only rewritten when their content changed. A change to the design code or to API-wide
settings (base URL, auth, default limits) regenerates everything, as does `--full`. `spec/spec-diff.json`
lists endpoints added/removed/changed (field-level), groups regenerated/reused/removed and checks
added/removed/changed.

**Spec drift** (`drift` stage after `report`, `scripts/spec-drift.ts`): documented behaviour
(endpoint-summary.json + the original spec) vs observed behaviour (recorded responses, failed checks,
calibration, suggested-overrides) -> `reports/spec-drift.json` (endpoint, kind, documented, observed,
evidence TC ids, confidence, recommendation `fix API` | `fix docs`); for OpenAPI/Swagger sources also
`reports/openapi-patch.json` (RFC 6902, against `spec/openapi.json`) and `reports/openapi-suggested.yaml`.
Docs silent -> document consistent behaviour; docs explicit -> the API must comply. A doc change needs >= 2
checks, no 5xx and no 2xx for invalid input on that endpoint (else it is listed under `withheld`);
documented rules are never patched to match a broken API.

## Guardrails (they replace human checkpoints)
- **Host allowlist**: `ALLOWED_HOSTS` in `.env`. Unknown host -> stop with a one-line message saying how
  to add it. Every request (discovery and tests) is checked. Do not edit `.env` yourself.
- **Secrets**: only from `.env` via `process.env`, names `<API_NAME>_BASE_URL`, `_API_KEY`, `_USERNAME`,
  `_PASSWORD`, `_ADMIN_TOKEN`, `_EXPIRED_TOKEN`. A token obtained at runtime stays in memory
  (`process.env.__API_TOKEN_ADMIN`). Playwright traces stay off. Never
  print, log or write values into reports, test cases or test data; never ask for or type credentials.
  Missing credentials -> those tests are skipped with a reason; no-token/invalid-token/public tests still run.
- **Data safety**: write only inside this project. Mutating tests clean up what they create. Discovery
  uses GET/HEAD/OPTIONS only. No load or stress testing; polite delay between requests (`POLITE_DELAY_MS`).
- **Scope**: practice/dummy APIs only (PetStore, Restful-Booker, JSONPlaceholder, ReqRes). No client data.

## MCP server (`mcp/`)
`npm run --silent mcp` (stdio) or `-- --http --port 8787`. HTTP mode has **no authentication** (user
decision), so it always binds to 127.0.0.1 (no `--host`; only this machine can reach it) and keeps
DNS-rebinding protection (Host must be 127.0.0.1/localhost). Never make it listen on another interface. Tools: run_api_test, get_run_status, list_apis, get_summary, get_failures,
get_access_matrix, get_history, get_spec_drift, get_test_case, rerun, get_qtest_file; resources `api://{name}/summary|triage|endpoint-summary`;
prompts test-api, explain-failures. Runs are background jobs (one per API name); every URL passes the
allowlist; names are validated; outputs and `mcp/logs/` are redacted.

## Conventions
**Unit tests** for the agent's own logic: `npm run test:unit` (`tests/unit/*.test.ts`, `node:test` + tsx,
no network, isolated fixture folders under `.unit-test-tmp/` via `API_TEST_API_DIR`). They cover triage
classification/root causes/outage detection, contract calibration, spec-diff and consolidation. Change
any of those scripts -> run them; add a test for every new classification or calibration rule. CI runs
them before any API run.

**Triage never reports an outage as a defect**: when >= 30% (and >= 3) of the valid read requests of a run
fail with 5xx, `triage.outageSuspected` is set and every 5xx becomes Flaky/Environment. Unrecognised
failures are named after their assertion message ("Expectation not met: ..."), never a generic label.
History counts a previous failure as fixed only when the test ran and passed; tests no longer run are
listed separately.

TypeScript strict, `npx tsc --noEmit` must pass, no `any` where a type is feasible, small helpers, clear
names. Prefer improving the generators in `scripts/` over hand-editing generated files.
