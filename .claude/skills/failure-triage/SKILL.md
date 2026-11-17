---
name: failure-triage
description: How to classify every failed API test as Real API defect, Test data issue, Flaky/Environment issue or Contract/Spec mismatch with evidence, and how to tell script errors (self-heal) from findings (report).
---

# Failure triage

Implemented by `scripts/triage-failures.ts` -> `api/<api-name>/reports/triage.json`.

## First: script error or finding?
| Script error (self-heal, max 3 attempts) | Finding (never "fix" the test) |
|---|---|
| `tsc` errors, `Cannot find module`, wrong paths | any assertion failure on a real response |
| `Test data "<key>" not found` | unexpected status / body / header / time |
| Playwright cannot load the config or specs | 5xx, leaks, missing validation, wrong auth code |

## Classes and rules (first match wins)
| Class | When |
|---|---|
| Flaky/Environment issue | passed on retry; timeouts, ECONNRESET/ENOTFOUND; 429/502/503/504; response time over threshold; shared collection changed between two idempotency calls |
| Test data issue | `[PRECONDITION]` errors (could not create/find setup data); test-data key missing; positive test got 404 for an id it obtained |
| Real API defect | any 5xx; internal details leaked; rejected credentials answered with 2xx; rejected login returned a token; invalid input accepted although the rule is documented; documented valid request rejected; value not persisted exactly |
| Contract/Spec mismatch | schema mismatch; unexpected Content-Type; 403 where 401 expected; invalid input accepted where the rule was only assumed; different 4xx than expected; success code differs; documented simulated writes |

## Resolving Contract/Spec mismatches (scripts/contract.ts) - never by weakening documented rules
Mismatches have four sources. The agent resolves the ones caused by its own guesses and keeps the rest:

| Source | Resolution | Stays a finding? |
|---|---|---|
| **Undocumented status code** (401 vs 403, 404 vs 405 for bad ids, 400 vs 422) | `calibrate` stage learns the API's convention from the run when it is a consistent 4xx across >= 2 checks (3 for credentials), writes `spec/calibration.json`, re-runs once. Never learns a 2xx or 5xx. | No (convention listed under Assumptions) |
| **Rule invented by the agent** (limits assumed as 1..255, fields "required" because seen in samples, ids on simulated-write resources) | Applied at design: becomes a **robustness check** - 4xx, or 2xx that stores values exactly; never 5xx, leaks or silent data change | Only if it crashes, leaks or corrupts data (then Real API defect) |
| **Documented behaviour the test contradicted** (docs say writes are simulated) | Lifecycle verifies the simulated-write contract (echo + id, created id not retrievable, "deleted" item still there) | Only if the API breaks its own documented behaviour |
| **Documented rule not enforced** (required field / type / enum accepted with 2xx) | Not auto-resolved. Classified as Real API defect. Endpoints that accept invalid input 3+ times are listed in `spec/suggested-overrides.json`; a human may confirm "no validation by design" in `spec/contract-overrides.json` | Yes |
| **Schema / Content-Type / success code differ from the spec** | Not auto-resolved - genuine contract deviations | Yes |

`spec/contract-overrides.json` (human-owned) wins over calibration: `unauthenticatedStatus`, per-endpoint
`unknownIdStatus` / `validationStatus`, `noValidation: ["<endpointId>" | "*"]`.

## Evidence
Each item: `testId`, `title`, `category`, `endpoint`, `classification`, `reason`, `expected`, `actual`,
`error` (first lines), `evidence` = the last request/response **of the request under test**
(setup/cleanup exchanges are attached as `setup-exchange-*` / `cleanup-exchange-*` and ignored), with
`Authorization`, `Cookie`, API-key headers and known secret values replaced by `***`.

## Root causes (what developers act on)
A count of failing tests says little: on PetStore 55 "Real API defect" tests come from 3 problems.
`triage.json` therefore also has `rootCauses`: every **failed check** (each sub-check of a high-level
case) is mapped to an underlying problem by `CAUSE_RULES` in `scripts/triage-failures.ts`, and checks with
the same problem are merged whatever endpoint or test they belong to. Each root cause has `id` (RC1..),
class, severity (worst member), developer-facing `title`, fix `hint`, `checks`, `testIds`, `endpoints`
and one `example` (expected vs actual). Items list their `rootCauses` ids.

| Root cause (key) | Typical reason |
|---|---|
| Invalid input crashes the server | 5xx for invalid input |
| Valid requests to `<endpoint>` fail with a server error | 5xx for a valid request (one per endpoint) |
| Invalid input is accepted with HTTP N | documented / inferred rule not enforced |
| Values are not stored or returned exactly | echo / persistence mismatch |
| Answers X where Y is expected | rejected with another 4xx |
| Blocked - test setup failed: ... | precondition failed; `blockedBy` points at the root cause that broke the setup (e.g. create returns 500) - not an independent defect |
| Slow responses / shared data changed / flaky / network | environment noise |
| API unavailable or degraded during the run | outage: >= 30% (and >= 3) of the run's valid GET requests answered 5xx (`triage.outageSuspected`); every 5xx of that run is Flaky/Environment, not a defect - re-run to confirm |
| Failed logins are answered with HTTP N (no token is issued) | a rejected login got 2xx but no token: the "no token" check runs BEFORE the status check, so a status-only failure proves no token was issued. Undocumented failure status -> Contract/Spec mismatch (Low); documented one -> Real API defect (Medium). A token in a rejected login's response stays a High security defect (`Security: rejected login still returned a token`). Login tokens are registered for redaction before an exchange is recorded |
| Filtering `<endpoint>` does not return the matching items | a filter check got 2xx but the wrong items |
| `<endpoint>`: expected "..." - not met | any other failed expectation, named after the assertion's own message (there is no generic "assertion failed" label) |

A 5xx is a Real API defect only when the run was otherwise healthy and the test failed on both attempts
(Playwright retries once). 502/503/504/429 are always environment. When a root cause disappears in the next
run, check summary.html "Run history": a previous failure counts as fixed only when the test ran and passed;
tests that no longer ran (level, spec or credentials changed) are listed separately, never as fixed.
Every rule here is covered by `tests/unit/triage.test.ts` - add a test with every new rule.

Sorted by class, then severity, then number of checks. Add a rule (regex on the reason + key + title +
hint) when a new recurring reason appears; do not hand-edit groups.

`triage.json.runStartedAt` = the Playwright start time of the run it describes; readers ignore a triage
whose `runStartedAt` differs from `results.json` (stale).

## Reviewing the first pass
Read evidence before agreeing with a class. Typical corrections: a 404 on a shared demo API that deleted
your resource -> Test data issue; a slow cold start -> Flaky/Environment. Fix systematic mistakes in the
rules, not by editing many items by hand.

## Example
```json
{ "testId": "TC_RESTFUL_BOOKER_AUTH_POST_002", "classification": "Real API defect",
  "reason": "Security: request with bad credentials was answered with 200.",
  "expected": "HTTP 400 or 401 or 403 or 422", "actual": "HTTP 200" }
```
