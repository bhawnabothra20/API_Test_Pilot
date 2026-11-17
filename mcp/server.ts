/**
 * API Test Pilot - MCP server.
 *
 *   npm run --silent mcp                       stdio transport (default; for Claude Code / Desktop / Cursor)
 *   npm run --silent mcp -- --http --port 8787  Streamable HTTP on 127.0.0.1 (no token; this machine only)
 *
 * Tools start the pipeline as background jobs and read its outputs. Security:
 *  - HTTP mode has NO authentication (user decision). It therefore always binds to 127.0.0.1 (there is no
 *    --host option), so only processes on this machine can reach it, and DNS-rebinding protection rejects
 *    requests whose Host header is not 127.0.0.1/localhost (stops web pages in a browser from calling it).
 *  - Every URL goes through the ALLOWED_HOSTS safety guard; API names are validated (no path traversal);
 *    one concurrent run per API name.
 *  - All outputs and logs pass through redact() - configured secret values never leave the server.
 *  - Tool calls are logged to mcp/logs/ (tool, redacted args, duration, ok/error). stdout is reserved for
 *    the stdio protocol; diagnostics go to stderr.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { loadEnv, PROJECT_ROOT, readJson, redact } from '../shared/helpers/env';
import { assertUrlAllowed, HostNotAllowedError } from '../shared/helpers/safety-guard';
import type { EndpointSummary } from '../shared/helpers/types';
import { deriveApiName } from '../scripts/discover';
import { STAGES, TC_ID } from '../scripts/stages';
import { apiExists, jobStatus, safeApiName, startJob, UserError } from './jobs';
import { getAccessMatrix, getFailures, getHistory, getQtestFile, getSpecDrift, getSummary, getTestCase, listApis, readResourceJson } from './queries';

loadEnv();

const LOG_DIR = path.join(PROJECT_ROOT, 'mcp', 'logs');
const VERSION = '1.0.0';

function logCall(tool: string, args: unknown, ms: number, ok: boolean, error?: string): void {
  try {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const line = redact(JSON.stringify({ ts: new Date().toISOString(), tool, args, ms, ok, error }));
    fs.appendFileSync(path.join(LOG_DIR, `mcp-${new Date().toISOString().slice(0, 10)}.log`), line + '\n', 'utf8');
  } catch {
    /* logging must never break a tool call */
  }
}

type ToolResult = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

/** Runs a tool body with logging, redaction and user-facing error messages. */
async function handle(tool: string, args: unknown, fn: () => unknown): Promise<ToolResult> {
  const started = Date.now();
  try {
    const out = await fn();
    logCall(tool, args, Date.now() - started, true);
    return { content: [{ type: 'text', text: redact(JSON.stringify(out, null, 2)) }] };
  } catch (e) {
    const known = e instanceof UserError || e instanceof HostNotAllowedError;
    const msg = known ? (e as Error).message : `Internal error: ${e instanceof Error ? e.message : String(e)}`;
    logCall(tool, args, Date.now() - started, false, msg);
    return { content: [{ type: 'text', text: redact(msg) }], isError: true };
  }
}

const stageEnum = z.enum(STAGES);
const apiName = z.string().min(1).max(63).describe('API folder name under api/ (lowercase, digits, "-")');

function sourceUrl(name: string): string {
  safeApiName(name);
  if (!apiExists(name)) throw new UserError(`No API "${name}" yet - run run_api_test first.`);
  return readJson<EndpointSummary>(path.join(PROJECT_ROOT, 'api', name, 'spec', 'endpoint-summary.json')).sourceUrl;
}

export function createServer(): McpServer {
  const server = new McpServer({ name: 'api-test-pilot', version: VERSION });

  server.registerTool(
    'run_api_test',
    {
      title: 'Run the API test pipeline',
      description:
        'Starts the full pipeline (discover -> design -> qTest Excel -> Playwright specs -> run -> triage -> reports) for a URL as a background job. Returns a jobId immediately - poll get_run_status. The host must be in ALLOWED_HOSTS.',
      inputSchema: {
        url: z.string().url().describe('OpenAPI/Swagger URL, docs page, base URL or endpoint URL'),
        name: apiName.optional().describe('API name (default: derived from the host)'),
        level: z.enum(['business', 'high', 'detailed']).optional().describe('business (default): business scenarios per resource, low-value technical checks left out; high: every check, one case per endpoint+technical scenario; detailed: one case per check'),
        only: z.array(stageEnum).optional().describe('run only these stages'),
        from: stageEnum.optional().describe('run from this stage to the end'),
        full: z.boolean().optional().describe('regenerate every resource group (default: only groups whose part of the spec changed)'),
      },
    },
    async (args) =>
      handle('run_api_test', args, () => {
        assertUrlAllowed(args.url); // one-line "add it to ALLOWED_HOSTS" message on refusal
        const name = safeApiName(args.name ?? deriveApiName(args.url));
        const cli: string[] = [];
        if (args.level) cli.push('--level', args.level);
        if (args.only?.length) cli.push('--only', args.only.join(','));
        else if (args.from) cli.push('--from', args.from);
        if (args.full) cli.push('--full');
        const job = startJob('run', name, args.url, cli);
        return { jobId: job.jobId, name, state: 'started', next: 'Poll get_run_status with this jobId (runs take minutes).' };
      }),
  );

  server.registerTool(
    'get_run_status',
    {
      title: 'Run status',
      description: 'Stage, progress and pass/fail counts of a background run started by run_api_test or rerun.',
      inputSchema: { jobId: z.string().describe('jobId returned by run_api_test / rerun') },
    },
    async (args) => handle('get_run_status', args, () => jobStatus(args.jobId)),
  );

  server.registerTool(
    'list_apis',
    { title: 'List tested APIs', description: 'APIs under api/ with state (running / results), last run, executed coverage next to the pass rate, and the last completed run from history.', inputSchema: {} },
    async (args) => handle('list_apis', args, () => ({ apis: listApis() })),
  );

  server.registerTool(
    'get_summary',
    {
      title: 'Run summary',
      description: 'Totals, executed coverage + pass rate of executed tests, preflight warnings (missing credentials, quota), root causes, failures by triage class, authorization findings and report paths for one API.',
      inputSchema: { name: apiName },
    },
    async (args) => handle('get_summary', args, () => getSummary(args.name)),
  );

  server.registerTool(
    'get_failures',
    {
      title: 'Failures with evidence',
      description: 'Root causes (failed checks grouped by underlying problem) and the failed TC ids with triage class, severity, OWASP mapping and redacted request/response evidence.',
      inputSchema: {
        name: apiName,
        triageClass: z.enum(['Real API defect', 'Test data issue', 'Flaky/Environment issue', 'Contract/Spec mismatch']).optional(),
      },
    },
    async (args) => handle('get_failures', args, () => getFailures(args.name, args.triageClass)),
  );

  server.registerTool(
    'get_access_matrix',
    {
      title: 'Access matrix',
      description: 'Endpoints x identities grid (expected vs actual status) with auth / token-hygiene findings and OWASP ids. Never contains tokens.',
      inputSchema: { name: apiName },
    },
    async (args) => handle('get_access_matrix', args, () => getAccessMatrix(args.name)),
  );

  server.registerTool(
    'get_history',
    {
      title: 'Run history',
      description: 'Archived runs of one API (newest first): executed coverage, pass rate, failures per class, root causes and the archived report path.',
      inputSchema: { name: apiName },
    },
    async (args) => handle('get_history', args, () => getHistory(args.name)),
  );

  server.registerTool(
    'get_spec_drift',
    {
      title: 'Spec drift',
      description:
        'Documented vs observed behaviour of the latest run: each drift item has endpoint, kind, documented, observed, evidence TC ids, confidence and a recommendation ("fix API" or "fix docs"), plus the path of the RFC 6902 openapi-patch.json for OpenAPI/Swagger sources.',
      inputSchema: { name: apiName, recommendation: z.enum(['fix API', 'fix docs']).optional().describe('only items with this recommendation') },
    },
    async (args) => handle('get_spec_drift', args, () => getSpecDrift(args.name, args.recommendation)),
  );

  server.registerTool(
    'get_test_case',
    {
      title: 'Test case details',
      description: 'Steps, expectations, test-data keys and the script path:line of one TC id (high-level or sub-check id).',
      inputSchema: { name: apiName, tcId: z.string().describe('e.g. TC_RESTFUL_BOOKER_BOOKING_POST_005 or ..._005.3') },
    },
    async (args) => handle('get_test_case', args, () => getTestCase(args.name, args.tcId)),
  );

  server.registerTool(
    'rerun',
    {
      title: 'Re-run tests',
      description: 'Re-runs the suite (or only the given TC ids via Playwright --grep) and rebuilds the reports, as a background job.',
      inputSchema: { name: apiName, tcIds: z.array(z.string()).optional().describe('TC ids to run; omit for the whole suite') },
    },
    async (args) =>
      handle('rerun', args, () => {
        const url = sourceUrl(args.name);
        assertUrlAllowed(url);
        const ids = [...new Set((args.tcIds ?? []).map((t) => t.trim().replace(/\.\d+$/, '')))];
        const bad = ids.filter((t) => !TC_ID.test(t));
        if (bad.length) throw new UserError(`Invalid TC id(s): ${bad.join(', ')}`);
        const cli = ['--only', 'typecheck,preflight,run,report,drift,final', ...(ids.length ? ['--tc', ids.join(',')] : [])];
        const job = startJob('rerun', args.name, url, cli);
        return { jobId: job.jobId, name: args.name, tests: ids.length ? ids : 'all', next: 'Poll get_run_status with this jobId.' };
      }),
  );

  server.registerTool(
    'get_qtest_file',
    { title: 'qTest Excel file', description: 'Path to the qTest import .xlsx of an API.', inputSchema: { name: apiName } },
    async (args) => handle('get_qtest_file', args, () => getQtestFile(args.name)),
  );

  // ---------------------------------------------------------------- resources (read-only)
  for (const which of ['summary', 'triage', 'endpoint-summary'] as const) {
    server.registerResource(
      `api-${which}`,
      new ResourceTemplate(`api://{name}/${which}`, {
        list: async () => ({
          resources: listApis().map((a) => ({ uri: `api://${a.name}/${which}`, name: `${a.name} ${which}`, mimeType: 'application/json' })),
        }),
      }),
      { title: `API ${which}`, description: `Read-only ${which} JSON of a tested API`, mimeType: 'application/json' },
      async (uri, variables) => {
        const name = String(Array.isArray(variables.name) ? variables.name[0] : variables.name);
        const started = Date.now();
        try {
          const text = redact(JSON.stringify(readResourceJson(safeApiName(name), which), null, 2));
          logCall(`resource:${which}`, { name }, Date.now() - started, true);
          return { contents: [{ uri: uri.href, mimeType: 'application/json', text }] };
        } catch (e) {
          logCall(`resource:${which}`, { name }, Date.now() - started, false, e instanceof Error ? e.message : String(e));
          throw e;
        }
      },
    );
  }

  // ---------------------------------------------------------------- prompts
  server.registerPrompt(
    'test-api',
    { title: 'Test an API', description: 'Run the full API test pipeline for a URL and report the results.', argsSchema: { url: z.string() } },
    ({ url }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Test the API at ${url} with the api-test-pilot tools:\n` +
              `1. Call run_api_test with url "${url}" and keep the jobId.\n` +
              `2. Poll get_run_status until state is "done" or "failed" (a run takes several minutes).\n` +
              `3. Call get_summary, then get_failures with triageClass "Real API defect", and get_access_matrix.\n` +
              `4. Report: totals, failures per triage class, the top findings (security/authorization first, with OWASP ids), anything skipped and why, and the qTest Excel path (get_qtest_file).\n` +
              `If the host is refused, tell the user to add it to ALLOWED_HOSTS in .env - do not try another way.`,
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'explain-failures',
    { title: 'Explain failures', description: 'Explain the failed tests of an API and what to do about them.', argsSchema: { name: z.string() } },
    ({ name }) => ({
      messages: [
        {
          role: 'user',
          content: {
            type: 'text',
            text:
              `Explain the latest test failures of API "${name}":\n` +
              `1. Call get_summary and get_failures for "${name}".\n` +
              `2. Group the failures by triage class. For each Real API defect give severity, OWASP id (if any), the evidence (request -> status) and the likely fix on the API side.\n` +
              `3. For Contract/Spec mismatches say whether the API or the documentation should change; for Test data / Flaky items say how to re-check (rerun with the TC ids).\n` +
              `4. Use get_test_case for any TC id you need to explain in detail. Never weaken a test to make it pass.`,
          },
        },
      ],
    }),
  );

  return server;
}

// ---------------------------------------------------------------- transports

function readBody(req: http.IncomingMessage, limit = 1_000_000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined);
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

/** No authentication in HTTP mode, so the server never listens on anything but the loopback interface. */
const HTTP_HOST = '127.0.0.1';

async function startHttp(port: number): Promise<void> {
  const host = HTTP_HOST;
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  const httpServer = http.createServer(async (req, res) => {
    try {
      if ((req.url ?? '').split('?')[0] !== '/mcp') return sendJson(res, 404, { error: 'not found - the MCP endpoint is /mcp' });
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'stateless server: use POST /mcp' }, { Allow: 'POST' });
      const body = await readBody(req);
      const server = createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless: jobs persist on disk, so no session state is needed
        enableJsonResponse: true,
        enableDnsRebindingProtection: true,
        allowedHosts,
      });
      res.on('close', () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (e) {
      if (!res.headersSent) sendJson(res, 400, { error: redact(e instanceof Error ? e.message : String(e)) });
    }
  });
  httpServer.listen(port, host, () => process.stderr.write(`api-test-pilot MCP server (Streamable HTTP) on http://${host}:${port}/mcp\n`));
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const opt = (flag: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  if (argv.includes('--http')) {
    const port = Number(opt('--port') ?? 8787);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('invalid --port');
    if (opt('--host')) process.stderr.write('--host is ignored: HTTP mode has no authentication and always binds to 127.0.0.1.\n');
    await startHttp(port);
  } else {
    await createServer().connect(new StdioServerTransport());
    process.stderr.write('api-test-pilot MCP server running on stdio\n');
  }
}

if (require.main === module) {
  main().catch((e: unknown) => {
    process.stderr.write(`MCP server failed: ${redact(e instanceof Error ? e.message : String(e))}\n`);
    process.exit(1);
  });
}
