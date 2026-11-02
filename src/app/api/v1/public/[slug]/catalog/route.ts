import { getPublicCatalogResponse } from "@/modules/businesses/public-catalog-http";
import { readPublicCatalog } from "@/modules/businesses/public-catalog-repository";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  return getPublicCatalogResponse((await params).slug, readPublicCatalog);
}
