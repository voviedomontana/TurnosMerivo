import { z } from "zod";
const clean = (v: string) => v.normalize("NFC").replace(/^ +| +$/g, "");
function text(max: number, multiline = false) {
  return z
    .string()
    .transform(clean)
    .refine(
      (v) =>
        Array.from(v).length <= max &&
        !/[\u0000-\u001f\u007f-\u009f]/u.test(
          multiline ? v.replace(/[\n\t]/g, "") : v,
        ),
      "Invalid text",
    );
}
const optionalText = (max: number, multiline = false) =>
  text(max, multiline)
    .transform((v) => v || null)
    .nullable()
    .default(null);
export function normalizePhone(raw: string | null): {
  phone_e164: string | null;
  phone_status: "missing" | "international" | "needs_review";
} {
  const value = raw === null ? null : clean(raw);
  if (!value) return { phone_e164: null, phone_status: "missing" };
  if (Array.from(value).length > 64 || !/^\+?[0-9 ().-]+$/.test(value))
    throw new Error("VALIDATION_ERROR");
  const digits = value.replace(/[ ().-]/g, "");
  if (!/^\+?[0-9]+$/.test(digits)) throw new Error("VALIDATION_ERROR");
  if (digits.startsWith("+")) {
    if (!/^\+[1-9][0-9]{7,14}$/.test(digits))
      throw new Error("VALIDATION_ERROR");
    if (
      !digits.startsWith("+54") ||
      /^\+54([0-9]{10}|9[0-9]{10})$/.test(digits)
    )
      return { phone_e164: digits, phone_status: "international" };
  }
  return { phone_e164: null, phone_status: "needs_review" };
}
const emailPattern =
  /^[A-Za-z0-9_%+-]+([.][A-Za-z0-9_%+-]+)*@[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?([.][A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;
export const customerInput = z
  .object({
    full_name: text(120).refine((v) => v.length > 0),
    phone_raw: optionalText(64).refine((v) => {
      try {
        normalizePhone(v);
        return true;
      } catch {
        return false;
      }
    }),
    email: optionalText(254).refine(
      (v) =>
        v === null || (emailPattern.test(v) && v.split("@")[0].length <= 64),
    ),
    instagram_handle: optionalText(31)
      .transform((v) => v?.replace(/^@/, "") ?? null)
      .refine((v) => v === null || /^[A-Za-z0-9_.]{1,30}$/.test(v)),
    private_notes: optionalText(2000, true),
  })
  .strict();
export type CustomerInput = z.infer<typeof customerInput>;
export const customerSummary = z
  .object({
    id: z.uuid(),
    full_name: z.string(),
    phone_raw: z.string().nullable(),
    phone_e164: z.string().nullable(),
    phone_status: z.enum(["missing", "international", "needs_review"]),
    email: z.string().nullable(),
    instagram_handle: z.string().nullable(),
    version: z.number().int().positive(),
    created_at: z.string(),
    deleted_at: z.string().nullable(),
  })
  .strict();
export const customerDetail = customerSummary
  .extend({
    private_notes: z.string().nullable(),
    source: z.enum(["admin_api", "public_booking"]),
    updated_at: z.string(),
  })
  .strict();
export type CustomerDetail = z.infer<typeof customerDetail>;
export const customerPage = z.object({
  data: z.array(customerSummary),
  page: z.object({ has_more: z.boolean(), next_cursor: z.string().nullable() }),
});
export type CustomerPage = z.infer<typeof customerPage>;
export const pageInput = z
  .object({
    state: z.enum(["current", "archived"]).default("current"),
    field: z.enum(["name", "phone", "email", "instagram"]).default("name"),
    value: z.string().max(254).nullable().default(null),
    mode: z.enum(["prefix", "exact"]).default("prefix"),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    cursor: z
      .string()
      .min(1)
      .max(1024)
      .regex(/^[A-Za-z0-9_-]+$/)
      .nullable()
      .default(null),
  })
  .strict();
