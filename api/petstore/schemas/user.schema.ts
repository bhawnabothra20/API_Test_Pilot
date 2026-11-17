// Generated from spec/endpoint-summary.json by scripts/generate-specs.ts.
// Response schemas for the "user" group: type, format and presence of every field.
import { z } from 'zod';
import type { Shape } from '../../../shared/helpers/authz';

/** GET /user/{username} - Get user by user name */
export const UserUsernameGetResponse = z
  .object({
    id: z.number().int().optional(),
    username: z.string().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    email: z.string().optional(),
    password: z.string().optional(),
    phone: z.string().optional(),
    userStatus: z.number().int().optional(),
  })
  .passthrough();
export type UserUsernameGetResponse = z.infer<typeof UserUsernameGetResponse>;

/** GET /user/login - Logs user into the system */
export const UserLoginGetResponse = z.string();
export type UserLoginGetResponse = z.infer<typeof UserLoginGetResponse>;

/** documented fields of GET /user/{username} (excessive data exposure check) */
export const UserUsernameGetShape: Shape = {"id":true,"username":true,"firstName":true,"lastName":true,"email":true,"password":true,"phone":true,"userStatus":true};

/** documented fields of GET /user/login (excessive data exposure check) */
export const UserLoginGetShape: Shape = true;
