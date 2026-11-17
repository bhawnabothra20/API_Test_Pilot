// Generated from spec/endpoint-summary.json by scripts/generate-specs.ts.
// Response schemas for the "booking" group: type, format and presence of every field.
import { z } from 'zod';
import type { Shape } from '../../../shared/helpers/authz';

/** POST /booking - CreateBooking */
export const BookingPostResponse = z
  .object({
    bookingid: z.number(),
    booking: z
    .object({
      firstname: z.string(),
      lastname: z.string(),
      totalprice: z.number(),
      depositpaid: z.boolean(),
      bookingdates: z
      .object({
        checkin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO 8601 date (YYYY-MM-DD)"),
        checkout: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO 8601 date (YYYY-MM-DD)"),
      })
      .passthrough(),
      additionalneeds: z.string(),
    })
    .passthrough(),
  })
  .passthrough();
export type BookingPostResponse = z.infer<typeof BookingPostResponse>;

/** GET /booking/{id} - GetBooking */
export const BookingIdGetResponse = z
  .object({
    firstname: z.string(),
    lastname: z.string(),
    totalprice: z.number(),
    depositpaid: z.boolean(),
    bookingdates: z
    .object({
      checkin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO 8601 date (YYYY-MM-DD)"),
      checkout: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO 8601 date (YYYY-MM-DD)"),
    })
    .passthrough(),
    additionalneeds: z.string(),
  })
  .passthrough();
export type BookingIdGetResponse = z.infer<typeof BookingIdGetResponse>;

/** GET /booking - GetBookingIds */
export const BookingGetResponse = z.array(z
  .object({
    bookingid: z.number(),
  })
  .passthrough());
export type BookingGetResponse = z.infer<typeof BookingGetResponse>;

/** PATCH /booking/{id} - PartialUpdateBooking */
export const BookingIdPatchResponse = z
  .object({
    firstname: z.string(),
    lastname: z.string(),
    totalprice: z.number(),
    depositpaid: z.boolean(),
    bookingdates: z
    .object({
      checkin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO 8601 date (YYYY-MM-DD)"),
      checkout: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO 8601 date (YYYY-MM-DD)"),
    })
    .passthrough(),
    additionalneeds: z.string(),
  })
  .passthrough();
export type BookingIdPatchResponse = z.infer<typeof BookingIdPatchResponse>;

/** PUT /booking/{id} - UpdateBooking */
export const BookingIdPutResponse = z
  .object({
    firstname: z.string(),
    lastname: z.string(),
    totalprice: z.number(),
    depositpaid: z.boolean(),
    bookingdates: z
    .object({
      checkin: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO 8601 date (YYYY-MM-DD)"),
      checkout: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "ISO 8601 date (YYYY-MM-DD)"),
    })
    .passthrough(),
    additionalneeds: z.string(),
  })
  .passthrough();
export type BookingIdPutResponse = z.infer<typeof BookingIdPutResponse>;

/** documented fields of POST /booking (excessive data exposure check) */
export const BookingPostShape: Shape = {"bookingid":true,"booking":{"firstname":true,"lastname":true,"totalprice":true,"depositpaid":true,"bookingdates":{"checkin":true,"checkout":true},"additionalneeds":true}};

/** documented fields of GET /booking/{id} (excessive data exposure check) */
export const BookingIdGetShape: Shape = {"firstname":true,"lastname":true,"totalprice":true,"depositpaid":true,"bookingdates":{"checkin":true,"checkout":true},"additionalneeds":true};

/** documented fields of GET /booking (excessive data exposure check) */
export const BookingGetShape: Shape = [{"bookingid":true}];

/** documented fields of PATCH /booking/{id} (excessive data exposure check) */
export const BookingIdPatchShape: Shape = {"firstname":true,"lastname":true,"totalprice":true,"depositpaid":true,"bookingdates":{"checkin":true,"checkout":true},"additionalneeds":true};

/** documented fields of PUT /booking/{id} (excessive data exposure check) */
export const BookingIdPutShape: Shape = {"firstname":true,"lastname":true,"totalprice":true,"depositpaid":true,"bookingdates":{"checkin":true,"checkout":true},"additionalneeds":true};
