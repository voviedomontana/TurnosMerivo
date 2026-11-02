import { z } from "zod";
import { customerInput } from "@/modules/customers/schemas";
export const secret = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const createInput = z
  .object({
    id: z.uuidv4(),
    attempt_id: z.uuidv4(),
    staff_id: z.uuid(),
    service_id: z.uuid(),
    starts_at: z.iso.datetime({ offset: true }),
    quote_id: z.uuid(),
    customer: customerInput
      .omit({ private_notes: true })
      .refine((v) => v.phone_raw !== null),
    privacy_policy_version: z.string().min(1).max(120),
  })
  .strict();
export const changeInput = z
  .object({
    starts_at: z.iso.datetime({ offset: true }).optional(),
    quote_id: z.uuid().optional(),
    reason: z.string().max(500).nullable().optional(),
  })
  .strict();
export const availabilitySchema = z
  .object({
    quote_id: z.uuid(),
    timezone: z.string(),
    price_cents: z.number().int().nonnegative(),
    duration_minutes: z.number().int().positive(),
    slots: z.array(
      z
        .object({
          date: z.iso.date(),
          start: z.iso.datetime({ offset: true }),
          end: z.iso.datetime({ offset: true }),
          label: z.string(),
        })
        .strict(),
    ),
  })
  .strict();
export type PublicAvailability = z.infer<typeof availabilitySchema>;
export const managementSchema = z
  .object({
    id: z.uuid(),
    business_id: z.uuid(),
    business_name: z.string(),
    service_name: z.string(),
    staff_name: z.string(),
    price_cents: z.number().int(),
    duration_minutes: z.number().int(),
    starts_at: z.iso.datetime({ offset: true }),
    ends_at: z.iso.datetime({ offset: true }),
    status: z.enum(["confirmed", "cancelled"]),
    version: z.number().int().positive(),
    timezone: z.string(),
    now: z.iso.datetime({ offset: true }),
    generation: z.number().int().positive(),
    token_expires_at: z.iso.datetime({ offset: true }),
    can_cancel: z.boolean(),
    can_reschedule: z.boolean(),
  })
  .strict();
export type PublicManagement = z.infer<typeof managementSchema>;
