import type { JsonSchema, JsonType } from './types';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URI = /^https?:\/\/\S+$/i;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/;

/** Field NAMES that mark a value as secret/sensitive (excessive data exposure, OWASP API3). */
export const SENSITIVE_FIELD =
  /^(password|passwd|pwd|pass_?hash|password_?hash|secret|client_?secret|api_?key|apikey|access_?token|refresh_?token|token|session_?id|ssn|social_?security(_number)?|credit_?card(_number)?|card_?number|cvv|private_?key)$/i;

/** Infers a JSON schema from one or more sample values (all observed keys become required). */
export function inferSchema(samples: unknown[]): JsonSchema {
  const values = samples.filter((s) => s !== undefined);
  if (values.length === 0) return {};
  const first = values[0];
  if (first === null) return { type: 'null' };
  if (Array.isArray(first)) {
    const items = values.flatMap((v) => (Array.isArray(v) ? v : [])).slice(0, 50);
    return { type: 'array', items: items.length ? inferSchema(items) : {} };
  }
  if (typeof first === 'object') {
    const objects = values.filter((v): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v));
    const keys = new Set<string>();
    objects.forEach((o) => Object.keys(o).forEach((k) => keys.add(k)));
    const properties: Record<string, JsonSchema> = {};
    const required: string[] = [];
    for (const key of keys) {
      const present = objects.filter((o) => key in o);
      properties[key] = inferSchema(present.map((o) => o[key]));
      if (objects.some((o) => o[key] === null)) properties[key].nullable = true;
      if (present.length === objects.length) required.push(key);
    }
    return { type: 'object', properties, required };
  }
  if (typeof first === 'boolean') return { type: 'boolean' };
  if (typeof first === 'number') {
    return { type: values.every((v) => typeof v === 'number' && Number.isInteger(v)) ? 'integer' : 'number' };
  }
  if (typeof first === 'string') {
    const strings = values.filter((v): v is string => typeof v === 'string');
    const schema: JsonSchema = { type: 'string' };
    if (strings.every((s) => EMAIL.test(s))) schema.format = 'email';
    else if (strings.every((s) => URI.test(s))) schema.format = 'uri';
    else if (strings.every((s) => UUID.test(s))) schema.format = 'uuid';
    else if (strings.every((s) => DATE.test(s))) schema.format = 'date';
    else if (strings.every((s) => DATE_TIME.test(s))) schema.format = 'date-time';
    return schema;
  }
  return {};
}

export function typeOf(schema: JsonSchema | undefined): JsonType | undefined {
  if (!schema) return undefined;
  if (schema.type) return schema.type;
  if (schema.properties) return 'object';
  if (schema.items) return 'array';
  return undefined;
}

/** Reads a dotted path ("booking.bookingdates.checkin") from a value. */
export function getAtPath(value: unknown, dotted: string | undefined): unknown {
  if (!dotted) return value;
  return dotted.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, value);
}

/** Lists leaf fields of an object schema as dotted paths. */
export function leafFields(schema: JsonSchema, prefix = ''): Array<{ path: string; schema: JsonSchema; required: boolean }> {
  const out: Array<{ path: string; schema: JsonSchema; required: boolean }> = [];
  const props = schema.properties ?? {};
  for (const [key, child] of Object.entries(props)) {
    const p = prefix ? `${prefix}.${key}` : key;
    const required = (schema.required ?? []).includes(key);
    if (typeOf(child) === 'object' && child.properties) {
      for (const leaf of leafFields(child, p)) out.push({ ...leaf, required: required && leaf.required });
    } else {
      out.push({ path: p, schema: child, required });
    }
  }
  return out;
}

/** Top-level fields (not flattened). */
export function topFields(schema: JsonSchema | undefined): Array<{ name: string; schema: JsonSchema; required: boolean }> {
  if (!schema?.properties) return [];
  return Object.entries(schema.properties).map(([name, s]) => ({
    name,
    schema: s,
    required: (schema.required ?? []).includes(name),
  }));
}

/** Removes server-generated (readOnly / id) fields to obtain a request-body schema. */
export function toRequestSchema(schema: JsonSchema, idField: string): JsonSchema {
  if (!schema.properties) return schema;
  const properties: Record<string, JsonSchema> = {};
  for (const [k, v] of Object.entries(schema.properties)) {
    if (k === idField || v.readOnly) continue;
    properties[k] = v;
  }
  return {
    type: 'object',
    properties,
    required: (schema.required ?? []).filter((r) => r in properties),
  };
}

export function deepClone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** Returns a copy of obj with a dotted path set (or removed when value === undefined). */
export function setAtPath<T>(obj: T, dotted: string, value: unknown): T {
  const copy = deepClone(obj) as unknown as Record<string, unknown>;
  const keys = dotted.split('.');
  let cursor: Record<string, unknown> = copy;
  for (let i = 0; i < keys.length - 1; i++) {
    const next = cursor[keys[i]];
    if (!next || typeof next !== 'object') cursor[keys[i]] = {};
    cursor = cursor[keys[i]] as Record<string, unknown>;
  }
  const last = keys[keys.length - 1];
  if (value === undefined) delete cursor[last];
  else cursor[last] = value;
  return copy as unknown as T;
}

/** Leaf field schema from a dotted path. */
export function schemaAtPath(schema: JsonSchema, dotted: string): JsonSchema | undefined {
  return dotted.split('.').reduce<JsonSchema | undefined>((acc, key) => acc?.properties?.[key], schema);
}
