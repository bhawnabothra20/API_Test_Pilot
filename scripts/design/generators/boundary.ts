/** Category generator: Boundary. See .claude/skills for the rules this implements. */
import { EMOJI_STRING, repeatChar } from '../../../shared/helpers/data-mutators';
import { leafFields, schemaAtPath, setAtPath, typeOf } from '../../../shared/helpers/json-schema';
import type { EndpointSpec, JsonSchema, Variant } from '../../../shared/helpers/types';
import { addCase, isStringId, patchBody, requiredQuery, successStatuses, validBody } from '../context';
import type { Ctx } from '../context';
import { valueFor } from '../values';
import type { CategoryGenerator } from '../plugin';

export function boundary(ctx: Ctx, e: EndpointSpec): void {
  const { summary } = ctx;
  const d = summary.defaults;
  const label = `${e.method} ${e.path}`;
  const ok = successStatuses(e);
  const bad = e.inferred || summary.specSource !== 'openapi3' ? [e.badRequestStatus, 422].filter((v, i, a) => a.indexOf(v) === i) : [e.badRequestStatus];
  const b = { e, category: 'Boundary' as const };

  if (e.pathParams.length) {
    const p = e.pathParams[0].name;
    const reqBody = e.method === 'PATCH' ? patchBody(e) : validBody(e);
    if (isStringId(e)) {
      // free-form string identifiers: length / character-set edges instead of numeric edges
      const values: Array<[string, string, number[]]> = [
        ['a single character', 'z', [404, 400, ...ok]],
        ['very long (10,000 chars)', repeatChar(10_000), [404, 400, 414]],
        ['unicode and emoji', EMOJI_STRING, [404, 400]],
        ['whitespace only', '   ', [404, 400, 405]],
      ];
      if (e.method !== 'GET') values.splice(2);
      for (const [name, v, status] of values) {
        addCase(ctx, { ...b, variant: 'tolerant', idSource: 'literal', title: `${label} with ${p} = ${name} is handled (${status.join('/')}), never a 5xx`, data: { note: `string id ${name}`, pathParams: { [p]: v }, body: reqBody }, status, assumption: 'Unknown string ids expected to return 404 (or 400/414 for unusable values).' });
      }
    } else {
      const values: Array<[string, string | number]> = [
        ['0', 0],
        ['very large (2^53+1)', '9007199254740993'],
      ];
      if (e.method === 'GET') values.push(['negative (-1)', -1], ['decimal (1.5)', 1.5]);
      for (const [name, v] of values) {
        addCase(ctx, { ...b, variant: 'negative', idSource: 'literal', title: `${label} with ${p} = ${name} returns 404/400`, data: { note: `id ${name}`, pathParams: { [p]: v }, body: reqBody }, status: [404, 400], assumption: 'Out-of-range ids expected to return 404 or 400.' });
      }
    }
  }

  const rq = requiredQuery(e) ?? {};
  const isStrParam = (s: JsonSchema) => (typeOf(s) === 'string' && !s.format) || (typeOf(s) === 'array' && typeOf(s.items) === 'string');
  const strQ = e.queryParams.find((x) => isStrParam(x.schema));
  if ((e.method === 'GET' && typeOf(e.responseSchema) === 'array') || strQ) {
    const q = strQ?.name ?? 'q';
    addCase(ctx, { ...b, variant: 'tolerant', title: `${label} with a 10,000-character "${q}" query value is handled (200/400/414), never a 5xx`, data: { note: 'very long query', query: { ...rq, [q]: repeatChar(10_000) }, body: validBody(e) }, status: [...ok, 400, 414] });
    addCase(ctx, { ...b, variant: 'tolerant', title: `${label} with unicode/emoji "${q}" query value is handled, never a 5xx`, data: { note: 'unicode query', query: { ...rq, [q]: EMOJI_STRING }, body: validBody(e) }, status: [...ok, 400] });
    addCase(ctx, { ...b, variant: 'tolerant', title: `${label} with a single-character "${q}" query value is handled, never a 5xx`, data: { note: 'one-char query', query: { ...rq, [q]: 'z' }, body: validBody(e) }, status: [...ok, 400] });
    addCase(ctx, { ...b, variant: 'tolerant', title: `${label} with leading/trailing whitespace in "${q}" query value is handled, never a 5xx`, data: { note: 'whitespace query', query: { ...rq, [q]: `  ${String(rq[q] ?? 'value')}  ` }, body: validBody(e) }, status: [...ok, 400] });
    if (e.pagination) {
      const { pageParam, limitParam, maxLimit = 100, firstPage } = e.pagination;
      const pc: Array<[string, Record<string, number>, number[]]> = [];
      if (pageParam) pc.push([`${pageParam}=${firstPage - 1}`, { [pageParam]: firstPage - 1 }, [400, ...ok]], [`${pageParam}=${firstPage}`, { [pageParam]: firstPage }, ok], [`${pageParam}=999999 (past last page)`, { [pageParam]: 999999 }, ok]);
      if (limitParam) pc.push([`${limitParam}=0`, { [limitParam]: 0 }, [400, ...ok]], [`${limitParam}=${maxLimit}`, { [limitParam]: maxLimit }, ok], [`${limitParam}=${maxLimit + 1}`, { [limitParam]: maxLimit + 1 }, [400, ...ok]]);
      for (const [name, query, status] of pc) addCase(ctx, { ...b, variant: 'tolerant', flow: 'pagination', title: `${label} pagination boundary ${name}`, data: { note: 'pagination', query }, status });
    }
  }

  if (!e.requestBody || e.isLogin) return;
  if (typeOf(e.requestBody.schema) === 'array') {
    // top-level array body: item-count edges, then per-item field edges on a one-item array
    const rs = e.requestBody.schema;
    const max = rs.maxItems ?? d.arrayMaxItems;
    const item = (validBody(e) as unknown[])[0];
    const list: Array<[string, unknown[], boolean]> = [
      ['an empty array []', [], (rs.minItems ?? 0) === 0],
      ['a one-item array', [item], true],
      [`max items (${max})`, Array.from({ length: max }, () => item), true],
      [`max+1 items (${max + 1})`, Array.from({ length: max + 1 }, () => item), false],
    ];
    const assumed = rs.maxItems === undefined ? `Request array max items assumed ${max}.` : undefined;
    for (const [name, v, accepted] of list) {
      addCase(ctx, { ...b, variant: accepted ? 'tolerant' : 'negative', title: `${label} with ${name} ${accepted ? 'is accepted' : 'is rejected'}`, data: { note: name, body: v }, status: accepted ? ok : bad, assumption: assumed });
    }
    const itemStr = leafFields(rs.items ?? {}).find((l) => typeOf(l.schema) === 'string' && !l.schema.format && !l.schema.enum);
    if (itemStr && item && typeof item === 'object') {
      const smax = itemStr.schema.maxLength ?? d.stringMaxLength;
      const sAssumed = itemStr.schema.maxLength === undefined ? `"${itemStr.path}" max length assumed ${smax}.` : undefined;
      const edges: Array<[string, string, boolean]> = [
        ['length 1', repeatChar(1), true],
        [`length ${smax}`, repeatChar(smax), true],
        [`length ${smax + 1} (max+1)`, repeatChar(smax + 1), false],
        ['unicode and emoji', EMOJI_STRING, true],
      ];
      for (const [name, v, accepted] of edges) {
        addCase(ctx, { ...b, variant: accepted ? 'tolerant' : 'negative', title: `${label} item field "${itemStr.path}" ${name} ${accepted ? 'is accepted' : 'is rejected'}`, data: { note: `item ${itemStr.path} ${name}`, body: [setAtPath(item, itemStr.path, v)] }, status: accepted ? ok : bad, assumption: sAssumed });
      }
    }
    return;
  }
  const full = (e.method === 'PATCH' ? patchBody(e) : validBody(e)) as Record<string, unknown>;
  const leaves = leafFields(e.requestBody.schema).filter((l) => !l.schema.readOnly && (e.method !== 'PATCH' || l.path in (full ?? {}) || schemaAtPath(e.requestBody!.schema, l.path)));
  // required strings first, so the full length matrix targets a field the API must validate
  const strings = leaves.filter((l) => typeOf(l.schema) === 'string' && !l.schema.format && !l.schema.enum).sort((x, y) => Number(y.required) - Number(x.required));
  const numbers = leaves.filter((l) => ['integer', 'number'].includes(typeOf(l.schema) ?? '') && !l.schema.enum);
  const dates = leaves.filter((l) => l.schema.format === 'date' || l.schema.format === 'date-time');
  const arrays = leaves.filter((l) => typeOf(l.schema) === 'array');
  const level = e.method === 'POST' ? 'full' : e.method === 'PUT' ? 'reduced' : 'minimal';
  const send = (title: string, body: unknown, status: number[], variant: Variant, assumption?: string) =>
    addCase(ctx, { ...b, variant, title, data: { note: title, body }, status, assumption, echo: variant === 'positive' && level === 'full' });

  const s1 = strings[0];
  if (s1) {
    const min = s1.schema.minLength ?? (s1.required ? d.stringMinLength : 0);
    const max = s1.schema.maxLength ?? d.stringMaxLength;
    const assumed = s1.schema.maxLength === undefined ? `"${s1.path}" length limits not documented; assumed ${min}..${max}.` : undefined;
    const lens = new Map<number, string>();
    const want = level === 'full' ? [0, 1, min - 1, min, max, max + 1, 10_000] : level === 'reduced' ? [0, max + 1, 10_000] : [max + 1];
    for (const len of want) if (len >= 0 && !lens.has(len)) lens.set(len, len === 10_000 ? 'very long (10,000)' : String(len));
    for (const [len, name] of lens) {
      const inRange = len >= min && len <= max;
      send(`${label} "${s1.path}" length ${name} ${inRange ? 'is accepted' : 'is rejected'}`, setAtPath(full, s1.path, repeatChar(len)), inRange ? ok : bad, inRange ? 'positive' : 'negative', assumed);
    }
    if (level === 'full') {
      send(`${label} "${s1.path}" with unicode and emoji is stored exactly`, setAtPath(full, s1.path, EMOJI_STRING), ok, 'positive');
      send(`${label} "${s1.path}" with leading/trailing whitespace is accepted (stored as-is or trimmed), never a 5xx`, setAtPath(full, s1.path, '  padded value  '), ok, 'tolerant');
    }
    if (level === 'full') {
      for (const s of strings.slice(1, 4)) {
        const mx = s.schema.maxLength ?? d.stringMaxLength;
        send(`${label} "${s.path}" length ${mx + 1} (max+1) is rejected`, setAtPath(full, s.path, repeatChar(mx + 1)), bad, 'negative', s.schema.maxLength === undefined ? `"${s.path}" max length assumed ${mx}.` : undefined);
      }
    }
  }

  const n1 = numbers.find((n) => !/id$/i.test(n.path)) ?? numbers[0];
  if (n1) {
    const integer = typeOf(n1.schema) === 'integer';
    const isId = /id$/i.test(n1.path);
    const min = n1.schema.minimum ?? (isId ? 1 : d.numberMin);
    const max = n1.schema.maximum ?? d.numberMax;
    const assumed = n1.schema.minimum === undefined ? `"${n1.path}" range not documented; assumed ${min}..${max}.` : undefined;
    const cases: Array<[string, number, boolean]> =
      level === 'full'
        ? [
            ['minimum', min, true],
            ['minimum-1', min - 1, false],
            ['maximum', max, true],
            ['maximum+1', max + 1, false],
            ['zero', 0, min <= 0],
            ['negative (-1)', -1, min <= -1],
            ['very large (1e15)', 1e15, 1e15 <= max],
          ]
        : level === 'reduced'
          ? [
              ['minimum-1', min - 1, false],
              ['maximum+1', max + 1, false],
            ]
          : [['minimum-1', min - 1, false]];
    if (integer && level === 'full') cases.push(['decimal (1.5) for an integer', 1.5, false]);
    const seen = new Set<number>();
    for (const [name, v, accepted] of cases) {
      if (seen.has(v)) continue;
      seen.add(v);
      send(`${label} "${n1.path}" = ${name} ${accepted ? 'is accepted' : 'is rejected'}`, setAtPath(full, n1.path, v), accepted ? ok : bad, accepted ? 'positive' : 'negative', assumed);
    }
  }

  if (dates[0] && level !== 'minimal') {
    const f = dates[0];
    const dt = f.schema.format === 'date-time';
    const list: Array<[string, string, boolean]> = [
      ['leap day 2024-02-29', dt ? '2024-02-29T00:00:00Z' : '2024-02-29', true],
      ['impossible date 2023-02-30', dt ? '2023-02-30T00:00:00Z' : '2023-02-30', false],
      ['far future 9999-12-31', dt ? '9999-12-31T23:59:59Z' : '9999-12-31', true],
      ['epoch 1970-01-01', dt ? '1970-01-01T00:00:00Z' : '1970-01-01', true],
    ];
    for (const [name, v, accepted] of level === 'full' ? list : list.slice(0, 2)) {
      send(`${label} "${f.path}" = ${name} ${accepted ? 'is accepted' : 'is rejected'}`, setAtPath(full, f.path, v), accepted ? ok : bad, accepted ? 'tolerant' : 'negative', 'Date range limits not documented.');
    }
  }

  for (const a of arrays.slice(0, 2)) {
    if (level !== 'full') break;
    const max = a.schema.maxItems ?? d.arrayMaxItems;
    const item = valueFor(a.path, a.schema.items ?? { type: 'string' }, false);
    const list: Array<[string, unknown[], boolean]> = [
      ['empty array', [], (a.schema.minItems ?? 0) === 0],
      ['a one-item array', [item], true],
      [`max items (${max})`, Array.from({ length: max }, () => item), true],
      [`max+1 items (${max + 1})`, Array.from({ length: max + 1 }, () => item), false],
    ];
    for (const [name, v, accepted] of list) {
      send(`${label} "${a.path}" with ${name} ${accepted ? 'is accepted' : 'is rejected'}`, setAtPath(full, a.path, v), accepted ? ok : bad, accepted ? 'tolerant' : 'negative', a.schema.maxItems === undefined ? `"${a.path}" max items assumed ${max}.` : undefined);
    }
  }
}

export const generator: CategoryGenerator = {
  name: 'boundary',
  category: 'Boundary',
  forEndpoint: (ctx, e) => boundary(ctx, e),
};
