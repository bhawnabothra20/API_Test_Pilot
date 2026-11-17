/**
 * Background pipeline jobs for the MCP server. A job is a detached `scripts/api-test.ts` process; its
 * record (mcp/jobs/<jobId>.json), progress (<jobId>.status.json, written by the orchestrator) and output
 * (<jobId>.log, redacted on read) live on disk, so status survives server restarts and works across
 * stateless stdio/HTTP sessions.
 */
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PROJECT_ROOT, readJson, redact } from '../shared/helpers/env';
import { STAGES, type RunStatus } from '../scripts/stages';

export const JOBS_DIR = path.join(PROJECT_ROOT, 'mcp', 'jobs');
const TSX_CLI = path.join(PROJECT_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const API_DIR = path.join(PROJECT_ROOT, 'api');

export interface JobRecord {
  jobId: string;
  kind: 'run' | 'rerun';
  name: string;
  url: string;
  args: string[];
  pid: number;
  startedAt: string;
}

export class UserError extends Error {}

/** API names are folder names under api/: lowercase slug, no traversal. */
export function safeApiName(name: string): string {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(name)) throw new UserError(`Invalid API name "${name}": use lowercase letters, digits and "-" only.`);
  const dir = path.resolve(API_DIR, name);
  if (path.dirname(dir) !== API_DIR) throw new UserError('Invalid API name (path traversal).');
  return name;
}

export function apiExists(name: string): boolean {
  return fs.existsSync(path.join(API_DIR, safeApiName(name), 'spec', 'endpoint-summary.json'));
}

function jobFiles(jobId: string) {
  if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new UserError(`Invalid jobId "${jobId}".`);
  return {
    record: path.join(JOBS_DIR, `${jobId}.json`),
    status: path.join(JOBS_DIR, `${jobId}.status.json`),
    log: path.join(JOBS_DIR, `${jobId}.log`),
  };
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readStatus(file: string): RunStatus | undefined {
  try {
    return fs.existsSync(file) ? readJson<RunStatus>(file) : undefined;
  } catch {
    return undefined; // being written right now
  }
}

export function listJobs(): JobRecord[] {
  if (!fs.existsSync(JOBS_DIR)) return [];
  return fs
    .readdirSync(JOBS_DIR)
    .filter((f) => /^[a-f0-9-]{36}\.json$/.test(f))
    .map((f) => readJson<JobRecord>(path.join(JOBS_DIR, f)));
}

export function isJobRunning(job: JobRecord): boolean {
  const st = readStatus(jobFiles(job.jobId).status);
  if (st && st.state !== 'running') return false;
  return pidAlive(job.pid);
}

/** Starts the orchestrator detached. One concurrent run per API name. */
export function startJob(kind: JobRecord['kind'], name: string, url: string, cliArgs: string[]): JobRecord {
  safeApiName(name);
  const busy = listJobs().find((j) => j.name === name && isJobRunning(j));
  if (busy) throw new UserError(`A run for "${name}" is already in progress (jobId ${busy.jobId}). Wait for it or poll get_run_status.`);
  if (!fs.existsSync(TSX_CLI)) throw new UserError('tsx is not installed - run "npm install" in the project first.');
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  const jobId = crypto.randomUUID();
  const files = jobFiles(jobId);
  const args = [url, '--name', name, ...cliArgs];
  const out = fs.openSync(files.log, 'a');
  // argv array, no shell: user input is never interpreted by a shell
  const child = spawn(process.execPath, [TSX_CLI, path.join('scripts', 'api-test.ts'), ...args], {
    cwd: PROJECT_ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, out],
    env: { ...process.env, API_TEST_STATUS_FILE: files.status, FORCE_COLOR: '0' },
  });
  child.unref();
  fs.closeSync(out);
  const record: JobRecord = { jobId, kind, name, url, args, pid: child.pid ?? -1, startedAt: new Date().toISOString() };
  fs.writeFileSync(files.record, JSON.stringify(record, null, 2), 'utf8');
  return record;
}

export interface JobStatusView {
  jobId: string;
  kind: JobRecord['kind'];
  name: string;
  state: 'running' | 'done' | 'failed' | 'unknown';
  stage?: string;
  progress: string;
  percent: number;
  startedAt: string;
  updatedAt?: string;
  exitCode?: number;
  message?: string;
  totals?: RunStatus['totals'];
  logTail: string[];
}

export function jobStatus(jobId: string): JobStatusView {
  const files = jobFiles(jobId);
  if (!fs.existsSync(files.record)) throw new UserError(`Unknown jobId "${jobId}".`);
  const job = readJson<JobRecord>(files.record);
  const st = readStatus(files.status);
  let state: JobStatusView['state'] = st?.state ?? (pidAlive(job.pid) ? 'running' : 'unknown');
  let message = st?.message;
  if (state === 'running' && !pidAlive(job.pid)) {
    state = 'failed';
    message = 'The pipeline process ended without reporting completion (crashed or was killed). See logTail.';
  }
  const idx = st?.stageIndex ?? 0;
  const total = st?.totalStages ?? STAGES.length;
  const done = state === 'done';
  const log = fs.existsSync(files.log) ? fs.readFileSync(files.log, 'utf8') : '';
  return {
    jobId,
    kind: job.kind,
    name: job.name,
    state,
    stage: st?.stage,
    progress: done ? `${total}/${total} stages` : `stage ${idx + 1}/${total}${st?.stage ? ` (${st.stage})` : ''}`,
    percent: done ? 100 : Math.round((idx / total) * 100),
    startedAt: job.startedAt,
    updatedAt: st?.updatedAt,
    exitCode: st?.exitCode,
    message: message ? redact(message) : undefined,
    totals: st?.totals,
    logTail: redact(log)
      .split(/\r?\n/)
      .filter((l) => l.trim() && !/^\s+(at |npx playwright show-trace|test-results)/.test(l))
      .slice(-12),
  };
}
