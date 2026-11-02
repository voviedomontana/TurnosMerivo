import "server-only";
import { rpc, AccessError, accessMessage } from "@/modules/auth/service";
import { customerPage, customerDetail } from "./schemas";
export async function listCustomers(businessId: string) {
  return customerPage.parse(
    await rpc("list_customers_page", { p_business_id: businessId }),
  );
}
export async function readCustomer(businessId: string, id: string) {
  return customerDetail.parse(
    await rpc("read_customer", { p_business_id: businessId, p_id: id }),
  );
}
export function customerMessage(error: unknown) {
  if (error instanceof AccessError) {
    if (error.code === "PRECONDITION_FAILED")
      return "La ficha cambió. Recargá para revisar la versión actual; tu borrador se conserva.";
    if (error.code === "DUPLICATE_RESOURCE")
      return "Esta solicitud de alta ya tiene una ficha. Recargá el directorio.";
    if (error.code === "RESOURCE_STATE_CONFLICT")
      return "La operación no corresponde al estado actual de la ficha.";
    if (error.code === "VALIDATION_ERROR")
      return "Revisá el nombre y el formato de los contactos.";
    return accessMessage(error);
  }
  return "No pudimos completar la operación. Revisá los datos e intentá nuevamente.";
}
