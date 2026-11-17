# API Test Pilot

1. `npm install` once, then `cp .env.example .env` and set `ALLOWED_HOSTS` (+ credentials, if the API needs them).
2. In Claude Code run: **`/api-test-pilot <API_URL_OR_ENDPOINT_URL> [--name <api-name>]`**, e.g. `/api-test-pilot https://restful-booker.herokuapp.com/`.
3. Input: an OpenAPI/Swagger spec URL, a docs page, a base URL or a single endpoint URL. Nothing else is asked.
4. The agent discovers the API, designs positive/data-validation/negative/boundary/auth cases, writes the qTest Excel, generates Playwright+TS tests, runs them and builds reports.
5. Outputs land in `api/<api-name>/`:
   - `test-cases/<api-name>_qtest_import.xlsx` (qTest import) and `testcases.json`
   - `tests/*.spec.ts`, `schemas/*.schema.ts`, `test-data/*.json`
   - `reports/summary.html`, `reports/html/index.html` (Playwright), `reports/triage.json`, `reports/run-log.txt`
6. Without Claude: `npm run api-test -- <url> [--name x]` runs the same pipeline deterministically.

## MCP server

The agent is also an MCP server (`mcp/server.ts`). See `mcp/README.md` for its tools, resources and prompts.

- **stdio** (default, no token): `npm run --silent mcp`
- **Streamable HTTP**: `npm run --silent mcp -- --http --port 8787`
  - **No token / no authentication.** Because of that it always binds to 127.0.0.1 (there is no `--host`
    option), so only programs on this machine can reach it. Requests whose `Host` header is not
    127.0.0.1/localhost are rejected (protects against web pages calling it through your browser).

**Claude Code.** The project already contains `.mcp.json`, so Claude Code offers the server when you open the folder. To add it by hand:
```
claude mcp add api-test-pilot -- node node_modules/tsx/dist/cli.mjs mcp/server.ts
claude mcp add --transport http api-test-pilot-http http://127.0.0.1:8787/mcp
```

**Claude Desktop.** Add this to `claude_desktop_config.json`. Use absolute paths, because Desktop has no working-directory setting.
```json
{ "mcpServers": { "api-test-pilot": {
  "command": "node",
  "args": ["C:\\Users\\<you>\\projects\\API_Test_Agent\\node_modules\\tsx\\dist\\cli.mjs",
           "C:\\Users\\<you>\\projects\\API_Test_Agent\\mcp\\server.ts"] } } }
```

**Cursor.** Add this to `.cursor/mcp.json` in the project, or to `~/.cursor/mcp.json`:
```json
{ "mcpServers": {
  "api-test-pilot": { "command": "node", "args": ["node_modules/tsx/dist/cli.mjs", "mcp/server.ts"] },
  "api-test-pilot-http": { "url": "http://127.0.0.1:8787/mcp" } } }
```

**Testing.** To try the server with the MCP Inspector:
```
npx mcp-inspector --cli node node_modules/tsx/dist/cli.mjs mcp/server.ts --method tools/list
```

## Reading the results
- **Coverage before pass rate.** `summary.html`, the final message and MCP `get_summary` show the share of
  tests that actually executed next to the pass rate. Below 80% a banner says the pass rate is not
  representative and why.
- **Pre-run check.** Before the run, `reports/preflight.json` and the run log list each identity the tests
  need, the `.env` variable that provides it or should, whether login works, and the API quota.
- **Root causes, not 55 defects.** Failed checks are grouped by underlying problem, for example "Invalid
  input is accepted with HTTP 200 - validation is missing" across 11 endpoints. Setup failures point at the
  root cause that blocked them.
- **History.** Every run is archived in `reports/history/<runId>/`, and `summary.html` shows earlier runs
  plus new and fixed failures. A run in progress or a stale triage is never mixed with new results.
- **Spec changes regenerate only what changed.** Re-running `/api-test-pilot` on a changed spec regenerates only
  the resource groups whose endpoints changed; other groups keep their test cases, TC ids, test data and
  files exactly. `spec/spec-diff.json` (and the run log) says which endpoints were added, removed or changed
  (field by field) and which groups were regenerated. Use `--full` to regenerate everything.
- **Spec drift.** After the report, the agent compares what the documentation says with what the API did:
  `reports/spec-drift.json` lists each difference with evidence TC ids, a confidence and a recommendation
  ("fix API" or "fix docs"). Where the docs are silent and the behaviour is consistent (an undocumented 404,
  a field every response returns), it suggests a doc change - for OpenAPI/Swagger as an RFC 6902
  `openapi-patch.json` plus the patched `openapi-suggested.yaml`. Where the docs are explicit, the API has
  to change; a 5xx or accepted invalid input is never written into the docs.
- **Any URL.** Discovery walks up from the given URL to the root looking for the spec. An endpoint URL such
  as `/booking` gets the full spec and auth, scoped to that resource, in its own folder
  (`restful-booker-booking`).

## CI
```
npm run api-test -- https://restful-booker.herokuapp.com/ --ci
```
- Writes `reports/junit.xml` (every run; testcase name = `[TC_ID] title`, failure message = its root cause)
  and `reports/ci-summary.md`: totals, executed coverage, new/fixed vs the previous run, top root causes.
- Exit codes: `0` no new failures, `4` new failures or new Critical authorization findings (first run with
  no history: any Critical/High root cause), `5` executed coverage below `CI_MIN_COVERAGE` (default 80),
  `1/2/3` pipeline error / host not allowed / script error as before.
- `.github/workflows/api-test.yml` runs this for jsonplaceholder, restful-booker, petstore and reqres:
  manually (`apis` input), daily at 03:00 UTC and on pull requests that touch the agent. It uploads the
  reports as artifacts, adds `ci-summary.md` to the job summary and posts or updates one PR comment per API.
  Run history is carried between runs in the Actions cache.
- Credentials: repository **secrets** named exactly like the `.env` variables (`RESTFUL_BOOKER_USERNAME`,
  `RESTFUL_BOOKER_PASSWORD`, `REQRES_API_KEY`, ...). Unset secrets mean those tests are skipped and
  preflight says so. Optional repository **variables**: `ALLOWED_HOSTS` (defaults to the four practice hosts),
  `CI_MIN_COVERAGE`, `RESPONSE_TIME_MS`, `POLITE_DELAY_MS`, `PW_WORKERS`, `PW_RETRIES`.

## Decisions made while building

- **Test design is split into category plugins** (`scripts/design/generators/`, one file per category,
  contract in `scripts/design/plugin.ts`). The refactor was verified to produce byte-identical
  `testcases.json` and test data for all four APIs.

- **One identity (admin), no OAuth.** The agent tests with the admin credentials from `.env` plus anonymous,
  invalid, expired, malformed and wrong-scheme credentials. There are no normal-user (`USER`/`USER2`)
  identities, so no wrong-role, BOLA or BFLA checks. OAuth2 flows are not run: discovery uses another
  declared scheme when there is one (PetStore: `api_key`), and an OAuth2-only API needs a ready access token
  in `<API>_ADMIN_TOKEN`.
- **Authorization category (OWASP API Top 10).** With one identity it covers:
  - mass assignment
  - excessive data exposure
  - token hygiene: token in the query string, `alg:none`, tampered signature, reuse after logout

  Results appear in the qTest Excel file, in an access matrix in `summary.html`, and in `reports/access-matrix.json`.
- **Playwright traces are off.** Traces record raw request headers, so they would contain tokens. Failure evidence comes from the redacted request/response attachments instead.

- **Contract/Spec mismatches the agent caused are fixed automatically, without relaxing anything documented.** Four rules:
  - **Status codes the docs don't specify** (for example 403 instead of 401) are learned from the run, but only when the API answers the same 4xx consistently. The result is saved to `spec/calibration.json`.
  - **Rules the agent invented** (assumed limits, fields inferred as required from samples) become robustness checks. They pass on a 4xx rejection, or on a 2xx that stores the value exactly. They fail on a 5xx, leaked internals or silently changed data.
  - **APIs documented as simulating writes** are tested against that documented behaviour.
  - **Documented rules are never relaxed automatically.** Where an endpoint seems not to validate on purpose, `spec/suggested-overrides.json` lists it. A person can then confirm that in `spec/contract-overrides.json`.
- **Business-level test cases by default.** Each resource gets one test case per business scenario, for example "Create a booking with valid details; the saved values match what was sent" or "Only authorised users can use bookings". Low-value technical checks (idempotency repeats, malformed bodies, injection strings, exotic boundaries, odd token formats) are left out; the rest run as steps, and the test fails listing every check that failed. jsonplaceholder: 59 cases instead of 334. Add `--level high` for every technical check (one case per endpoint + scenario), or `--level detailed` for one case per check.
- **Project root = this folder (`API_Test_Agent/` on disk).** `.claude/` must sit at the workspace root for `/api-test-pilot` to be found.
- **Hybrid agents.** Every stage has a deterministic TypeScript implementation in `scripts/`. The sub-agents run it, then review and enrich the output (for example by reading docs when no spec exists). Runs are reproducible, and the pipeline still completes if a sub-agent fails.
- **Extra files beyond the brief's tree.** The brief named three scripts. Discovery, design, spec generation and triage are separate scripts too, and the data model lives in `shared/helpers/types.ts`.
- **No browsers.** Tests use Playwright's `request` fixture only, so the setup stage installs npm packages but no browsers.
- **Discovery formats.** OpenAPI 3, Swagger 2 (JSON/YAML) and apiDoc (`api_data.json`, used by Restful-Booker). Without a spec it probes a single endpoint or crawls the docs page links. Only GET, HEAD and OPTIONS are used during discovery.
- **Undocumented expectations.** Where the spec is silent: 401 for missing or invalid credentials, 400 or 422 for invalid input, 405 or 404 for unsupported methods, string lengths 1..255, numbers 0..2^31-1, arrays up to 100 items. Each affected case is marked as assumption-based, shown in Excel and the reports, and its failures are triaged as `Contract/Spec mismatch` rather than defects.
- **Simulated writes.** JSONPlaceholder documents that writes are faked. Mutation tests there use existing ids, and the CRUD-lifecycle test still asserts persistence, so this documented behaviour shows up as a finding.
- **Error-body rule.** Without a documented error schema, negative tests require a leak-free error body (no stack traces, internal paths or SQL errors) instead of a specific JSON shape.
- **Credentials.** Restful-Booker's credentials are publicly documented demo values, kept only in the git-ignored `.env`. Tokens obtained at login stay in memory (`process.env`) for the run and are redacted from all reports and logs.
- **Excel format.** Based on Tricentis' "Import or Modify Test Cases Using Microsoft Excel": one header row, one row per step, and column-to-field mapping done in the import wizard (explained on the `Import Notes` sheet).
- **Run settings.** Defaults are `PW_WORKERS=4`, `PW_RETRIES=1`, `POLITE_DELAY_MS=150` and `RESPONSE_TIME_MS=2000`. All can be changed in `.env`.
