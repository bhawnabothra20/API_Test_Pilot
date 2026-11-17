/**
 * Stage 5 - qTest export.
 * testcases.json -> api/<name>/test-cases/<name>_qtest_import.xlsx
 *
 * Layout (qTest Manager > Test Design > Import from Excel):
 *  - sheet "Test Cases": ONE header row, one row per test step. Case-level fields are filled on the first
 *    step row of each case and left blank on following step rows. No merged cells, no blank rows.
 *  - sheet "Import Notes": how to map each column in the qTest import wizard.
 * After writing, the file is re-opened and validated (see validateExcel).
 */
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { apiPaths, readJson } from '../shared/helpers/env';
import { OWASP_NAMES, type TestCaseFile, type TestDataFile } from '../shared/helpers/types';
import { describeData } from './design-test-cases';

export const COLUMNS = [
  'Module',
  'Test Case Name',
  'Description',
  'Precondition',
  'Priority',
  'Type',
  'Status',
  'Test Step Number',
  'Step Description',
  'Step Expected Result',
  'Automation ID',
  'Requirement/Endpoint',
  'Category',
  'Test Data',
] as const;

/** Case-level columns that must be filled on the first row of every case. */
const CASE_REQUIRED = ['Module', 'Test Case Name', 'Description', 'Precondition', 'Priority', 'Type', 'Status', 'Automation ID', 'Requirement/Endpoint', 'Category'];
/** Step-level columns that must be filled on every row. */
const STEP_REQUIRED = ['Test Step Number', 'Step Description', 'Step Expected Result'];

const MAX_CELL = 32_000;
const clip = (s: string) => (s.length > MAX_CELL ? `${s.slice(0, MAX_CELL - 20)}...[truncated]` : s);

function loadData(apiName: string): TestDataFile {
  const dir = apiPaths(apiName).testData;
  const merged: TestDataFile = {};
  for (const f of ['valid', 'invalid', 'boundary']) {
    const file = path.join(dir, `${f}.json`);
    if (fs.existsSync(file)) Object.assign(merged, readJson<TestDataFile>(file));
  }
  return merged;
}

export async function buildExcel(apiName: string): Promise<string> {
  const paths = apiPaths(apiName);
  const tc = readJson<TestCaseFile>(paths.testCasesJson);
  const data = loadData(apiName);
  const wb = new ExcelJS.Workbook();
  wb.creator = 'api-test-pilot';
  wb.created = new Date();

  const ws = wb.addWorksheet('Test Cases');
  ws.columns = COLUMNS.map((header) => ({
    header,
    key: header,
    width: header === 'Step Description' || header === 'Step Expected Result' || header === 'Test Data' ? 60 : header === 'Test Case Name' || header === 'Description' || header === 'Precondition' ? 45 : 18,
  }));
  ws.getRow(1).font = { bold: true };

  for (const c of tc.cases) {
    c.steps.forEach((step, i) => {
      const first = i === 0;
      ws.addRow({
        Module: first ? c.module : '',
        'Test Case Name': first ? c.title : '',
        Description: first
          ? clip(
              (c.owasp ? `[OWASP ${c.owasp} ${OWASP_NAMES[c.owasp]}] ` : '') +
                c.description +
                (c.assumption ? ` Assumption: ${c.assumption}` : ''),
            )
          : '',
        Precondition: first ? c.precondition : '',
        Priority: first ? c.priority : '',
        Type: first ? 'Automation' : '',
        Status: first ? 'New' : '',
        'Test Step Number': i + 1,
        'Step Description': clip(step.action),
        'Step Expected Result': clip(step.expected),
        'Automation ID': first ? c.id : '',
        'Requirement/Endpoint': first ? `${c.request.method} ${c.request.path}` : '',
        Category: first ? c.category : '',
        'Test Data': first
          ? clip(
              c.subCases?.length
                ? c.subCases.map((s, n) => `${n + 1}. ${describeData(data[s.request.dataKey ?? s.id])}`).join('\n')
                : describeData(data[c.request.dataKey ?? c.id]),
            )
          : '',
      });
    });
  }

  const notes = wb.addWorksheet('Import Notes');
  notes.columns = [
    { header: 'Excel column', key: 'col', width: 24 },
    { header: 'Map to qTest field', key: 'field', width: 34 },
    { header: 'Notes', key: 'notes', width: 100 },
  ];
  notes.getRow(1).font = { bold: true };
  const mapping: Array<[string, string, string]> = [
    ['Module', 'Module (or leave unmapped)', 'API/endpoint group, e.g. restful-booker/booking. qTest creates the folder from the SHEET NAME ("Test Cases"); rename the sheet to "MD-<n> <folder>" (max 31 chars) to import into an existing module, or map this column to a custom field.'],
    ['Test Case Name', 'Name', 'Unique per case. Rows where this cell is blank are additional steps of the case above.'],
    ['Description', 'Description', 'Includes any assumption the expected result relies on.'],
    ['Precondition', 'Precondition', ''],
    ['Priority', 'Priority', 'Values: High / Medium / Low - must exist in qTest Field Settings.'],
    ['Type', 'Type', 'Always "Automation" - must exist in qTest Field Settings (default values: Manual, Automation, Performance, Scenario).'],
    ['Status', 'Status', 'Always "New".'],
    ['Test Step Number', '(not mapped) or Step #', 'Order of steps; qTest orders steps by row order.'],
    ['Step Description', 'Test Step Description', 'One step per row.'],
    ['Step Expected Result', 'Test Step Expected Result', 'Status code, headers, schema and key field checks.'],
    ['Automation ID', 'Automation Content (or a custom "Automation ID" field)', 'Equals the [TC_ID] prefix of the Playwright test title - links manual and automated results.'],
    ['Requirement/Endpoint', 'custom field "Endpoint" (create it first)', 'HTTP method + path template.'],
    ['Category', 'custom field "Category" (create it first)', 'Positive-Functional, Positive-DataValidation, Negative, Boundary, Auth, Authorization (OWASP API Top 10: mass assignment, data exposure, token hygiene - the OWASP id is in the Description).'],
    ['Test Data', 'custom field "Test Data" (create it first) or append to Description', 'Request data summary; long values abbreviated. Full data lives in api/<name>/test-data/*.json.'],
    ['How to import', '', 'qTest Manager > Test Design > select project > Import Excel icon > upload this file > map fields as above (do NOT map a Test Case Id - qTest generates it) > Import.'],
    ['Reference', '', 'Tricentis docs: "Import or Modify Test Cases Using Microsoft Excel" (qTest Manager). Column names need not match qTest field names; mapping is done in the wizard. Values must match configured field values.'],
    ['Generated', '', `${new Date().toISOString()} from api/${apiName}/test-cases/testcases.json (${tc.cases.length} cases).`],
  ];
  mapping.forEach(([col, field, n]) => notes.addRow({ col, field, notes: n }));
  fs.mkdirSync(paths.testCases, { recursive: true });
  await wb.xlsx.writeFile(paths.excel);
  return paths.excel;
}

export interface ExcelValidation {
  ok: boolean;
  errors: string[];
  cases: number;
  rows: number;
}

/** Re-opens the workbook and checks it is importable and consistent with testcases.json. */
export async function validateExcel(apiName: string): Promise<ExcelValidation> {
  const paths = apiPaths(apiName);
  const tc = readJson<TestCaseFile>(paths.testCasesJson);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(paths.excel);
  const ws = wb.getWorksheet('Test Cases');
  const errors: string[] = [];
  if (!ws) return { ok: false, errors: ['sheet "Test Cases" missing'], cases: 0, rows: 0 };

  const header = (ws.getRow(1).values as unknown[]).slice(1).map((v) => String(v ?? ''));
  if (header.join('|') !== COLUMNS.join('|')) errors.push(`header mismatch: ${header.join(', ')}`);
  const col = (name: string) => COLUMNS.indexOf(name as (typeof COLUMNS)[number]) + 1;
  const names = new Set<string>();
  const ids = new Set<string>();
  let caseRows = 0;
  let dataRows = 0;
  const merges = (ws.model as { merges?: string[] }).merges ?? [];
  if (merges.length) errors.push(`merged cells found: ${merges.join(', ')}`);

  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const cell = (n: string) => String(row.getCell(col(n)).value ?? '').trim();
    const allEmpty = COLUMNS.every((c) => cell(c) === '');
    if (allEmpty) {
      errors.push(`row ${r} is blank`);
      continue;
    }
    dataRows++;
    for (const c of STEP_REQUIRED) if (!cell(c)) errors.push(`row ${r}: "${c}" empty`);
    if (cell('Test Case Name')) {
      caseRows++;
      for (const c of CASE_REQUIRED) if (!cell(c)) errors.push(`row ${r}: "${c}" empty`);
      if (names.has(cell('Test Case Name'))) errors.push(`row ${r}: duplicate test case name "${cell('Test Case Name')}"`);
      names.add(cell('Test Case Name'));
      if (ids.has(cell('Automation ID'))) errors.push(`row ${r}: duplicate Automation ID ${cell('Automation ID')}`);
      ids.add(cell('Automation ID'));
      if (cell('Test Step Number') !== '1') errors.push(`row ${r}: first step of a case must be step 1`);
    } else if (r === 2) {
      errors.push('row 2 must start a test case');
    }
  }
  const expectedRows = tc.cases.reduce((n, c) => n + c.steps.length, 0);
  if (caseRows !== tc.cases.length) errors.push(`case count ${caseRows} != testcases.json ${tc.cases.length}`);
  if (dataRows !== expectedRows) errors.push(`step row count ${dataRows} != expected ${expectedRows}`);
  for (const c of tc.cases) if (!ids.has(c.id)) errors.push(`${c.id} missing from Excel`);
  return { ok: errors.length === 0, errors: errors.slice(0, 50), cases: caseRows, rows: dataRows };
}

/** Every Excel Automation ID must appear in a spec title and vice versa. */
export function validateTraceability(apiName: string): { ok: boolean; missingInSpecs: string[]; missingInExcel: string[] } {
  const paths = apiPaths(apiName);
  const tc = readJson<TestCaseFile>(paths.testCasesJson);
  const specIds = new Set<string>();
  if (fs.existsSync(paths.tests)) {
    for (const f of fs.readdirSync(paths.tests).filter((x) => x.endsWith('.spec.ts'))) {
      const src = fs.readFileSync(path.join(paths.tests, f), 'utf8');
      for (const m of src.matchAll(/test\(\s*'\[(TC_[A-Z0-9_]+)\]/g)) specIds.add(m[1]);
    }
  }
  const caseIds = new Set(tc.cases.map((c) => c.id));
  const missingInSpecs = [...caseIds].filter((id) => !specIds.has(id));
  const missingInExcel = [...specIds].filter((id) => !caseIds.has(id));
  return { ok: missingInSpecs.length === 0 && missingInExcel.length === 0, missingInSpecs, missingInExcel };
}

if (require.main === module) {
  const name = process.argv[2];
  if (!name) {
    console.error('usage: tsx scripts/build-qtest-excel.ts <api-name> [--validate-only]');
    process.exit(2);
  }
  (async () => {
    if (!process.argv.includes('--validate-only')) await buildExcel(name);
    const v = await validateExcel(name);
    console.log(`excel ${v.ok ? 'OK' : 'INVALID'}: ${v.cases} cases, ${v.rows} step rows -> ${apiPaths(name).excel}`);
    v.errors.forEach((e) => console.log(`  - ${e}`));
    const t = validateTraceability(name);
    if (fs.existsSync(apiPaths(name).tests)) {
      console.log(`traceability ${t.ok ? 'OK' : 'MISMATCH'} (missing in specs: ${t.missingInSpecs.length}, missing in excel: ${t.missingInExcel.length})`);
    }
    process.exit(v.ok ? 0 : 1);
  })().catch((e: unknown) => {
    console.error(e);
    process.exit(1);
  });
}
