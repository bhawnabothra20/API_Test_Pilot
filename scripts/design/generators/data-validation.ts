/** Category generator: Positive-DataValidation. See .claude/skills for the rules this implements. */
import { leafFields, typeOf } from '../../../shared/helpers/json-schema';
import type { EndpointSpec } from '../../../shared/helpers/types';
import { addCase, isJson, patchBody, successStatuses, validBody } from '../context';
import type { Ctx } from '../context';
import type { CategoryGenerator } from '../plugin';

export function dataValidation(ctx: Ctx, e: EndpointSpec): void {
  if (e.isLogin) return;
  const ok = successStatuses(e);
  const label = `${e.method} ${e.path}`;
  const body = e.method === 'PATCH' ? patchBody(e) : validBody(e);
  const base = { e, category: 'Positive-DataValidation' as const, variant: 'positive' as const, status: ok };
  if (e.responseSchema && isJson(e)) {
    const isArray = typeOf(e.responseSchema) === 'array';
    addCase(ctx, {
      ...base,
      priority: 'High',
      title: `${label} response matches the schema for every field${isArray ? ' of every array item' : ''} (type, format, presence)`,
      data: { note: 'schema validation', body },
    });
    const leaves = leafFields(isArray ? (e.responseSchema.items ?? {}) : e.responseSchema);
    const special = leaves.filter((l) => l.schema.format || l.schema.enum || l.schema.minimum !== undefined || l.schema.maximum !== undefined);
    if (special.length) {
      addCase(ctx, {
        ...base,
        title: `${label} formatted fields are valid (${special
          .slice(0, 4)
          .map((l) => `${l.path}:${l.schema.format ?? (l.schema.enum ? 'enum' : 'range')}`)
          .join(', ')})`,
        data: { note: 'format/enum/range validation', body },
      });
    }
  }
  addCase(ctx, {
    ...base,
    title: `${label} returns the documented Content-Type header (${e.responseContentType})`,
    data: { note: 'header validation', body },
  });
  addCase(ctx, {
    ...base,
    title: `${label} responds within ${ctx.summary.defaults.responseTimeMs} ms`,
    data: { note: 'response time', body },
  });
  if (body !== undefined && ['POST', 'PUT', 'PATCH'].includes(e.method)) {
    addCase(ctx, {
      ...base,
      title: `${label} persists/echoes every request value exactly (no truncation or type change)`,
      data: { note: 'echo exactness', body },
      echo: true,
    });
  }
}

export const generator: CategoryGenerator = {
  name: 'data-validation',
  category: 'Positive-DataValidation',
  forEndpoint: (ctx, e) => dataValidation(ctx, e),
};
