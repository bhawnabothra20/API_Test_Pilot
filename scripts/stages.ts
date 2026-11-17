/** Pipeline stages in order - shared by the orchestrator (scripts/api-test.ts) and the MCP server. */
export const STAGES = ['setup', 'safety', 'discover', 'design', 'excel', 'scripts', 'typecheck', 'preflight', 'run', 'calibrate', 'report', 'drift', 'final'] as const;
export type Stage = (typeof STAGES)[number];

/** Written to $API_TEST_STATUS_FILE while a run progresses (read by MCP get_run_status). */
export interface RunStatus {
  state: 'running' | 'done' | 'failed';
  stage?: Stage;
  stageIndex?: number;
  totalStages: number;
  pid: number;
  updatedAt: string;
  exitCode?: number;
  message?: string;
  totals?: { total: number; passed: number; failed: number; skipped: number; flaky: number };
}

/** A TC id as used in test titles (high-level and detailed). */
export const TC_ID = /^TC_[A-Z0-9_]+$/;
