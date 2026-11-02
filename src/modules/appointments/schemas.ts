import { z } from "zod";
const version = z.number().int().min(1).max(2147483647);
const contextFields = {
  staff: version.optional(),
  calendar: version.optional(),
  settings: version.optional(),
  business: version.optional(),
};
export const contextVersions = z
  .object({
    ...contextFields,
    service: version.optional(),
    customer: version.optional(),
  })
  .strict()
  .optional();
export const moveContextVersions = z.object(contextFields).strict().optional();
const instant = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/)
  .pipe(z.iso.datetime({ offset: true }));
const reason = z
  .string()
  .normalize("NFC")
  .refine(
    (v) =>
      Array.from(v).length <= 500 &&
      !/[\u0000-\u001f\u007f-\u009f]/u.test(v.replace(/[\n\t]/g, "")),
  )
  .nullable()
  .optional();
export const createAppointmentInput = z
  .object({
    id: z.uuidv4(),
    customer_id: z.uuid(),
    staff_id: z.uuid(),
    service_id: z.uuid(),
    starts_at: instant,
    context_versions: contextVersions,
  })
  .strict();
export const rescheduleInput = z
  .object({ starts_at: instant, context_versions: moveContextVersions, reason })
  .strict();
export const cancelInput = z.object({ reason }).strict();
export const appointmentSummary = z.object({
  id: z.uuid(),
  customer_id: z.uuid(),
  customer_name: z.string(),
  staff_id: z.uuid(),
  staff_name: z.string(),
  service_name: z.string(),
  price_cents: z.number().int().nonnegative(),
  currency: z.literal("ARS"),
  starts_at: z.string(),
  ends_at: z.string(),
  status: z.enum(["confirmed", "cancelled"]),
  version,
});
export const appointmentPage = z.object({
  from: z.string(),
  days: z.number(),
  timezone: z.string(),
  now: z.string(),
  data: z.array(appointmentSummary),
  page: z.object({ has_more: z.boolean(), next_cursor: z.string().nullable() }),
});
export type AppointmentPage = z.infer<typeof appointmentPage>;
export const appointmentDetail = appointmentSummary.extend({
  business_id: z.uuid(),
  phone_raw: z.string().nullable(),
  customer_version: version,
  service_id: z.uuid(),
  duration_minutes: z.number().int().min(5).max(480),
  buffer_minutes: z.number().int().min(0).max(120),
  blocked_until: z.string(),
  cancelled_at: z.string().nullable(),
  timezone: z.string(),
  now: z.string(),
  events: z.array(
    z.object({
      id: z.uuid(),
      version,
      event_type: z.enum(["created", "rescheduled", "cancelled"]),
      reason: z.string().nullable(),
      created_at: z.string(),
      actor_user_id: z.uuid().nullable(),
      actor_type: z.enum(["user", "public"]).default("user"),
    }),
  ),
});
export type AppointmentDetail = z.infer<typeof appointmentDetail>;
export const bookingPreview = z.object({
  mode: z.literal("schedule_preview"),
  can_book: z.literal(false),
  occupancy_checked: z.literal(true),
  timezone: z.string(),
  staff_version: version,
  service_version: version,
  global_version: version,
  settings_version: version,
  business_version: version,
  price_cents: z.number().int(),
  duration_minutes: z.number().int(),
  buffer_minutes: z.number().int(),
  days: z.array(z.object({ date: z.string(), warning: z.string().nullable() })),
  slots: z.array(
    z.object({
      date: z.string(),
      start: z.string(),
      end: z.string(),
      blocked_until: z.string(),
      label: z.string(),
    }),
  ),
});
export type BookingPreview = z.infer<typeof bookingPreview>;
