import { z } from "zod";
export const assignmentInput = z
  .object({
    service_id: z.uuid(),
    price_override_cents: z
      .number()
      .int()
      .min(0)
      .max(2147483647)
      .nullable()
      .default(null),
    duration_override_minutes: z
      .number()
      .int()
      .min(5)
      .max(480)
      .nullable()
      .default(null),
  })
  .strict();
export const staffInput = z
  .object({
    display_name: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .transform((v) => v.normalize("NFC")),
    bio: z.string().trim().max(1000).nullable().default(null),
    member_id: z.uuid().nullable().default(null),
    active: z.boolean().default(true),
    accepts_online: z.boolean().default(true),
    sort_order: z.number().int().min(0).max(10000).default(0),
    assignments: z.array(assignmentInput).max(500).default([]),
  })
  .strict()
  .refine(
    (v) =>
      new Set(v.assignments.map((a) => a.service_id)).size ===
      v.assignments.length,
    { message: "Duplicate services", path: ["assignments"] },
  );
export const staffRecord = z.object({
  id: z.uuid(),
  business_id: z.uuid(),
  member_id: z.uuid().nullable(),
  display_name: z.string(),
  bio: z.string().nullable(),
  active: z.boolean(),
  accepts_online: z.boolean(),
  sort_order: z.number().int(),
  version: z.number().int().positive(),
  deleted_at: z.string().nullable(),
});
export type StaffRecord = z.infer<typeof staffRecord>;
