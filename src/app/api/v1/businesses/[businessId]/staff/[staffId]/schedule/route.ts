import { handleScheduleRequest } from "@/modules/availability/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ businessId: string; staffId: string }> },
) {
  return handleScheduleRequest(request, {
    ...(await params),
    kind: "schedule",
  });
}
