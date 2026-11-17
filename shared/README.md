# shared

Reusable, API-agnostic code imported by every generated spec and script. Nothing here may be specific to one API.

- `fixtures/api-fixture.ts` - Playwright `test` extended with `api` (allowlisted, rate-limited, timed request client with redacted evidence attachments, `existingId`, `withResource`, `create`, `remove`) and `data` (test-data loader); `fromData`, `requireCredentials`, `limits`.
- `fixtures/auth.ts` - identities (admin, user, none, invalid, expired, malformed, wrongScheme) and how tokens are applied (bearer, basic, apiKey, cookie).
- `helpers/assertions.ts` - status, headers, schema, fields/echo, response time, no-5xx, leak-free error body.
- `helpers/data-mutators.ts` - wrong types, invalid formats, injection strings, leak patterns.
- `helpers/json-schema.ts` - schema inference and path utilities.
- `helpers/env.ts` - `.env` loader, per-API paths, secret redaction. `helpers/safety-guard.ts` - host allowlist.
- `helpers/test-data.ts` - reads `test-data/*.json`, resolves `${env:...}` placeholders at runtime.
- `helpers/types.ts` - the data model shared by all stages.
- `global-setup.ts` - logs in once per run and exposes tokens to workers via `process.env` (never on disk).
