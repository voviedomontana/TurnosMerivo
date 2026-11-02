import { handleCustomerRequest } from "@/modules/customers/http";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ businessId: string }> },
) {
  return handleCustomerRequest(request, {
    ...(await params),
    action: "search",
  });
}
