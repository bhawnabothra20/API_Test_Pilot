// Generated from spec/endpoint-summary.json by scripts/generate-specs.ts.
// Response schemas for the "posts" group: type, format and presence of every field.
import { z } from 'zod';

/** GET /posts - List posts */
export const PostsGetResponse = z.array(z
  .object({
    userId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
    body: z.string(),
  })
  .passthrough());
export type PostsGetResponse = z.infer<typeof PostsGetResponse>;

/** POST /posts - Create posts */
export const PostsPostResponse = z
  .object({
    userId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
    body: z.string(),
  })
  .passthrough();
export type PostsPostResponse = z.infer<typeof PostsPostResponse>;

/** GET /posts/{id} - Get one posts */
export const PostsIdGetResponse = z
  .object({
    userId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
    body: z.string(),
  })
  .passthrough();
export type PostsIdGetResponse = z.infer<typeof PostsIdGetResponse>;

/** PUT /posts/{id} - Replace posts */
export const PostsIdPutResponse = z
  .object({
    userId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
    body: z.string(),
  })
  .passthrough();
export type PostsIdPutResponse = z.infer<typeof PostsIdPutResponse>;

/** PATCH /posts/{id} - Update part of posts */
export const PostsIdPatchResponse = z
  .object({
    userId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
    body: z.string(),
  })
  .passthrough();
export type PostsIdPatchResponse = z.infer<typeof PostsIdPatchResponse>;

/** GET /posts/{id}/comments - List comments of one posts */
export const PostsIdCommentsGetResponse = z.array(z
  .object({
    postId: z.number().int(),
    id: z.number().int(),
    name: z.string(),
    email: z.string().email(),
    body: z.string(),
  })
  .passthrough());
export type PostsIdCommentsGetResponse = z.infer<typeof PostsIdCommentsGetResponse>;
