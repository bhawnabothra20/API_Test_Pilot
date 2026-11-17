---
name: schema-validator
description: How response schemas are represented (JSON-schema subset in endpoint-summary.json), inferred from samples, converted to zod source files, and asserted in tests with readable error messages.
---

# Schema validation

## Representation
`JsonSchema` in `shared/helpers/types.ts`: `type`, `properties`, `required`, `items`, `enum`, `format`
(`date | date-time | email | uri | uuid`), `minLength/maxLength`, `minimum/maximum`, `minItems/maxItems`,
`nullable`, `readOnly`, `example`, `description`. OpenAPI `$ref`, `allOf` (merged), `oneOf/anyOf` (first
option), `nullable`/`x-nullable` and type arrays with `null` are normalised into this subset.

## Inference (no spec)
`inferSchema(samples)` in `shared/helpers/json-schema.ts`: up to 50 samples; a key is `required` when
present in every sample; `nullable` when any sample has `null`; integers vs numbers; string formats
detected only when **all** samples match (email, http(s) URI, UUID, `YYYY-MM-DD`, ISO date-time).
Record "schema inferred from N samples" as an assumption.

## zod generation (`scripts/generate-specs.ts` -> `schemas/<group>.schema.ts`)
| JSON schema | zod |
|---|---|
| object | `z.object({...}).passthrough()` (extra fields allowed, listed fields enforced) |
| optional property | `.optional()` |
| nullable | `.nullable()` |
| integer / number | `z.number().int()` / `z.number()` + `.gte/.lte` |
| string formats | `.datetime({ offset: true })`, `.regex(/^\d{4}-\d{2}-\d{2}$/)`, `.email()`, `.url()`, `.uuid()` |
| enum | `z.enum([...])` (strings) or literal union (numbers) |
| array | `z.array(item)` - validates every item, + `.min/.max` |
| object without properties | `z.record(z.unknown())` |

Export names: `<PascalEndpointId>Response`, e.g. `BookingIdGetResponse`, plus a matching `type`.

## Asserting
```ts
const body = expectSchema(res, S.BookingIdGetResponse);
```
Fails with `Schema validation failed: bookingdates.checkin: ISO 8601 date (YYYY-MM-DD); totalprice:
Expected number, received string` (first 10 issues) and returns the typed body.
