import "server-only";
import { z } from "zod";
import { rpc, AccessError, accessMessage } from "@/modules/auth/service";
import { staffRecord, assignmentInput } from "@/modules/staff/schemas";
import { serviceRecord } from "./schemas";
export const catalogSchema = z.object({
  staff: z.array(staffRecord),
  services: z.array(serviceRecord),
  assignments: z.array(assignmentInput.extend({ staff_member_id: z.uuid() })),
});
export type Catalog = z.infer<typeof catalogSchema>;
export async function readCatalog(
  businessId: string,
  includeArchived = false,
  bearer?: string,
  trace?: string,
) {
  return catalogSchema.parse(
    await rpc(
      "list_catalog",
      { p_business_id: businessId, p_include_archived: includeArchived },
      bearer,
      undefined,
      trace,
    ),
  );
}
export function catalogMessage(error: unknown): string {
  if (error instanceof AccessError) {
    if (error.code === "DUPLICATE_RESOURCE")
      return "Ya existe un registro con ese nombre o una cuenta vinculada a otro profesional.";
    if (error.code === "PRECONDITION_FAILED")
      return "El registro cambió. Recargá la página antes de volver a editar.";
    if (error.code === "PRECONDITION_REQUIRED")
      return "Recargá la página para obtener la versión vigente.";
    if (error.code === "RESOURCE_STATE_CONFLICT")
      return "La operación no corresponde al estado actual del registro o de sus servicios.";
    if (error.code === "VALIDATION_ERROR")
      return "Revisá los datos, los precios y las duraciones ingresadas.";
    return accessMessage(error);
  }
  return "Revisá los datos. Usá precios con hasta dos decimales y duraciones válidas.";
}
