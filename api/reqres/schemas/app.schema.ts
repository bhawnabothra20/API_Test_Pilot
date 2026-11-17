// Generated from spec/endpoint-summary.json by scripts/generate-specs.ts.
// Response schemas for the "app" group: type, format and presence of every field.
import { z } from 'zod';
import type { Shape } from '../../../shared/helpers/authz';

/** GET /app/me - App user profile */
export const AppMeGetResponse = z
  .object({
    data: z.record(z.unknown()),
  })
  .passthrough();
export type AppMeGetResponse = z.infer<typeof AppMeGetResponse>;

/** GET /app/collections - List collections (app user) */
export const AppCollectionsGetResponse = z
  .object({
    data: z.array(z
    .object({
      id: z.string(),
      project_id: z.string().optional(),
      user_id: z.string().optional(),
      name: z.string(),
      slug: z.string(),
      schema: z.record(z.unknown()).optional(),
      visibility: z.string().optional(),
      created_at: z.string().datetime({ offset: true }).optional(),
      updated_at: z.string().datetime({ offset: true }).optional(),
    })
    .passthrough()),
  })
  .passthrough();
export type AppCollectionsGetResponse = z.infer<typeof AppCollectionsGetResponse>;

/** GET /app/collections/{slug} - Get collection (app user) */
export const AppCollectionsSlugGetResponse = z
  .object({
    data: z
    .object({
      id: z.string(),
      project_id: z.string().optional(),
      user_id: z.string().optional(),
      name: z.string(),
      slug: z.string(),
      schema: z.record(z.unknown()).optional(),
      visibility: z.string().optional(),
      created_at: z.string().datetime({ offset: true }).optional(),
      updated_at: z.string().datetime({ offset: true }).optional(),
    })
    .passthrough(),
  })
  .passthrough();
export type AppCollectionsSlugGetResponse = z.infer<typeof AppCollectionsSlugGetResponse>;

/** GET /app/collections/{slug}/records - List records (app user) */
export const AppCollectionsSlugRecordsGetResponse = z
  .object({
    data: z.array(z
    .object({
      id: z.string(),
      collection_id: z.string().optional(),
      project_id: z.string().optional(),
      app_user_id: z.string().optional(),
      created_by: z.string().optional(),
      created_at: z.string().datetime({ offset: true }).optional(),
      updated_at: z.string().datetime({ offset: true }).optional(),
      deleted_at: z.string().datetime({ offset: true }).nullable().optional(),
      data: z.record(z.unknown()),
    })
    .passthrough()),
    meta: z
    .object({
      page: z.number().int().optional(),
      limit: z.number().int().optional(),
      total: z.number().int().optional(),
      pages: z.number().int().optional(),
    })
    .passthrough().optional(),
  })
  .passthrough();
export type AppCollectionsSlugRecordsGetResponse = z.infer<typeof AppCollectionsSlugRecordsGetResponse>;

/** POST /app/collections/{slug}/records - Create record (app user) */
export const AppCollectionsSlugRecordsPostResponse = z
  .object({
    data: z
    .object({
      id: z.string(),
      collection_id: z.string().optional(),
      project_id: z.string().optional(),
      app_user_id: z.string().optional(),
      created_by: z.string().optional(),
      created_at: z.string().datetime({ offset: true }).optional(),
      updated_at: z.string().datetime({ offset: true }).optional(),
      deleted_at: z.string().datetime({ offset: true }).nullable().optional(),
      data: z.record(z.unknown()),
    })
    .passthrough(),
  })
  .passthrough();
export type AppCollectionsSlugRecordsPostResponse = z.infer<typeof AppCollectionsSlugRecordsPostResponse>;

/** GET /app/collections/{slug}/records/{recordId} - Get record (app user) */
export const AppCollectionsSlugRecordsRecordidGetResponse = z
  .object({
    data: z
    .object({
      id: z.string(),
      collection_id: z.string().optional(),
      project_id: z.string().optional(),
      app_user_id: z.string().optional(),
      created_by: z.string().optional(),
      created_at: z.string().datetime({ offset: true }).optional(),
      updated_at: z.string().datetime({ offset: true }).optional(),
      deleted_at: z.string().datetime({ offset: true }).nullable().optional(),
      data: z.record(z.unknown()),
    })
    .passthrough(),
  })
  .passthrough();
export type AppCollectionsSlugRecordsRecordidGetResponse = z.infer<typeof AppCollectionsSlugRecordsRecordidGetResponse>;

/** PUT /app/collections/{slug}/records/{recordId} - Update record (app user) */
export const AppCollectionsSlugRecordsRecordidPutResponse = z
  .object({
    data: z
    .object({
      id: z.string(),
      collection_id: z.string().optional(),
      project_id: z.string().optional(),
      app_user_id: z.string().optional(),
      created_by: z.string().optional(),
      created_at: z.string().datetime({ offset: true }).optional(),
      updated_at: z.string().datetime({ offset: true }).optional(),
      deleted_at: z.string().datetime({ offset: true }).nullable().optional(),
      data: z.record(z.unknown()),
    })
    .passthrough(),
  })
  .passthrough();
export type AppCollectionsSlugRecordsRecordidPutResponse = z.infer<typeof AppCollectionsSlugRecordsRecordidPutResponse>;

/** PATCH /app/collections/{slug}/records/{recordId} - Patch record (app user) */
export const AppCollectionsSlugRecordsRecordidPatchResponse = z
  .object({
    data: z
    .object({
      id: z.string(),
      collection_id: z.string().optional(),
      project_id: z.string().optional(),
      app_user_id: z.string().optional(),
      created_by: z.string().optional(),
      created_at: z.string().datetime({ offset: true }).optional(),
      updated_at: z.string().datetime({ offset: true }).optional(),
      deleted_at: z.string().datetime({ offset: true }).nullable().optional(),
      data: z.record(z.unknown()),
    })
    .passthrough(),
  })
  .passthrough();
export type AppCollectionsSlugRecordsRecordidPatchResponse = z.infer<typeof AppCollectionsSlugRecordsRecordidPatchResponse>;

/** documented fields of GET /app/me (excessive data exposure check) */
export const AppMeGetShape: Shape = {"data":{}};

/** documented fields of GET /app/collections (excessive data exposure check) */
export const AppCollectionsGetShape: Shape = {"data":[{"id":true,"project_id":true,"user_id":true,"name":true,"slug":true,"schema":{},"visibility":true,"created_at":true,"updated_at":true}]};

/** documented fields of GET /app/collections/{slug} (excessive data exposure check) */
export const AppCollectionsSlugGetShape: Shape = {"data":{"id":true,"project_id":true,"user_id":true,"name":true,"slug":true,"schema":{},"visibility":true,"created_at":true,"updated_at":true}};

/** documented fields of GET /app/collections/{slug}/records (excessive data exposure check) */
export const AppCollectionsSlugRecordsGetShape: Shape = {"data":[{"id":true,"collection_id":true,"project_id":true,"app_user_id":true,"created_by":true,"created_at":true,"updated_at":true,"deleted_at":true,"data":{}}],"meta":{"page":true,"limit":true,"total":true,"pages":true}};

/** documented fields of POST /app/collections/{slug}/records (excessive data exposure check) */
export const AppCollectionsSlugRecordsPostShape: Shape = {"data":{"id":true,"collection_id":true,"project_id":true,"app_user_id":true,"created_by":true,"created_at":true,"updated_at":true,"deleted_at":true,"data":{}}};

/** documented fields of GET /app/collections/{slug}/records/{recordId} (excessive data exposure check) */
export const AppCollectionsSlugRecordsRecordidGetShape: Shape = {"data":{"id":true,"collection_id":true,"project_id":true,"app_user_id":true,"created_by":true,"created_at":true,"updated_at":true,"deleted_at":true,"data":{}}};

/** documented fields of PUT /app/collections/{slug}/records/{recordId} (excessive data exposure check) */
export const AppCollectionsSlugRecordsRecordidPutShape: Shape = {"data":{"id":true,"collection_id":true,"project_id":true,"app_user_id":true,"created_by":true,"created_at":true,"updated_at":true,"deleted_at":true,"data":{}}};

/** documented fields of PATCH /app/collections/{slug}/records/{recordId} (excessive data exposure check) */
export const AppCollectionsSlugRecordsRecordidPatchShape: Shape = {"data":{"id":true,"collection_id":true,"project_id":true,"app_user_id":true,"created_by":true,"created_at":true,"updated_at":true,"deleted_at":true,"data":{}}};
