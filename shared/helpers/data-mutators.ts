import { typeOf } from './json-schema';
import type { JsonSchema } from './types';

/** A value of a clearly wrong JSON type for the given schema. */
export function wrongTypeValue(schema: JsonSchema): unknown {
  switch (typeOf(schema)) {
    case 'string':
      return 12345;
    case 'integer':
    case 'number':
      return 'not-a-number';
    case 'boolean':
      return 'not-a-boolean';
    case 'array':
      return { unexpected: 'object-instead-of-array' };
    case 'object':
      return ['array-instead-of-object'];
    default:
      return { unexpected: true };
  }
}

export function describeWrongType(schema: JsonSchema): string {
  return `${jsonTypeName(wrongTypeValue(schema))} instead of ${typeOf(schema) ?? 'unknown'}`;
}

function jsonTypeName(v: unknown): JsonSchema['type'] {
  if (Array.isArray(v)) return 'array';
  if (v === null) return 'null';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'object') return 'object';
  return 'string';
}

/** Invalid value for a formatted string field. */
export function invalidFormatValue(schema: JsonSchema): string | undefined {
  switch (schema.format) {
    case 'email':
      return 'not-an-email';
    case 'date':
      return '2024-13-45';
    case 'date-time':
      return 'yesterday at noon';
    case 'uri':
      return 'ht!tp://not a url';
    case 'uuid':
      return '1234-not-a-uuid';
    default:
      return undefined;
  }
}

/** Input-data probes that must be rejected or safely stored, never cause a 5xx. */
export const INJECTION_STRINGS: Array<{ label: string; value: string }> = [
  { label: 'SQL injection', value: "' OR '1'='1'; DROP TABLE users; --" },
  { label: 'script injection', value: '<script>alert("x")</script>' },
  { label: 'special characters', value: '%00\\";{}$`|&<>\u0000' },
];

/** Privileged / read-only fields a client must not be able to set (mass assignment probes). */
export const PRIVILEGED_PROBES: Record<string, unknown> = {
  role: 'mass-assignment-admin',
  isAdmin: true,
  is_admin: true,
  owner: 'mass-assignment-attacker',
  ownerId: 987654321,
  createdAt: '2000-01-01T00:00:00.000Z',
};

export const EMOJI_STRING = 'Ünïcödé テスト 😀🚀';

export function repeatChar(length: number, ch = 'a'): string {
  return ch.repeat(Math.max(0, length));
}

/** Patterns that indicate an internal error leak in a response body. */
export const LEAK_PATTERNS: RegExp[] = [
  /\bat\s+[\w.<>]+\s+\([^)]*:\d+:\d+\)/, // node stack frame
  /Traceback \(most recent call last\)/,
  /\bException in thread\b/,
  /\bjava\.lang\.\w+Exception\b/,
  /node_modules[\\/]/,
  /[A-Z]:\\(Users|inetpub|Program Files)\\/i,
  /\/(home|usr|var|opt|app)\/[\w.-]+\/[\w.-]+\.(js|ts|py|java|rb|php)\b/,
  /SQLSTATE\[|ORA-\d{5}|syntax error at or near/i,
];
