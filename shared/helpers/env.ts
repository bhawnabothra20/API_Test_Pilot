import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

/** Absolute project root (folder holding package.json). */
export const PROJECT_ROOT = path.resolve(__dirname, '..', '..');

let loaded = false;

/** Loads .env once. Values stay in process.env and are never printed. */
export function loadEnv(): void {
  if (loaded) return;
  const envFile = path.join(PROJECT_ROOT, '.env');
  if (fs.existsSync(envFile)) dotenv.config({ path: envFile, quiet: true });
  loaded = true;
}

/** "restful-booker" -> "RESTFUL_BOOKER" */
export function envPrefix(apiName: string): string {
  return apiName.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

const credentialPrefixCache = new Map<string, string>();

/**
 * Prefix under which this API's credentials live: endpoint-summary.json `envPrefix`. Discovery sets it to
 * the HOST-level prefix for a run scoped to one endpoint (api "restful-booker-booking" -> RESTFUL_BOOKER),
 * so a scoped run uses the same .env credentials as the full API.
 */
export function credentialPrefix(apiName: string): string {
  const cached = credentialPrefixCache.get(apiName);
  if (cached) return cached;
  let prefix = envPrefix(apiName);
  try {
    const file = apiPaths(apiName).summary;
    if (fs.existsSync(file)) prefix = readJson<{ envPrefix?: string }>(file).envPrefix || prefix;
  } catch {
    // unreadable summary: own prefix
  }
  credentialPrefixCache.set(apiName, prefix);
  return prefix;
}

/** Reads <API_NAME>_<suffix> (own prefix first, then credentialPrefix); undefined when unset or empty. */
export function apiEnv(apiName: string, suffix: string): string | undefined {
  loadEnv();
  for (const p of [...new Set([envPrefix(apiName), credentialPrefix(apiName)])]) {
    const value = process.env[`${p}_${suffix}`];
    if (value && value.trim() !== '') return value.trim();
  }
  return undefined;
}

export function numberEnv(name: string, fallback: number): number {
  loadEnv();
  const raw = process.env[name];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

/** Folder holding one sub-folder per API. API_TEST_API_DIR is for unit tests only (isolated fixtures). */
export function apiRoot(): string {
  return process.env.API_TEST_API_DIR || path.join(PROJECT_ROOT, 'api');
}

/** Folder layout for one API. */
export function apiPaths(apiName: string) {
  const root = path.join(apiRoot(), apiName);
  return {
    root,
    spec: path.join(root, 'spec'),
    summary: path.join(root, 'spec', 'endpoint-summary.json'),
    testData: path.join(root, 'test-data'),
    testCases: path.join(root, 'test-cases'),
    testCasesJson: path.join(root, 'test-cases', 'testcases.json'),
    excel: path.join(root, 'test-cases', `${apiName}_qtest_import.xlsx`),
    tests: path.join(root, 'tests'),
    schemas: path.join(root, 'schemas'),
    reports: path.join(root, 'reports'),
    htmlReport: path.join(root, 'reports', 'html'),
    resultsJson: path.join(root, 'reports', 'results.json'),
    summaryHtml: path.join(root, 'reports', 'summary.html'),
    triage: path.join(root, 'reports', 'triage.json'),
    runLog: path.join(root, 'reports', 'run-log.txt'),
  };
}

export function readJson<T>(file: string): T {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
}

export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

/** Names of environment variables that hold secrets - used for redaction. */
export function secretValues(): string[] {
  loadEnv();
  return Object.entries(process.env)
    .filter(([k, v]) => /(_PASSWORD|_TOKEN|_API_KEY|_SECRET|_CLIENT_SECRET)$/.test(k) && typeof v === 'string' && v.length >= 4)
    .map(([, v]) => v as string);
}

/** Replaces every known secret value (and token-ish headers) with ***. */
export function redact(text: string): string {
  let out = text;
  for (const secret of secretValues()) out = out.split(secret).join('***');
  // runtime tokens (__API_TOKEN_ADMIN) and any extra values registered for this process
  const runtime = Object.entries(process.env)
    .filter(([k, v]) => k.startsWith('__API_TOKEN_') && !k.endsWith('_EXP') && typeof v === 'string')
    .map(([, v]) => v as string);
  for (const token of [...runtime, ...extraSecrets]) {
    if (token && token.length >= 4) out = out.split(token).join('***');
  }
  return out;
}

const extraSecrets = new Set<string>();

/** Registers a derived secret (e.g. a tampered copy of a real token) so it is redacted everywhere. */
export function registerSecret(value: string): void {
  if (value.length >= 8) extraSecrets.add(value);
}
