/** Category generator: Positive-Functional. See .claude/skills for the rules this implements. */
import { leafFields, topFields, typeOf } from '../../../shared/helpers/json-schema';
import type { EndpointSpec, TestStep } from '../../../shared/helpers/types';
import { addCase, createEndpoint, patchBody, requiredQuery, resourceOf, successStatuses, validBody } from '../context';
import type { Ctx } from '../context';
import type { CategoryGenerator } from '../plugin';

export function positiveFunctional(ctx: Ctx, e: EndpointSpec): void {
  const { summary } = ctx;
  const r = resourceOf(summary, e);
  const ok = successStatuses(e);
  const label = `${e.method} ${e.path}`;
  if (e.isLogin) return; // login is covered in Auth
  const isList = e.method === 'GET' && typeOf(e.responseSchema) === 'array';

  // 1. happy path
  const body = e.method === 'PATCH' ? patchBody(e) : validBody(e);
  addCase(ctx, {
    e,
    category: 'Positive-Functional',
    variant: 'positive',
    title: `${label} with a valid request returns ${ok.join('/')} and the required fields`,
    data: { note: 'valid request', body },
    status: ok,
    echo: body !== undefined && ['POST', 'PUT', 'PATCH'].includes(e.method),
    matchId: e.method === 'GET' && e.pathParams.length > 0 && r?.itemPath === e.path,
    nonEmptyArray: isList,
  });

  // 2. optional fields omitted / included
  if (e.requestBody && ['POST', 'PUT'].includes(e.method)) {
    const arrayBody = typeOf(e.requestBody.schema) === 'array';
    const all = topFields(arrayBody ? e.requestBody.schema.items : e.requestBody.schema).filter((f) => !f.schema.readOnly);
    if (all.some((f) => !f.required)) {
      addCase(ctx, {
        e,
        category: 'Positive-Functional',
        variant: 'positive',
        title: `${label} with only required fields${arrayBody ? ' in each item' : ''} (optional fields omitted) succeeds`,
        data: { note: 'required fields only', body: validBody(e, true) },
        status: ok,
        echo: true,
      });
    } else {
      ctx.notApplicable.push(`${label}: "optional fields omitted" - every documented field is required.`);
    }
  }

  // 3. idempotency
  if (e.method === 'GET') {
    addCase(ctx, { e, category: 'Positive-Functional', variant: 'idempotent-read', flow: 'idempotent', title: `${label} is idempotent (two identical calls return identical bodies)`, data: { note: 'idempotency' }, status: ok });
  } else if (e.method === 'PUT') {
    addCase(ctx, { e, category: 'Positive-Functional', variant: 'idempotent-put', flow: 'idempotent', title: `${label} is idempotent (same body twice gives the same result)`, data: { note: 'idempotency', body }, status: ok });
  } else if (e.method === 'DELETE') {
    addCase(ctx, {
      e,
      category: 'Positive-Functional',
      variant: 'idempotent-delete',
      flow: 'idempotent',
      title: `${label} repeated on the same id is idempotent (second call ${e.notFoundStatus} or same success)`,
      data: { note: 'idempotency' },
      status: ok,
      schema: false,
    });
  }

  // 4. filters / search / pagination
  if (isList) {
    const itemSchema = e.responseSchema?.items;
    for (const q of e.queryParams.filter((p) => !/^(_?page|_?limit|offset|per_page|size)$/i.test(p.name))) {
      const itemField = itemSchema?.properties?.[q.name];
      if (itemField && ['array', 'object'].includes(typeOf(itemField) ?? '')) {
        ctx.notApplicable.push(`${label}: exact-match filter check for "${q.name}" - the matching item field is a ${typeOf(itemField)}, so per-item equality cannot be asserted (covered by the happy-path schema check).`);
      } else if (itemField) {
        const scalar = typeOf(q.schema) === 'array' && q.schema.items ? q.schema.items : q.schema;
        const value = scalar.enum?.[0] ?? q.schema.example ?? r?.sampleId ?? 1;
        addCase(ctx, {
          e,
          category: 'Positive-Functional',
          variant: 'filter-all',
          flow: 'filter-subset',
          title: `${label}?${q.name}=${String(value)} returns only items whose ${q.name} matches`,
          data: { note: 'filter', query: { ...requiredQuery(e), [q.name]: typeOf(scalar) === 'integer' || typeOf(scalar) === 'number' ? Number(value) : String(value) }, filterField: q.name },
          status: ok,
          nonEmptyArray: true,
        });
      } else if (r && createEndpoint(summary, r) && r.persistsWrites) {
        const setupBody = validBody(createEndpoint(summary, r)!);
        const leaf = leafFields(createEndpoint(summary, r)!.requestBody?.schema ?? {}).find((f) => f.path.split('.').pop() === q.name);
        if (!leaf) continue;
        const raw = leaf.path.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)?.[k], setupBody);
        addCase(ctx, {
          e,
          category: 'Positive-Functional',
          variant: 'filter-contains',
          flow: 'filter-subset',
          idSource: 'created',
          title: `${label}?${q.name}=<value of a newly created ${r.name}> returns that ${r.name}`,
          data: { note: 'filter on created resource', setupBody, query: { ...requiredQuery(e), [q.name]: String(raw) }, filterField: q.name },
          status: ok,
          nonEmptyArray: true,
          schema: true,
        });
      }
    }
    if (!e.pagination) ctx.notApplicable.push(`${label}: pagination/sorting - no pagination or sort parameters documented.`);
  }

  // 5. CRUD lifecycle (attached to the create endpoint)
  if (e.method === 'POST' && r && r.itemPath && r.collectionPath === e.path) {
    const put = summary.endpoints.find((x) => x.method === 'PUT' && x.path === r.itemPath);
    const patch = summary.endpoints.find((x) => x.method === 'PATCH' && x.path === r.itemPath);
    const del = summary.endpoints.find((x) => x.method === 'DELETE' && x.path === r.itemPath);
    const get = summary.endpoints.find((x) => x.method === 'GET' && x.path === r.itemPath);
    if (get) {
      const needs = [put, patch, del].some((x) => x?.requiresAuth);
      const steps: TestStep[] = [
        { action: `POST ${summary.baseUrl}${r.collectionPath} with a valid body`, expected: `HTTP ${e.successStatus}; response holds a new ${r.createIdPath ?? r.idField}` },
        { action: `GET ${summary.baseUrl}${r.itemPath} with the new id`, expected: `HTTP ${get.successStatus}; body equals the created payload` },
      ];
      if (put) steps.push({ action: `PUT ${summary.baseUrl}${r.itemPath} with a full replacement body`, expected: `HTTP ${put.successStatus}; body equals the replacement payload` });
      if (put) steps.push({ action: `GET ${summary.baseUrl}${r.itemPath} again`, expected: 'Body equals the replacement payload' });
      if (patch) steps.push({ action: `PATCH ${summary.baseUrl}${r.itemPath} with one field`, expected: `HTTP ${patch.successStatus}; field updated` });
      if (del) steps.push({ action: `DELETE ${summary.baseUrl}${r.itemPath}`, expected: `HTTP ${successStatuses(del).join(' or ')}` });
      if (del) steps.push({ action: `GET ${summary.baseUrl}${r.itemPath} after delete`, expected: `HTTP ${get.notFoundStatus}` });
      addCase(ctx, {
        e,
        category: 'Positive-Functional',
        variant: 'lifecycle',
        flow: 'crud-lifecycle',
        idSource: 'none',
        priority: 'High',
        title: `CRUD lifecycle for ${r.name}: create, read, update, delete, then ${get.notFoundStatus} on re-read`,
        description: `Created data is retrievable and matches the payload; updates persist; deleted resource is gone.${r.persistsWrites ? '' : ' The documentation says writes are simulated, so this test is expected to expose that.'}`,
        data: { note: 'lifecycle', body: validBody(e), updateBody: put ? validBody(put) : undefined, patchBody: patch ? patchBody(patch) : undefined },
        status: [e.successStatus],
        requiresCredentials: needs ? 'admin' : 'none',
        steps,
      });
    }
  }
}

export const generator: CategoryGenerator = {
  name: 'positive-functional',
  category: 'Positive-Functional',
  forEndpoint: (ctx, e) => positiveFunctional(ctx, e),
};
