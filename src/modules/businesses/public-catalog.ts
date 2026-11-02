import { z } from "zod";
import { publicBusinessSchema, isBusinessSlug } from "./schemas";
export const publicCatalogSchema = z
  .object({
    business: publicBusinessSchema,
    professionals: z.array(
      z
        .object({
          id: z.uuid(),
          display_name: z.string(),
          bio: z.string().nullable(),
          services: z.array(
            z
              .object({
                id: z.uuid(),
                name: z.string(),
                description: z.string().nullable(),
                category: z.string().nullable(),
                price_cents: z.number().int().nonnegative(),
                currency: z.literal("ARS"),
                duration_minutes: z.number().int().min(5).max(480),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
  })
  .strict();
export type PublicCatalog = z.infer<typeof publicCatalogSchema>;
export type PublicCatalogReader = (
  slug: string,
) => Promise<PublicCatalog | null>;
export async function resolvePublicCatalog(
  slug: string,
  read: PublicCatalogReader,
) {
  if (!isBusinessSlug(slug)) return null;
  const value = await read(slug);
  return value === null ? null : publicCatalogSchema.parse(value);
}
