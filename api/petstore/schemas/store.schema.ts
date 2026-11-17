// Generated from spec/endpoint-summary.json by scripts/generate-specs.ts.
// Response schemas for the "store" group: type, format and presence of every field.
import { z } from 'zod';
import type { Shape } from '../../../shared/helpers/authz';

/** GET /store/inventory - Returns pet inventories by status */
export const StoreInventoryGetResponse = z.record(z.unknown());
export type StoreInventoryGetResponse = z.infer<typeof StoreInventoryGetResponse>;

/** POST /store/order - Place an order for a pet */
export const StoreOrderPostResponse = z
  .object({
    id: z.number().int().optional(),
    petId: z.number().int().optional(),
    quantity: z.number().int().optional(),
    shipDate: z.string().datetime({ offset: true }).optional(),
    status: z.enum(['placed', 'approved', 'delivered']).optional(),
    complete: z.boolean().optional(),
  })
  .passthrough();
export type StoreOrderPostResponse = z.infer<typeof StoreOrderPostResponse>;

/** GET /store/order/{orderId} - Find purchase order by ID */
export const StoreOrderOrderidGetResponse = z
  .object({
    id: z.number().int().optional(),
    petId: z.number().int().optional(),
    quantity: z.number().int().optional(),
    shipDate: z.string().datetime({ offset: true }).optional(),
    status: z.enum(['placed', 'approved', 'delivered']).optional(),
    complete: z.boolean().optional(),
  })
  .passthrough();
export type StoreOrderOrderidGetResponse = z.infer<typeof StoreOrderOrderidGetResponse>;

/** documented fields of GET /store/inventory (excessive data exposure check) */
export const StoreInventoryGetShape: Shape = {};

/** documented fields of POST /store/order (excessive data exposure check) */
export const StoreOrderPostShape: Shape = {"id":true,"petId":true,"quantity":true,"shipDate":true,"status":true,"complete":true};

/** documented fields of GET /store/order/{orderId} (excessive data exposure check) */
export const StoreOrderOrderidGetShape: Shape = {"id":true,"petId":true,"quantity":true,"shipDate":true,"status":true,"complete":true};
