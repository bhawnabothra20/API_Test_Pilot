/**
 * Stage "preflight" (before run) - says exactly what will NOT be tested and why, before spending requests:
 *  - the admin identity: needed by how many checks? configured? via which .env variable NAMES? does the
 *    login actually return a token?
 *  - the API's rate-limit quota (one GET to a public endpoint), e.g. an exhausted anonymous quota
 *  - how many checks can execute vs. will be skipped
 * Output: api/<name>/reports/preflight.json (no secret values - names only). Never blocks the run.
 */
import { request } from '@playwright/test';
import { CREDENTIAL_KINDS, credentialSource, obtainToken } from '../shared/fixtures/auth';
import { apiEnv, apiPaths, readJson, writeJson } from '../shared/helpers/env';
import { assertUrlAllowed } from '../shared/helpers/safety-guard';
import type { CredentialKind, EndpointSummary, TestCase, TestCaseFile } from '../shared/helpers/types';

export interface CredentialCheck {
  kind: CredentialKind;
  /** leaf checks that need this identity */
  neededBy: number;
  configured: boolean;
  /** .env variable names that provide it (never values) */
  via?: string;
  /** login attempted: ok | failed; a static token or key cannot be checked offline */
  verified: 'ok' | 'failed' | 'not-checked';
  /** what to set in .env when missing or failing */
  action?: string;
}

export interface PreflightReport {
  apiName: string;
  generatedAt: string;
  authType: string;
  totalChecks: number;
  /** checks whose identities are all available */
  runnableChecks: number;
  credentials: CredentialCheck[];
  quota: { status: 'ok' | 'exhausted' | 'unknown'; detail: string };
  /** one line per problem, ready to print */
  warnings: string[];
}

const leaves = (cases: TestCase[]): TestCase[] => cases.flatMap((c) => c.subCases ?? [c]);
const needs = (tc: TestCase): CredentialKind[] =>
  [tc.requiresCredentials].filter((k): k is CredentialKind => k !== 'none');

export async function preflight(apiName: string): Promise<PreflightReport> {
  const paths = apiPaths(apiName);
  const summary = readJson<EndpointSummary>(paths.summary);
  const checks = leaves(readJson<TestCaseFile>(paths.testCasesJson).cases);
  const baseUrl = (process.env[`${summary.envPrefix}_BASE_URL`] || summary.baseUrl).replace(/\/+$/, '');
  assertUrlAllowed(baseUrl);

  const ctx = await request.newContext();
  const credentials: CredentialCheck[] = [];
  const available = new Set<CredentialKind>();
  let quota: PreflightReport['quota'] = { status: 'unknown', detail: 'No public GET endpoint without parameters to probe.' };
  try {
    for (const kind of CREDENTIAL_KINDS) {
      const neededBy = checks.filter((c) => needs(c).includes(kind)).length;
      const src = credentialSource(summary, kind);
      const c: CredentialCheck = { kind, neededBy, configured: src.configured, via: src.via, verified: 'not-checked' };
      if (src.configured) {
        // a static token/key is used as-is; a login is attempted so a wrong password shows up now
        const dynamic = !!src.via && !/_(ADMIN_TOKEN|API_KEY)$/.test(src.via);
        if (dynamic) {
          const t = await obtainToken(ctx, summary, baseUrl, kind).catch(() => undefined);
          c.verified = t ? 'ok' : 'failed';
          if (!t) c.action = `${src.via} is configured but did not return a token - check the values in .env.`;
        }
        if (c.verified !== 'failed') available.add(kind);
      } else if (neededBy) {
        c.action = src.missing;
      }
      credentials.push(c);
    }
    quota = await probeQuota(ctx, summary, baseUrl);
  } finally {
    await ctx.dispose();
  }

  const runnableChecks = checks.filter((c) => needs(c).every((k) => available.has(k))).length;
  const warnings: string[] = [];
  for (const c of credentials.filter((x) => x.neededBy && x.action)) {
    warnings.push(`${c.kind}: ${c.configured ? 'login FAILED' : 'MISSING'} - ${c.neededBy} checks will be skipped. ${c.action}`);
  }
  if (quota.status === 'exhausted') warnings.push(`Quota exhausted - most checks will be skipped until it resets. ${quota.detail}`);
  const report: PreflightReport = {
    apiName,
    generatedAt: new Date().toISOString(),
    authType: summary.auth.type,
    totalChecks: checks.length,
    runnableChecks: quota.status === 'exhausted' ? 0 : runnableChecks,
    credentials,
    quota,
    warnings,
  };
  writeJson(`${paths.reports}/preflight.json`, report);
  return report;
}

/** One GET to the first public, parameter-free GET endpoint; reads 429 / rate-limit headers. */
async function probeQuota(ctx: Awaited<ReturnType<typeof request.newContext>>, summary: EndpointSummary, baseUrl: string): Promise<PreflightReport['quota']> {
  const e = summary.endpoints.find((x) => x.method === 'GET' && !x.path.includes('{') && !x.queryParams.some((q) => q.required));
  if (!e) return { status: 'unknown', detail: 'No public GET endpoint without parameters to probe.' };
  const headers: Record<string, string> = { Accept: 'application/json' };
  const key = summary.auth.type === 'apiKey' ? (apiEnv(summary.apiName, 'API_KEY') ?? apiEnv(summary.apiName, 'ADMIN_TOKEN')) : undefined;
  if (key && summary.auth.headerName) headers[summary.auth.headerName] = key;
  const url = `${baseUrl}${e.path}`;
  assertUrlAllowed(url);
  const res = await ctx.get(url, { headers, failOnStatusCode: false }).catch(() => undefined);
  if (!res) return { status: 'unknown', detail: `GET ${e.path} could not be sent (network).` };
  const h = res.headers();
  const remaining = h['x-ratelimit-remaining'] ?? h['ratelimit-remaining'];
  const limit = h['x-ratelimit-limit'] ?? h['ratelimit-limit'];
  const reset = h['x-ratelimit-reset'] ?? h['ratelimit-reset'];
  const resetText = reset && /^\d+$/.test(reset) ? (Number(reset) > 1e9 ? ` Resets ${new Date(Number(reset) * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC.` : ` Resets in ${reset} s.`) : '';
  const keyHint = summary.auth.type === 'apiKey' && !key ? ` Set ${summary.envPrefix}_API_KEY in .env for the keyed quota.` : '';
  if (res.status() === 429 || remaining === '0') {
    return { status: 'exhausted', detail: `GET ${e.path} -> ${res.status()}${limit ? ` (limit ${limit})` : ''}.${resetText}${keyHint}` };
  }
  return { status: 'ok', detail: `GET ${e.path} -> ${res.status()}${remaining ? `, ${remaining}${limit ? `/${limit}` : ''} requests left` : ''}.` };
}
