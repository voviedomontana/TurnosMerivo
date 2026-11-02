import { getPublicBusinessResponse } from "@/modules/businesses/http";
import { readPublicBusiness } from "@/modules/businesses/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return getPublicBusinessResponse(slug, readPublicBusiness);
}
