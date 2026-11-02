import "server-only";
import { rpc, AccessError, accessMessage } from "@/modules/auth/service";
import { appointmentPage, appointmentDetail } from "./schemas";
export const readAppointment = async (businessId: string, id: string) =>
  appointmentDetail.parse(
    await rpc("read_appointment", { p_business_id: businessId, p_id: id }),
  );
export const listInitialAppointments = async (businessId: string) =>
  appointmentPage.parse(
    await rpc("list_appointments_page", { p_business_id: businessId }),
  );
export function appointmentMessage(error: unknown) {
  if (error instanceof AccessError) {
    const messages: Record<string, string> = {
      SLOT_TAKEN:
        "Ese horario acaba de ocuparse. Consultá los horarios nuevamente.",
      TIME_NOT_ALLOWED:
        "El horario ya no cumple la jornada, los bloqueos o la anticipación vigente.",
      PRECONDITION_FAILED:
        "El turno, la ficha o la configuración cambiaron. Revisá los datos y consultá horarios nuevamente; tu borrador se conserva.",
      PRECONDITION_REQUIRED:
        "Consultá los datos vigentes antes de confirmar el turno.",
      APPOINTMENT_STATE_CONFLICT:
        "Sólo se puede modificar un turno confirmado que todavía no comenzó.",
      RESOURCE_STATE_CONFLICT:
        "El cliente, profesional o servicio no está disponible para esta operación.",
      SERVICE_NOT_AVAILABLE:
        "El servicio ya no está habilitado para ese profesional.",
      DUPLICATE_RESOURCE:
        "Esta solicitud ya tiene un turno. Recargá la agenda.",
      VALIDATION_ERROR: "Revisá el cliente, el servicio y el horario elegido.",
    };
    return messages[error.code] ?? accessMessage(error);
  }
  return "No pudimos completar la operación.";
}
