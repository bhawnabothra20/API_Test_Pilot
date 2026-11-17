---
name: test-case-design
description: The test-case model (testcases.json + test-data files) - IDs, categories, priorities, flows, variants, steps, credentials, assumptions - and the rules that make every case traceable to qTest and to a Playwright test.
---

# Test case design

## Level: business cases (DEFAULT - the user's standing choice)
The user wants business-level test cases only, no unnecessary ones. `scripts/consolidate-cases.ts`
(level `business`) keeps only the checks allowed by `businessKeep` in `scripts/design/business.ts` and groups
them per **resource** into business scenarios (`businessScenario`):

| Scenario | Example title | Checks it runs |
|---|---|---|
| browse | "Browse bookings and filter them by their attributes" | list, filters, schema |
| view | "View a booking by its id; an unknown booking is not found" | get by id, schema, 404 |
| create / create-invalid / duplicate | "Create a booking with valid details; the saved values match what was sent" / "Creating a booking with missing or invalid details is rejected" | valid + required-only create, exact storage; missing/empty required, wrong types, invalid enum/format, documented min/max +/-1 |
| update / update-invalid | "Update an existing booking (full and partial update)" | PUT/PATCH; invalid values, unknown id |
| delete | "Delete a booking; deleting a booking that does not exist is rejected" | delete, unknown id |
| lifecycle | "Manage a booking end to end: create, view, update and delete it; it is gone afterwards" | CRUD flow |
| op:<endpoint> | the endpoint's documented summary, e.g. "Finds Pets by status" | non-CRUD operations |
| access | "Only authorised users can use bookings; privileged fields cannot be set by the client; responses expose no sensitive data" | no/invalid token, valid admin, public access, mass assignment, data exposure |
| login | "Log in with valid credentials; wrong or missing credentials are rejected without a token" | login checks |

Left out at this level: idempotency repeats, separate Content-Type/response-time checks, null/{}/no-body/
malformed/text-plain bodies, malformed ids, unsupported methods, injection strings, unknown query params,
undocumented limits, exotic boundaries (decimal, huge, 10,000 chars, unicode, whitespace, dates, arrays, ids),
expired/malformed/wrong-scheme tokens, token-hygiene tricks. A new generator check must be classified in
`businessKeep` and mapped in `businessScenario` - never surfaced as an extra technical test case.

## Level: high-level cases (`--level high`, full technical coverage on request)
`scripts/design-test-cases.ts` first designs every detailed check (through the category plugins in `scripts/design/generators/`); `scripts/consolidate-cases.ts` then
groups them into **one high-level test case per endpoint + scenario** - coverage is unchanged, every
detailed check becomes a step (`subCases`). Scenarios:

| Category | High-level scenarios per endpoint |
|---|---|
| Positive-Functional | happy path; optional fields omitted; idempotency; query filters; CRUD lifecycle (per resource) |
| Positive-DataValidation | response contract: schema of every field, formats/enums/ranges, Content-Type, response time, exact echo |
| Negative | unknown/malformed ids; unsupported method; missing/null/empty required fields; empty/malformed/wrongly typed bodies; wrong types/enums/formats; injection input; duplicates; invalid/unknown query params |
| Boundary | id edges; query/pagination edges; string boundaries; numeric boundaries; date boundaries; array sizes |
| Auth | valid admin credentials; rejected credentials (none/invalid/expired/malformed/wrong scheme); public access; login valid; login rejections |

Example: `TC_RESTFUL_BOOKER_BOOKING_POST_005` "POST /booking rejects missing, null and empty required
fields" with 14 checks. In the spec each check is a `test.step` run through `check(failures, ...)`; all
checks run, and the test fails listing every failed check. A check needing a credential that is missing
is skipped individually (`skipCheck`) with a reason annotation. Use `--level detailed` to get one test
case per check instead.

Implemented by `scripts/design-test-cases.ts` (orchestrator), one plugin per category in `scripts/design/generators/` (shared helpers: `scripts/design/context.ts`, `values.ts`; contract: `plugin.ts`) and `scripts/consolidate-cases.ts`. Types: `TestCase`, `TestCaseFile`, `TestDataEntry` in
`shared/helpers/types.ts`. Category-specific rules live in the five category skills
(`positive-functional-tests`, `data-validation-tests`, `negative-tests`, `boundary-tests`, `auth-tests`).

## Identity and naming
- ID: `TC_<API>_<ENDPOINT>_<NNN>` - `<API>` = api name upper snake, `<ENDPOINT>` = endpoint id upper
  (`BOOKING_ID_PUT`), `<NNN>` = running number per endpoint. Example `TC_RESTFUL_BOOKER_BOOKING_ID_PUT_027`.
- The ID is the qTest **Automation ID** and the prefix of the Playwright title `[ID] title`.
- Titles are unique, readable and state the expectation: `PUT /booking/{id} with wrong type for
  "firstname" (number instead of string) is rejected with 400/422`.
- `module` = `<api-name>/<group>`.

## Fields that drive generation
| Field | Meaning |
|---|---|
| `category` | Positive-Functional, Positive-DataValidation, Negative, Boundary, Auth |
| `variant` | code template: positive, negative, tolerant, auth-reject, login-valid, login-reject, filter-all, filter-contains, idempotent-read/put/delete, lifecycle, duplicate |
| `request.identity` | default, admin, user, none, invalid, expired, malformed, wrongScheme |
| `request.idSource` | none, existing (first id of the collection), created (fresh resource, deleted after), literal (from test data) |
| `request.dataFile/dataKey` | entry in `test-data/<file>.json`, key = case id |
| `expected.status` | allowed status codes (list) |
| `expected.schema` | zod export in `schemas/<group>.schema.ts` |
| `expected.echo` / `fields` / `nonEmptyArray` | business checks |
| `expected.errorBody` | `json` (documented error schema) or `safe` (leak-free) |
| `requiresCredentials` | none / admin / user - spec skips with a reason when missing |
| `assumptionBased` + `assumption` | expectation not documented - shown in Excel and reports |

## Priorities
Positive-Functional and Auth = High; Data validation and Negative = Medium; Boundary = Low
(schema validation and CRUD lifecycle forced High).

## Steps (for qTest)
Concrete and executable by a human: precondition step (how the id is obtained/created), the request
(method, full URL, identity, headers, Content-Type, body summary), then one step per assertion group:
Content-Type, schema, error body, echo/business fields, collection size. Each step has an expected result
naming status codes, the schema or the field rule.

## Test data
- `valid.json` positive data, `invalid.json` negative/auth data, `boundary.json` boundary data,
  `auth-identities.json` describes where each identity comes from (env var **names** only).
- Faker with a fixed seed -> reproducible data; emails at `example.com`.
- Secrets never appear: login bodies use `${env:USERNAME}` / `${env:PASSWORD}` placeholders that are
  resolved at runtime by `shared/helpers/test-data.ts`.

## Not applicable
When a category cannot apply (e.g. no auth, no pagination, no uniqueness rule), add a sentence to
`notApplicable` instead of silently skipping it.
