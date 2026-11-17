import { request, type FullConfig } from '@playwright/test';
import { CREDENTIAL_KINDS, obtainToken, storeToken } from './fixtures/auth';
import { apiPaths, loadEnv, readJson } from './helpers/env';
import { assertUrlAllowed } from './helpers/safety-guard';
import type { EndpointSummary } from './helpers/types';

/**
 * Runs once before all tests:
 *  - verifies the base URL is allowlisted
 *  - obtains the admin token from .env - a direct token/key, Basic credentials or the documented login
 *    endpoint (no OAuth flows)
 *  - exposes them to workers through process.env (__API_TOKEN_*), never on disk or in logs
 */
export default async function globalSetup(_config: FullConfig): Promise<void> {
  loadEnv();
  const apiName = process.env.API_NAME;
  if (!apiName) throw new Error('API_NAME is not set');
  const summary = readJson<EndpointSummary>(apiPaths(apiName).summary);
  const baseUrl = (process.env.BASE_URL || summary.baseUrl).replace(/\/+$/, '');
  assertUrlAllowed(baseUrl);

  const ctx = await request.newContext();
  const status: string[] = [];
  try {
    for (const kind of CREDENTIAL_KINDS) {
      const t = await obtainToken(ctx, summary, baseUrl, kind).catch(() => undefined);
      if (t) storeToken(kind, t);
      status.push(`${kind}=${t ? 'available' : 'not configured'}`);
    }
    console.log(`[global-setup] ${apiName}: auth=${summary.auth.type} ${status.join(' ')}`);
  } finally {
    await ctx.dispose();
  }
}
