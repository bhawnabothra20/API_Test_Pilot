import { expect } from '@playwright/test';
import type { ApiResponse } from '../fixtures/api-fixture';
import { expectErrorBody, expectNoServerError, expectResponseTime, expectStatus } from './assertions';
import { getAtPath, SENSITIVE_FIELD } from './json-schema';

/**
 * Authorization assertions (OWASP API Top 10). Messages start with a stable marker that triage maps to
 * class, severity and OWASP id - keep them unchanged:
 *   "Authorization bypass"   -> Real API defect (token hygiene)
 *   "Sensitive field exposed" -> Real API defect (API3)
 *   "Mass assignment"         -> Real API defect (API3)
 *   "Undocumented field"      -> Contract/Spec mismatch (API3)
 */

/** Access must be denied: never 2xx, never 5xx, one of the expected 4xx, leak-free body, within time. */
export function expectAccessDenied(res: ApiResponse, allowed: number[], maxMs: number, what: string): void {
  expect(
    res.status >= 200 && res.status < 300,
    `Authorization bypass: ${what} was answered with ${res.status} (expected ${allowed.join(' or ')}) but got ${res.status}. ${res.method} ${res.url}`,
  ).toBe(false);
  expectNoServerError(res);
  expectStatus(res, allowed);
  expectErrorBody(res, 'safe');
  expectResponseTime(res, maxMs);
}

const SENSITIVE = SENSITIVE_FIELD;

/** Paths of fields whose NAME marks them as secret/sensitive (password, token, ssn ...), at any depth. */
export function sensitiveFields(body: unknown, prefix = '', out: string[] = []): string[] {
  if (Array.isArray(body)) {
    body.slice(0, 200).forEach((item, i) => sensitiveFields(item, `${prefix}[${i}]`, out));
  } else if (body && typeof body === 'object') {
    for (const [k, v] of Object.entries(body)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (SENSITIVE.test(k) && v !== null && v !== '') out.push(p);
      sensitiveFields(v, p, out);
    }
  }
  return [...new Set(out.map((p) => p.replace(/\[\d+\]/g, '[]')))];
}

export function expectNoSensitiveFields(body: unknown): void {
  const found = sensitiveFields(body);
  expect(found, `Sensitive field exposed in response: ${found.join(', ')}`).toEqual([]);
}

/**
 * Documented response shape: object keys -> nested shape, arrays -> [itemShape], leaves -> true.
 * Generated from the spec by scripts/generate-specs.ts (exported as <Name>Shape in schemas/*.schema.ts).
 */
export type Shape = true | { [key: string]: Shape } | [Shape];

export function undocumentedFields(body: unknown, shape: Shape, prefix = '', out: string[] = []): string[] {
  if (shape === true || body === null || body === undefined) return out;
  if (Array.isArray(shape)) {
    if (Array.isArray(body)) body.slice(0, 200).forEach((item) => undocumentedFields(item, shape[0], `${prefix}[]`, out));
    return [...new Set(out)];
  }
  if (typeof body !== 'object' || Array.isArray(body)) return out;
  // an object shape without keys documents a free-form object
  if (Object.keys(shape).length === 0) return out;
  for (const [k, v] of Object.entries(body)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (!(k in shape)) out.push(p);
    else undocumentedFields(v, shape[k], p, out);
  }
  return [...new Set(out)];
}

export function expectNoUndocumentedFields(body: unknown, shape: Shape): void {
  const extra = undocumentedFields(body, shape);
  expect(extra, `Undocumented field returned (not in the documented schema): ${extra.join(', ')}`).toEqual([]);
}

export { PRIVILEGED_PROBES } from './data-mutators';

/**
 * After a create/update carrying privileged fields, the stored resource must not hold the client-supplied
 * values (they must be ignored or the request rejected).
 */
export function expectPrivilegedIgnored(entity: unknown, privileged: Record<string, unknown>): void {
  const stored = Object.entries(privileged).filter(([k, v]) => {
    const actual = getAtPath(entity, k);
    return actual !== undefined && JSON.stringify(actual) === JSON.stringify(v);
  });
  expect(
    stored.map(([k]) => k),
    `Mass assignment: privileged/read-only field(s) stored with the client-supplied value: ${stored.map(([k]) => k).join(', ')}`,
  ).toEqual([]);
}
