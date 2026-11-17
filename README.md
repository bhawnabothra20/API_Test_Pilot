# API Test Pilot
Give it the URL of an API. It writes the test cases, writes the automation, runs it and builds the reports. One command, no manual steps in between.

Built with [Claude Code](https://claude.com/claude-code), [Playwright](https://playwright.dev/) and TypeScript.

> **Status:** under development. It is meant for practice APIs only for now (see [Safety](#safety-and-credentials)). Secrets handling is still in progress.

## What it does

```
/api-test-pilot <API_URL_OR_ENDPOINT_URL>
```

| You give | You get |
|---|---|
| The URL of an API, or a single endpoint | An Excel file of test cases that imports straight into qTest |
| | Playwright API tests written in TypeScript |
| | A test run with every script executed |
| | HTML reports with results and failure details |

## How it works

The command runs six steps in order, each handled by its own sub-agent:

1. **Understand** the API from its URL or spec: endpoints, fields, auth rules.
2. **Design** test cases and test data.
3. **Export** the test cases as a qTest-ready Excel file.
4. **Automate** with Playwright + TypeScript scripts.
5. **Execute** the scripts and capture requests, responses and traces.
6. **Report** in HTML, with failures sorted by likely cause.

## What gets tested

Every endpoint is covered where the scenario applies:

- **Positive, functional:** valid requests, create/read/update/delete flows, filters and paging.
- **Positive, data validation:** types, formats, required fields, headers and response time, checked against schemas.
- **Negative:** missing fields, wrong types, bad IDs and malformed input return the right 4xx error, never a 5xx.
- **Boundary:** minimum and maximum lengths and values, page limits, special characters.
- **Authentication:** no token, invalid token, expired token and wrong role are rejected correctly.

Every test asserts the status code, headers, response schema, key values and response time. No test only checks for a 200.

## Project structure

```
.
├── .claude/
│   ├── commands/      # api-test.md: the single entry command
│   ├── agents/        # api-analyst, test-designer, qtest-exporter,
│   │                  # script-writer, test-runner, report-builder
│   ├── skills/        # test design rules, coding standards, qTest format, reporting
│   └── settings.json  # permissions for the agent
├── api/
│   └── <api-name>/    # created automatically for each API
│       ├── spec/        # discovered spec and endpoint summary
│       ├── test-data/   # valid, invalid, boundary and auth data
│       ├── test-cases/  # testcases.json and the qTest Excel file
│       ├── tests/       # generated Playwright specs
│       ├── schemas/     # response schemas
│       └── reports/     # HTML reports, triage and run log
├── shared/            # reusable fixtures and helpers
├── scripts/           # Excel builder, summary report, orchestration
├── .env.example       # variable names only
└── playwright.config.ts
```

## Getting started

**Requirements:** Node.js and Claude Code.

```bash
git clone <your-repo-url>
cd <your-repo-folder>
npm install
cp .env.example .env
```

Then open the folder in Claude Code and run the command:

```
/api-test https://jsonplaceholder.typicode.com
```

Optionally name the output folder yourself:

```
/api-test https://jsonplaceholder.typicode.com --name jsonplaceholder
```

## Output

After a run, look in `api/<api-name>/`:

| File | What it is |
|---|---|
| `test-cases/<api-name>_qtest_import.xlsx` | Test cases to import into qTest (Test Design, then Import from Excel) |
| `tests/*.spec.ts` | The Playwright tests |
| `reports/html/index.html` | Playwright HTML report with traces |
| `reports/summary.html` | One-page summary by category and endpoint, with failure details |

Each Playwright test title starts with the same ID as its qTest test case (the `Automation ID` column), so manual and automated results map back to each other.

## Safety and credentials

- **Approved hosts only.** The agent calls only hosts listed in `ALLOWED_HOSTS` in your `.env`. Anything else stops with a clear message.
- **Secrets stay in `.env`.** Keys, usernames, passwords and tokens are read from environment variables, for example `<API>_API_KEY`, `<API>_USERNAME`, `<API>_PASSWORD`, `<API>_ADMIN_TOKEN`. The file is git-ignored. `.env.example` lists names only.
- **Never exposed.** Secret values must not appear in logs, reports, test cases or test data.
- **Missing credentials.** Tests that need them are skipped with a reason, never silently passed.
- **No client data yet.** Use practice APIs such as JSONPlaceholder, Restful-Booker, PetStore or ReqRes.
- **Honest failures.** Failing tests are reported with evidence. The agent only fixes script errors, never loosens an assertion to make a test pass.

> Secrets handling is still being built. Confirm the data and credential policy before using the agent on any client API.

## Tools used

Claude Code, Playwright, TypeScript, Zod (schema checks), ExcelJS (Excel export), Faker (test data), dotenv (secrets), and qTest as the test management tool.

## Roadmap

- Live demo on a sample API
- Validate on more practice APIs
- Finish secrets handling
- Measure time saved in a pilot
- Share with other teams

## Contributing

Issues and pull requests are welcome. Please do not commit `.env` files or any real credentials.
