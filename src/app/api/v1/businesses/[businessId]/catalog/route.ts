import { handleCatalogRequest } from "@/modules/services/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  return handleCatalogRequest(request, await params);
}
