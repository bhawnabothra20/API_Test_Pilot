// Generated from spec/endpoint-summary.json by scripts/generate-specs.ts.
// Response schemas for the "photos" group: type, format and presence of every field.
import { z } from 'zod';

/** GET /photos - List photos */
export const PhotosGetResponse = z.array(z
  .object({
    albumId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
    url: z.string().url(),
    thumbnailUrl: z.string().url(),
  })
  .passthrough());
export type PhotosGetResponse = z.infer<typeof PhotosGetResponse>;

/** POST /photos - Create photos */
export const PhotosPostResponse = z
  .object({
    albumId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
    url: z.string().url(),
    thumbnailUrl: z.string().url(),
  })
  .passthrough();
export type PhotosPostResponse = z.infer<typeof PhotosPostResponse>;

/** GET /photos/{id} - Get one photos */
export const PhotosIdGetResponse = z
  .object({
    albumId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
    url: z.string().url(),
    thumbnailUrl: z.string().url(),
  })
  .passthrough();
export type PhotosIdGetResponse = z.infer<typeof PhotosIdGetResponse>;

/** PUT /photos/{id} - Replace photos */
export const PhotosIdPutResponse = z
  .object({
    albumId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
    url: z.string().url(),
    thumbnailUrl: z.string().url(),
  })
  .passthrough();
export type PhotosIdPutResponse = z.infer<typeof PhotosIdPutResponse>;

/** PATCH /photos/{id} - Update part of photos */
export const PhotosIdPatchResponse = z
  .object({
    albumId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
    url: z.string().url(),
    thumbnailUrl: z.string().url(),
  })
  .passthrough();
export type PhotosIdPatchResponse = z.infer<typeof PhotosIdPatchResponse>;
