/**
 * Spec-diff updates: when the spec changes, regenerate only what changed.
 *
 * The unit of regeneration is a resource GROUP (first path segment): its endpoints, test cases, test data,
 * spec file (tests/<group>.spec.ts) and schema file (schemas/<group>.schema.ts) belong together.
 *
 * The design stage calls incrementalDesign() instead of designTestCases():
 *   1. builds the full design in memory from the new endpoint-summary.json (cheap, deterministic),
 *   2. compares fingerprints with spec/design-cache.json (written by the previous design):
 *        tool    hash of the design code         -> changed: everything is regenerated
 *        global  api name, base URL, auth, limits -> changed: everything is regenerated
 *        groups  endpoints + resource of a group  -> changed / new groups are regenerated
 *   3. for UNCHANGED groups keeps the previous cases and test data exactly (same TC ids, same values -
 *      the seeded Faker sequence would otherwise shift values whenever an earlier endpoint changes),
 *   4. writes testcases.json + test data, the cache, and spec/spec-diff.json (endpoints added / removed /
 *      changed with field-level changes, groups regenerated / unchanged / removed, TC ids added / removed).
 * Contract handling, consolidation and spec generation then run as usual; generate-specs only rewrites files
 * whose content changed. `--full` (api-test) forces a complete regeneration.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { apiPaths, PROJECT_ROOT, readJson, writeJson } from '../shared/helpers/env';
import type { EndpointSpec, EndpointSummary, ResourceSpec, TestCase, TestDataFile } from '../shared/helpers/types';
import { buildDesign, writeDesign, type Design } from './design-test-cases';

const CACHE_VERSION = 1;
/** design code: a change here regenerates everything */
const TOOL_SOURCES = ['scripts/design', 'scripts/design-test-cases.ts', 'shared/helpers/json-schema.ts', 'shared/helpers/data-mutators.ts', 'shared/helpers/types.ts'];
const MAX_CHANGES = 25;

interface Fingerprints {
  tool: string;
  global: string;
  groups: Record<string, string>;
}

interface DesignCache {
  version: number;
  writtenAt: string;
  fingerprints: Fingerprints;
  /** endpoint + resource specs the cached design was built from (for field-level diffs) */
  endpoints: EndpointSpec[];
  resources: ResourceSpec[];
  /** raw detailed design (before contract handling and consolidation) */
  design: Design;
}

export interface EndpointChange {
  id: string;
  endpoint: string;
  /** "requestBody.schema.properties.name.maxLength: 50 -> 100" */
  changes: string[];
}

export interface SpecDiff {
  apiName: string;
  generatedAt: string;
  previousDesignAt?: string;
  /** why the groups were (re)generated */
  mode: 'first-design' | 'full' | 'incremental';
  reason: string;
  endpoints: { added: string[]; removed: string[]; changed: EndpointChange[]; unchanged: number };
  groups: { regenerated: string[]; unchanged: string[]; removed: string[] };
  /** detailed check ids (before consolidation) */
  /** same id, different content (expectation, data, title...) - e.g. new boundary values after a limit changed */
  checks: { added: string[]; removed: string[]; changed: string[]; kept: number };
}

// ----------------------------------------------------------------------------- fingerprints

/** JSON with sorted keys, so equal objects always hash equally. */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const hash = (value: unknown): string => crypto.createHash('sha256').update(typeof value === 'string' ? value : stable(value)).digest('hex').slice(0, 16);

function toolHash(): string {
  const files: string[] = [];
  const walk = (p: string) => {
    const abs = path.join(PROJECT_ROOT, p);
    if (!fs.existsSync(abs)) return;
    if (fs.statSync(abs).isDirectory()) for (const f of fs.readdirSync(abs).sort()) walk(path.join(p, f));
    else if (abs.endsWith('.ts')) files.push(abs);
  };
  TOOL_SOURCES.forEach(walk);
  const h = crypto.createHash('sha256');
  for (const f of files) h.update(path.relative(PROJECT_ROOT, f).replace(/\\/g, '/')).update(fs.readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));
  return h.digest('hex').slice(0, 16);
}

/** sampleId is re-probed on every discovery and does not change what is generated */
const resourceKey = (r: ResourceSpec) => ({ ...r, sampleId: undefined });

export function fingerprints(summary: EndpointSummary): Fingerprints {
  const groups: Record<string, string> = {};
  for (const g of [...new Set(summary.endpoints.map((e) => e.group))]) {
    groups[g] = hash({
      endpoints: summary.endpoints.filter((e) => e.group === g),
      resources: summary.resources.filter((r) => r.name === g).map(resourceKey),
    });
  }
  return {
    tool: toolHash(),
    global: hash({ apiName: summary.apiName, baseUrl: summary.baseUrl, envPrefix: summary.envPrefix, specSource: summary.specSource, auth: summary.auth, defaults: summary.defaults }),
    groups,
  };
}

// ----------------------------------------------------------------------------- field-level diff

function diffValues(a: unknown, b: unknown, at: string, out: string[]): void {
  if (out.length >= MAX_CHANGES || stable(a) === stable(b)) return;
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  if (isObj(a) && isObj(b)) {
    for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) diffValues(a[k], b[k], at ? `${at}.${k}` : k, out);
    return;
  }
  const show = (v: unknown) => (v === undefined ? '(none)' : JSON.stringify(v).slice(0, 80));
  out.push(`${at || '<root>'}: ${show(a)} -> ${show(b)}`);
}

const label = (e: EndpointSpec) => `${e.method} ${e.path}`;

// ----------------------------------------------------------------------------- merge

const cachePath = (apiName: string) => path.join(apiPaths(apiName).spec, 'design-cache.json');
const diffPath = (apiName: string) => path.join(apiPaths(apiName).spec, 'spec-diff.json');

function readCache(apiName: string): DesignCache | undefined {
  try {
    const c = fs.existsSync(cachePath(apiName)) ? readJson<DesignCache>(cachePath(apiName)) : undefined;
    return c?.version === CACHE_VERSION ? c : undefined;
  } catch {
    return undefined; // unreadable cache: regenerate everything
  }
}

/** Group of a test-data key: the case whose id equals the key or prefixes it ("<id>.3"). */
function groupOfKey(key: string, groupById: Map<string, string>): string | undefined {
  let k = key;
  for (;;) {
    const g = groupById.get(k);
    if (g) return g;
    const dot = k.lastIndexOf('.');
    if (dot < 0) return undefined;
    k = k.slice(0, dot);
  }
}

function mergeData(fresh: TestDataFile, cached: TestDataFile, freshGroups: Map<string, string>, keep: Set<string>): TestDataFile {
  const out: TestDataFile = {};
  for (const [key, entry] of Object.entries(fresh)) {
    const g = groupOfKey(key, freshGroups);
    out[key] = g && keep.has(g) && key in cached ? cached[key] : entry;
  }
  return out;
}

export function incrementalDesign(apiName: string, opts: { full?: boolean; writeDiff?: boolean } = {}): { design: Design; diff: SpecDiff } {
  const paths = apiPaths(apiName);
  const summary = readJson<EndpointSummary>(paths.summary);
  const fresh = buildDesign(apiName);
  const now = fingerprints(summary);
  const cache = readCache(apiName);

  let mode: SpecDiff['mode'] = 'incremental';
  let reason = 'only groups whose endpoints or resource changed are regenerated';
  if (!cache) {
    mode = 'first-design';
    reason = 'no previous design (spec/design-cache.json) - everything generated';
  } else if (opts.full) {
    mode = 'full';
    reason = '--full requested';
  } else if (cache.fingerprints.tool !== now.tool) {
    mode = 'full';
    reason = 'the test-design code changed since the previous design - everything regenerated';
  } else if (cache.fingerprints.global !== now.global) {
    mode = 'full';
    reason = 'API-wide settings changed (base URL, auth scheme or default limits) - everything regenerated';
  }

  const groups = Object.keys(now.groups);
  const keep = new Set(mode === 'incremental' ? groups.filter((g) => cache!.fingerprints.groups[g] === now.groups[g]) : []);

  // unchanged groups: previous cases verbatim (positionally, by id); everything else: fresh
  const cachedById = new Map((cache?.design.file.cases ?? []).map((c) => [c.id, c]));
  let missing = 0;
  const cases: TestCase[] = fresh.file.cases.map((c) => {
    if (!keep.has(c.group)) return c;
    const old = cachedById.get(c.id);
    if (old && old.group === c.group) return old;
    missing++;
    return c;
  });
  if (missing) {
    // the generators produced a different case list for a group with an unchanged fingerprint - should not
    // happen; keep the fresh cases for safety and say so
    reason += ` (${missing} cases of unchanged groups were not in the cache and were generated fresh)`;
  }
  const groupById = new Map(fresh.file.cases.map((c) => [c.id, c.group]));
  const design: Design = {
    file: { ...fresh.file, cases },
    valid: mergeData(fresh.valid, cache?.design.valid ?? {}, groupById, keep),
    invalid: mergeData(fresh.invalid, cache?.design.invalid ?? {}, groupById, keep),
    boundary: mergeData(fresh.boundary, cache?.design.boundary ?? {}, groupById, keep),
  };

  // diff report
  const oldEps = new Map((cache?.endpoints ?? []).map((e) => [e.id, e]));
  const newEps = new Map(summary.endpoints.map((e) => [e.id, e]));
  const changed: EndpointChange[] = [];
  let unchangedEps = 0;
  for (const [id, e] of newEps) {
    const old = oldEps.get(id);
    if (!old) continue;
    const changes: string[] = [];
    diffValues(old, e, '', changes);
    if (changes.length) changed.push({ id, endpoint: label(e), changes });
    else unchangedEps++;
  }
  for (const r of summary.resources) {
    const old = cache?.resources.find((x) => x.name === r.name);
    const changes: string[] = [];
    if (old) diffValues(resourceKey(old), resourceKey(r), `resource ${r.name}`, changes);
    if (changes.length) changed.push({ id: `resource:${r.name}`, endpoint: `resource ${r.name}`, changes });
  }
  const oldIds = new Set((cache?.design.file.cases ?? []).map((c) => c.id));
  const newIds = new Set(cases.map((c) => c.id));
  const oldGroups = Object.keys(cache?.fingerprints.groups ?? {});
  const diff: SpecDiff = {
    apiName,
    generatedAt: new Date().toISOString(),
    previousDesignAt: cache?.writtenAt,
    mode,
    reason,
    endpoints: {
      added: cache ? [...newEps.values()].filter((e) => !oldEps.has(e.id)).map(label) : [],
      removed: [...oldEps.values()].filter((e) => !newEps.has(e.id)).map(label),
      changed,
      unchanged: unchangedEps,
    },
    groups: {
      regenerated: groups.filter((g) => !keep.has(g)),
      unchanged: groups.filter((g) => keep.has(g)),
      removed: oldGroups.filter((g) => !(g in now.groups)),
    },
    checks: {
      added: cache ? [...newIds].filter((id) => !oldIds.has(id)) : [],
      removed: [...oldIds].filter((id) => !newIds.has(id)),
      changed: cases.filter((c) => !keep.has(c.group) && cachedById.has(c.id) && stable(cachedById.get(c.id)) !== stable(c)).map((c) => c.id),
      kept: [...newIds].filter((id) => oldIds.has(id)).length,
    },
  };

  writeDesign(apiName, design);
  const next: DesignCache = { version: CACHE_VERSION, writtenAt: diff.generatedAt, fingerprints: now, endpoints: summary.endpoints, resources: summary.resources, design };
  writeJson(cachePath(apiName), next);
  // the calibration re-run designs again from the same spec; it must not replace this run's diff
  if (opts.writeDiff !== false) writeJson(diffPath(apiName), diff);
  return { design, diff };
}

export function readSpecDiff(apiName: string): SpecDiff | undefined {
  return fs.existsSync(diffPath(apiName)) ? readJson<SpecDiff>(diffPath(apiName)) : undefined;
}

/** One line for logs and the final message. */
export function describeDiff(d: SpecDiff): string {
  if (d.mode !== 'incremental') return `${d.mode}: ${d.reason}`;
  const e = d.endpoints;
  if (!e.added.length && !e.removed.length && !e.changed.length && !d.groups.removed.length) return 'spec unchanged - all groups reused from the previous design';
  return (
    `endpoints +${e.added.length} -${e.removed.length} ~${e.changed.length}; ` +
    `regenerated ${d.groups.regenerated.length ? d.groups.regenerated.join(', ') : 'none'}; reused ${d.groups.unchanged.length} group(s)` +
    `${d.groups.removed.length ? `; removed ${d.groups.removed.join(', ')}` : ''}; checks +${d.checks.added.length} -${d.checks.removed.length} ~${d.checks.changed.length}`
  );
}

if (require.main === module) {
  const [name, flag] = process.argv.slice(2);
  if (!name) {
    console.error('usage: tsx scripts/spec-diff.ts <api-name> [--full]');
    process.exit(2);
  }
  const { diff } = incrementalDesign(name, { full: flag === '--full' });
  console.log(describeDiff(diff));
}
