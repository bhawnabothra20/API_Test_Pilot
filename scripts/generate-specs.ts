/**
 * Stage 6 - script writer.
 * Input : endpoint-summary.json + testcases.json
 * Output: api/<name>/schemas/<group>.schema.ts (zod) and api/<name>/tests/<group>.spec.ts (Playwright)
 *
 * The generated code follows .claude/skills/playwright-api-writer/SKILL.md:
 *  - one spec per resource group, test.describe per category
 *  - title "[TC_ID] description", identical to the qTest Automation ID
 *  - every test asserts status, headers, schema, business fields and response time (negative: status,
 *    error body, never 5xx)
 */
import fs from 'node:fs';
import path from 'node:path';
import { apiPaths, readJson } from '../shared/helpers/env';
import { typeOf } from '../shared/helpers/json-schema';
import { CATEGORIES, type EndpointSpec, type EndpointSummary, type JsonSchema, type ResourceSpec, type TestCase, type TestCaseFile } from '../shared/helpers/types';

const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

// ----------------------------------------------------------------------------- zod source

function zodSource(s: JsonSchema | undefined, indent = '  '): string {
  if (!s) return 'z.unknown()';
  let out: string;
  const t = typeOf(s);
  if (s.enum?.length && (t === 'string' || t === undefined) && s.enum.every((v) => typeof v === 'string')) {
    out = `z.enum([${s.enum.map((v) => q(String(v))).join(', ')}])`;
  } else if (s.enum?.length && s.enum.every((v) => typeof v === 'number')) {
    out = `z.union([${s.enum.map((v) => `z.literal(${v})`).join(', ')}, z.never()])`;
  } else {
    switch (t) {
      case 'string': {
        out = 'z.string()';
        if (s.format === 'date-time') out += '.datetime({ offset: true })';
        else if (s.format === 'date') out += '.regex(/^\\d{4}-\\d{2}-\\d{2}$/, "ISO 8601 date (YYYY-MM-DD)")';
        else if (s.format === 'email') out += '.email()';
        else if (s.format === 'uri') out += '.url()';
        else if (s.format === 'uuid') out += '.uuid()';
        if (s.minLength !== undefined) out += `.min(${s.minLength})`;
        if (s.maxLength !== undefined) out += `.max(${s.maxLength})`;
        break;
      }
      case 'integer':
      case 'number':
        out = t === 'integer' ? 'z.number().int()' : 'z.number()';
        if (s.minimum !== undefined) out += `.gte(${s.minimum})`;
        if (s.maximum !== undefined) out += `.lte(${s.maximum})`;
        break;
      case 'boolean':
        out = 'z.boolean()';
        break;
      case 'null':
        out = 'z.null()';
        break;
      case 'array':
        out = `z.array(${zodSource(s.items, indent)})`;
        if (s.minItems !== undefined) out += `.min(${s.minItems})`;
        if (s.maxItems !== undefined) out += `.max(${s.maxItems})`;
        break;
      case 'object': {
        const props = Object.entries(s.properties ?? {});
        if (props.length === 0) {
          out = 'z.record(z.unknown())';
          break;
        }
        const inner = indent + '  ';
        const lines = props.map(([k, v]) => {
          const req = (s.required ?? []).includes(k);
          const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : q(k);
          return `${inner}${key}: ${zodSource(v, inner)}${req ? '' : '.optional()'},`;
        });
        out = `z\n${indent}.object({\n${lines.join('\n')}\n${indent}})\n${indent}.passthrough()`;
        break;
      }
      default:
        out = 'z.unknown()';
    }
  }
  if (s.nullable) out += '.nullable()';
  return out;
}

export function schemaExportName(e: EndpointSpec): string {
  return (
    e.id
      .split('_')
      .map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase())
      .join('') + 'Response'
  );
}

/** Documented key tree of a schema (for the undocumented-field check); undefined when free-form. */
function shapeOf(s: JsonSchema | undefined): unknown {
  const t = typeOf(s);
  if (t === 'array') return [shapeOf(s?.items) ?? true];
  if (t === 'object' && s?.properties && Object.keys(s.properties).length) {
    return Object.fromEntries(Object.entries(s.properties).map(([k, v]) => [k, shapeOf(v) ?? true]));
  }
  return t === 'object' ? {} : true;
}

/** An undocumented-field check only makes sense against a documented (not sample-inferred) schema. */
export function hasDocumentedShape(e: EndpointSpec): boolean {
  return !e.inferred && !!e.responseSchema && /json/i.test(e.responseContentType);
}

/** Writes a generated file only when its content changed; returns true when written. */
function writeIfChanged(file: string, content: string): boolean {
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) return false;
  fs.writeFileSync(file, content, 'utf8');
  return true;
}

function writeSchemas(summary: EndpointSummary, groups: string[]): string[] {
  const written: string[] = [];
  const dir = apiPaths(summary.apiName).schemas;
  fs.mkdirSync(dir, { recursive: true });
  for (const g of groups) {
    const eps = summary.endpoints.filter((e) => e.group === g && e.responseSchema && /json/i.test(e.responseContentType));
    const shapes = eps.filter(hasDocumentedShape);
    const body = eps
      .map((e) => `/** ${e.method} ${e.path} - ${e.summary.replace(/\*\//g, '')} */\nexport const ${schemaExportName(e)} = ${zodSource(e.responseSchema)};\nexport type ${schemaExportName(e)} = z.infer<typeof ${schemaExportName(e)}>;\n`)
      .join('\n');
    const shapeBody = shapes
      .map((e) => `/** documented fields of ${e.method} ${e.path} (excessive data exposure check) */\nexport const ${schemaExportName(e).replace(/Response$/, 'Shape')}: Shape = ${JSON.stringify(shapeOf(e.responseSchema))};\n`)
      .join('\n');
    const content =
      `// Generated from spec/endpoint-summary.json by scripts/generate-specs.ts.\n// Response schemas for the "${g}" group: type, format and presence of every field.\nimport { z } from 'zod';\n` +
      (shapes.length ? `import type { Shape } from '../../../shared/helpers/authz';\n` : '') +
      `\n${body || 'export {};\n'}${shapeBody ? `\n${shapeBody}` : ''}`;
    if (writeIfChanged(path.join(dir, `${g}.schema.ts`), content)) written.push(`${g}.schema.ts`);
  }
  // schema files of groups that no longer exist
  for (const old of fs.readdirSync(dir).filter((f) => f.endsWith('.schema.ts') && !groups.includes(f.replace(/\.schema\.ts$/, '')))) {
    fs.rmSync(path.join(dir, old));
    written.push(`${old} (removed)`);
  }
  return written;
}

// ----------------------------------------------------------------------------- test source

interface Gen {
  summary: EndpointSummary;
  endpoint: EndpointSpec;
  resource?: ResourceSpec;
  tc: TestCase;
}

function resourceOf(summary: EndpointSummary, e: EndpointSpec): ResourceSpec | undefined {
  return (
    summary.resources.find((r) => r.collectionPath === e.path || r.itemPath === e.path) ??
    summary.resources.find((r) => r.itemPath && e.path.startsWith(r.itemPath))
  );
}

function sendCall(g: Gen, opts: { method?: string; path?: string; idVar?: string; identity?: string; bodyExpr?: string } = {}): string {
  const { tc, endpoint } = g;
  const p = opts.path ?? tc.request.path;
  const idParam = endpoint.pathParams[0]?.name;
  const override = opts.idVar && idParam ? `, { ${/^[A-Za-z_$][\w$]*$/.test(idParam) ? idParam : q(idParam)}: ${opts.idVar} }` : '';
  return `api.send({ method: ${q(opts.method ?? tc.request.method)}, path: ${q(p)}, identity: ${q(opts.identity ?? tc.request.identity)}, ...fromData(input${override}) })`;
}

function contentTypeAssert(e: EndpointSpec, v = 'res'): string {
  if (/json/i.test(e.responseContentType)) return `expectJsonContentType(${v});`;
  const main = e.responseContentType.split(';')[0].replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  return `expectContentType(${v}, /${main}/i);`;
}

/** Assertions for a positive response. */
function positiveAsserts(g: Gen, v = 'res', idVar?: string): string[] {
  const { tc, endpoint, resource } = g;
  const lines = [`expectStatus(${v}, ${JSON.stringify(tc.expected.status)});`, contentTypeAssert(endpoint, v), `expectResponseTime(${v}, limits.responseTimeMs);`];
  if (tc.expected.schema) {
    lines.push(`const body = expectSchema(${v}, S.${tc.expected.schema});`);
  } else {
    lines.push(`const body = ${v}.json;`);
  }
  if (tc.expected.nonEmptyArray) lines.push('expectNonEmptyArray(body);');
  if (tc.expected.fields && idVar && resource) lines.push(`expectFields(body, { ${q(resource.idField)}: ${idVar} });`);
  if (tc.expected.echo) {
    const entityPath = tc.request.method === 'POST' && resource?.createEntityPath ? resource.createEntityPath : '';
    lines.push(entityPath ? `expectEcho(input.body, getAtPath(body, ${q(entityPath)}));` : 'expectEcho(input.body, body);');
  }
  if (!tc.expected.schema && !tc.expected.echo && !tc.expected.nonEmptyArray && /json/i.test(endpoint.responseContentType) && tc.request.method !== 'DELETE') {
    lines.push('expect(body, "JSON body present").not.toBeUndefined();');
  }
  // Text responses: a read/write must return content; a DELETE may legitimately return an empty body.
  if (!/json/i.test(endpoint.responseContentType) && tc.request.method !== 'DELETE') {
    lines.push(`expect(${v}.text.trim().length, 'non-empty body').toBeGreaterThan(0);`);
  }
  return lines;
}

function negativeAsserts(g: Gen, v = 'res'): string[] {
  const { tc } = g;
  return [
    `expectNoServerError(${v});`,
    `expectStatus(${v}, ${JSON.stringify(tc.expected.status)});`,
    `expectErrorBody(${v}, ${q(tc.expected.errorBody ?? 'safe')});`,
    `expectResponseTime(${v}, limits.responseTimeMs);`,
  ];
}

function tolerantAsserts(g: Gen, v = 'res'): string[] {
  const lines = [`expectNoServerError(${v});`, `expectStatus(${v}, ${JSON.stringify(g.tc.expected.status)});`, `expectNoLeak(${v});`, `expectResponseTime(${v}, limits.responseTimeMs);`];
  if (g.tc.expected.robust) {
    // undocumented limit: accepted input must be stored exactly; rejection is fine
    const entityPath = g.tc.request.method === 'POST' && g.resource?.createEntityPath ? g.resource.createEntityPath : '';
    lines.push(entityPath ? `expectEchoIfAccepted(${v}, input.body, ${q(entityPath)});` : `expectEchoIfAccepted(${v}, input.body);`);
  }
  return lines;
}

/** Wraps a block with the id acquisition the case needs. */
function withId(g: Gen, inner: (idVar?: string) => string[]): string[] {
  const { tc } = g;
  const group = g.resource?.name ?? tc.group;
  switch (tc.request.idSource) {
    case 'existing':
      return [`const id = await api.existingId(${q(group)});`, ...inner('id')];
    case 'created':
      return [`await api.withResource(${q(group)}, input.setupBody, async (id) => {`, ...inner('id').map((l) => `  ${l}`), '});'];
    default:
      return inner(undefined);
  }
}

function bodyFor(g: Gen): string[] {
  const { tc, endpoint, resource, summary } = g;
  switch (tc.variant) {
    case 'positive':
      return withId(g, (id) => [`const res = await ${sendCall(g, { idVar: id })};`, ...positiveAsserts(g, 'res', id)]);
    case 'negative':
      return withId(g, (id) => [`const res = await ${sendCall(g, { idVar: id })};`, ...negativeAsserts(g)]);
    case 'tolerant':
      return withId(g, (id) => [`const res = await ${sendCall(g, { idVar: id })};`, ...tolerantAsserts(g)]);
    case 'auth-reject':
      return withId(g, (id) => [`const res = await ${sendCall(g, { idVar: id })};`, ...negativeAsserts(g), 'expect(res.status, "rejected credentials must not succeed").toBeGreaterThanOrEqual(400);']);
    case 'duplicate':
      return [
        `const first = await ${sendCall(g)};`,
        `expectStatus(first, ${JSON.stringify(endpoint.successStatus ? [endpoint.successStatus] : [201])});`,
        `const res = await ${sendCall(g)};`,
        ...(tc.expected.robust ? tolerantAsserts(g) : negativeAsserts(g)),
        ...(resource?.persistsWrites
          ? [
              `for (const r of [first, res]) {`,
              `  const createdId = getAtPath(r.json, ${q(resource.createIdPath ?? resource.idField)});`,
              `  if (typeof createdId === 'string' || typeof createdId === 'number') await api.remove(${q(resource.name)}, createdId);`,
              `}`,
            ]
          : []),
      ];
    case 'login-valid': {
      const tokenField = summary.auth.login?.tokenField ?? 'token';
      return [
        `const res = await ${sendCall(g)};`,
        ...positiveAsserts(g),
        `const token = getAtPath(body, ${q(tokenField)});`,
        `expect(typeof token, 'login returns a token string').toBe('string');`,
        `expect(String(token).length, 'token is not empty').toBeGreaterThan(0);`,
      ];
    }
    case 'login-reject': {
      const tokenField = summary.auth.login?.tokenField ?? 'token';
      // the security property first: a rejected login must never issue a token. Then the status, so a
      // failing status check proves no token was issued (triage relies on this order).
      return [`const res = await ${sendCall(g)};`, `expect(getAtPath(res.json, ${q(tokenField)}), 'no token for rejected login').toBeUndefined();`, ...negativeAsserts(g)];
    }
    case 'filter-all':
      return [
        `const res = await ${sendCall(g)};`,
        ...positiveAsserts(g),
        `const field = input.filterField ?? '';`,
        `expectAllItems(body, field, input.query?.[field]);`,
      ];
    case 'filter-contains': {
      const idField = resource?.idField ?? 'id';
      return withId(g, (id) => [
        `const res = await ${sendCall(g)};`,
        ...positiveAsserts(g),
        `const ids = (body as unknown[]).map((item) => getAtPath(item, ${q(idField)}));`,
        `expect(ids, 'created ${resource?.name ?? 'item'} is part of the filtered result').toContainEqual(${id ?? 'undefined'});`,
      ]);
    }
    case 'idempotent-read':
    case 'idempotent-put':
      return withId(g, (id) => [
        `const first = await ${sendCall(g, { idVar: id })};`,
        `const second = await ${sendCall(g, { idVar: id })};`,
        ...positiveAsserts(g, 'first', id),
        `expectStatus(second, ${JSON.stringify(tc.expected.status)});`,
        `expectSameBody(first, second);`,
      ]);
    case 'idempotent-delete':
      return withId(g, (id) => [
        `const first = await ${sendCall(g, { idVar: id })};`,
        ...positiveAsserts(g, 'first', id),
        `const second = await ${sendCall(g, { idVar: id })};`,
        `expectNoServerError(second);`,
        `expectStatus(second, ${JSON.stringify([...new Set([...tc.expected.status, endpoint.notFoundStatus])])});`,
      ]);
    case 'lifecycle':
      return lifecycle(g);
    case 'data-exposure':
      return withId(g, (id) => [
        `const res = await ${sendCall(g, { idVar: id })};`,
        ...positiveAsserts(g, 'res', id),
        `expectNoSensitiveFields(res.json);`,
        ...(hasDocumentedShape(endpoint) ? [`expectNoUndocumentedFields(res.json, S.${schemaExportName(endpoint).replace(/Response$/, 'Shape')});`] : []),
      ]);
    case 'mass-assignment':
      return massAssignment(g);
    case 'token-hygiene':
      return tokenHygiene(g);
  }
}

function idParamKey(name: string | undefined): string {
  const n = name ?? 'id';
  return /^[A-Za-z_$][\w$]*$/.test(n) ? n : q(n);
}

/** Mass assignment: privileged fields sent; on 2xx the re-read resource must not hold them. */
function massAssignment(g: Gen): string[] {
  const { tc, resource: r, summary, endpoint } = g;
  if (!r?.itemPath) return ['test.skip(true, "resource has no item path");'];
  const get = summary.endpoints.find((x) => x.method === 'GET' && x.path === r.itemPath)!;
  const p = idParamKey(r.idParam);
  const reread = (idExpr: string) => [
    `const read = await api.send({ method: 'GET', path: ${q(r.itemPath!)}, identity: 'default', pathParams: { ${p}: ${idExpr} } });`,
    `expectStatus(read, ${JSON.stringify([get.successStatus])});`,
    `expectJsonContentType(read);`,
    ...(get.responseSchema ? [`expectSchema(read, S.${schemaExportName(get)});`] : []),
    `expectPrivilegedIgnored(read.json, input.privilegedFields ?? {});`,
  ];
  const accepted = [`expectNoServerError(res);`, `expectStatus(res, ${JSON.stringify(tc.expected.status)});`, `expectNoLeak(res);`, `expectResponseTime(res, limits.responseTimeMs);`];
  if (endpoint.method === 'POST') {
    return [
      `const res = await ${sendCall(g)};`,
      ...accepted,
      `if (res.status >= 200 && res.status < 300) {`,
      `  const created = getAtPath(res.json, ${q(r.createIdPath ?? r.idField)}) ?? getAtPath(input.body, ${q(r.idField)});`,
      `  expect(['string', 'number'], 'create response returns an id').toContain(typeof created);`,
      `  try {`,
      ...reread('created as string | number').map((l) => `    ${l}`),
      `  } finally {`,
      `    await api.remove(${q(r.name)}, created as string | number);`,
      `  }`,
      `}`,
    ];
  }
  return withId(g, (id) => [
    `const res = await ${sendCall(g, { idVar: id })};`,
    ...accepted,
    `if (res.status >= 200 && res.status < 300) {`,
    ...reread(id ?? 'undefined as never').map((l) => `  ${l}`),
    `}`,
  ]);
}

/** Token hygiene: token in query / alg:none / tampered signature / reuse after logout -> rejected. */
function tokenHygiene(g: Gen): string[] {
  const { tc, summary } = g;
  const what = `${tc.request.method} ${tc.request.path}`;
  const kind = tc.request.tokenTest ?? 'tampered';
  return withId(g, (id) => {
    const override = id ? `, { ${idParamKey(g.endpoint.pathParams[0]?.name)}: ${id} }` : '';
    const base = `method: ${q(tc.request.method)}, path: ${q(tc.request.path)}, identity: 'admin', ...fromData(input${override})`;
    if (kind !== 'afterLogout') {
      return [
        `const res = await api.send({ ${base}, tokenMutation: ${q(kind)} });`,
        `expectAccessDenied(res, ${JSON.stringify(tc.expected.status)}, limits.responseTimeMs, ${q(`${kind} token on ${what}`)});`,
      ];
    }
    const logout = summary.endpoints.find((e) => /\/(logout|signout|sign-out|log-out)$/i.test(e.path));
    if (!logout) return [`test.skip(true, 'no logout endpoint documented');`];
    return [
      `const token = await api.freshToken('admin'); // a separate session - the shared token stays valid`,
      `const out = await api.send({ method: ${q(logout.method)}, path: ${q(logout.path)}, identity: 'admin', token });`,
      `expectNoServerError(out);`,
      `expect(out.status, 'logout succeeds').toBeLessThan(300);`,
      `const res = await api.send({ ${base}, token });`,
      `expectAccessDenied(res, ${JSON.stringify(tc.expected.status)}, limits.responseTimeMs, ${q(`token reuse after logout on ${what}`)});`,
    ];
  });
}

function lifecycle(g: Gen): string[] {
  const { summary, resource: r, endpoint } = g;
  if (!r?.itemPath) return ['test.skip(true, "resource has no item path");'];
  const find = (m: string) => summary.endpoints.find((x) => x.method === m && x.path === r.itemPath);
  const get = find('GET')!;
  const put = find('PUT');
  const patch = find('PATCH');
  const del = find('DELETE');
  const idParam = /^[A-Za-z_$][\w$]*$/.test(r.idParam ?? 'id') ? (r.idParam ?? 'id') : q(r.idParam ?? 'id');
  const entity = r.createEntityPath ? `getAtPath(created.json, ${q(r.createEntityPath)})` : 'created.json';
  if (!r.persistsWrites) return simulatedLifecycle(g, r, { get, put, patch, del }, idParam, entity);
  const lines = [
    `// 1. create`,
    `const created = await api.send({ method: 'POST', path: ${q(r.collectionPath)}, identity: 'default', body: input.body });`,
    `expectStatus(created, ${JSON.stringify([endpoint.successStatus])});`,
    `expectJsonContentType(created);`,
    `expectResponseTime(created, limits.responseTimeMs);`,
    ...(g.tc.expected.schema ? [`expectSchema(created, S.${g.tc.expected.schema});`] : []),
    `expectEcho(input.body, ${entity});`,
    `const id = getAtPath(created.json, ${q(r.createIdPath ?? r.idField)});`,
    `expect(['string', 'number'], 'create response returns an id').toContain(typeof id);`,
    `const itemId = id as string | number;`,
    `let deleted = false;`,
    `try {`,
    `  // 2. read back - created data must be retrievable and identical`,
    `  const read = await api.send({ method: 'GET', path: ${q(r.itemPath)}, identity: 'default', pathParams: { ${idParam}: itemId } });`,
    `  expectStatus(read, ${JSON.stringify([get.successStatus])});`,
    ...(get.responseSchema ? [`  expectSchema(read, S.${schemaExportName(get)});`] : []),
    `  expectEcho(input.body, read.json);`,
  ];
  if (put) {
    lines.push(
      `  // 3. full update`,
      `  const updated = await api.send({ method: 'PUT', path: ${q(r.itemPath)}, identity: 'default', pathParams: { ${idParam}: itemId }, body: input.updateBody });`,
      `  expectStatus(updated, ${JSON.stringify([put.successStatus])});`,
      `  expectEcho(input.updateBody, updated.json);`,
      `  const reread = await api.send({ method: 'GET', path: ${q(r.itemPath)}, identity: 'default', pathParams: { ${idParam}: itemId } });`,
      `  expectStatus(reread, ${JSON.stringify([get.successStatus])});`,
      `  expectEcho(input.updateBody, reread.json);`,
    );
  }
  if (patch) {
    lines.push(
      `  // 4. partial update`,
      `  const patched = await api.send({ method: 'PATCH', path: ${q(r.itemPath)}, identity: 'default', pathParams: { ${idParam}: itemId }, body: input.patchBody });`,
      `  expectStatus(patched, ${JSON.stringify([patch.successStatus])});`,
      `  expectEcho(input.patchBody, patched.json);`,
    );
  }
  if (del) {
    const delOk = del.inferred ? [...new Set([del.successStatus, 204])] : [del.successStatus];
    lines.push(
      `  // 5. delete, then the resource must be gone`,
      `  const removed = await api.send({ method: 'DELETE', path: ${q(r.itemPath)}, identity: 'default', pathParams: { ${idParam}: itemId } });`,
      `  expectStatus(removed, ${JSON.stringify(delOk)});`,
      `  deleted = true;`,
      `  const gone = await api.send({ method: 'GET', path: ${q(r.itemPath)}, identity: 'default', pathParams: { ${idParam}: itemId } });`,
      `  expectStatus(gone, ${JSON.stringify([get.notFoundStatus])});`,
    );
  }
  lines.push(`} finally {`, `  if (!deleted) await api.remove(${q(r.name)}, itemId);`, `}`);
  return lines;
}

/** Lines that load the case's data and run its request + assertions. */
function caseBody(g: Gen): string[] {
  const { tc } = g;
  return [`const input = data.entry(${q(tc.request.dataFile ?? 'valid')}, ${q(tc.request.dataKey ?? tc.id)});`, ...bodyFor(g)];
}

/**
 * Lifecycle for APIs whose documentation states that writes are simulated: verifies THAT contract -
 * writes are answered as if they happened (status, echo, id) and nothing is persisted.
 */
function simulatedLifecycle(
  g: Gen,
  r: ResourceSpec,
  eps: { get: EndpointSpec; put?: EndpointSpec; patch?: EndpointSpec; del?: EndpointSpec },
  idParam: string,
  entity: string,
): string[] {
  const { get, put, patch, del } = eps;
  const lines = [
    `// documented: this API simulates writes - verify the simulation contract`,
    `// 1. create is answered as if it happened`,
    `const created = await api.send({ method: 'POST', path: ${q(r.collectionPath)}, identity: 'default', body: input.body });`,
    `expectStatus(created, ${JSON.stringify([g.endpoint.successStatus])});`,
    `expectJsonContentType(created);`,
    `expectResponseTime(created, limits.responseTimeMs);`,
    ...(g.tc.expected.schema ? [`expectSchema(created, S.${g.tc.expected.schema});`] : []),
    `expectEcho(input.body, ${entity});`,
    `const createdId = getAtPath(created.json, ${q(r.createIdPath ?? r.idField)});`,
    `expect(['string', 'number'], 'create response returns an id').toContain(typeof createdId);`,
    `// 2. ...but nothing is persisted`,
    `const notStored = await api.send({ method: 'GET', path: ${q(r.itemPath!)}, identity: 'default', pathParams: { ${idParam}: createdId as string | number } });`,
    `expectStatus(notStored, ${JSON.stringify([get.notFoundStatus])});`,
    `// 3. updates and delete of an existing resource are answered as if they happened`,
    `const id = await api.existingId(${q(r.name)});`,
  ];
  if (put) {
    lines.push(
      `const updated = await api.send({ method: 'PUT', path: ${q(r.itemPath!)}, identity: 'default', pathParams: { ${idParam}: id }, body: input.updateBody });`,
      `expectStatus(updated, ${JSON.stringify([put.successStatus])});`,
      `expectEcho(input.updateBody, updated.json);`,
    );
  }
  if (patch) {
    lines.push(
      `const patched = await api.send({ method: 'PATCH', path: ${q(r.itemPath!)}, identity: 'default', pathParams: { ${idParam}: id }, body: input.patchBody });`,
      `expectStatus(patched, ${JSON.stringify([patch.successStatus])});`,
      `expectEcho(input.patchBody, patched.json);`,
    );
  }
  if (del) {
    const delOk = del.inferred ? [...new Set([del.successStatus, 204])] : [del.successStatus];
    lines.push(
      `const removed = await api.send({ method: 'DELETE', path: ${q(r.itemPath!)}, identity: 'default', pathParams: { ${idParam}: id } });`,
      `expectStatus(removed, ${JSON.stringify(delOk)});`,
      `// 4. the "deleted" resource is still there`,
      `const still = await api.send({ method: 'GET', path: ${q(r.itemPath!)}, identity: 'default', pathParams: { ${idParam}: id } });`,
      `expectStatus(still, ${JSON.stringify([get.successStatus])});`,
    );
  }
  return lines;
}

function testSource(g: Gen): string {
  const { tc } = g;
  const title = `[${tc.id}] ${tc.title}`;
  const lines: string[] = [];
  if (tc.requiresCredentials !== 'none') lines.push(`requireCredentials(${q(tc.requiresCredentials)});`);
  if (tc.subCases?.length) {
    // high-level case: every detailed check runs as its own step; all failures are collected and reported
    lines.push('const failures: string[] = [];');
    for (const sub of tc.subCases) {
      // business-level cases combine checks of several endpoints of one resource: each step uses its own
      const endpoint = g.summary.endpoints.find((e) => e.id === sub.endpointId) ?? g.endpoint;
      const body = caseBody({ ...g, endpoint, resource: resourceOf(g.summary, endpoint), tc: sub });
      if (sub.requiresCredentials !== 'none' && sub.requiresCredentials !== tc.requiresCredentials) {
        body.unshift(`if (skipCheck(${q(sub.requiresCredentials)}, ${q(sub.id)})) return;`);
      }
      lines.push(`await check(failures, ${q(`[${sub.id}] ${sub.title}`)}, async () => {`, ...body.map((l) => `  ${l}`), '});');
    }
    lines.push(`expectNoFailures(failures, ${tc.subCases.length});`);
  } else {
    lines.push(...caseBody(g));
  }
  const tag = tc.assumptionBased ? `, { annotation: { type: 'assumption', description: ${q(tc.assumption ?? '')} } }` : '';
  return `    test(${q(title)}${tag}, async ({ api, data }) => {\n${lines.map((l) => (l ? `      ${l}` : '')).join('\n')}\n    });`;
}

function specSource(summary: EndpointSummary, group: string, cases: TestCase[]): string {
  const hasSchemas = summary.endpoints.some((e) => e.group === group && e.responseSchema && /json/i.test(e.responseContentType));
  const blocks = CATEGORIES.map((cat) => {
    const inCat = cases.filter((c) => c.category === cat);
    if (!inCat.length) return '';
    const tests = inCat
      .map((tc) => {
        const endpoint = summary.endpoints.find((e) => e.id === tc.endpointId)!;
        return testSource({ summary, endpoint, resource: resourceOf(summary, endpoint), tc });
      })
      .join('\n\n');
    return `  test.describe(${q(cat)}, () => {\n${tests}\n  });`;
  })
    .filter(Boolean)
    .join('\n\n');

  const usesGetAtPath = /getAtPath\(/.test(blocks);
  const helpers = [
    'check',
    'expectNoFailures',
    'expectAllItems',
    'expectContentType',
    'expectEcho',
    'expectErrorBody',
    'expectFields',
    'expectJsonContentType',
    'expectNoLeak',
    'expectNoServerError',
    'expectNonEmptyArray',
    'expectResponseTime',
    'expectSameBody',
    'expectSchema',
    'expectStatus',
    'expectEchoIfAccepted',
  ].filter((h) => new RegExp(`\\b${h}\\(`).test(blocks));
  const authzHelpers = ['expectAccessDenied', 'expectNoSensitiveFields', 'expectNoUndocumentedFields', 'expectPrivilegedIgnored'].filter((h) =>
    new RegExp(`\\b${h}\\(`).test(blocks),
  );
  const fixtureImports = [
    'test',
    'expect',
    'limits',
    ...(/fromData\(/.test(blocks) ? ['fromData'] : []),
    ...(/requireCredentials\(/.test(blocks) ? ['requireCredentials'] : []),
    ...(/skipCheck\(/.test(blocks) ? ['skipCheck'] : []),
  ];
  return [
    `// Generated by scripts/generate-specs.ts from test-cases/testcases.json - API: ${summary.apiName}, group: ${group}.`,
    `// Test titles start with the qTest Automation ID. Regenerate instead of editing by hand where possible.`,
    `import { ${fixtureImports.join(', ')} } from '../../../shared/fixtures/api-fixture';`,
    helpers.length ? `import { ${helpers.join(', ')} } from '../../../shared/helpers/assertions';` : '',
    authzHelpers.length ? `import { ${authzHelpers.join(', ')} } from '../../../shared/helpers/authz';` : '',
    usesGetAtPath ? `import { getAtPath } from '../../../shared/helpers/json-schema';` : '',
    hasSchemas && /\bS\./.test(blocks) ? `import * as S from '../schemas/${group}.schema';` : '',
    '',
    `test.describe(${q(`${summary.apiName} / ${group}`)}, () => {`,
    blocks,
    '});',
    '',
  ]
    .filter((l, i) => l !== '' || i > 5)
    .join('\n');
}

/**
 * Writes tests/<group>.spec.ts and schemas/<group>.schema.ts. Files are rewritten only when their content
 * changed (spec-diff updates: an unchanged group keeps its files untouched); files of removed groups are deleted.
 */
export function generateSpecs(apiName: string): { files: string[]; tests: number; written: string[]; unchanged: string[]; removed: string[]; schemasWritten: string[] } {
  const paths = apiPaths(apiName);
  const summary = readJson<EndpointSummary>(paths.summary);
  const tcFile = readJson<TestCaseFile>(paths.testCasesJson);
  const groups = [...new Set(tcFile.cases.map((c) => c.group))];
  const schemasWritten = writeSchemas(summary, [...new Set(summary.endpoints.map((e) => e.group))]);
  fs.mkdirSync(paths.tests, { recursive: true });
  const wanted = new Set(groups.map((g) => `${g}.spec.ts`));
  const removed = fs.readdirSync(paths.tests).filter((f) => f.endsWith('.spec.ts') && !wanted.has(f));
  for (const old of removed) fs.rmSync(path.join(paths.tests, old));
  const files: string[] = [];
  const written: string[] = [];
  const unchanged: string[] = [];
  for (const g of groups) {
    const file = path.join(paths.tests, `${g}.spec.ts`);
    (writeIfChanged(file, specSource(summary, g, tcFile.cases.filter((c) => c.group === g))) ? written : unchanged).push(`${g}.spec.ts`);
    files.push(file);
  }
  return { files, tests: tcFile.cases.length, written, unchanged, removed, schemasWritten };
}

if (require.main === module) {
  const name = process.argv[2];
  if (!name) {
    console.error('usage: tsx scripts/generate-specs.ts <api-name>');
    process.exit(2);
  }
  const r = generateSpecs(name);
  console.log(`wrote ${r.files.length} spec files with ${r.tests} tests -> ${apiPaths(name).tests}`);
}
