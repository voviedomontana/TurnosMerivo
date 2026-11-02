import { handleAuthRequest } from "@/modules/auth/http";
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ businessId: string; memberId: string }> },
) {
  return handleAuthRequest(request, "update", await params);
}
