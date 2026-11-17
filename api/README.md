# api

One folder per tested API, created automatically by `/api-test` (name derived from the URL host, or `--name`).

```
api/<api-name>/
  spec/        endpoint-summary.json (what the agent understood, incl. assumptions) + downloaded spec
  test-data/   valid.json, invalid.json, boundary.json, auth-identities.json (env var names only, no secrets)
  test-cases/  testcases.json (source of truth) + <api-name>_qtest_import.xlsx
  tests/       generated Playwright specs, one per resource group
  schemas/     generated zod response schemas
  reports/     html/ (Playwright report), summary.html, triage.json, run-log.txt
```

Working example kept from the validation runs: `jsonplaceholder/` (no auth, simulated CRUD). Other
APIs appear here when you run `/api-test` on them.
