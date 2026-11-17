/**
 * Per-worker record of an exhausted API quota (HTTP 429 with x-ratelimit-remaining: 0 or Retry-After).
 * Once set, every further test in the worker is skipped with the reason instead of failing as "flaky".
 */
let exhaustedReason: string | undefined;

export function quotaExhausted(): string | undefined {
  return exhaustedReason;
}

export function markQuotaExhausted(reason: string): void {
  exhaustedReason = exhaustedReason ?? reason;
}

/** Builds a human-readable reason from rate-limit response headers. */
export function quotaReason(host: string, headers: Record<string, string>, keyHint: string | undefined): string {
  const limit = headers['x-ratelimit-limit'] ?? headers['ratelimit-limit'];
  const resetRaw = headers['x-ratelimit-reset'] ?? headers['ratelimit-reset'];
  const retryAfter = headers['retry-after'];
  let reset = '';
  if (resetRaw && /^\d+$/.test(resetRaw)) {
    const n = Number(resetRaw);
    reset = n > 1e9 ? ` Resets ${new Date(n * 1000).toISOString().replace('T', ' ').slice(0, 16)} UTC.` : ` Resets in ${n} s.`;
  } else if (retryAfter) {
    reset = ` Retry after ${retryAfter}.`;
  }
  return `Skipped: ${host} rate limit reached (HTTP 429${limit ? `, limit ${limit} requests` : ''}).${reset}${keyHint ? ` ${keyHint}` : ''}`;
}
