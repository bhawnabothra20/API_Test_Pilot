// Generated from spec/endpoint-summary.json by scripts/generate-specs.ts.
// Response schemas for the "api" group: type, format and presence of every field.
import { z } from 'zod';
import type { Shape } from '../../../shared/helpers/authz';

/** POST /api/projects/sandbox - Create a sandbox project (no signup) */
export const ApiProjectsSandboxPostResponse = z
  .object({
    project: z.record(z.unknown()).optional(),
    keys: z.record(z.unknown()).optional(),
    starter_collection: z.string().optional(),
    base_url: z.string().optional(),
    claim_url: z.string().optional(),
    expires_at: z.string().datetime({ offset: true }).optional(),
    limits: z.record(z.unknown()).optional(),
    next_steps: z.array(z.string()).optional(),
  })
  .passthrough();
export type ApiProjectsSandboxPostResponse = z.infer<typeof ApiProjectsSandboxPostResponse>;

/** GET /api/users - List users (legacy) */
export const ApiUsersGetResponse = z
  .object({
    page: z.number().int(),
    per_page: z.number().int(),
    total: z.number().int(),
    total_pages: z.number().int(),
    data: z.array(z
    .object({
      id: z.number().int(),
      email: z.string().email(),
      first_name: z.string(),
      last_name: z.string(),
      avatar: z.string(),
    })
    .passthrough()),
    support: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type ApiUsersGetResponse = z.infer<typeof ApiUsersGetResponse>;

/** POST /api/users - Create user (legacy) */
export const ApiUsersPostResponse = z
  .object({
    id: z.string().optional(),
    createdAt: z.string().datetime({ offset: true }).optional(),
    updatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .passthrough();
export type ApiUsersPostResponse = z.infer<typeof ApiUsersPostResponse>;

/** GET /api/users/{id} - Get user by id (legacy) */
export const ApiUsersIdGetResponse = z
  .object({
    data: z
    .object({
      id: z.number().int(),
      email: z.string().email(),
      first_name: z.string(),
      last_name: z.string(),
      avatar: z.string(),
    })
    .passthrough(),
    support: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type ApiUsersIdGetResponse = z.infer<typeof ApiUsersIdGetResponse>;

/** PUT /api/users/{id} - Update user (legacy) */
export const ApiUsersIdPutResponse = z
  .object({
    id: z.string().optional(),
    createdAt: z.string().datetime({ offset: true }).optional(),
    updatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .passthrough();
export type ApiUsersIdPutResponse = z.infer<typeof ApiUsersIdPutResponse>;

/** PATCH /api/users/{id} - Patch user (legacy) */
export const ApiUsersIdPatchResponse = z
  .object({
    id: z.string().optional(),
    createdAt: z.string().datetime({ offset: true }).optional(),
    updatedAt: z.string().datetime({ offset: true }).optional(),
  })
  .passthrough();
export type ApiUsersIdPatchResponse = z.infer<typeof ApiUsersIdPatchResponse>;

/** GET /api/unknown - List resources (legacy) */
export const ApiUnknownGetResponse = z
  .object({
    page: z.number().int(),
    per_page: z.number().int(),
    total: z.number().int(),
    total_pages: z.number().int(),
    data: z.array(z
    .object({
      id: z.number().int(),
      name: z.string(),
      year: z.number().int(),
      color: z.string(),
      pantone_value: z.string(),
    })
    .passthrough()),
    support: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type ApiUnknownGetResponse = z.infer<typeof ApiUnknownGetResponse>;

/** GET /api/unknown/{id} - Get resource by id (legacy) */
export const ApiUnknownIdGetResponse = z
  .object({
    data: z
    .object({
      id: z.number().int(),
      name: z.string(),
      year: z.number().int(),
      color: z.string(),
      pantone_value: z.string(),
    })
    .passthrough(),
    support: z.record(z.unknown()).optional(),
  })
  .passthrough();
export type ApiUnknownIdGetResponse = z.infer<typeof ApiUnknownIdGetResponse>;

/** POST /api/register - Register user */
export const ApiRegisterPostResponse = z
  .object({
    id: z.number().int().optional(),
    token: z.string(),
  })
  .passthrough();
export type ApiRegisterPostResponse = z.infer<typeof ApiRegisterPostResponse>;

/** POST /api/login - Login user */
export const ApiLoginPostResponse = z
  .object({
    token: z.string(),
  })
  .passthrough();
export type ApiLoginPostResponse = z.infer<typeof ApiLoginPostResponse>;

/** POST /api/logout - Logout user */
export const ApiLogoutPostResponse = z.record(z.unknown());
export type ApiLogoutPostResponse = z.infer<typeof ApiLogoutPostResponse>;

/** GET /api/collections - List collections */
export const ApiCollectionsGetResponse = z
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
export type ApiCollectionsGetResponse = z.infer<typeof ApiCollectionsGetResponse>;

/** POST /api/collections - Create collection */
export const ApiCollectionsPostResponse = z
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
export type ApiCollectionsPostResponse = z.infer<typeof ApiCollectionsPostResponse>;

/** GET /api/collections/{slug} - Get collection */
export const ApiCollectionsSlugGetResponse = z
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
export type ApiCollectionsSlugGetResponse = z.infer<typeof ApiCollectionsSlugGetResponse>;

/** PUT /api/collections/{slug} - Update collection */
export const ApiCollectionsSlugPutResponse = z
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
export type ApiCollectionsSlugPutResponse = z.infer<typeof ApiCollectionsSlugPutResponse>;

/** GET /api/collections/{slug}/records - List records */
export const ApiCollectionsSlugRecordsGetResponse = z
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
export type ApiCollectionsSlugRecordsGetResponse = z.infer<typeof ApiCollectionsSlugRecordsGetResponse>;

/** POST /api/collections/{slug}/records - Create record */
export const ApiCollectionsSlugRecordsPostResponse = z
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
export type ApiCollectionsSlugRecordsPostResponse = z.infer<typeof ApiCollectionsSlugRecordsPostResponse>;

/** GET /api/collections/{slug}/records/{recordId} - Get record */
export const ApiCollectionsSlugRecordsRecordidGetResponse = z
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
export type ApiCollectionsSlugRecordsRecordidGetResponse = z.infer<typeof ApiCollectionsSlugRecordsRecordidGetResponse>;

/** PUT /api/collections/{slug}/records/{recordId} - Update record */
export const ApiCollectionsSlugRecordsRecordidPutResponse = z
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
export type ApiCollectionsSlugRecordsRecordidPutResponse = z.infer<typeof ApiCollectionsSlugRecordsRecordidPutResponse>;

/** PATCH /api/collections/{slug}/records/{recordId} - Patch record */
export const ApiCollectionsSlugRecordsRecordidPatchResponse = z
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
export type ApiCollectionsSlugRecordsRecordidPatchResponse = z.infer<typeof ApiCollectionsSlugRecordsRecordidPatchResponse>;

/** POST /api/app-users/login - App user login */
export const ApiAppusersLoginPostResponse = z
  .object({
    data: z.record(z.unknown()),
  })
  .passthrough();
export type ApiAppusersLoginPostResponse = z.infer<typeof ApiAppusersLoginPostResponse>;

/** POST /api/app-users/verify - Verify app user token */
export const ApiAppusersVerifyPostResponse = z
  .object({
    data: z.record(z.unknown()),
  })
  .passthrough();
export type ApiAppusersVerifyPostResponse = z.infer<typeof ApiAppusersVerifyPostResponse>;

/** GET /api/app-users/me - Current app user */
export const ApiAppusersMeGetResponse = z
  .object({
    data: z.record(z.unknown()),
  })
  .passthrough();
export type ApiAppusersMeGetResponse = z.infer<typeof ApiAppusersMeGetResponse>;

/** GET /api/app-users - List app users */
export const ApiAppusersGetResponse = z
  .object({
    data: z.array(z
    .object({
      id: z.string(),
      email: z.string().email(),
      status: z.string().optional(),
      last_login_at: z.string().datetime({ offset: true }).optional(),
      created_at: z.string().datetime({ offset: true }).optional(),
      metadata: z.record(z.unknown()).optional(),
    })
    .passthrough()),
  })
  .passthrough();
export type ApiAppusersGetResponse = z.infer<typeof ApiAppusersGetResponse>;

/** POST /api/app-users - Create app user */
export const ApiAppusersPostResponse = z
  .object({
    data: z
    .object({
      id: z.string(),
      email: z.string().email(),
      status: z.string().optional(),
      last_login_at: z.string().datetime({ offset: true }).optional(),
      created_at: z.string().datetime({ offset: true }).optional(),
      metadata: z.record(z.unknown()).optional(),
    })
    .passthrough(),
  })
  .passthrough();
export type ApiAppusersPostResponse = z.infer<typeof ApiAppusersPostResponse>;

/** GET /api/app-users/{id} - Get app user */
export const ApiAppusersIdGetResponse = z
  .object({
    data: z
    .object({
      id: z.string(),
      email: z.string().email(),
      status: z.string().optional(),
      last_login_at: z.string().datetime({ offset: true }).optional(),
      created_at: z.string().datetime({ offset: true }).optional(),
      metadata: z.record(z.unknown()).optional(),
    })
    .passthrough(),
  })
  .passthrough();
export type ApiAppusersIdGetResponse = z.infer<typeof ApiAppusersIdGetResponse>;

/** PUT /api/app-users/{id} - Update app user */
export const ApiAppusersIdPutResponse = z
  .object({
    data: z
    .object({
      id: z.string(),
      email: z.string().email(),
      status: z.string().optional(),
      last_login_at: z.string().datetime({ offset: true }).optional(),
      created_at: z.string().datetime({ offset: true }).optional(),
      metadata: z.record(z.unknown()).optional(),
    })
    .passthrough(),
  })
  .passthrough();
export type ApiAppusersIdPutResponse = z.infer<typeof ApiAppusersIdPutResponse>;

/** DELETE /api/app-users/{id} - Delete app user */
export const ApiAppusersIdDeleteResponse = z.record(z.unknown());
export type ApiAppusersIdDeleteResponse = z.infer<typeof ApiAppusersIdDeleteResponse>;

/** POST /api/app-users/{id}/sessions/simulate - Simulate app user session */
export const ApiAppusersIdSessionsSimulatePostResponse = z.record(z.unknown());
export type ApiAppusersIdSessionsSimulatePostResponse = z.infer<typeof ApiAppusersIdSessionsSimulatePostResponse>;

/** GET /api/projects/{projectId}/app-users - List project app users */
export const ApiProjectsProjectidAppusersGetResponse = z
  .object({
    data: z.array(z
    .object({
      id: z.string(),
      email: z.string().email(),
      status: z.string().optional(),
      last_login_at: z.string().datetime({ offset: true }).optional(),
      created_at: z.string().datetime({ offset: true }).optional(),
      metadata: z.record(z.unknown()).optional(),
    })
    .passthrough()),
  })
  .passthrough();
export type ApiProjectsProjectidAppusersGetResponse = z.infer<typeof ApiProjectsProjectidAppusersGetResponse>;

/** GET /api/projects/{projectId}/app-users/total - App users total */
export const ApiProjectsProjectidAppusersTotalGetResponse = z
  .object({
    total: z.number().int(),
  })
  .passthrough();
export type ApiProjectsProjectidAppusersTotalGetResponse = z.infer<typeof ApiProjectsProjectidAppusersTotalGetResponse>;

/** GET /api/custom/{path} - Execute custom endpoint */
export const ApiCustomPathGetResponse = z.record(z.unknown());
export type ApiCustomPathGetResponse = z.infer<typeof ApiCustomPathGetResponse>;

/** POST /api/custom/{path} - Execute custom endpoint */
export const ApiCustomPathPostResponse = z.record(z.unknown());
export type ApiCustomPathPostResponse = z.infer<typeof ApiCustomPathPostResponse>;

/** PUT /api/custom/{path} - Execute custom endpoint */
export const ApiCustomPathPutResponse = z.record(z.unknown());
export type ApiCustomPathPutResponse = z.infer<typeof ApiCustomPathPutResponse>;

/** PATCH /api/custom/{path} - Execute custom endpoint */
export const ApiCustomPathPatchResponse = z.record(z.unknown());
export type ApiCustomPathPatchResponse = z.infer<typeof ApiCustomPathPatchResponse>;

/** DELETE /api/custom/{path} - Execute custom endpoint */
export const ApiCustomPathDeleteResponse = z.record(z.unknown());
export type ApiCustomPathDeleteResponse = z.infer<typeof ApiCustomPathDeleteResponse>;

/** documented fields of POST /api/projects/sandbox (excessive data exposure check) */
export const ApiProjectsSandboxPostShape: Shape = {"project":{},"keys":{},"starter_collection":true,"base_url":true,"claim_url":true,"expires_at":true,"limits":{},"next_steps":[true]};

/** documented fields of GET /api/users (excessive data exposure check) */
export const ApiUsersGetShape: Shape = {"page":true,"per_page":true,"total":true,"total_pages":true,"data":[{"id":true,"email":true,"first_name":true,"last_name":true,"avatar":true}],"support":{}};

/** documented fields of POST /api/users (excessive data exposure check) */
export const ApiUsersPostShape: Shape = {"id":true,"createdAt":true,"updatedAt":true};

/** documented fields of GET /api/users/{id} (excessive data exposure check) */
export const ApiUsersIdGetShape: Shape = {"data":{"id":true,"email":true,"first_name":true,"last_name":true,"avatar":true},"support":{}};

/** documented fields of PUT /api/users/{id} (excessive data exposure check) */
export const ApiUsersIdPutShape: Shape = {"id":true,"createdAt":true,"updatedAt":true};

/** documented fields of PATCH /api/users/{id} (excessive data exposure check) */
export const ApiUsersIdPatchShape: Shape = {"id":true,"createdAt":true,"updatedAt":true};

/** documented fields of GET /api/unknown (excessive data exposure check) */
export const ApiUnknownGetShape: Shape = {"page":true,"per_page":true,"total":true,"total_pages":true,"data":[{"id":true,"name":true,"year":true,"color":true,"pantone_value":true}],"support":{}};

/** documented fields of GET /api/unknown/{id} (excessive data exposure check) */
export const ApiUnknownIdGetShape: Shape = {"data":{"id":true,"name":true,"year":true,"color":true,"pantone_value":true},"support":{}};

/** documented fields of POST /api/register (excessive data exposure check) */
export const ApiRegisterPostShape: Shape = {"id":true,"token":true};

/** documented fields of POST /api/login (excessive data exposure check) */
export const ApiLoginPostShape: Shape = {"token":true};

/** documented fields of POST /api/logout (excessive data exposure check) */
export const ApiLogoutPostShape: Shape = {};

/** documented fields of GET /api/collections (excessive data exposure check) */
export const ApiCollectionsGetShape: Shape = {"data":[{"id":true,"project_id":true,"user_id":true,"name":true,"slug":true,"schema":{},"visibility":true,"created_at":true,"updated_at":true}]};

/** documented fields of POST /api/collections (excessive data exposure check) */
export const ApiCollectionsPostShape: Shape = {"data":{"id":true,"project_id":true,"user_id":true,"name":true,"slug":true,"schema":{},"visibility":true,"created_at":true,"updated_at":true}};

/** documented fields of GET /api/collections/{slug} (excessive data exposure check) */
export const ApiCollectionsSlugGetShape: Shape = {"data":{"id":true,"project_id":true,"user_id":true,"name":true,"slug":true,"schema":{},"visibility":true,"created_at":true,"updated_at":true}};

/** documented fields of PUT /api/collections/{slug} (excessive data exposure check) */
export const ApiCollectionsSlugPutShape: Shape = {"data":{"id":true,"project_id":true,"user_id":true,"name":true,"slug":true,"schema":{},"visibility":true,"created_at":true,"updated_at":true}};

/** documented fields of GET /api/collections/{slug}/records (excessive data exposure check) */
export const ApiCollectionsSlugRecordsGetShape: Shape = {"data":[{"id":true,"collection_id":true,"project_id":true,"app_user_id":true,"created_by":true,"created_at":true,"updated_at":true,"deleted_at":true,"data":{}}],"meta":{"page":true,"limit":true,"total":true,"pages":true}};

/** documented fields of POST /api/collections/{slug}/records (excessive data exposure check) */
export const ApiCollectionsSlugRecordsPostShape: Shape = {"data":{"id":true,"collection_id":true,"project_id":true,"app_user_id":true,"created_by":true,"created_at":true,"updated_at":true,"deleted_at":true,"data":{}}};

/** documented fields of GET /api/collections/{slug}/records/{recordId} (excessive data exposure check) */
export const ApiCollectionsSlugRecordsRecordidGetShape: Shape = {"data":{"id":true,"collection_id":true,"project_id":true,"app_user_id":true,"created_by":true,"created_at":true,"updated_at":true,"deleted_at":true,"data":{}}};

/** documented fields of PUT /api/collections/{slug}/records/{recordId} (excessive data exposure check) */
export const ApiCollectionsSlugRecordsRecordidPutShape: Shape = {"data":{"id":true,"collection_id":true,"project_id":true,"app_user_id":true,"created_by":true,"created_at":true,"updated_at":true,"deleted_at":true,"data":{}}};

/** documented fields of PATCH /api/collections/{slug}/records/{recordId} (excessive data exposure check) */
export const ApiCollectionsSlugRecordsRecordidPatchShape: Shape = {"data":{"id":true,"collection_id":true,"project_id":true,"app_user_id":true,"created_by":true,"created_at":true,"updated_at":true,"deleted_at":true,"data":{}}};

/** documented fields of POST /api/app-users/login (excessive data exposure check) */
export const ApiAppusersLoginPostShape: Shape = {"data":{}};

/** documented fields of POST /api/app-users/verify (excessive data exposure check) */
export const ApiAppusersVerifyPostShape: Shape = {"data":{}};

/** documented fields of GET /api/app-users/me (excessive data exposure check) */
export const ApiAppusersMeGetShape: Shape = {"data":{}};

/** documented fields of GET /api/app-users (excessive data exposure check) */
export const ApiAppusersGetShape: Shape = {"data":[{"id":true,"email":true,"status":true,"last_login_at":true,"created_at":true,"metadata":{}}]};

/** documented fields of POST /api/app-users (excessive data exposure check) */
export const ApiAppusersPostShape: Shape = {"data":{"id":true,"email":true,"status":true,"last_login_at":true,"created_at":true,"metadata":{}}};

/** documented fields of GET /api/app-users/{id} (excessive data exposure check) */
export const ApiAppusersIdGetShape: Shape = {"data":{"id":true,"email":true,"status":true,"last_login_at":true,"created_at":true,"metadata":{}}};

/** documented fields of PUT /api/app-users/{id} (excessive data exposure check) */
export const ApiAppusersIdPutShape: Shape = {"data":{"id":true,"email":true,"status":true,"last_login_at":true,"created_at":true,"metadata":{}}};

/** documented fields of DELETE /api/app-users/{id} (excessive data exposure check) */
export const ApiAppusersIdDeleteShape: Shape = {};

/** documented fields of POST /api/app-users/{id}/sessions/simulate (excessive data exposure check) */
export const ApiAppusersIdSessionsSimulatePostShape: Shape = {};

/** documented fields of GET /api/projects/{projectId}/app-users (excessive data exposure check) */
export const ApiProjectsProjectidAppusersGetShape: Shape = {"data":[{"id":true,"email":true,"status":true,"last_login_at":true,"created_at":true,"metadata":{}}]};

/** documented fields of GET /api/projects/{projectId}/app-users/total (excessive data exposure check) */
export const ApiProjectsProjectidAppusersTotalGetShape: Shape = {"total":true};

/** documented fields of GET /api/custom/{path} (excessive data exposure check) */
export const ApiCustomPathGetShape: Shape = {};

/** documented fields of POST /api/custom/{path} (excessive data exposure check) */
export const ApiCustomPathPostShape: Shape = {};

/** documented fields of PUT /api/custom/{path} (excessive data exposure check) */
export const ApiCustomPathPutShape: Shape = {};

/** documented fields of PATCH /api/custom/{path} (excessive data exposure check) */
export const ApiCustomPathPatchShape: Shape = {};

/** documented fields of DELETE /api/custom/{path} (excessive data exposure check) */
export const ApiCustomPathDeleteShape: Shape = {};
