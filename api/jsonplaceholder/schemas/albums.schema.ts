// Generated from spec/endpoint-summary.json by scripts/generate-specs.ts.
// Response schemas for the "albums" group: type, format and presence of every field.
import { z } from 'zod';

/** GET /albums - List albums */
export const AlbumsGetResponse = z.array(z
  .object({
    userId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
  })
  .passthrough());
export type AlbumsGetResponse = z.infer<typeof AlbumsGetResponse>;

/** POST /albums - Create albums */
export const AlbumsPostResponse = z
  .object({
    userId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
  })
  .passthrough();
export type AlbumsPostResponse = z.infer<typeof AlbumsPostResponse>;

/** GET /albums/{id} - Get one albums */
export const AlbumsIdGetResponse = z
  .object({
    userId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
  })
  .passthrough();
export type AlbumsIdGetResponse = z.infer<typeof AlbumsIdGetResponse>;

/** PUT /albums/{id} - Replace albums */
export const AlbumsIdPutResponse = z
  .object({
    userId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
  })
  .passthrough();
export type AlbumsIdPutResponse = z.infer<typeof AlbumsIdPutResponse>;

/** PATCH /albums/{id} - Update part of albums */
export const AlbumsIdPatchResponse = z
  .object({
    userId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
  })
  .passthrough();
export type AlbumsIdPatchResponse = z.infer<typeof AlbumsIdPatchResponse>;
