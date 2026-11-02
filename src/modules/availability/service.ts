import "server-only";
import { z } from "zod";
import { rpc, AccessError, accessMessage } from "@/modules/auth/service";
import { staffOption, scheduleSchema } from "./schemas";
export const listScheduleStaff = async (businessId: string) =>
  z
    .array(staffOption)
    .parse(await rpc("list_schedule_staff", { p_business_id: businessId }));
export const readSchedule = async (businessId: string, staffId: string) =>
  scheduleSchema.parse(
    await rpc("read_schedule", {
      p_business_id: businessId,
      p_staff_id: staffId,
    }),
  );
export function scheduleMessage(error: unknown) {
  if (error instanceof AccessError) {
    if (error.code === "APPOINTMENTS_AFFECTED")
      return "El cambio dejaría turnos futuros fuera del horario. No se guardó la configuración; revisá los turnos afectados.";
    if (error.code === "PRECONDITION_FAILED")
      return "La configuración cambió. Recargá para revisar los cambios; tu borrador se conserva.";
    if (error.code === "RESOURCE_STATE_CONFLICT")
      return "Ya hay una excepción para esa fecha o el registro está retirado.";
    if (error.code === "VALIDATION_ERROR")
      return "Revisá fechas, intervalos y vigencias. No se permiten solapes ni cambios pasados.";
    if (error.code === "DUPLICATE_RESOURCE")
      return "La solicitud ya existe. Recargá la configuración.";
    return accessMessage(error);
  }
  return "No pudimos completar la operación.";
}
