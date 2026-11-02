import { isBusinessSlug } from "./schemas";
import type { PublicBusinessReader, PublicTenantContext } from "./types";

export async function resolvePublicBusiness(
  slug: string,
  read: PublicBusinessReader,
) {
  if (!isBusinessSlug(slug)) return null;
  const business = await read(slug);
  if (!business) return null;
  const tenant: PublicTenantContext = Object.freeze({
    businessId: business.id,
    slug: business.slug,
    actor: "public",
  });
  return { business, tenant };
}
