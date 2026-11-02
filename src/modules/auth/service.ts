import "server-only";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  meSchema,
  memberSchema,
  memberPageInputSchema,
  memberPageSchema,
} from "./schemas";

export class AccessError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly conflicts?: {
      appointments: {
        id: string;
        staff_id: string;
        starts_at: string;
        ends_at: string;
      }[];
      has_more: boolean;
    },
  ) {
    super(code);
  }
}
export async function sessionClient(bearer?: string, requestId?: string) {
  const client = await createServerSupabaseClient(bearer, requestId);
  if (!client) throw new AccessError("UNAVAILABLE", 503);
  const { data, error } = await client.auth.getUser(bearer);
  if (error || !data.user?.email_confirmed_at)
    throw new AccessError("UNAUTHENTICATED", 401);
  return client;
}
export async function rpc(
  name: string,
  args: Record<string, unknown> = {},
  bearer?: string,
  verifiedClient?: Awaited<ReturnType<typeof sessionClient>>,
  requestId?: string,
) {
  const client = verifiedClient ?? (await sessionClient(bearer, requestId));
  const { data, error } = await client.schema("api").rpc(name, args);
  if (error) {
    const status = /^PT(400|401|403|404|409|412|428)$/.exec(error.code)?.[1];
    if (status) {
      // Only this named domain error has an allowlisted, non-PII data projection.
      if (error.code === "PT409" && error.message === "APPOINTMENTS_AFFECTED") {
        let conflicts: AccessError["conflicts"];
        try {
          conflicts = z
            .object({
              appointments: z
                .array(
                  z
                    .object({
                      id: z.uuid(),
                      staff_id: z.uuid(),
                      starts_at: z.iso.datetime({ offset: true }),
                      ends_at: z.iso.datetime({ offset: true }),
                    })
                    .strict(),
                )
                .max(20),
              has_more: z.boolean(),
            })
            .strict()
            .parse(JSON.parse(error.details ?? ""));
        } catch {
          /* Never expose unvalidated PostgreSQL details. */
        }
        throw new AccessError(error.message, 409, conflicts);
      }
      throw new AccessError(error.message, Number(status));
    }
    if (error.code === "23514") throw new AccessError("INTERNAL_ERROR", 500);
    if (error.code === "23505")
      throw new AccessError("DUPLICATE_RESOURCE", 409);
    throw new AccessError("UNAVAILABLE", 503);
  }
  return data as unknown;
}
export async function getMe(bearer?: string, requestId?: string) {
  return meSchema.parse(await rpc("me", {}, bearer, undefined, requestId));
}
export async function listMembers(
  businessId: string,
  bearer?: string,
  requestId?: string,
) {
  return z
    .array(memberSchema)
    .parse(
      await rpc(
        "list_members",
        { p_business_id: businessId },
        bearer,
        undefined,
        requestId,
      ),
    );
}
export async function listMembersPage(
  businessId: string,
  options: { limit?: unknown; cursor?: unknown } = {},
  bearer?: string,
  requestId?: string,
) {
  const client = await sessionClient(bearer, requestId);
  const parsed = memberPageInputSchema.safeParse(options);
  if (!parsed.success) throw new AccessError("VALIDATION_ERROR", 400);
  return memberPageSchema.parse(
    await rpc(
      "list_members_page",
      {
        p_business_id: businessId,
        p_limit: parsed.data.limit,
        p_cursor: parsed.data.cursor ?? null,
      },
      bearer,
      client,
      requestId,
    ),
  );
}
export async function getAal() {
  const client = await sessionClient();
  const { data, error } =
    await client.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw new AccessError("UNAVAILABLE", 503);
  return data?.currentLevel === "aal2" ? ("aal2" as const) : ("aal1" as const);
}
export const accessMessages: Record<string, string> = {
  INTERNAL_ERROR: "No pudimos completar la operación.",
  UNAVAILABLE:
    "El acceso no está disponible. Revisá la conexión local e intentá nuevamente.",
  UNAUTHENTICATED: "Ingresá con tu cuenta para continuar.",
  MFA_REQUIRED: "Verificá tu segundo factor para continuar.",
  FORBIDDEN: "Tu cuenta no tiene permiso para esta operación.",
  NOT_FOUND: "El recurso o la invitación no está disponible.",
  LAST_OWNER: "No se puede quitar al último propietario activo.",
  DUPLICATE_RESOURCE:
    "Esta persona ya tiene una membresía o invitación en el negocio.",
  PRECONDITION_FAILED:
    "La membresía cambió. Actualizá la página antes de volver a editar.",
  PRECONDITION_REQUIRED: "Actualizá la página para obtener la versión vigente.",
  IDEMPOTENCY_KEY_REUSED:
    "La solicitud ya se usó con otros datos. Actualizá la página.",
};
export function accessMessage(error: unknown) {
  return error instanceof AccessError
    ? (accessMessages[error.code] ?? "No pudimos completar la operación.")
    : "Revisá los datos e intentá nuevamente.";
}
