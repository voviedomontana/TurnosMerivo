import { handleAuthRequest } from "@/modules/auth/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  return handleAuthRequest(request, "list", await params);
}
