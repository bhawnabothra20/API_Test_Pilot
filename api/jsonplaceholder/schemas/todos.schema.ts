// Generated from spec/endpoint-summary.json by scripts/generate-specs.ts.
// Response schemas for the "todos" group: type, format and presence of every field.
import { z } from 'zod';

/** GET /todos - List todos */
export const TodosGetResponse = z.array(z
  .object({
    userId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
    completed: z.boolean(),
  })
  .passthrough());
export type TodosGetResponse = z.infer<typeof TodosGetResponse>;

/** POST /todos - Create todos */
export const TodosPostResponse = z
  .object({
    userId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
    completed: z.boolean(),
  })
  .passthrough();
export type TodosPostResponse = z.infer<typeof TodosPostResponse>;

/** GET /todos/{id} - Get one todos */
export const TodosIdGetResponse = z
  .object({
    userId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
    completed: z.boolean(),
  })
  .passthrough();
export type TodosIdGetResponse = z.infer<typeof TodosIdGetResponse>;

/** PUT /todos/{id} - Replace todos */
export const TodosIdPutResponse = z
  .object({
    userId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
    completed: z.boolean(),
  })
  .passthrough();
export type TodosIdPutResponse = z.infer<typeof TodosIdPutResponse>;

/** PATCH /todos/{id} - Update part of todos */
export const TodosIdPatchResponse = z
  .object({
    userId: z.number().int(),
    id: z.number().int(),
    title: z.string(),
    completed: z.boolean(),
  })
  .passthrough();
export type TodosIdPatchResponse = z.infer<typeof TodosIdPatchResponse>;
