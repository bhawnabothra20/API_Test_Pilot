// Generated from spec/endpoint-summary.json by scripts/generate-specs.ts.
// Response schemas for the "users" group: type, format and presence of every field.
import { z } from 'zod';

/** GET /users - List users */
export const UsersGetResponse = z.array(z
  .object({
    id: z.number().int(),
    name: z.string(),
    username: z.string(),
    email: z.string().email(),
    address: z
    .object({
      street: z.string(),
      suite: z.string(),
      city: z.string(),
      zipcode: z.string(),
      geo: z
      .object({
        lat: z.string(),
        lng: z.string(),
      })
      .passthrough(),
    })
    .passthrough(),
    phone: z.string(),
    website: z.string(),
    company: z
    .object({
      name: z.string(),
      catchPhrase: z.string(),
      bs: z.string(),
    })
    .passthrough(),
  })
  .passthrough());
export type UsersGetResponse = z.infer<typeof UsersGetResponse>;

/** POST /users - Create users */
export const UsersPostResponse = z
  .object({
    id: z.number().int(),
    name: z.string(),
    username: z.string(),
    email: z.string().email(),
    address: z
    .object({
      street: z.string(),
      suite: z.string(),
      city: z.string(),
      zipcode: z.string(),
      geo: z
      .object({
        lat: z.string(),
        lng: z.string(),
      })
      .passthrough(),
    })
    .passthrough(),
    phone: z.string(),
    website: z.string(),
    company: z
    .object({
      name: z.string(),
      catchPhrase: z.string(),
      bs: z.string(),
    })
    .passthrough(),
  })
  .passthrough();
export type UsersPostResponse = z.infer<typeof UsersPostResponse>;

/** GET /users/{id} - Get one users */
export const UsersIdGetResponse = z
  .object({
    id: z.number().int(),
    name: z.string(),
    username: z.string(),
    email: z.string().email(),
    address: z
    .object({
      street: z.string(),
      suite: z.string(),
      city: z.string(),
      zipcode: z.string(),
      geo: z
      .object({
        lat: z.string(),
        lng: z.string(),
      })
      .passthrough(),
    })
    .passthrough(),
    phone: z.string(),
    website: z.string(),
    company: z
    .object({
      name: z.string(),
      catchPhrase: z.string(),
      bs: z.string(),
    })
    .passthrough(),
  })
  .passthrough();
export type UsersIdGetResponse = z.infer<typeof UsersIdGetResponse>;

/** PUT /users/{id} - Replace users */
export const UsersIdPutResponse = z
  .object({
    id: z.number().int(),
    name: z.string(),
    username: z.string(),
    email: z.string().email(),
    address: z
    .object({
      street: z.string(),
      suite: z.string(),
      city: z.string(),
      zipcode: z.string(),
      geo: z
      .object({
        lat: z.string(),
        lng: z.string(),
      })
      .passthrough(),
    })
    .passthrough(),
    phone: z.string(),
    website: z.string(),
    company: z
    .object({
      name: z.string(),
      catchPhrase: z.string(),
      bs: z.string(),
    })
    .passthrough(),
  })
  .passthrough();
export type UsersIdPutResponse = z.infer<typeof UsersIdPutResponse>;

/** PATCH /users/{id} - Update part of users */
export const UsersIdPatchResponse = z
  .object({
    id: z.number().int(),
    name: z.string(),
    username: z.string(),
    email: z.string().email(),
    address: z
    .object({
      street: z.string(),
      suite: z.string(),
      city: z.string(),
      zipcode: z.string(),
      geo: z
      .object({
        lat: z.string(),
        lng: z.string(),
      })
      .passthrough(),
    })
    .passthrough(),
    phone: z.string(),
    website: z.string(),
    company: z
    .object({
      name: z.string(),
      catchPhrase: z.string(),
      bs: z.string(),
    })
    .passthrough(),
  })
  .passthrough();
export type UsersIdPatchResponse = z.infer<typeof UsersIdPatchResponse>;
