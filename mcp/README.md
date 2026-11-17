# mcp

MCP server that exposes the API Test Pilot to any MCP client (Claude Code, Claude Desktop, Cursor ...).

- `server.ts` - tools, resources, prompts; stdio (default) and Streamable HTTP (`--http --port 8787`, 127.0.0.1 only, no token).
- `jobs.ts` - background pipeline jobs (detached `scripts/api-test.ts`), one run per API name, status on disk.
- `queries.ts` - read-only views of `api/<name>/` (summary, failures, access matrix, test cases, qTest file).
- `jobs/` (runtime, git-ignored) - job records, progress and logs. `logs/` (runtime, git-ignored) - one line per tool call: tool, redacted args, duration, ok/error.

| Tool | Purpose |
|---|---|
| `run_api_test {url, name?, level?, only?, from?, full?}` | start the pipeline in the background -> `jobId` (host must be in `ALLOWED_HOSTS`) |
| `get_run_status {jobId}` | stage, progress, pass/fail counts, log tail |
| `list_apis` | tested APIs: state (running / results), last run, **executed coverage next to the pass rate**, last completed run |
| `get_summary {name}` | totals, executed coverage + pass rate, preflight warnings (missing credentials, quota), root causes, failures by class, authorization findings; never mixes a stale triage with new results |
| `get_failures {name, triageClass?}` | root causes + failed TC ids with severity, OWASP id and redacted evidence |
| `get_history {name}` | archived runs (newest first): coverage, pass rate, failures, root causes, archived report |
| `get_access_matrix {name}` | endpoints x identities, expected vs actual |
| `get_spec_drift {name, recommendation?}` | documented vs observed behaviour: drift items with evidence TC ids, confidence and `fix API` / `fix docs`, withheld doc changes, and the `openapi-patch.json` path (OpenAPI/Swagger) |
| `get_test_case {name, tcId}` | steps, expectations, data keys, script path:line |
| `rerun {name, tcIds?}` | re-run all or selected TC ids (Playwright `--grep`) and rebuild reports |
| `get_qtest_file {name}` | path of the qTest `.xlsx` |

Resources: `api://{name}/summary`, `api://{name}/triage`, `api://{name}/endpoint-summary`. Prompts: `test-api(url)`, `explain-failures(name)`.
Registration for each client: see the root `README.md`.
