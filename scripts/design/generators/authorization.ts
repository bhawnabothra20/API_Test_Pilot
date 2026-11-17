/**
 * Category generator: Authorization (OWASP API Top 10) with the single admin identity: excessive data
 * exposure (API3), mass assignment (API3) and token hygiene (API2). BOLA/BFLA/scope checks need further
 * identities and are not generated.
 */
import { PRIVILEGED_PROBES } from '../../../shared/helpers/data-mutators';
import { typeOf } from '../../../shared/helpers/json-schema';
import type { EndpointSpec, ResourceSpec, TestDataEntry } from '../../../shared/helpers/types';
import { addCase, isJson, patchBody, resourceOf, successStatuses, validBody } from '../context';
import type { Ctx } from '../context';
import type { CategoryGenerator } from '../plugin';

export const LOGOUT_PATH = /\/(logout|signout|sign-out|log-out)$/i;

/** Privileged / read-only fields to probe: generic probes + schema readOnly fields, minus legitimately writable ones. */
export function privilegedFieldsFor(e: EndpointSpec, r: ResourceSpec): Record<string, unknown> {
  const writable = new Set(Object.entries(e.requestBody?.schema.properties ?? {}).filter(([, s]) => !s.readOnly).map(([k]) => k));
  const probes: Record<string, unknown> = { ...PRIVILEGED_PROBES };
  for (const [k, s] of Object.entries(r.schema?.properties ?? {})) {
    if (!s.readOnly && k !== r.idField) continue;
    const t = typeOf(s);
    if (t === 'string') probes[k] = s.format === 'date-time' ? '2000-01-01T00:00:00.000Z' : 'mass-assignment-probe';
    else if (t === 'integer' || t === 'number') probes[k] = 987654321;
  }
  for (const k of Object.keys(probes)) if (writable.has(k)) delete probes[k];
  return probes;
}

export function authorization(ctx: Ctx): void {
  const { summary } = ctx;
  const a = summary.auth;
  const cat = 'Authorization' as const;
  const unauth = a.statusDocumented ? [a.unauthenticatedStatus] : [401, 403];
  const statusNote = a.statusDocumented ? undefined : 'Rejection status not documented: 401 or 403 accepted (never 2xx).';
  const jsonEndpoints = summary.endpoints.filter((e) => !e.isLogin && !(e.requestContentType && !/json/i.test(e.requestContentType)));

  for (const e of jsonEndpoints) {
    const label = `${e.method} ${e.path}`;
    const r = resourceOf(summary, e);
    const ok = successStatuses(e);
    const getItem = r?.itemPath ? summary.endpoints.find((x) => x.method === 'GET' && x.path === r.itemPath) : undefined;

    // 1. excessive data exposure (API3) - every JSON read
    if (e.method === 'GET' && isJson(e)) {
      addCase(ctx, {
        e,
        category: cat,
        variant: 'data-exposure',
        owasp: 'API3:2023',
        priority: 'High',
        title: `${label} exposes no sensitive fields (password/secret/token/ssn) and no fields outside the documented schema`,
        data: { note: 'excessive data exposure' },
        status: ok,
        schema: true,
        assumption: e.inferred ? 'Schema inferred from samples: only sensitive-field checks apply (undocumented-field check needs a documented schema).' : undefined,
      });
    }

    // 2. mass assignment (API3): privileged fields on create/update must be ignored or rejected
    const writes = (e.method === 'POST' && r?.collectionPath === e.path) || (['PUT', 'PATCH'].includes(e.method) && r?.itemPath === e.path);
    if (writes && r && e.requestBody && typeOf(e.requestBody.schema) === 'object') {
      if (!r.persistsWrites || !getItem) {
        ctx.notApplicable.push(`${label}: mass assignment - ${!r.persistsWrites ? 'writes are simulated' : 'no GET item endpoint'}, so the stored resource cannot be re-read.`);
      } else {
        const privileged = privilegedFieldsFor(e, r);
        const base = (e.method === 'PATCH' ? patchBody(e) : validBody(e)) as Record<string, unknown>;
        addCase(ctx, {
          e,
          category: cat,
          variant: 'mass-assignment',
          owasp: 'API3:2023',
          priority: 'High',
          title: `Mass assignment: ${label} ignores or rejects privileged fields (${Object.keys(privileged).join(', ')})`,
          data: { note: 'mass assignment', body: { ...base, ...privileged }, privilegedFields: privileged },
          status: [...ok, 400, 422],
          assumption: 'Privileged fields are not documented as writable: 2xx (fields ignored) and 400/422 (rejected) both pass; the re-read resource must not hold the sent values.',
        });
      }
    }
  }
  ctx.notApplicable.push('BOLA, BFLA and OAuth2 scope checks - not generated: the agent tests with one identity (admin) and does not run OAuth flows.');

  // 3. token hygiene (API2) - once per API, against a protected endpoint
  const target = [...jsonEndpoints].filter((e) => e.requiresAuth).sort((x, y) => (x.method === 'GET' ? -1 : 0) - (y.method === 'GET' ? -1 : 0))[0];
  if (!target || a.type === 'none') {
    ctx.notApplicable.push('Token hygiene - no protected endpoint / no token-based authentication.');
    return;
  }
  const label = `${target.method} ${target.path}`;
  const body = target.method === 'PATCH' ? patchBody(target) : validBody(target);
  const hygiene = (tokenTest: TestDataEntry['tokenTest'], title: string) => {
    const tc = addCase(ctx, {
      e: target,
      category: cat,
      variant: 'token-hygiene',
      owasp: 'API2:2023',
      priority: 'High',
      identity: 'admin',
      title,
      data: { note: `token hygiene: ${tokenTest}`, body, tokenTest },
      status: unauth,
      assumption: statusNote,
    });
    tc.request.tokenTest = tokenTest;
  };
  if (a.type !== 'basic') hygiene('query', `${label} rejects a valid token sent in the query string`);
  if (['bearer', 'cookie'].includes(a.type)) {
    hygiene('algNone', `${label} rejects a JWT signed with alg:none`);
    hygiene('tampered', `${label} rejects a token with a tampered signature`);
  } else {
    ctx.notApplicable.push(`Token hygiene alg:none / tampered signature - ${a.type} credentials are not signed tokens.`);
  }
  const logout = summary.endpoints.find((e) => LOGOUT_PATH.test(e.path));
  if (logout && a.login && ['bearer', 'cookie'].includes(a.type)) {
    hygiene('afterLogout', `${label} rejects a token after logout (${logout.method} ${logout.path})`);
  } else {
    ctx.notApplicable.push('Token reuse after logout - no logout endpoint with login-issued tokens documented.');
  }
}

export const generator: CategoryGenerator = {
  name: 'authorization',
  category: 'Authorization',
  forApi: (ctx) => authorization(ctx),
};
