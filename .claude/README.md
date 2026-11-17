# .claude

Everything Claude Code needs to run the agent.

- `commands/api-test-pilot.md` - the single entry point `/api-test-pilot <url> [--name <api-name>]`; runs the pipeline and delegates each step to a sub-agent.
- `agents/` - one sub-agent per pipeline step: `api-analyst`, `test-designer`, `qtest-exporter`, `script-writer`, `test-runner`, `report-builder`.
- `skills/` - the knowledge the agents apply: discovery, test design (+ one skill per test category), qTest Excel format, Playwright coding standards, schema validation, failure triage, HTML reports.
- `settings.json` - permissions: npm/npx/node/tsc/playwright allowed, edits limited to `api/`, `shared/`, `scripts/`; `.env` cannot be read or edited by the agent; raw curl/wget blocked (all HTTP goes through the allowlisted scripts).
