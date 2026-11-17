# API Test Pilot: likely panel questions and answers

Short answers you can say out loud, plus a one-line proof point where the panel may push back.
Figures come from the run logs and reports of 10-11 Nov 2026.

---

## 1. Concept and value

**Q1. In one sentence, what does your agent do?**
You give it one URL: a spec, a docs page, a base URL or a single endpoint. It discovers the API, designs business-level test cases, writes the qTest Excel and the Playwright scripts, runs them, groups the failures into root causes and checks the docs against real behaviour. It asks no questions along the way.

**Q2. Who is the user, and what problem does it remove?**
QA engineers and test leads who get a new API or a changed spec. It removes the manual steps: reading the docs, writing the cases twice (once in qTest, once as code), and triaging a red run by hand.

**Q3. How did you arrive at "~26 hours manual vs ~3 minutes"?**
The 3 minutes is measured from the run log (Restful-Booker: 7 s to build the suite, 169 s to execute). The 26 hours is an estimate for a tester who is new to an API of that size, and the slide labels it that way. *Honest line:* "I'd like to validate the manual figure with the team's real numbers. Even if it were 8 hours, the saving is still over 99%."

**Q4. What is the ROI for the organisation?**
Every new API or spec change costs minutes of machine time instead of days of QA time. Coverage is the same no matter who runs it. Defects come with evidence a developer can act on straight away, and the qTest file and CI gate fit the process we already use.

---

## 2. AI reliability (expect the hardest questions here)

**Q5. How do you stop the AI from hallucinating tests or results?**
The core is deterministic. Each of the 13 stages is a TypeScript script, and the Claude sub-agents review and enrich its output rather than invent it. Test cases come from the spec, every guess is recorded as an assumption in the report, the scripts must pass `tsc --noEmit`, and results come from real Playwright runs against the live API.

**Q6. Does it work without the AI?**
Yes. `npm run api-test -- <url>` runs the same pipeline without Claude, so runs are reproducible. If an AI step fails, the pipeline still finishes.

**Q7. "Self-healing" sounds risky. Can it make tests pass by changing them?**
No. It only heals script errors: TypeScript errors, imports, paths and data-key typos, with at most 3 attempts. It is forbidden from weakening an assertion or changing an expected value. A failure caused by the API is a finding, not something to fix.

**Q8. How do you avoid false positives, i.e. blaming the API for the test's mistake?**
Triage sorts every failure into one of four classes, with evidence: Real API defect, Test data issue, Flaky/Environment issue, or Contract/Spec mismatch. Expectations the agent assumed (because the docs were silent) are triaged as Contract/Spec mismatch, never as defects. If 30% or more of the read requests fail with a 5xx (and at least 3 do), it treats the run as an outage, not as bugs.

**Q9. What is "contract calibration"?**
When the docs don't say which error code to expect, for example 403 vs 401, the agent learns it from the run. It only does this when the API answers with the same 4xx consistently. It never learns a 2xx or a 5xx, and it never relaxes a rule the documentation states. A person can pin the contract in `contract-overrides.json`.

**Q10. What if the spec itself is wrong?**
That is exactly what spec drift reports. Each difference gets evidence test IDs, a confidence level and a verdict: "fix API" or "fix docs". Where the docs are silent and the behaviour is consistent, it proposes a doc change; for OpenAPI it writes an RFC 6902 patch. It never patches the docs to match a broken API, such as one that returns a 5xx or accepts invalid input.

**Q11. What if there is no spec at all?**
JSONPlaceholder has none. The agent followed the links on its docs page, probed safely with GET/OPTIONS and inferred schemas from 50 sample objects. All of that is listed as assumptions. Result: 59 business test cases, 100% executed, 100% passed.

---

## 3. Coverage and test design

**Q12. Why only 13 test cases for Restful-Booker? Isn't that too few?**
These are business-level cases, and the checks run as steps inside each case. The 13 cases cover 92 checks. Low-value technical variants such as injection strings, exotic boundaries and odd token formats are left out on purpose. For full technical coverage, `--level high` runs every check (212 for Restful-Booker), and `--level detailed` makes one case per check.

**Q13. Which categories does it cover?**
Positive-functional (including the full CRUD lifecycle with a 404 after delete), data validation (zod schema on every field), negative, boundary, auth, and authorization (OWASP). Every test asserts status, headers, schema, key business fields and response time. None of them checks the status code alone.

**Q14. What security testing does it do?**
It is mapped to the OWASP API Top 10. Excessive data exposure and mass assignment checks run by default. Token hygiene checks (token in the query string, JWT `alg:none`, tampered signature, reuse after logout) run with `--level high`. A bypass becomes a High Real API defect tagged with its OWASP ID.

**Q15. Why no BOLA / BFLA checks?**
They need a second normal-user identity, and this build deliberately tests with one credential identity, admin, plus anonymous, invalid and expired credentials. That was a design decision to keep setup simple. Adding user identities is a natural next step.

**Q16. Why no OAuth2 flows?**
Also a deliberate choice for this version. Discovery prefers any other declared scheme (PetStore uses `api_key`). An OAuth-only API is tested as bearer, with a ready token supplied in `.env`.

**Q17. Petstore shows only 63% executed and a 23% pass rate. Is the agent failing?**
No. The agent is reporting the API honestly. Petstore is a shared public sandbox: setup steps could not find an existing user or pet ID, so those tests were blocked rather than failed. The report leads with coverage and flags any run under 80% executed as "not representative". The real findings there include an endpoint answering 200 without valid credentials, and 5xx errors on invalid input.

**Q18. How does it handle flaky tests?**
Playwright retries once. A test that passes on retry is marked flaky and triaged as Flaky/Environment, not as a defect. History shows whether a failure is new or recurring.

---

## 4. Integration and process

**Q19. How does it connect to qTest?**
It generates a qTest import Excel file: 14 columns, one row per step, plus an Import Notes sheet. The file is re-opened and validated after writing. The test ID is both the qTest Automation ID and the Playwright test title, so results map back with no manual linking. A direct qTest API sync is on the roadmap.

**Q20. How does it fit into CI/CD?**
With the `--ci` flag it writes JUnit XML and a CI summary. Exit codes: 0 = no new failures, 4 = new failures or a new Critical finding, 5 = executed coverage below the threshold (default 80%). A GitHub Actions workflow is included: it runs daily and on PRs, and posts one PR comment per API.

**Q21. What happens when the spec changes?**
Only the resource groups whose endpoints changed are regenerated. Unchanged groups keep their test cases, TC IDs and test data exactly, so qTest history stays intact. `spec-diff.json` lists what was added, removed or changed, field by field.

**Q22. What is the MCP server for?**
It makes the agent usable from any AI assistant: Claude Code, Claude Desktop or Cursor. It offers 11 tools: start a run, track it, read the summary, failures and spec drift, and re-run chosen test IDs.

**Q23. Can the team maintain the generated tests?**
Yes. They are plain Playwright + TypeScript in our own repo, with a standard HTML report, so there is no vendor lock-in. That said, the intended way to change tests is to improve the generators, not to hand-edit the generated files.

**Q24. Why Playwright and TypeScript rather than RestAssured or Postman collections?**
It is one modern toolchain the team may already use for UI tests. Its `request` fixture needs no browser install, its reporters are built in, and it runs parallel workers. TypeScript strict mode plus zod schemas catch mistakes before the run.

---

## 5. Security, safety and data

**Q25. How are credentials handled?**
Only through `.env` and environment variables (in CI, from repository secrets). Tokens obtained at runtime stay in memory. Playwright traces are off because traces would record headers. Every report, log and MCP output is redacted, so no secret value is ever written to a test case, test data or a report.

**Q26. Could it damage a real system?**
There are several guardrails. Every request is checked against a host allowlist (`ALLOWED_HOSTS`), and an unknown host stops the run. Discovery uses only GET, HEAD and OPTIONS. Tests clean up what they create. There is a polite delay between requests, and no load or stress testing. Today it is scoped to practice APIs; for a real product I would point it at staging, not production.

**Q27. Is API data sent to the AI model?**
The sub-agents read the spec and recorded (redacted) responses in order to review them. Secrets are never included. For client or sensitive data you would either run the deterministic mode, which needs no AI, or use an enterprise AI agreement. The current scope is public practice APIs only.

**Q28. The MCP HTTP mode has no authentication. Isn't that a risk?**
It binds only to 127.0.0.1, so only this machine can reach it, and it rejects requests whose Host header is not localhost (DNS-rebinding protection). It can never listen on another network interface. Stdio, the default mode, has no network port at all.

---

## 6. Competition

**Q29. Postman has Postbot, its AI assistant. Why not just use that?**
Postbot helps write tests one request at a time, inside the collection a person builds. Our agent goes from one URL to a full suite on its own, and then also triages failures into root causes, checks the docs against reality and produces the qTest file. Postman is great for exploring an API; this agent automates the whole QA cycle.

**Q30. Tricentis already integrates Tosca with qTest. What is your edge?**
Tosca is powerful but model-based and licence-heavy, and a person still designs, maintains and triages the tests. We produce open code in our own repo with qTest-compatible output, root-cause triage and spec drift, on an open stack plus AI usage cost. *Honest line:* "Tricentis is stronger for large enterprise UI + API suites today; this agent wins on speed to first coverage and on explaining failures."

**Q31. Is the comparison table fair?**
It is based on public product information, and I marked partial capabilities as "Partial" rather than "No". I would re-check current editions before using it externally.

---

## 7. Limitations and future (always good to own these)

**Q32. What are the current limitations?**
- One credential identity (admin), so no BOLA/BFLA checks and no OAuth flows.
- REST only: no GraphQL, gRPC or SOAP yet.
- qTest connection is through Excel import, not a live API.
- Execution time depends on the API under test; the agent is fast, but a slow or rate-limited API is still slow.
- Validated on public practice APIs; not yet tried on an internal product.

**Q33. What would you build next?**
Next: a direct qTest API sync and GraphQL/gRPC/SOAP support. Then: Jira requirement traceability and a trend dashboard. Later: opt-in performance smoke tests, and auto-drafted fixes or doc PRs for each root cause.

**Q34. How would you roll it out in a real team?**
1. Run it on one internal API in staging, behind the allowlist.
2. Compare its findings with the existing manual suite.
3. Import the qTest file.
4. Turn on the CI gate on PRs.
5. Calibrate the contract with `contract-overrides.json` where the team knows the intended behaviour.

**Q35. How do you know the agent itself is correct?**
There are 31 unit tests for its own logic (triage classification, root causes, outage detection, contract calibration, spec-diff and consolidation). They run with no network. The code is about 10,000 lines of strict TypeScript that passes `tsc --noEmit`, and CI runs the unit tests before any API run.

---

## Quick numbers to remember

| Fact | Value |
|---|---|
| URL to ready suite (Restful-Booker) | ~7 s |
| Full flow (Restful-Booker) | ~3 min (13 cases, 92 checks) |
| Restful-Booker findings | 6 failing tests -> 5 root causes (2 High) |
| JSONPlaceholder | 37 endpoints, no spec, 59 cases, 100% pass |
| Business vs technical cases (JSONPlaceholder) | 59 instead of 334 |
| Pipeline | 13 stages, 6 sub-agents, 13 skills, 6 category plugins |
| MCP | 11 tools |
| Unit tests | 31 |
| CI exit codes | 0 ok / 4 new failures / 5 low coverage |

## If you don't know an answer
"That's a good point. I haven't tested that case yet. Here's how I'd approach it: ..." Then name the nearest mechanism: assumptions, triage, the allowlist or `contract-overrides.json`.
