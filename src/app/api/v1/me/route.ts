import { handleAuthRequest } from "@/modules/auth/http";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return handleAuthRequest(request, "me");
}
