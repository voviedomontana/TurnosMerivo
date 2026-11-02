import "server-only";
import { getAppServerDatabase } from "@/lib/database/server";
import {
  publicCatalogSchema,
  type PublicCatalogReader,
} from "./public-catalog";
export const readPublicCatalog: PublicCatalogReader = async (slug) => {
  const sql = getAppServerDatabase();
  if (!sql) throw Error("Database is not configured");
  const rows = await sql<
    { catalog: unknown }[]
  >`select app_internal.get_public_catalog(${slug}) as catalog`;
  const value = rows[0]?.catalog;
  return value == null ? null : publicCatalogSchema.parse(value);
};
