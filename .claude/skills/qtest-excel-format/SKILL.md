---
name: qtest-excel-format
description: The qTest Manager Excel import format used by this project - sheet layout, the 14 columns, one-row-per-step rules, field values, the Import Notes mapping sheet, and the validation the file must pass.
---

# qTest Excel import format

Implemented by `scripts/build-qtest-excel.ts` (`buildExcel`, `validateExcel`, `validateTraceability`)
with `exceljs`. Output: `api/<api-name>/test-cases/<api-name>_qtest_import.xlsx`.

## Basis (Tricentis docs, "Import or Modify Test Cases Using Microsoft Excel")
- Import path: Test Design -> project -> **Import Excel** icon -> upload -> map columns -> Import.
- Test cases and their steps are individual rows; column names need not match qTest field names - the
  wizard maps them. Do not map a Test Case Id for new cases (qTest generates it).
- Field values (Type, Status, Priority) must already exist in qTest Field Settings; extra columns need a
  custom field first.
- The sheet name becomes the target folder (max 31 chars); `MD-<n> <folder>` imports into an existing
  module.

## Sheet `Test Cases`
Row 1 is the only header row - exactly these columns, in this order:

`Module | Test Case Name | Description | Precondition | Priority | Type | Status | Test Step Number |
Step Description | Step Expected Result | Automation ID | Requirement/Endpoint | Category | Test Data`

- Business cases (default) and high-level cases (`--level high`): one test case per business scenario
  (resp. endpoint + scenario); each of its detailed checks is one step row ("<check title>: Send <method> <url> ..." / expected status, schema, error-body rule).
- One row per test step. Case-level columns (Module ... Status, Automation ID, Requirement/Endpoint,
  Category, Test Data) are filled on the **first** step row of the case and blank on following step rows.
- No merged cells, no blank rows, no formulas; plain values only (bold header and column widths are fine).
- `Type` = `Automation`, `Status` = `New`, `Priority` = `High | Medium | Low`.
- `Module` = `<api-name>/<group>`; `Requirement/Endpoint` = `METHOD /path/{param}`.
- `Automation ID` = the case id = the `[ID]` prefix of the Playwright test title.
- `Test Data` = compact JSON of the request data (long strings abbreviated, e.g. `<10000 chars: "aaaa...">`).
- Cells are clipped below Excel's 32,767-character limit.

## Sheet `Import Notes`
Column -> qTest field mapping with notes (e.g. Step Description -> Test Step Description,
Automation ID -> Automation Content or a custom field), how to import, and the generation timestamp.

## Validation (must pass, file is re-opened)
1. sheet and header exact; 2. no merges, no blank rows; 3. every row has step number, description and
expected result; 4. every case row has all case-level required cells; 5. names and Automation IDs unique;
6. first step number is 1; 7. case count and step-row count equal `testcases.json`;
8. traceability: every Automation ID exists in a spec title and every spec test exists in the file.
