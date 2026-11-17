// Generated from spec/endpoint-summary.json by scripts/generate-specs.ts.
// Response schemas for the "comments" group: type, format and presence of every field.
import { z } from 'zod';

/** GET /comments - List comments */
export const CommentsGetResponse = z.array(z
  .object({
    postId: z.number().int(),
    id: z.number().int(),
    name: z.string(),
    email: z.string().email(),
    body: z.string(),
  })
  .passthrough());
export type CommentsGetResponse = z.infer<typeof CommentsGetResponse>;

/** POST /comments - Create comments */
export const CommentsPostResponse = z
  .object({
    postId: z.number().int(),
    id: z.number().int(),
    name: z.string(),
    email: z.string().email(),
    body: z.string(),
  })
  .passthrough();
export type CommentsPostResponse = z.infer<typeof CommentsPostResponse>;

/** GET /comments/{id} - Get one comments */
export const CommentsIdGetResponse = z
  .object({
    postId: z.number().int(),
    id: z.number().int(),
    name: z.string(),
    email: z.string().email(),
    body: z.string(),
  })
  .passthrough();
export type CommentsIdGetResponse = z.infer<typeof CommentsIdGetResponse>;

/** PUT /comments/{id} - Replace comments */
export const CommentsIdPutResponse = z
  .object({
    postId: z.number().int(),
    id: z.number().int(),
    name: z.string(),
    email: z.string().email(),
    body: z.string(),
  })
  .passthrough();
export type CommentsIdPutResponse = z.infer<typeof CommentsIdPutResponse>;

/** PATCH /comments/{id} - Update part of comments */
export const CommentsIdPatchResponse = z
  .object({
    postId: z.number().int(),
    id: z.number().int(),
    name: z.string(),
    email: z.string().email(),
    body: z.string(),
  })
  .passthrough();
export type CommentsIdPatchResponse = z.infer<typeof CommentsIdPatchResponse>;
