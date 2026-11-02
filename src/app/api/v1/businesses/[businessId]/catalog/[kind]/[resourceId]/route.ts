import { handleCatalogRequest } from "@/modules/services/http";
export async function PUT(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ businessId: string; kind: string; resourceId: string }>;
  },
) {
  return handleCatalogRequest(request, await params);
}
export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ businessId: string; kind: string; resourceId: string }>;
  },
) {
  return handleCatalogRequest(request, await params);
}
