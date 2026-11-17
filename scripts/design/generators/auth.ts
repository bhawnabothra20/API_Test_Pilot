/** Category generator: Auth. See .claude/skills for the rules this implements. */
import type { EndpointSpec, Identity } from '../../../shared/helpers/types';
import { addCase, patchBody, successStatuses, validBody } from '../context';
import type { Ctx } from '../context';
import type { CategoryGenerator } from '../plugin';

export function auth(ctx: Ctx, e: EndpointSpec): void {
  const { summary } = ctx;
  const a = summary.auth;
  const label = `${e.method} ${e.path}`;
  const ok = successStatuses(e);
  const body = e.method === 'PATCH' ? patchBody(e) : validBody(e);
  const base = { e, category: 'Auth' as const };

  if (e.isLogin && a.login) {
    const u = a.login.usernameField;
    const p = a.login.passwordField;
    const reject = [400, 401, 403, 422];
    addCase(ctx, { ...base, variant: 'login-valid', flow: 'login', title: `${label} with valid credentials returns a token`, data: { note: 'valid credentials from .env', body: { [u]: '${env:USERNAME}', [p]: '${env:PASSWORD}' } }, status: [e.successStatus], requiresCredentials: 'admin' });
    addCase(ctx, { ...base, variant: 'login-reject', flow: 'login', title: `${label} with a wrong password is rejected without a token`, data: { note: 'wrong password', body: { [u]: '${env:USERNAME}', [p]: 'definitely-wrong-password-123' } }, status: reject, assumption: 'Rejected logins expected to return 400/401/403/422.' });
    addCase(ctx, { ...base, variant: 'login-reject', flow: 'login', title: `${label} without "${u}" is rejected`, data: { note: 'missing username', body: { [p]: 'some-password' } }, status: reject, assumption: 'Rejected logins expected to return 400/401/403/422.' });
    addCase(ctx, { ...base, variant: 'login-reject', flow: 'login', title: `${label} without "${p}" is rejected`, data: { note: 'missing password', body: { [u]: '${env:USERNAME}' } }, status: reject, assumption: 'Rejected logins expected to return 400/401/403/422.' });
    addCase(ctx, { ...base, variant: 'login-reject', flow: 'login', title: `${label} with an empty body is rejected`, data: { note: 'empty body', body: {} }, status: reject, assumption: 'Rejected logins expected to return 400/401/403/422.' });
    return;
  }

  if (!e.requiresAuth) {
    addCase(ctx, { ...base, variant: 'positive', identity: 'none', title: `Public ${label} works without any token`, data: { note: 'public endpoint, no token', body }, status: ok });
    if (a.type === 'none') {
      addCase(ctx, { ...base, variant: 'positive', identity: 'invalid', title: `Public ${label} ignores an unexpected random bearer token`, data: { note: 'public endpoint, random token', body }, status: ok, assumption: 'Public endpoints assumed to ignore Authorization headers.' });
    }
    return;
  }

  const unauth = [a.unauthenticatedStatus];
  const assumption = a.statusDocumented ? undefined : `Status for rejected credentials not documented; expecting ${a.unauthenticatedStatus} (RFC 7235).`;
  addCase(ctx, { ...base, variant: 'positive', identity: 'admin', title: `${label} with a valid admin token succeeds (${ok.join('/')})`, data: { note: 'admin token', body }, status: ok, schema: true });
  const rejects: Array<[Identity, string]> = [
    ['none', 'without a token'],
    ['invalid', 'with an invalid random token'],
    ['expired', 'with an expired token'],
    ['malformed', a.type === 'cookie' ? 'with a malformed auth cookie' : 'with a malformed Authorization header (no scheme prefix)'],
    ['wrongScheme', `with the wrong auth scheme (${a.type === 'bearer' ? 'Basic instead of Bearer' : 'Bearer header instead of ' + a.type})`],
  ];
  for (const [identity, text] of rejects) {
    addCase(ctx, { ...base, variant: 'auth-reject', identity, title: `${label} ${text} is rejected with ${unauth.join('/')}`, data: { note: text, body }, status: unauth, assumption });
  }
}

// ----------------------------------------------------------------------------- authorization (OWASP API Top 10)

export const generator: CategoryGenerator = {
  name: 'auth',
  category: 'Auth',
  forEndpoint: (ctx, e) => auth(ctx, e),
};
