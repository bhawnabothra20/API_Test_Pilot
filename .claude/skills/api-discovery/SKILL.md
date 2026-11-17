---
name: api-discovery
description: How to understand an API from one URL (OpenAPI/Swagger JSON/YAML, Swagger UI page, apiDoc, base URL, or a single endpoint) using safe methods only, and how to record the result in endpoint-summary.json with explicit assumptions.
---

# API discovery

Implemented by `scripts/discover.ts` (`discover(url, apiName)`); the data shape is `EndpointSummary` in
`shared/helpers/types.ts`. Output: `api/<api-name>/spec/endpoint-summary.json` (+ raw spec copy).

## Decision order
1. **URL is a spec** - JSON/YAML with `openapi:` (3.x), `swagger:` (2.0), or an apiDoc array
   (`[{type,url,...}]`). Parse it directly.
2. **Anything else (docs page, base URL, or an endpoint such as `/booking`) - walk up to the root.**
   Spec links on the input page first (Swagger UI `url: "...json"`, links containing
   `swagger|openapi|api-docs|apidoc`; for apiDoc pages also `api_data.json` next to them). Then for every
   ancestor path, deepest first (`/api/users/2` -> `/api/users` -> `/api` -> `/`): the known spec paths
   below it (`/openapi.json /swagger.json /v3/api-docs /swagger/v1/swagger.json /v2/swagger.json
   /api-docs /api/swagger.json /openapi.yaml /swagger.yaml /apidoc/api_data.json`) and the spec links on
   that level's HTML page. At most 40 GET requests (`findSpec()` in `discover.ts`). The input URL never
   decides the result on its own: `/booking` on Restful-Booker finds the root apiDoc and cookie auth.
   **Scoping**: when the input names an endpoint and the spec covers the whole API, only that resource's
   endpoints are kept (path params match any segment), plus login/logout for authentication; recorded as
   an assumption. The default API name then gets the first path segment (`restful-booker-booking`), so a
   scoped run never overwrites the full-API folder.
3. **URL returns JSON and no spec exists anywhere up the tree** - single-endpoint mode: GET the URL, OPTIONS for allowed methods
   (`Allow` / `Access-Control-Allow-Methods`), infer the schema from the sample(s); array = collection,
   object = item (parent collection probed with GET). Request bodies for POST/PUT/PATCH mirror the
   resource fields minus the id. A 401/403 on GET means the endpoint is protected.
4. **Nothing machine-readable** - crawl same-origin links of the docs page (max 40, GET only); JSON
   collections become resources, nested routes (`/posts/1/comments`) become read-only GETs, query links
   (`/comments?postId=1`) become documented filters.

## Safety
- Only GET, HEAD, OPTIONS. Every request goes through the allowlist (`ALLOWED_HOSTS`).
- Polite delay (`POLITE_DELAY_MS`, default 150 ms) between requests.
- The spec's own base URL must also be allowlisted.

## What to capture per endpoint
`id` (`<path_slug>_<METHOD>`), `group` (first path segment), method, path template (`{param}`),
path/query params with schemas, `requiredHeaders` (e.g. `Accept: application/json`), `requestBody.schema`
(+ `required`), `successStatus`, `responseSchema`, `responseContentType`, `requiresAuth`, `adminOnly`,
`isLogin`, `notFoundStatus`, `badRequestStatus`, `errorSchema`, `pagination`, `inferred`.

API level: `baseUrl`, `auth` (type, header/cookie name, login endpoint + token field,
`unauthenticatedStatus`, `statusDocumented`, roles), `resources` (collection/item path, id field, create
response id/entity path, sample id, `persistsWrites`), `defaults` (limits used when the spec has none),
`assumptions`.

## Assumptions - always explicit
Write one sentence per guess. Examples:
- `No spec found; probing single endpoint /posts with GET/OPTIONS only.`
- `/posts: schema inferred from 50 sample object(s); every observed field treated as required.`
- `Unauthenticated status not documented: expecting 401 for missing/invalid credentials (RFC 7235).`
- `Documentation states writes are simulated (not persisted): mutation tests target existing ids.`

## Example (excerpt)
```json
{
  "apiName": "restful-booker",
  "baseUrl": "https://restful-booker.herokuapp.com",
  "specSource": "apidoc",
  "auth": { "type": "cookie", "cookieName": "token", "login": { "method": "POST", "path": "/auth",
            "usernameField": "username", "passwordField": "password", "tokenField": "token" },
            "unauthenticatedStatus": 401, "statusDocumented": false },
  "endpoints": [{ "id": "booking_id_PUT", "method": "PUT", "path": "/booking/{id}", "requiresAuth": true,
                  "requiredHeaders": { "Accept": "application/json" }, "successStatus": 200 }],
  "resources": [{ "name": "booking", "collectionPath": "/booking", "itemPath": "/booking/{id}",
                  "idField": "bookingid", "createIdPath": "bookingid", "createEntityPath": "booking",
                  "persistsWrites": true }]
}
```
