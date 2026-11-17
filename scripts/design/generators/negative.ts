/** Category generator: Negative. See .claude/skills for the rules this implements. */
import { INJECTION_STRINGS, describeWrongType, invalidFormatValue, wrongTypeValue } from '../../../shared/helpers/data-mutators';
import { leafFields, setAtPath, topFields, typeOf } from '../../../shared/helpers/json-schema';
import type { EndpointSpec, HttpMethod } from '../../../shared/helpers/types';
import { addCase, isStringId, patchBody, requiredQuery, successStatuses, validBody } from '../context';
import type { Ctx } from '../context';
import type { CategoryGenerator } from '../plugin';

export function negative(ctx: Ctx, e: EndpointSpec, firstOnPath: boolean): void {
  const { summary } = ctx;
  const label = `${e.method} ${e.path}`;
  const bad = e.inferred || summary.specSource === 'apidoc' ? [e.badRequestStatus, 422].filter((v, i, a) => a.indexOf(v) === i) : [e.badRequestStatus];
  const assumed = e.inferred || summary.specSource === 'apidoc' || summary.specSource === 'html-links' ? 'Validation rules/status inferred, not documented.' : undefined;
  const neg = { e, category: 'Negative' as const, variant: 'negative' as const, assumption: assumed };

  if (e.pathParams.length) {
    const p = e.pathParams[0].name;
    addCase(ctx, { ...neg, idSource: 'literal', title: `${label} with a non-existent ${p} returns ${e.notFoundStatus}`, data: { note: 'non-existent id', pathParams: { [p]: 999999999 }, body: e.method === 'PATCH' ? patchBody(e) : validBody(e) }, status: [e.notFoundStatus], assumption: undefined });
    if (isStringId(e)) {
      // a free-form string id has no "invalid format"; special characters must simply not be found / be rejected
      addCase(ctx, { ...neg, idSource: 'literal', title: `${label} with an invalid ${p} format returns ${e.notFoundStatus}/${e.badRequestStatus} (special characters in a string id)`, data: { note: 'special-character id', pathParams: { [p]: 'abc-!@#$%' }, body: e.method === 'PATCH' ? patchBody(e) : validBody(e) }, status: [e.notFoundStatus, e.badRequestStatus].filter((v, i, a) => a.indexOf(v) === i), assumption: 'String ids with special characters expected to return 404 (not found) or 400.' });
    } else {
      addCase(ctx, { ...neg, idSource: 'literal', title: `${label} with an invalid ${p} format returns ${e.badRequestStatus}`, data: { note: 'invalid id format', pathParams: { [p]: 'abc-!@#' }, body: e.method === 'PATCH' ? patchBody(e) : validBody(e) }, status: [e.badRequestStatus], assumption: 'Invalid id format expected to be rejected with 400 (not documented).' });
    }
  }

  // documented query parameters: missing required (one at a time), empty, invalid enum, wrong type
  const rq = requiredQuery(e) ?? {};
  const qBad = [e.badRequestStatus];
  for (const q of e.queryParams.filter((x) => x.required).slice(0, 10)) {
    const rest = { ...rq };
    delete rest[q.name];
    addCase(ctx, { ...neg, title: `${label} without required query parameter "${q.name}" is rejected with ${qBad.join('/')}`, data: { note: `missing query ${q.name}`, query: rest, body: validBody(e) }, status: qBad, assumption: assumed });
    addCase(ctx, { ...neg, title: `${label} with an empty value for required query parameter "${q.name}" is rejected with ${qBad.join('/')}`, data: { note: `empty query ${q.name}`, query: { ...rq, [q.name]: '' }, body: validBody(e) }, status: qBad, assumption: assumed ?? 'Empty required query values expected to return 400 (not documented).' });
  }
  for (const q of e.queryParams.filter((x) => (x.schema.enum ?? x.schema.items?.enum)?.length).slice(0, 3)) {
    addCase(ctx, { ...neg, title: `${label}?${q.name}=<invalid enum value> is rejected with ${qBad.join('/')}`, data: { note: `invalid enum query ${q.name}`, query: { ...rq, [q.name]: 'NOT_A_VALID_ENUM' }, body: validBody(e) }, status: qBad, assumption: 'Invalid enum query values expected to return 400 (not documented).' });
  }
  const isListGet = e.method === 'GET' && typeOf(e.responseSchema) === 'array';
  if (!isListGet) {
    const typedQ = e.queryParams.find((q) => ['integer', 'number'].includes(typeOf(q.schema) ?? '') || q.schema.format);
    if (typedQ) addCase(ctx, { ...neg, title: `${label}?${typedQ.name}=<wrong type> is rejected with 400`, data: { note: 'wrong query type', query: { ...rq, [typedQ.name]: typedQ.schema.format ? 'not-a-date' : 'abc' }, body: validBody(e) }, status: bad, assumption: 'Wrong-typed query values expected to return 400 (not documented).' });
  }

  if (firstOnPath) {
    const onPath = new Set(summary.endpoints.filter((x) => x.path === e.path).map((x) => x.method));
    const unsupported = (['DELETE', 'PATCH', 'PUT', 'POST'] as HttpMethod[]).find((m) => !onPath.has(m));
    if (unsupported) {
      addCase(ctx, {
        ...neg,
        method: unsupported,
        idSource: e.pathParams.length ? 'literal' : 'none',
        title: `Unsupported method ${unsupported} on ${e.path} is rejected with 405/404`,
        data: { note: 'unsupported method', pathParams: e.pathParams.length ? { [e.pathParams[0].name]: 999999999 } : undefined },
        status: [405, 404],
        assumption: 'Unsupported methods expected to return 405 (or 404 for unrouted paths).',
      });
    }
  }

  if (e.method === 'GET' && typeOf(e.responseSchema) === 'array') {
    const typed = e.queryParams.find((q) => ['integer', 'number'].includes(typeOf(q.schema) ?? '') || q.schema.format);
    if (typed) {
      addCase(ctx, { ...neg, title: `${label}?${typed.name}=<wrong type> is rejected with 400`, data: { note: 'wrong query type', query: { ...rq, [typed.name]: typed.schema.format ? 'not-a-date' : 'abc' } }, status: bad, assumption: 'Wrong-typed query values expected to return 400 (not documented).' });
    }
    addCase(ctx, { ...neg, variant: 'tolerant', title: `${label} with an unknown query parameter is ignored or rejected, never a 5xx`, data: { note: 'unknown query parameter', query: { ...rq, unknownParam: 'x' } }, status: [...successStatuses(e), 400] });
  }

  if (!e.requestBody && ['POST', 'PUT', 'PATCH'].includes(e.method)) {
    ctx.notApplicable.push(`${label}: body-field negative/boundary cases (missing/null/wrong type/length) - no JSON request body documented (form-data or parameter-only endpoint).`);
  }
  if (!e.requestBody || e.isLogin) return;
  const schema = e.requestBody.schema;
  if (typeOf(schema) === 'array') {
    arrayBodyNegatives(ctx, e, neg, bad);
    return;
  }
  const valid = (e.method === 'PATCH' ? patchBody(e) : validBody(e)) as Record<string, unknown>;
  const full = validBody(e) as Record<string, unknown>;
  const leaves = leafFields(schema).filter((l) => !l.schema.readOnly);
  const required = leaves.filter((l) => l.required);
  const tops = topFields(schema).filter((f) => !f.schema.readOnly);

  if (e.method !== 'PATCH') {
    for (const f of required.slice(0, 10)) {
      addCase(ctx, { ...neg, title: `${label} without required field "${f.path}" is rejected with ${bad.join('/')}`, data: { note: `missing ${f.path}`, body: setAtPath(full, f.path, undefined) }, status: bad });
    }
    for (const f of tops.filter((t) => t.required).slice(0, 5)) {
      addCase(ctx, { ...neg, title: `${label} with "${f.name}": null is rejected with ${bad.join('/')}`, data: { note: `null ${f.name}`, body: { ...full, [f.name]: null } }, status: bad });
    }
    const str = required.find((l) => typeOf(l.schema) === 'string');
    if (str) addCase(ctx, { ...neg, title: `${label} with empty string for required "${str.path}" is rejected with ${bad.join('/')}`, data: { note: `empty ${str.path}`, body: setAtPath(full, str.path, '') }, status: bad });
    addCase(ctx, { ...neg, title: `${label} with an empty JSON object {} is rejected with ${bad.join('/')}`, data: { note: 'empty object', body: {} }, status: bad });
  }
  addCase(ctx, { ...neg, title: `${label} with no body is rejected with ${bad.join('/')}`, data: { note: 'empty body', rawBody: '' }, status: bad });
  addCase(ctx, { ...neg, title: `${label} with malformed JSON is rejected with 400`, data: { note: 'malformed JSON', rawBody: '{"broken": ' }, status: [400] });
  addCase(ctx, { ...neg, title: `${label} with a JSON array instead of an object is rejected with ${bad.join('/')}`, data: { note: 'array body', body: [valid] }, status: bad });
  for (const f of tops.slice(0, 8)) {
    addCase(ctx, { ...neg, title: `${label} with wrong type for "${f.name}" (${describeWrongType(f.schema)}) is rejected with ${bad.join('/')}`, data: { note: `wrong type ${f.name}`, body: { ...(e.method === 'PATCH' ? valid : full), [f.name]: wrongTypeValue(f.schema) } }, status: bad });
  }
  for (const f of leaves.filter((l) => l.schema.enum?.length).slice(0, 3)) {
    addCase(ctx, { ...neg, title: `${label} with invalid enum value for "${f.path}" is rejected with ${bad.join('/')}`, data: { note: `invalid enum ${f.path}`, body: setAtPath(full, f.path, 'NOT_A_VALID_ENUM') }, status: bad });
  }
  for (const f of leaves.filter((l) => invalidFormatValue(l.schema)).slice(0, 3)) {
    addCase(ctx, { ...neg, title: `${label} with invalid ${f.schema.format} for "${f.path}" is rejected with ${bad.join('/')}`, data: { note: `invalid format ${f.path}`, body: setAtPath(full, f.path, invalidFormatValue(f.schema)) }, status: bad });
  }
  addCase(ctx, { ...neg, title: `${label} with Content-Type text/plain is rejected with 415/400`, data: { note: 'wrong content type', rawBody: JSON.stringify(full), contentType: 'text/plain' }, status: [415, 400], assumption: 'Wrong Content-Type expected to return 415 or 400 (not documented).' });
  const firstStr = leaves.find((l) => typeOf(l.schema) === 'string' && !l.schema.format && !l.schema.enum);
  if (firstStr) {
    for (const inj of INJECTION_STRINGS) {
      addCase(ctx, {
        ...neg,
        variant: 'tolerant',
        title: `${label} with ${inj.label} input in "${firstStr.path}" is rejected or stored safely, never a 5xx`,
        data: { note: inj.label, body: setAtPath(e.method === 'PATCH' ? valid : full, firstStr.path, inj.value) },
        status: [...successStatuses(e), 400, 422],
        assumption: undefined,
      });
    }
  }
  if (e.method === 'POST') {
    const unique = leaves.find((l) => /^(username|email)$/i.test(l.path.split('.').pop() ?? '') || /unique/i.test(l.schema.description ?? ''));
    if (unique) {
      addCase(ctx, { ...neg, variant: 'duplicate', title: `${label} twice with the same "${unique.path}" is rejected as a duplicate (409/400/422)`, data: { note: `duplicate ${unique.path}`, body: full }, status: [409, 400, 422], assumption: `"${unique.path}" assumed to be unique.` });
    } else {
      ctx.notApplicable.push(`${label}: duplicate creation - no uniqueness constraint documented or implied.`);
    }
  }
}

/** Negative cases for endpoints whose request body is a top-level JSON array (bulk create etc.). */
export function arrayBodyNegatives(ctx: Ctx, e: EndpointSpec, neg: { e: EndpointSpec; category: 'Negative'; variant: 'negative'; assumption?: string }, bad: number[]): void {
  const label = `${e.method} ${e.path}`;
  const itemSchema = e.requestBody!.schema.items ?? {};
  const full = validBody(e) as unknown[];
  const item = (full[0] ?? {}) as Record<string, unknown>;
  const isObjItem = typeOf(itemSchema) === 'object';
  const leaves = isObjItem ? leafFields(itemSchema).filter((l) => !l.schema.readOnly) : [];
  const tops = isObjItem ? topFields(itemSchema).filter((f) => !f.schema.readOnly) : [];

  addCase(ctx, { ...neg, title: `${label} with an empty JSON object {} instead of an array is rejected with ${bad.join('/')}`, data: { note: 'object instead of array (empty)', body: {} }, status: bad });
  addCase(ctx, { ...neg, title: `${label} with no body is rejected with ${bad.join('/')}`, data: { note: 'empty body', rawBody: '' }, status: bad });
  addCase(ctx, { ...neg, title: `${label} with malformed JSON is rejected with 400`, data: { note: 'malformed JSON', rawBody: '[{"broken": ' }, status: [400] });
  addCase(ctx, { ...neg, title: `${label} with wrong type for the request body (single object instead of array) is rejected with ${bad.join("/")}`, data: { note: 'object body instead of array', body: item }, status: bad });
  addCase(ctx, { ...neg, title: `${label} with wrong type for an array item (null) is rejected with ${bad.join("/")}`, data: { note: 'null item', body: [null] }, status: bad });
  addCase(ctx, { ...neg, title: `${label} with wrong type for an array item (primitive instead of ${typeOf(itemSchema) ?? "object"}) is rejected with ${bad.join("/")}`, data: { note: 'primitive item', body: [typeOf(itemSchema) === 'string' ? 12345 : 'not-an-object'] }, status: bad });
  for (const f of leaves.filter((l) => l.required).slice(0, 10)) {
    addCase(ctx, { ...neg, title: `${label} without required field "${f.path}" in the array item is rejected with ${bad.join("/")}`, data: { note: `item missing ${f.path}`, body: [setAtPath(item, f.path, undefined)] }, status: bad });
  }
  for (const f of tops.slice(0, 8)) {
    addCase(ctx, { ...neg, title: `${label} with wrong type for item field "${f.name}" (${describeWrongType(f.schema)}) is rejected with ${bad.join('/')}`, data: { note: `item wrong type ${f.name}`, body: [{ ...item, [f.name]: wrongTypeValue(f.schema) }] }, status: bad });
  }
  for (const f of leaves.filter((l) => l.schema.enum?.length).slice(0, 3)) {
    addCase(ctx, { ...neg, title: `${label} with invalid enum value for item field "${f.path}" is rejected with ${bad.join('/')}`, data: { note: `item invalid enum ${f.path}`, body: [setAtPath(item, f.path, 'NOT_A_VALID_ENUM')] }, status: bad });
  }
  for (const f of leaves.filter((l) => invalidFormatValue(l.schema)).slice(0, 3)) {
    addCase(ctx, { ...neg, title: `${label} with invalid ${f.schema.format} for item field "${f.path}" is rejected with ${bad.join('/')}`, data: { note: `item invalid format ${f.path}`, body: [setAtPath(item, f.path, invalidFormatValue(f.schema))] }, status: bad });
  }
  addCase(ctx, { ...neg, title: `${label} with Content-Type text/plain is rejected with 415/400`, data: { note: 'wrong content type', rawBody: JSON.stringify(full), contentType: 'text/plain' }, status: [415, 400], assumption: 'Wrong Content-Type expected to return 415 or 400 (not documented).' });
  const firstStr = leaves.find((l) => typeOf(l.schema) === 'string' && !l.schema.format && !l.schema.enum);
  if (firstStr) {
    for (const inj of INJECTION_STRINGS) {
      addCase(ctx, { ...neg, variant: 'tolerant', title: `${label} with ${inj.label} input in item field "${firstStr.path}" is rejected or stored safely, never a 5xx`, data: { note: inj.label, body: [setAtPath(item, firstStr.path, inj.value)] }, status: [...successStatuses(e), 400, 422], assumption: undefined });
    }
  }
  if (e.method === 'POST') {
    const unique = leaves.find((l) => /^(username|email)$/i.test(l.path.split('.').pop() ?? '') || /unique/i.test(l.schema.description ?? ''));
    if (unique) {
      addCase(ctx, { ...neg, variant: 'duplicate', title: `${label} twice with the same item "${unique.path}" is rejected as a duplicate (409/400/422)`, data: { note: `duplicate item ${unique.path}`, body: full }, status: [409, 400, 422], assumption: `"${unique.path}" assumed to be unique.` });
    } else {
      ctx.notApplicable.push(`${label}: duplicate creation - no uniqueness constraint documented or implied.`);
    }
  }
}

export const generator: CategoryGenerator = {
  name: 'negative',
  category: 'Negative',
  forEndpoint: (ctx, e, info) => negative(ctx, e, info.firstOnPath),
};
