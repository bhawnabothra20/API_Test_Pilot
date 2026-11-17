// Generated from spec/endpoint-summary.json by scripts/generate-specs.ts.
// Response schemas for the "auth" group: type, format and presence of every field.
import { z } from 'zod';
import type { Shape } from '../../../shared/helpers/authz';

/** POST /auth - CreateToken */
export const AuthPostResponse = z
  .object({
    token: z.string(),
  })
  .passthrough();
export type AuthPostResponse = z.infer<typeof AuthPostResponse>;

/** documented fields of POST /auth (excessive data exposure check) */
export const AuthPostShape: Shape = {"token":true};
