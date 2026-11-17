// Generated from spec/endpoint-summary.json by scripts/generate-specs.ts.
// Response schemas for the "pet" group: type, format and presence of every field.
import { z } from 'zod';
import type { Shape } from '../../../shared/helpers/authz';

/** POST /pet/{petId}/uploadImage - uploads an image */
export const PetPetidUploadimagePostResponse = z
  .object({
    code: z.number().int().optional(),
    type: z.string().optional(),
    message: z.string().optional(),
  })
  .passthrough();
export type PetPetidUploadimagePostResponse = z.infer<typeof PetPetidUploadimagePostResponse>;

/** GET /pet/findByStatus - Finds Pets by status */
export const PetFindbystatusGetResponse = z.array(z
  .object({
    id: z.number().int().optional(),
    category: z
    .object({
      id: z.number().int().optional(),
      name: z.string().optional(),
    })
    .passthrough().optional(),
    name: z.string(),
    photoUrls: z.array(z.string()),
    tags: z.array(z
    .object({
      id: z.number().int().optional(),
      name: z.string().optional(),
    })
    .passthrough()).optional(),
    status: z.enum(['available', 'pending', 'sold']).optional(),
  })
  .passthrough());
export type PetFindbystatusGetResponse = z.infer<typeof PetFindbystatusGetResponse>;

/** GET /pet/findByTags - Finds Pets by tags */
export const PetFindbytagsGetResponse = z.array(z
  .object({
    id: z.number().int().optional(),
    category: z
    .object({
      id: z.number().int().optional(),
      name: z.string().optional(),
    })
    .passthrough().optional(),
    name: z.string(),
    photoUrls: z.array(z.string()),
    tags: z.array(z
    .object({
      id: z.number().int().optional(),
      name: z.string().optional(),
    })
    .passthrough()).optional(),
    status: z.enum(['available', 'pending', 'sold']).optional(),
  })
  .passthrough());
export type PetFindbytagsGetResponse = z.infer<typeof PetFindbytagsGetResponse>;

/** GET /pet/{petId} - Find pet by ID */
export const PetPetidGetResponse = z
  .object({
    id: z.number().int().optional(),
    category: z
    .object({
      id: z.number().int().optional(),
      name: z.string().optional(),
    })
    .passthrough().optional(),
    name: z.string(),
    photoUrls: z.array(z.string()),
    tags: z.array(z
    .object({
      id: z.number().int().optional(),
      name: z.string().optional(),
    })
    .passthrough()).optional(),
    status: z.enum(['available', 'pending', 'sold']).optional(),
  })
  .passthrough();
export type PetPetidGetResponse = z.infer<typeof PetPetidGetResponse>;

/** documented fields of POST /pet/{petId}/uploadImage (excessive data exposure check) */
export const PetPetidUploadimagePostShape: Shape = {"code":true,"type":true,"message":true};

/** documented fields of GET /pet/findByStatus (excessive data exposure check) */
export const PetFindbystatusGetShape: Shape = [{"id":true,"category":{"id":true,"name":true},"name":true,"photoUrls":[true],"tags":[{"id":true,"name":true}],"status":true}];

/** documented fields of GET /pet/findByTags (excessive data exposure check) */
export const PetFindbytagsGetShape: Shape = [{"id":true,"category":{"id":true,"name":true},"name":true,"photoUrls":[true],"tags":[{"id":true,"name":true}],"status":true}];

/** documented fields of GET /pet/{petId} (excessive data exposure check) */
export const PetPetidGetShape: Shape = {"id":true,"category":{"id":true,"name":true},"name":true,"photoUrls":[true],"tags":[{"id":true,"name":true}],"status":true};
