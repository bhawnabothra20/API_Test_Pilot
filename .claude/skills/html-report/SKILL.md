---
name: html-report
description: What the HTML reports of an /api-test-pilot run contain (Playwright report and the self-contained summary.html), where they are written, and how to check them for accuracy and secret leakage.
---

# HTML reports

## Files (`api/<api-name>/reports/`)
| File | Producer | Content |
|---|---|---|
| `html/index.html` | Playwright HTML reporter | every test, steps, errors, attachments (redacted exchanges), traces of failures |
| `results.json` | Playwright JSON reporter | machine-readable results (input for triage and summary) |
| `summary.html` | `scripts/build-summary-report.ts` | one self-contained page, inline CSS/JS, no external assets |
| `triage.json` | `scripts/triage-failures.ts` | classified failures with evidence |
| `junit.xml` | `scripts/junit.ts` | JUnit for CI: testsuite per category, testcase `[TC_ID] title`, failure message = root cause |
| `spec-drift.json` | `scripts/spec-drift.ts` (drift stage) | documented vs observed: kind, evidence TC ids, confidence, `fix API` / `fix docs`; summary.html "Spec drift" section |
| `openapi-patch.json`, `openapi-suggested.yaml` | `scripts/spec-drift.ts` | RFC 6902 patch against `spec/openapi.json` and the patched spec (OpenAPI/Swagger sources only) |
| `ci-summary.md` | `scripts/ci.ts` (`--ci` only) | PR comment / job summary: totals, coverage, new/fixed, top root causes, CI verdict |
| `run-log.txt` | `scripts/api-test.ts` | timestamped stage log + Playwright output, secrets redacted |

## summary.html sections
1. Header: API title/name, input URL, base URL, spec source, auth type, run date/time (UTC), duration,
   endpoint and case counts; links to the Playwright report, the qTest Excel file, `triage.json`,
   `run-log.txt` (relative links, so the folder can be zipped and shared).
2. **Low-coverage banner** when less than 80% of the tests executed, listing the preflight warnings
   (which credential is missing, quota exhausted). A pass rate is never shown without coverage.
3. Totals cards: total, **executed %** (passed+failed+flaky / total), **pass rate of executed tests**,
   passed, failed, skipped, flaky, **root causes** (and how many are real defects); new/fixed failures
   compared with the previous full run.
4. **Root causes**: failed checks grouped by underlying problem (severity, class, title, fix hint,
   endpoints, tests, example) - see `failure-triage`.
5. **Pre-run checks** (`reports/preflight.json`): admin identity needed vs configured (.env names only),
   login verified, quota probe, expected executable checks.
6. Results by category and by endpoint with executed % and pass rate.
7. Access matrix (endpoints x identities, expected vs actual; bypasses highlighted with OWASP ids) and
   Authorization findings (severity + OWASP API Top 10) - also in `reports/access-matrix.json`.
8. Failure table: id, title, category, endpoint, triage class + reason, expected vs actual, collapsible
   evidence (request/response) and error; text + class + category filters (inline JS).
9. Skipped tests with their reasons (e.g. missing credentials).
10. **Run history**: this run + archived runs (`reports/history/index.json`) with coverage, pass rate,
    failures and root causes, linking `history/<runId>/summary.html`.
11. Assumptions (discovery + design) and "Not applicable" coverage items.

## History and stale results
A run never overwrites another: the `run` stage deletes the previous run's derived files (`triage.json`,
`access-matrix.json`) before executing, and the `report` stage archives the finished run to
`reports/history/<runId>/` (results, triage, matrix, preflight, summary, log; last 20 kept). Partial runs
(`--tc`, MCP `rerun`) are marked `partial` and are not used for "new/fixed failures".

Light and dark mode via `prefers-color-scheme`; tables scroll horizontally on narrow screens.

## Accuracy checks
- Totals in `summary.html` = Playwright stats (`expected` = passed, `unexpected` = failed, `flaky`,
  `skipped`).
- Every failed test appears exactly once in the failure table and in `triage.json`.
- No secret values anywhere: search the reports for the values of `*_PASSWORD`, `*_TOKEN`, `*_API_KEY`
  (the pipeline redacts automatically).
