/**
 * Category generator plugin contract.
 *
 * A generator owns ONE test category. The designer calls `forEndpoint` for every JSON endpoint (in
 * endpoint-summary order, all generators per endpoint) and then `forApi` once per API. Generators add
 * cases only through `addCase()` from ./context and record skipped areas in `ctx.notApplicable`.
 *
 * To add a category: create scripts/design/generators/<name>.ts exporting `generator`, register it in
 * scripts/design/generators/index.ts, add the Category to shared/helpers/types.ts and a skill.
 */
import type { Category, EndpointSpec } from '../../shared/helpers/types';
import type { Ctx } from './context';

export interface EndpointInfo {
  /** true for the first method seen on this path (path-level checks run once) */
  firstOnPath: boolean;
}

export interface CategoryGenerator {
  name: string;
  category: Category;
  forEndpoint?(ctx: Ctx, e: EndpointSpec, info: EndpointInfo): void;
  forApi?(ctx: Ctx): void;
}
