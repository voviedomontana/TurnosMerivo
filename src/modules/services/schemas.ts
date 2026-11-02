import { z } from "zod";
const name = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .transform((value) => value.normalize("NFC"));
export const serviceInput = z
  .object({
    name,
    description: z.string().trim().max(1000).nullable().default(null),
    category: z.string().trim().max(100).nullable().default(null),
    price_cents: z.number().int().min(0).max(2147483647),
    duration_minutes: z.number().int().min(5).max(480),
    buffer_minutes: z.number().int().min(0).max(120).default(0),
    active: z.boolean().default(true),
    sort_order: z.number().int().min(0).max(10000).default(0),
  })
  .strict();
export const serviceRecord = serviceInput.extend({
  id: z.uuid(),
  business_id: z.uuid(),
  currency: z.literal("ARS"),
  version: z.number().int().positive(),
  deleted_at: z.string().nullable(),
});
export type ServiceRecord = z.infer<typeof serviceRecord>;

export function moneyToCents(value: FormDataEntryValue | null): number {
  if (
    typeof value !== "string" ||
    !/^\d{1,8}([.,]\d{1,2})?$/.test(value.trim())
  )
    throw new Error("PRICE_FORMAT");
  const [whole, fraction = ""] = value.trim().split(/[.,]/);
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (cents > 2147483647) throw new Error("PRICE_FORMAT");
  return cents;
}
