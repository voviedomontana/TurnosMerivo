import "server-only";
import { getAppServerDatabase } from "@/lib/database/server";
import { publicBusinessSchema } from "./schemas";
import type { PublicBusinessReader } from "./types";

export const readPublicBusiness: PublicBusinessReader = async (slug) => {
  const sql = getAppServerDatabase();
  if (!sql) throw new Error("Database is not configured");
  const rows = await sql<{ business: unknown }[]>`
    select app_internal.get_public_business(${slug}) as business
  `;
  const business = rows[0]?.business;
  return business == null ? null : publicBusinessSchema.parse(business);
};
