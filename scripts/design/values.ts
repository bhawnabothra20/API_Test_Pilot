/** Valid example values generated from JSON schemas (seeded faker, so designs are reproducible). */
import { faker } from '@faker-js/faker';
import { topFields, typeOf } from '../../shared/helpers/json-schema';
import type { JsonSchema } from '../../shared/helpers/types';

faker.seed(20261105);

export function stringFor(name: string, s: JsonSchema): string {
  const n = name.toLowerCase();
  if (s.enum?.length) return String(s.enum[0]);
  let v: string;
  switch (s.format) {
    case 'email':
      v = faker.internet.email({ provider: 'example.com' }).toLowerCase();
      break;
    case 'uri':
      v = `https://example.com/${faker.string.alphanumeric(8).toLowerCase()}`;
      break;
    case 'uuid':
      v = faker.string.uuid();
      break;
    case 'date':
      v = /checkout|end|to$|until/.test(n) ? '2026-01-05' : '2026-01-01';
      break;
    case 'date-time':
      v = '2026-01-01T10:00:00.000Z';
      break;
    default:
      if (/first.?name/.test(n)) v = faker.person.firstName();
      else if (/last.?name|surname/.test(n)) v = faker.person.lastName();
      else if (/user.?name|login/.test(n)) v = faker.internet.username().replace(/[^A-Za-z0-9_]/g, '');
      else if (n === 'name' || /full.?name/.test(n)) v = faker.person.fullName();
      else if (/title|subject/.test(n)) v = faker.lorem.sentence(4);
      else if (/body|description|text|comment|content/.test(n)) v = faker.lorem.sentences(2);
      else if (/phone/.test(n)) v = '1-555-0100';
      else if (/street/.test(n)) v = faker.location.street();
      else if (/suite/.test(n)) v = 'Suite 100';
      else if (/city/.test(n)) v = faker.location.city();
      else if (/zip|postal/.test(n)) v = '12345-6789';
      else if (/^(lat|lng|lon)/.test(n)) v = '12.3456';
      else if (/website|url|link/.test(n)) v = 'example.com';
      else if (/need/.test(n)) v = 'Breakfast';
      else if (/status/.test(n)) v = 'available';
      else if (/catch|phrase|bs$/.test(n)) v = faker.company.catchPhrase();
      else v = faker.lorem.words(2);
  }
  if (s.maxLength !== undefined && v.length > s.maxLength) v = v.slice(0, s.maxLength);
  if (s.minLength !== undefined && v.length < s.minLength) v = v.padEnd(s.minLength, 'x');
  return v;
}

export function numberFor(name: string, s: JsonSchema, integer: boolean): number {
  if (s.enum?.length) return Number(s.enum[0]);
  const n = name.toLowerCase();
  if (/id$/.test(n)) return Math.max(1, s.minimum ?? 1);
  let v = /price|amount|total|cost/.test(n) ? 111 : integer ? 42 : 42.5;
  if (s.minimum !== undefined && v < s.minimum) v = s.minimum;
  if (s.maximum !== undefined && v > s.maximum) v = s.maximum;
  return integer ? Math.round(v) : v;
}

export function valueFor(name: string, s: JsonSchema, requiredOnly: boolean): unknown {
  switch (typeOf(s)) {
    case 'string':
      return stringFor(name, s);
    case 'integer':
      return numberFor(name, s, true);
    case 'number':
      return numberFor(name, s, false);
    case 'boolean':
      return true;
    case 'array':
      return s.items ? [valueFor(name.replace(/s$/, ''), s.items, requiredOnly)] : [];
    case 'object':
      return objectFor(s, requiredOnly);
    case 'null':
      return null;
    default:
      return stringFor(name, { type: 'string' });
  }
}

export function objectFor(s: JsonSchema, requiredOnly: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of topFields(s)) {
    if (requiredOnly && !f.required) continue;
    if (f.schema.readOnly) continue;
    out[f.name] = valueFor(f.name, f.schema, requiredOnly);
  }
  return out;
}
