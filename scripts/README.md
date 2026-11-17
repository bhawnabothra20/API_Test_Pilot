# scripts

Deterministic implementations of each pipeline stage. The sub-agents run them and then review/enrich the output.

| Script | Stage | Output |
|---|---|---|
| `api-test.ts` | orchestrator: `npm run api-test -- <url> [--name x] [--only a,b] [--from stage] [--ci]` | runs all stages, writes `reports/run-log.txt`, prints the final summary |
| `junit.ts` | report (after triage) | `reports/junit.xml`: one testsuite per category, testcase = `[TC_ID] title`, failure message = root cause |
| `spec-drift.ts` | drift (after report) | `reports/spec-drift.json` (fix API / fix docs per drift, evidence TC ids), `reports/openapi-patch.json` (RFC 6902) + `openapi-suggested.yaml` for OpenAPI/Swagger sources |
| `ci.ts` | `--ci` only, report stage | `reports/ci-summary.md` (PR comment / job summary) and the CI exit code |
| `discover.ts` | 2 discover | `spec/endpoint-summary.json` |
| `design-test-cases.ts` | 3-4 design + data (orchestrates the plugins below) | `test-cases/testcases.json`, `test-data/*.json` |
| `spec-diff.ts` | 3 design (wraps `design-test-cases.ts`) | regenerates only resource groups whose spec changed; `spec/design-cache.json`, `spec/spec-diff.json`; `--full` forces everything |
| `design/generators/*.ts` | one **category plugin** per test category (`CategoryGenerator` in `design/plugin.ts`, registered in `design/generators/index.ts`) | cases via `addCase()` from `design/context.ts` |
| `preflight.ts` | preflight (before run) | `reports/preflight.json`: credentials needed vs configured (names only), login check, quota probe, expected coverage |
| `history.ts` | run (clear stale) + report (archive) | `reports/history/<runId>/`, `reports/history/index.json` |
| `consolidate-cases.ts` | 3 (default `--level business`) | business: keeps business-relevant checks (`design/business.ts`) and groups them into one case per business scenario per resource; `--level high`: every check, one case per endpoint + scenario |
| `build-qtest-excel.ts` | 5 excel (+ validation, traceability) | `test-cases/<name>_qtest_import.xlsx` |
| `generate-specs.ts` | 6 scripts | `tests/*.spec.ts`, `schemas/*.schema.ts` |
| `triage-failures.ts` | 9 triage | `reports/triage.json` (items + **root causes**: failed checks grouped by underlying problem) |
| `build-summary-report.ts` | 9 report | `reports/summary.html` |

Stages: `setup, safety, discover, design, excel, scripts, typecheck, preflight, run, calibrate, report, drift, final`.

**Adding a test category**: create `design/generators/<name>.ts` exporting `generator: CategoryGenerator` (`forEndpoint` per endpoint and/or `forApi` once), register it in `design/generators/index.ts` (order fixes the TC ids), add the `Category` in `shared/helpers/types.ts` and a skill. The other generators are untouched.
Exit codes: 0 done (test failures are findings), 2 host not allowed / usage, 3 script error (self-heal), 1 other.
With `--ci` the test results also gate the exit code: 0 no new failures vs the previous complete run,
4 new failures or new Critical authorization findings (first run without history: any Critical/High root
cause that is not Flaky/Environment), 5 executed coverage below `CI_MIN_COVERAGE` (default 80). 4 wins over 5.
Flaky tests never count as failures. Playwright prints `dot` progress instead of `list` in CI mode.
Unit tests for this folder's logic: `npm run test:unit` (`tests/unit/`, no network, ~5 s).
Each stage script can also run alone, e.g. `npx tsx scripts/discover.ts <url> <api-name>`.
