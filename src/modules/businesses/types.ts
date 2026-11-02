import type { z } from "zod";
import type { publicBusinessSchema } from "./schemas";

export type PublicBusiness = z.infer<typeof publicBusinessSchema>;

export type PublicTenantContext = Readonly<{
  businessId: string;
  slug: string;
  actor: "public";
}>;

export type PublicBusinessReader = (
  slug: string,
) => Promise<PublicBusiness | null>;
