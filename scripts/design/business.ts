/**
 * Business-level test cases (the DEFAULT level).
 *
 * 1. businessKeep(): an explicit allowlist of the checks a business reader cares about. Low-value technical
 *    checks are left out: idempotency repeats, separate Content-Type/response-time checks (every test asserts
 *    them anyway), null/{}/no-body/malformed-JSON/text-plain bodies, malformed ids, unsupported methods,
 *    injection strings, unknown query params, undocumented limits, decimal/huge/unicode/whitespace/date/array/id
 *    boundaries, expired/malformed/wrong-scheme tokens, random tokens on public endpoints and token-hygiene
 *    tricks (alg:none, tampered signature, token in query).
 * 2. businessScenario(): groups the kept checks into business scenarios per RESOURCE (not per endpoint):
 *    browse, view, create, update, delete, full lifecycle, invalid create/update, duplicates, access control,
 *    login, plus one scenario per non-CRUD operation, worded in business terms.
 * `--level high` (one case per endpoint + technical scenario, every check) and `--level detailed` (one case per
 * check) remain available for full technical coverage.
 */
import type { Category, EndpointSpec, EndpointSummary, TestCase } from '../../shared/helpers/types';
import { resourceOf } from './context';

export interface BusinessScenario {
  key: string;
  title: string;
  category: Category;
}

// ----------------------------------------------------------------------------- 1. which checks to keep

const DROP_NEGATIVE =
  /: null is rejected|with "[^"]*": null|empty JSON object|with no body|malformed JSON|JSON array instead|Content-Type text\/plain|invalid \w+ format|^Unsupported method|injection|special characters|unknown query parameter|wrong type for (an array item|item field|the request body)/;
const KEEP_BOUNDARY = /= (minimum|maximum)(\+1|-1)? is (accepted|rejected)|length \d+ \(max\+1\) is rejected|with max\+1 items|impossible date/;

/** true when the detailed check belongs in a business-level suite */
export function businessKeep(c: TestCase): boolean {
  const t = c.title;
  switch (c.category) {
    case 'Positive-Functional':
      return !c.variant.startsWith('idempotent');
    case 'Positive-DataValidation':
      return !/responds within|Content-Type header/.test(t);
    case 'Negative':
      return !DROP_NEGATIVE.test(t);
    case 'Boundary':
      // documented limits only: an undocumented (assumed) limit is not a business rule
      return !c.expected.robust && c.variant !== 'tolerant' && KEEP_BOUNDARY.test(t);
    case 'Auth':
      if (c.variant === 'login-valid' || c.variant === 'login-reject') return true;
      if (c.variant === 'auth-reject') return c.request.identity === 'none' || c.request.identity === 'invalid';
      return !(c.request.identity === 'invalid' && /^Public /.test(t)); // random token on a public endpoint
    case 'Authorization':
      return c.variant !== 'token-hygiene';
    default:
      return true;
  }
}

// ----------------------------------------------------------------------------- 2. business scenarios

type Role = 'browse' | 'view' | 'create' | 'update' | 'delete' | 'login' | 'other';

function roleOf(summary: EndpointSummary, e: EndpointSpec): Role {
  if (e.isLogin) return 'login';
  const r = resourceOf(summary, e);
  if (r && e.path === r.collectionPath) return e.method === 'GET' ? 'browse' : e.method === 'POST' ? 'create' : 'other';
  if (r && e.path === r.itemPath) {
    if (e.method === 'GET') return 'view';
    if (e.method === 'PUT' || e.method === 'PATCH') return 'update';
    if (e.method === 'DELETE') return 'delete';
  }
  return 'other';
}

/** path segments that name an action, not a business object (/user/createWithList, /pet/findByStatus) */
const ACTION_SEGMENT = /^(create|find|get|update|delete|list|search|login|logout|upload)|With[A-Z]|By[A-Z]/;

function nounFrom(path: string | undefined, fallback: string): { one: string; many: string } {
  const segs = (path ?? '').split('/').filter((s) => s && !s.startsWith('{') && !ACTION_SEGMENT.test(s));
  const word = (segs[segs.length - 1] ?? fallback).replace(/[-_]+/g, ' ');
  if (/ies$/.test(word)) return { one: word.replace(/ies$/, 'y'), many: word };
  if (/s$/.test(word) && !/ss$/.test(word)) return { one: word.replace(/s$/, ''), many: word };
  if (/[^aeiou]y$/.test(word)) return { one: word, many: word.replace(/y$/, 'ies') };
  return { one: word, many: `${word}s` };
}

/** "order" / "orders" from /store/order, "post" / "posts" from /posts, "user" from /user/createWithList */
export function nouns(summary: EndpointSummary, e: EndpointSpec): { one: string; many: string } {
  const r = resourceOf(summary, e);
  return nounFrom(r?.collectionPath ?? e.path, r?.name ?? e.group);
}

/** Business object of a whole resource group (used for scenarios spanning its endpoints). */
export function groupNouns(summary: EndpointSummary, group: string): { one: string; many: string } {
  const r = summary.resources.find((x) => x.name === group);
  return nounFrom(r?.collectionPath ?? `/${group}`, group);
}

const an = (w: string) => (/^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const isRejection = (c: TestCase) => c.category === 'Negative' || (c.category === 'Boundary' && c.variant === 'negative');

/** Which business scenario a kept detailed check belongs to. Keys are per resource group. */
export function businessScenario(c: TestCase, summary: EndpointSummary): BusinessScenario {
  const e = summary.endpoints.find((x) => x.id === c.endpointId);
  if (!e) return { key: c.id, title: c.title, category: c.category };
  const { one, many } = nouns(summary, e);
  const role = roleOf(summary, e);
  const op = e.summary?.trim() ? cap(e.summary.trim().replace(/\.$/, '')) : `${e.method} ${e.path}`;

  if (role === 'login') return { key: 'login', title: 'Log in with valid credentials; wrong or missing credentials are rejected without a token', category: 'Auth' };
  if (c.category === 'Auth' || c.category === 'Authorization') return { key: 'access', title: '', category: 'Auth' }; // title from members
  if (c.variant === 'lifecycle') {
    const simulated = /simulated-write/.test(c.title);
    return {
      key: 'lifecycle',
      title: simulated
        ? `Manage ${an(one)} end to end; as documented, changes are answered but not saved`
        : `Manage ${an(one)} end to end: create, view, update and delete it; it is gone afterwards`,
      category: 'Positive-Functional',
    };
  }
  if (c.variant === 'duplicate') return { key: 'duplicate', title: `Creating a duplicate ${one} is rejected`, category: 'Negative' };

  const rejection = isRejection(c);
  switch (role) {
    case 'browse':
      return rejection
        ? { key: 'browse-invalid', title: `Searching ${many} with missing or invalid criteria is rejected`, category: 'Negative' }
        : { key: 'browse', title: '', category: 'Positive-Functional' };
    case 'view':
      return { key: 'view', title: `View ${an(one)} by its id; an unknown ${one} is not found`, category: 'Positive-Functional' };
    case 'create':
      return rejection
        ? { key: 'create-invalid', title: `Creating ${an(one)} with missing or invalid details is rejected`, category: 'Negative' }
        : { key: 'create', title: `Create ${an(one)} with valid details; the saved values match what was sent`, category: 'Positive-Functional' };
    case 'update':
      return rejection
        ? { key: 'update-invalid', title: `Updating ${an(one)} with invalid details, or ${an(one)} that does not exist, is rejected`, category: 'Negative' }
        : { key: 'update', title: `Update an existing ${one} (full and partial update)`, category: 'Positive-Functional' };
    case 'delete':
      return { key: 'delete', title: `Delete ${an(one)}; deleting ${an(one)} that does not exist is rejected`, category: 'Positive-Functional' };
    default:
      return rejection
        ? { key: `op-invalid:${e.id}`, title: `${op}: missing or invalid input is rejected`, category: 'Negative' }
        : { key: `op:${e.id}`, title: op, category: 'Positive-Functional' };
  }
}

const ORDER = ['login', 'browse', 'browse-invalid', 'view', 'create', 'create-invalid', 'duplicate', 'update', 'update-invalid', 'delete', 'lifecycle', 'op', 'op-invalid', 'access'];

/** Reading order of business scenarios within a resource (CRUD flow first, access control last). */
export function scenarioRank(key: string): number {
  const i = ORDER.indexOf(key.split(':')[0]);
  return i < 0 ? ORDER.length : i;
}

/** Titles that depend on what the scenario's checks actually verify. */
export function finalizeBusinessTitle(s: BusinessScenario, members: TestCase[], summary: EndpointSummary): string {
  const e = summary.endpoints.find((x) => x.id === members[0].endpointId);
  // access control spans the whole resource group; browse is about the listed objects
  const { many } = s.key === 'access' ? groupNouns(summary, members[0].group) : e ? nouns(summary, e) : { many: 'items' };
  let title = s.title;
  if (s.key === 'access') {
    const parts: string[] = [];
    const protectedChecks = members.some((m) => m.variant === 'auth-reject');
    const publicChecks = members.some((m) => /^Public /.test(m.title));
    if (protectedChecks) parts.push(`only authorised users can use ${many}`);
    if (publicChecks) parts.push(protectedChecks ? `public ${many} operations work without logging in` : `${many} can be used without logging in (public API)`);
    if (members.some((m) => m.variant === 'mass-assignment')) parts.push('privileged fields cannot be set by the client');
    if (members.some((m) => m.variant === 'data-exposure')) parts.push('responses expose no sensitive data');
    title = cap(parts.join('; ') || `Access control for ${many}`);
  }
  if (s.key === 'browse') {
    const filters = members.some((m) => m.variant.startsWith('filter'));
    title = filters ? `Browse ${many} and filter them by their attributes` : `Browse the list of ${many}`;
  }
  // undocumented rules: the checks verify safe handling (4xx, or stored exactly), not a rejection
  if (members.every((m) => m.expected.robust || m.variant === 'tolerant') && / is rejected$/.test(title)) {
    title = title.replace(/ is rejected$/, ' is handled safely (validation rules are not documented)');
  }
  return title;
}
