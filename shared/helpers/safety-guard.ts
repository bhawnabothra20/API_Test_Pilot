import { loadEnv } from './env';

const DEFAULT_ALLOWED = [
  'petstore.swagger.io',
  'restful-booker.herokuapp.com',
  'jsonplaceholder.typicode.com',
  'reqres.in',
];

export function allowedHosts(): string[] {
  loadEnv();
  const raw = process.env.ALLOWED_HOSTS;
  const list = raw && raw.trim() !== '' ? raw.split(',') : DEFAULT_ALLOWED;
  return list.map((h) => h.trim().toLowerCase()).filter(Boolean);
}

/** True when host equals an allowed host or is a subdomain of one. */
export function isHostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  return allowedHosts().some((a) => h === a || h.endsWith(`.${a}`));
}

export class HostNotAllowedError extends Error {}

/** Throws a one-line, actionable error when the URL's host is not allowlisted. */
export function assertUrlAllowed(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new HostNotAllowedError(`Invalid URL "${url}". Pass a full http(s) URL, e.g. https://jsonplaceholder.typicode.com/`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new HostNotAllowedError(`Only http/https URLs are supported (got ${parsed.protocol}).`);
  }
  if (!isHostAllowed(parsed.hostname)) {
    throw new HostNotAllowedError(
      `Host "${parsed.hostname}" is not in ALLOWED_HOSTS. Add it to ALLOWED_HOSTS in .env (comma-separated) and re-run /api-test-pilot.`,
    );
  }
  return parsed;
}
