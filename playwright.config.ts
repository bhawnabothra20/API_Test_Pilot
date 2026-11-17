import path from 'node:path';
import { defineConfig } from '@playwright/test';
import { apiPaths, loadEnv, numberEnv } from './shared/helpers/env';

loadEnv();

/** One API per run: API_NAME selects api/<name>/tests and api/<name>/reports. */
const apiName = process.env.API_NAME ?? 'jsonplaceholder';
const paths = apiPaths(apiName);
/** set by `api-test --ci`: compact progress output instead of one line per test */
const ci = process.env.API_TEST_CI === '1';

export default defineConfig({
  testDir: paths.tests,
  testMatch: '**/*.spec.ts',
  globalSetup: path.join(__dirname, 'shared', 'global-setup.ts'),
  timeout: 45_000,
  expect: { timeout: 10_000 },
  retries: numberEnv('PW_RETRIES', 1),
  workers: numberEnv('PW_WORKERS', 4),
  fullyParallel: false,
  forbidOnly: true,
  outputDir: path.join(__dirname, 'test-results', apiName),
  // junit.xml is written after triage by scripts/junit.ts, so failures carry their root cause
  reporter: [
    [ci ? 'dot' : 'list'],
    ['html', { outputFolder: paths.htmlReport, open: 'never' }],
    ['json', { outputFile: paths.resultsJson }],
  ],
  use: {
    extraHTTPHeaders: { 'User-Agent': 'api-test-pilot/1.0 (practice-api-testing)' },
    // traces record raw request headers (tokens, cookies, keys); evidence comes from the redacted
    // exchange attachments instead, so traces stay off
    trace: 'off',
    ignoreHTTPSErrors: false,
  },
});
