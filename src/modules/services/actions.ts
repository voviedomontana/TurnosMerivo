"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getRequestId } from "@/lib/http/request-id";
import { rpc } from "@/modules/auth/service";
import { staffInput } from "@/modules/staff/schemas";
import { moneyToCents, serviceInput } from "./schemas";
import { catalogMessage } from "./catalog";
export type CatalogActionState = {
  message?: string;
  request_id?: string;
  success?: boolean;
};
function base(form: FormData) {
  return {
    businessId: z.uuid().parse(form.get("businessId")),
    id: z.uuid().parse(form.get("id")),
    key: z.uuid().parse(form.get("key")),
    action: z
      .enum(["create", "update", "archive", "restore"])
      .parse(form.get("action")),
    expected: form.get("version")
      ? z.coerce.number().int().positive().parse(form.get("version"))
      : null,
  };
}
async function write(
  form: FormData,
  kind: "staff" | "service",
  data: unknown,
  trace: string,
) {
  const value = base(form);
  await rpc(
    "write_catalog",
    {
      p_business_id: value.businessId,
      p_kind: kind,
      p_id: value.id,
      p_action: value.action,
      p_data: data,
      p_key: value.key,
      p_expected: value.expected,
    },
    undefined,
    undefined,
    trace,
  );
  revalidatePath(`/app/${value.businessId}/profesionales`);
  revalidatePath(`/app/${value.businessId}/servicios`);
}
export async function saveServiceAction(
  _: CatalogActionState,
  form: FormData,
): Promise<CatalogActionState> {
  const trace = getRequestId();
  try {
    const data = serviceInput.parse({
      name: form.get("name"),
      description: form.get("description") || null,
      category: form.get("category") || null,
      price_cents: moneyToCents(form.get("price")),
      duration_minutes: Number(form.get("duration_minutes")),
      buffer_minutes: Number(form.get("buffer_minutes")),
      active: form.get("active") === "on",
      sort_order: Number(form.get("sort_order")),
    });
    await write(form, "service", data, trace);
    return { message: "Servicio guardado.", success: true, request_id: trace };
  } catch (error) {
    return { message: catalogMessage(error), request_id: trace };
  }
}
export async function saveStaffAction(
  _: CatalogActionState,
  form: FormData,
): Promise<CatalogActionState> {
  const trace = getRequestId();
  try {
    const assignments = form.getAll("service_ids").map((raw) => {
      const id = z.uuid().parse(raw),
        price = form.get(`price_${id}`),
        duration = form.get(`duration_${id}`);
      return {
        service_id: id,
        price_override_cents: price ? moneyToCents(price) : null,
        duration_override_minutes: duration ? Number(duration) : null,
      };
    });
    const data = staffInput.parse({
      display_name: form.get("display_name"),
      bio: form.get("bio") || null,
      member_id: form.get("member_id") || null,
      active: form.get("active") === "on",
      accepts_online: form.get("accepts_online") === "on",
      sort_order: Number(form.get("sort_order")),
      assignments,
    });
    await write(form, "staff", data, trace);
    return {
      message: "Profesional guardado.",
      success: true,
      request_id: trace,
    };
  } catch (error) {
    return { message: catalogMessage(error), request_id: trace };
  }
}
export async function catalogStateAction(
  _: CatalogActionState,
  form: FormData,
): Promise<CatalogActionState> {
  const trace = getRequestId();
  try {
    const action = z.enum(["archive", "restore"]).parse(form.get("action"));
    await write(
      form,
      z.enum(["staff", "service"]).parse(form.get("kind")),
      {},
      trace,
    );
    return {
      message:
        action === "archive"
          ? "Registro archivado. Su historial se conserva."
          : "Registro restaurado.",
      success: true,
      request_id: trace,
    };
  } catch (error) {
    return { message: catalogMessage(error), request_id: trace };
  }
}
