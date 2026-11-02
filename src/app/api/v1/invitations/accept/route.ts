import { handleAuthRequest } from "@/modules/auth/http";
export async function POST(request: Request) {
  return handleAuthRequest(request, "accept");
}
