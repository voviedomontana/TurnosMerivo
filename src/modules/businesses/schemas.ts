import { z } from "zod";

export const reservedBusinessSlugs = ["api", "app", "admin", "b"] as const;

export function isBusinessSlug(value: string): boolean {
  return (
    /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(value) &&
    !reservedBusinessSlugs.some((slug) => slug === value)
  );
}

export const publicBusinessSchema = z
  .object({
    id: z.uuid(),
    slug: z.string().refine(isBusinessSlug),
    name: z.string().min(1),
    timezone: z.string(),
    phone: z.string().nullable(),
    address_line: z.string().nullable(),
    city: z.string().nullable(),
    region: z.string().nullable(),
    country: z.string(),
    logo_path: z.string().nullable(),
    locale: z.string(),
    currency: z.string(),
  })
  .strict();
