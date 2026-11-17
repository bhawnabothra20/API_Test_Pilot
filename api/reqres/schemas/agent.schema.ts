// Generated from spec/endpoint-summary.json by scripts/generate-specs.ts.
// Response schemas for the "agent" group: type, format and presence of every field.
import { z } from 'zod';
import type { Shape } from '../../../shared/helpers/authz';

/** GET /agent/v1/health - Agent Sandbox health probe */
export const AgentV1HealthGetResponse = z
  .object({
    data: z
    .object({
      status: z.enum(['healthy', 'degraded', 'maintenance']),
      version: z.string(),
      uptime_seconds: z.number().int(),
      rate_limit_status: z
      .object({
        tier: z.string().optional(),
        remaining_today: z.number().int().nullable().optional(),
        limit_today: z.number().int().nullable().optional(),
        reset_at: z.string().datetime({ offset: true }).nullable().optional(),
      })
      .passthrough(),
      deprecations: z.array(z.record(z.unknown())),
    })
    .passthrough(),
  })
  .passthrough();
export type AgentV1HealthGetResponse = z.infer<typeof AgentV1HealthGetResponse>;

/** GET /agent/v1/users - List agent users (cursor pagination) */
export const AgentV1UsersGetResponse = z
  .object({
    data: z.array(z
    .object({
      id: z.string(),
      email: z.string().email(),
      full_name: z.string(),
      locale: z.string(),
      created_at: z.string().datetime({ offset: true }),
      updated_at: z.string().datetime({ offset: true }),
      timezone: z.string(),
      profile: z
      .object({
        avatar_url: z.string().nullable().optional(),
        bio: z.string().nullable().optional(),
        company: z
        .object({
          name: z.string().optional(),
          department: z.string().optional(),
          employee_id: z.string().optional(),
        })
        .passthrough().nullable().optional(),
        social: z
        .object({
          twitter: z.string().nullable().optional(),
          github: z.string().nullable().optional(),
          linkedin: z.string().nullable().optional(),
        })
        .passthrough().optional(),
      })
      .passthrough(),
      preferences: z.record(z.unknown()),
      status: z.enum(['active', 'suspended']),
    })
    .passthrough()),
    meta: z
    .object({
      limit: z.number().int(),
      returned: z.number().int(),
      next_cursor: z.string().nullable(),
      prev_cursor: z.string().nullable(),
      has_more: z.boolean(),
      total_estimate: z.number().int(),
    })
    .passthrough(),
  })
  .passthrough();
export type AgentV1UsersGetResponse = z.infer<typeof AgentV1UsersGetResponse>;

/** GET /agent/v1/users/{id} - Get a single agent user with optional expansion */
export const AgentV1UsersIdGetResponse = z
  .object({
    data: z
    .object({
      id: z.string(),
      email: z.string().email(),
      full_name: z.string(),
      locale: z.string(),
      created_at: z.string().datetime({ offset: true }),
      updated_at: z.string().datetime({ offset: true }),
      timezone: z.string(),
      profile: z
      .object({
        avatar_url: z.string().nullable().optional(),
        bio: z.string().nullable().optional(),
        company: z
        .object({
          name: z.string().optional(),
          department: z.string().optional(),
          employee_id: z.string().optional(),
        })
        .passthrough().nullable().optional(),
        social: z
        .object({
          twitter: z.string().nullable().optional(),
          github: z.string().nullable().optional(),
          linkedin: z.string().nullable().optional(),
        })
        .passthrough().optional(),
      })
      .passthrough(),
      preferences: z.record(z.unknown()),
      status: z.enum(['active', 'suspended']),
    })
    .passthrough(),
  })
  .passthrough();
export type AgentV1UsersIdGetResponse = z.infer<typeof AgentV1UsersIdGetResponse>;

/** documented fields of GET /agent/v1/health (excessive data exposure check) */
export const AgentV1HealthGetShape: Shape = {"data":{"status":true,"version":true,"uptime_seconds":true,"rate_limit_status":{"tier":true,"remaining_today":true,"limit_today":true,"reset_at":true},"deprecations":[{}]}};

/** documented fields of GET /agent/v1/users (excessive data exposure check) */
export const AgentV1UsersGetShape: Shape = {"data":[{"id":true,"email":true,"full_name":true,"locale":true,"created_at":true,"updated_at":true,"timezone":true,"profile":{"avatar_url":true,"bio":true,"company":{"name":true,"department":true,"employee_id":true},"social":{"twitter":true,"github":true,"linkedin":true}},"preferences":{},"status":true}],"meta":{"limit":true,"returned":true,"next_cursor":true,"prev_cursor":true,"has_more":true,"total_estimate":true}};

/** documented fields of GET /agent/v1/users/{id} (excessive data exposure check) */
export const AgentV1UsersIdGetShape: Shape = {"data":{"id":true,"email":true,"full_name":true,"locale":true,"created_at":true,"updated_at":true,"timezone":true,"profile":{"avatar_url":true,"bio":true,"company":{"name":true,"department":true,"employee_id":true},"social":{"twitter":true,"github":true,"linkedin":true}},"preferences":{},"status":true}};
