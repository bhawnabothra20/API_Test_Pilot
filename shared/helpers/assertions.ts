import { expect, test } from '@playwright/test';
import type { ZodTypeAny, z } from 'zod';
import type { ApiResponse } from '../fixtures/api-fixture';
import { LEAK_PATTERNS } from './data-mutators';
import { getAtPath } from './json-schema';
import { quotaExhausted } from './quota';

function snippet(res: ApiResponse): string {
  const body = res.text.length > 300 ? `${res.text.slice(0, 300)}...` : res.text;
  return `${res.method} ${res.url} -> ${res.status} body=${body}`;
}

/** (1) status code */
export function expectStatus(res: ApiResponse, allowed: number[]): void {
  expect(allowed, `Expected status ${allowed.join(' or ')} but got ${res.status}. ${snippet(res)}`).toContain(res.status);
}

/** Never a 5xx, whatever the input. */
export function expectNoServerError(res: ApiResponse): void {
  expect(res.status, `Server error (5xx) returned. ${snippet(res)}`).toBeLessThan(500);
}

/** (2) headers */
export function expectJsonContentType(res: ApiResponse): void {
  const ct = res.headers['content-type'] ?? '';
  expect(ct, `Expected JSON content-type, got "${ct}". ${snippet(res)}`).toMatch(/application\/(.+\+)?json/i);
}

export function expectContentType(res: ApiResponse, pattern: RegExp): void {
  const ct = res.headers['content-type'] ?? '';
  expect(ct, `Unexpected content-type "${ct}"`).toMatch(pattern);
}

/** (3) schema - returns the typed body */
export function expectSchema<S extends ZodTypeAny>(res: ApiResponse, schema: S): z.infer<S> {
  expect(res.json, `Response is not valid JSON. ${snippet(res)}`).not.toBeUndefined();
  const parsed = schema.safeParse(res.json);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 10)
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    expect(parsed.success, `Schema validation failed: ${issues}`).toBe(true);
  }
  return parsed.success ? (parsed.data as z.infer<S>) : (res.json as z.infer<S>);
}

/** (4) business fields */
export function expectFields(body: unknown, fields: Record<string, unknown>): void {
  for (const [path, value] of Object.entries(fields)) {
    expect(getAtPath(body, path), `Field "${path}"`).toEqual(value);
  }
}

/** Every leaf value sent must come back unchanged (no truncation / type change). */
export function expectEcho(sent: unknown, received: unknown, prefix = ''): void {
  if (sent && typeof sent === 'object' && !Array.isArray(sent)) {
    for (const [k, v] of Object.entries(sent)) expectEcho(v, getAtPath(received, k), prefix ? `${prefix}.${k}` : k);
    return;
  }
  expect(received, `Field "${prefix}" was not persisted/echoed exactly`).toEqual(sent);
}

export function expectNonEmptyArray(body: unknown): void {
  expect(Array.isArray(body), 'Expected an array body').toBe(true);
  expect((body as unknown[]).length, 'Expected at least one item').toBeGreaterThan(0);
}

export function expectAllItems(body: unknown, field: string, value: unknown): void {
  expect(Array.isArray(body), 'Expected an array body').toBe(true);
  for (const [i, item] of (body as unknown[]).entries()) {
    expect(String(getAtPath(item, field)), `item[${i}].${field}`).toBe(String(value));
  }
}

/** (5) response time */
export function expectResponseTime(res: ApiResponse, maxMs: number): void {
  expect(res.durationMs, `Response took ${res.durationMs} ms (limit ${maxMs} ms)`).toBeLessThanOrEqual(maxMs);
}

/** No stack traces / internal paths / SQL errors in the body. */
export function expectNoLeak(res: ApiResponse): void {
  for (const pattern of LEAK_PATTERNS) {
    expect(pattern.test(res.text), `Response leaks internals (${pattern}). ${snippet(res)}`).toBe(false);
  }
}

/**
 * Error body structure.
 * "json": body must be a JSON object (documented error schema).
 * "safe": body may be JSON or short text, but must be present-or-empty and leak free.
 */
export function expectErrorBody(res: ApiResponse, mode: 'json' | 'safe'): void {
  expectNoLeak(res);
  if (mode === 'json') {
    expect(
      res.json !== undefined && typeof res.json === 'object' && !Array.isArray(res.json),
      `Expected a structured JSON error object. ${snippet(res)}`,
    ).toBe(true);
  } else {
    expect(res.text.length, 'Error body unexpectedly large (possible dump)').toBeLessThan(20_000);
    expect(/<html|<!doctype/i.test(res.text) && /exception|stack|trace/i.test(res.text), 'HTML error page with exception details').toBe(false);
  }
}

/**
 * Robustness: when undocumented-limit input is ACCEPTED (2xx), every sent value must come back unchanged
 * (no truncation, trimming or type coercion). A rejection (4xx) is equally fine - nothing to compare.
 */
export function expectEchoIfAccepted(res: ApiResponse, sent: unknown, entityPath?: string): void {
  const plainObject = !!sent && typeof sent === 'object' && !Array.isArray(sent) && Object.keys(sent).length > 0;
  if (res.status < 200 || res.status >= 300 || !plainObject || res.json === undefined) return;
  expectEcho(sent, entityPath ? getAtPath(res.json, entityPath) : res.json);
}

const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * Runs one detailed check of a high-level test case as a test.step. A failure is recorded (first line of
 * the assertion message) instead of aborting, so every check of the scenario runs and is reported.
 */
export async function check(failures: string[], label: string, fn: () => Promise<void>): Promise<void> {
  await test.step(label, async () => {
    try {
      await fn();
    } catch (e) {
      if (quotaExhausted()) throw e; // quota skip must propagate, not be recorded as a failed check
      const message = (e instanceof Error ? e.message : String(e)).replace(ANSI, '').trim().split('\n')[0];
      failures.push(`${label}: ${message}`);
    }
  });
}

/** Fails the high-level test when any of its checks failed, listing every failed check. */
export function expectNoFailures(failures: string[], total: number): void {
  expect(failures.length, `${failures.length} of ${total} checks failed:\n• ${failures.join('\n• ')}`).toBe(0);
}

/** Two responses carry the same JSON body. */
export function expectSameBody(a: ApiResponse, b: ApiResponse): void {
  expect(b.json ?? b.text, 'Repeated request returned a different body').toEqual(a.json ?? a.text);
}
