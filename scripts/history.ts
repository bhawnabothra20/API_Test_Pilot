/**
 * Run history - every completed run is archived instead of being overwritten.
 *
 *   api/<name>/reports/history/index.json          one entry per run (newest first)
 *   api/<name>/reports/history/<runId>/            results.json, triage.json, access-matrix.json,
 *                                                  preflight.json, summary.html, run-log.txt,
 *                                                  junit.xml, ci-summary.md (--ci), spec-drift.json,
 *                                                  openapi-patch.json, openapi-suggested.yaml
 *
 * runId = the Playwright run start time (results.json stats.startTime), so triage/summary files can be
 * matched to the run that produced them; a mismatch means the file is stale.
 * The current files in reports/ always belong to ONE run: the run stage clears the previous run's
 * derived files first (clearCurrentRun), and the report stage archives the finished run (archiveRun).
 */
import fs from 'node:fs';
import path from 'node:path';
import { apiPaths, readJson, writeJson } from '../shared/helpers/env';
import type { TriageFile } from '../shared/helpers/types';

export const HISTORY_KEEP = 20;
const DRIFT = ['spec-drift.json', 'openapi-patch.json', 'openapi-suggested.yaml'];
const ARCHIVED = ['results.json', 'triage.json', 'access-matrix.json', 'preflight.json', 'summary.html', 'run-log.txt', 'junit.xml', 'ci-summary.md', ...DRIFT];
/** derived from results.json - deleted when a new run starts so they can never describe another run */
const DERIVED = ['triage.json', 'access-matrix.json', 'junit.xml', 'ci-summary.md', ...DRIFT];

export interface Totals {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
}

export interface HistoryEntry {
  runId: string;
  startedAt: string;
  sourceUrl: string;
  /** true when only some TC ids were run (MCP rerun / --tc) */
  partial: boolean;
  testCases: number;
  totals: Totals;
  /** executed (passed + failed + flaky) / total, in % */
  executedPct: number;
  /** (passed + flaky) / executed, in %; null when nothing executed */
  passRatePct: number | null;
  failuresByClass: Record<string, number>;
  rootCauses: number;
  failedIds: string[];
}

export const runIdOf = (startTime: string | undefined): string | undefined =>
  startTime ? startTime.replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z').replace('T', '-') : undefined;

export function executedPct(t: Totals): number {
  return t.total ? Math.round(((t.passed + t.failed + t.flaky) / t.total) * 100) : 0;
}

export function passRatePct(t: Totals): number | null {
  const executed = t.passed + t.failed + t.flaky;
  return executed ? Math.round(((t.passed + t.flaky) / executed) * 100) : null;
}

function historyDir(apiName: string): string {
  return path.join(apiPaths(apiName).reports, 'history');
}

export function readHistory(apiName: string): HistoryEntry[] {
  const f = path.join(historyDir(apiName), 'index.json');
  return fs.existsSync(f) ? readJson<HistoryEntry[]>(f) : [];
}

/** Called when a run starts: removes the previous run's derived files (they stay in history). */
export function clearCurrentRun(apiName: string): void {
  const p = apiPaths(apiName);
  for (const f of DERIVED) {
    const file = path.join(p.reports, f);
    if (fs.existsSync(file)) fs.rmSync(file);
  }
}

/** Archives the finished run and records it in index.json (idempotent per runId). */
export function archiveRun(apiName: string, entry: Omit<HistoryEntry, 'runId'> & { runId?: string }): HistoryEntry | undefined {
  const runId = entry.runId ?? runIdOf(entry.startedAt);
  if (!runId || !/^[0-9TZ-]+$/.test(runId)) return undefined;
  const p = apiPaths(apiName);
  const dir = path.join(historyDir(apiName), runId);
  fs.mkdirSync(dir, { recursive: true });
  for (const f of ARCHIVED) {
    const src = path.join(p.reports, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, f));
  }
  const full: HistoryEntry = { ...entry, runId };
  const index = [full, ...readHistory(apiName).filter((h) => h.runId !== runId)].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  for (const old of index.splice(HISTORY_KEEP)) {
    const oldDir = path.join(historyDir(apiName), old.runId);
    // only ever delete a run folder directly inside this API's history folder
    if (/^[0-9TZ-]+$/.test(old.runId) && path.dirname(oldDir) === historyDir(apiName) && fs.existsSync(oldDir)) fs.rmSync(oldDir, { recursive: true });
  }
  writeJson(path.join(historyDir(apiName), 'index.json'), index);
  return full;
}

/**
 * Copies files written AFTER the report stage archived the run (drift stage: spec-drift.json, patch,
 * re-rendered summary.html, ci-summary.md) into that run's existing history folder.
 */
export function archiveFiles(apiName: string, runId: string | undefined, names: string[]): void {
  if (!runId || !/^[0-9TZ-]+$/.test(runId)) return;
  const dir = path.join(historyDir(apiName), runId);
  if (!fs.existsSync(dir)) return;
  const reports = apiPaths(apiName).reports;
  for (const f of names.filter((n) => ARCHIVED.includes(n))) {
    const src = path.join(reports, f);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(dir, f));
  }
}

/**
 * Failures that are new / fixed compared with the previous complete run. A previously failing test counts as
 * FIXED only when it ran in this run and did not fail; when it no longer exists or did not execute (test level
 * changed, spec changed, skipped) it is listed under notRun - never as fixed.
 * Without executedIds (older callers) every id that is not failing counts as fixed.
 */
export function compareWithPrevious(
  apiName: string,
  runId: string | undefined,
  failedIds: string[],
  executedIds?: string[],
): { previous?: HistoryEntry; newFailures: string[]; fixed: string[]; notRun: string[] } {
  const previous = readHistory(apiName).find((h) => h.runId !== runId && !h.partial);
  if (!previous) return { newFailures: [], fixed: [], notRun: [] };
  const before = new Set(previous.failedIds);
  const now = new Set(failedIds);
  const ran = executedIds ? new Set(executedIds) : undefined;
  const gone = previous.failedIds.filter((id) => !now.has(id));
  return {
    previous,
    newFailures: failedIds.filter((id) => !before.has(id)),
    fixed: gone.filter((id) => !ran || ran.has(id)),
    notRun: ran ? gone.filter((id) => !ran.has(id)) : [],
  };
}

/** true when triage.json was produced from the current results.json */
export function triageMatchesRun(t: TriageFile | undefined, startTime: string | undefined): boolean {
  return !!t && !!startTime && t.runStartedAt === startTime;
}
