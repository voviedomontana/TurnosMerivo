import { handleAuthRequest } from "@/modules/auth/http";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  return handleAuthRequest(request, "invite", await params);
}
