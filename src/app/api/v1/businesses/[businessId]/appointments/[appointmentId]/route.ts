import { handleAppointmentRequest } from "@/modules/appointments/http";
type Context = {
  params: Promise<{ businessId: string; appointmentId: string }>;
};
export async function GET(request: Request, { params }: Context) {
  return handleAppointmentRequest(request, await params);
}
