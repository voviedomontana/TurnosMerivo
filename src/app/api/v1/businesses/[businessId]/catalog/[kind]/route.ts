import { handleCatalogRequest } from "@/modules/services/http";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ businessId: string; kind: string }> },
) {
  return handleCatalogRequest(request, await params);
}
