import { handleCustomerRequest } from "@/modules/customers/http";
export async function POST(
  request: Request,
  {
    params,
  }: {
    params: Promise<{ businessId: string; resourceId: string; action: string }>;
  },
) {
  return handleCustomerRequest(request, await params);
}
