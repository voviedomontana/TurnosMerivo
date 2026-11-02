import { handleCustomerRequest } from "@/modules/customers/http";
type Context = { params: Promise<{ businessId: string }> };
export async function GET(request: Request, { params }: Context) {
  return handleCustomerRequest(request, await params);
}
export async function POST(request: Request, { params }: Context) {
  return handleCustomerRequest(request, await params);
}
