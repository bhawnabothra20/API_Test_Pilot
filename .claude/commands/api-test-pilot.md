---
description: Fully autonomous API testing - URL in; qTest Excel, Playwright+TypeScript tests, execution and HTML reports out. No questions, no approvals.
argument-hint: <API_URL_OR_ENDPOINT_URL> [--name <api-name>]
allowed-tools: Bash, PowerShell, Read, Write, Edit, Glob, Grep, Agent, WebFetch, WebSearch
---

# /api-test-pilot

Input: `$ARGUMENTS` (first token = URL; optional `--name <api-name>`; optional `--level high|detailed`).
Default is **business-level test cases** (the user's standing choice - never ask): one case per business
scenario per resource, low-value technical checks left out (`scripts/design/business.ts`). Use `--level
high` / `detailed` only when the user explicitly asks for full technical coverage. Pass `--level` through
to every stage command.

You run the whole pipeline below **sequentially, in one go, without asking the user anything** and without
waiting for approval between steps. Safety comes from the guardrails in `CLAUDE.md` (host allowlist,
secrets only from `.env`, writes only inside this project, cleanup of created data), not from checkpoints.
If a decision is needed, make the reasonable choice, record it as an assumption in
`api/<name>/spec/endpoint-summary.json` (`assumptions`) and continue.

All stage logic lives in `scripts/api-test.ts`; every agent runs its stage with:

```
npm run api-test -- <url> --name <api-name> --only <stage>
```

Exit codes: `0` ok, `2` safety gate refused the host (stop), `3` script error (self-heal), `1` other error.

## Pipeline

| Step | Who | What to run / do | Output |
|---|---|---|---|
| 0. Setup | you | `npm run api-test -- <url> [--name x] --only setup`. Read the `api name:` line from the output - that is `<api-name>` for every later step. | deps installed, `api/<api-name>/` folders |
| 1. Safety | you | `--only safety`. On exit code 2 print the one-line message (it says how to add the host to `ALLOWED_HOSTS`) and **stop**. Never edit `.env` yourself. | - |
| 2. Discover | `api-analyst` agent | discovery stage + enrichment | `spec/endpoint-summary.json` |
| 3+4. Design + data | `test-designer` agent | design stage + coverage review | `test-cases/testcases.json`, `test-data/*.json` |
| 5. Excel | `qtest-exporter` agent | excel stage + validation | `test-cases/<api-name>_qtest_import.xlsx` |
| 6. Scripts | `script-writer` agent | scripts stage + code review | `tests/*.spec.ts`, `schemas/*.schema.ts` |
| 7+8. Typecheck + preflight + run | `test-runner` agent | typecheck, preflight (what will be skipped and why) and run stages, self-heal script errors (max 3 attempts) | `reports/preflight.json`, `reports/html/`, `reports/results.json` |
| 9. Report | `report-builder` agent | report stage + triage review | `reports/summary.html`, `reports/triage.json`, `reports/run-log.txt` |
| 9b. Spec drift | orchestrator | drift stage | `reports/spec-drift.json`; for OpenAPI/Swagger `reports/openapi-patch.json` + `openapi-suggested.yaml` |
| 10. Final | you | `--only final`, then print its block | paths + counts |

### How to delegate

For steps 2-9 launch the named sub-agent with the Agent tool (`subagent_type` = agent name), one at a time,
waiting for each to finish. Give each agent this brief (fill in the values):

> URL: `<url>` · API name: `<api-name>` · Project root: current directory.
> Run your stage as described in your agent file, verify its output, fix what your file allows you to fix,
> and reply with: status (ok/failed), key counts, files written, assumptions added. Do not ask questions.

If an agent reports `failed`, or the Agent tool is unavailable, run that stage's command yourself
(`npm run api-test -- <url> --name <api-name> --only <stage>`) and continue. The deterministic scripts
can complete the whole pipeline on their own: `npm run api-test -- <url> --name <api-name> --from discover`.

### Rules that override everything

- Never weaken an assertion or change an expected value to turn a failing test green. Real API
  behaviour that differs from expectations is a **finding**, reported by triage.
- Self-healing is only for script errors (TypeScript errors, bad imports, wrong paths, test-data key typos).
- Never print, log or write secret values; never ask for or type credentials. Missing credentials mean
  those tests are **skipped with a reason**.
- Only call hosts on the allowlist. No load testing.

## Final message (step 10)

After `--only final`, reply to the user with exactly this information (short):

- API name and URL, spec source, number of endpoints and test cases
- **Executed coverage first** (executed / total), then the pass rate of the executed tests; if coverage is
  below 80% say so plainly and give the preflight warnings (which `.env` variable names are missing)
- Totals: passed / failed / skipped / flaky
- **Root causes** from `triage.json.rootCauses` (one line each, real defects first, with how many checks
  and endpoints they explain) - not a list of individual failing tests
- New / fixed failures compared with the previous run (summary.html "Run history")
- Absolute paths: qTest Excel file, `reports/summary.html`, `reports/html/index.html`
- Anything skipped and why (e.g. missing credentials)

## Also available as an MCP server

The same pipeline is exposed through `mcp/server.ts` (`run_api_test`, `get_run_status`, `get_summary`,
`get_failures`, `get_access_matrix`, `rerun`, ...). See the README "MCP server" section.

## Example

```
/api-test-pilot https://restful-booker.herokuapp.com/
/api-test-pilot https://jsonplaceholder.typicode.com/posts --name jsonplaceholder-posts
/api-test-pilot https://petstore.swagger.io/v2/swagger.json
```
