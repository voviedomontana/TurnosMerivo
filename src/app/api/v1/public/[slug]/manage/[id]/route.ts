import { handlePublicBooking } from "@/modules/public-booking/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  return handlePublicBooking(request, { ...(await params), kind: "manage" });
}
