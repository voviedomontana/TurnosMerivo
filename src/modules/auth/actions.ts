"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { accessMessage, AccessError, rpc, sessionClient } from "./service";
import {
  acceptSchema,
  credentialsSchema,
  inviteSchema,
  updateMemberSchema,
} from "./schemas";
import { authAdminClient } from "./auth-admin";
import { getRequestId } from "@/lib/http/request-id";

export type ActionState = {
  request_id?: string;
  message?: string;
  link?: string;
  qr?: string;
  secret?: string;
  factorId?: string;
};
export async function loginAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const input = credentialsSchema.parse({
      email: form.get("email"),
      password: form.get("password"),
    });
    const client = await createServerSupabaseClient();
    if (!client) throw new AccessError("UNAVAILABLE", 503);
    const { error } = await client.auth.signInWithPassword(input);
    if (error)
      return {
        message:
          "No pudimos ingresar. Revisá tu email, contraseña y confirmación de correo.",
      };
  } catch (error) {
    return { message: accessMessage(error) };
  }
  redirect("/app");
}
export async function logoutAction(form: FormData) {
  const client = await createServerSupabaseClient();
  if (client) {
    const { error } = await client.auth.signOut({
      scope: form.get("scope") === "global" ? "global" : "local",
    });
    if (error) redirect("/seguridad?error=logout");
  }
  redirect("/login");
}
export async function enrollAction(): Promise<ActionState> {
  try {
    const client = await sessionClient();
    const { data: factors, error: listError } =
      await client.auth.mfa.listFactors();
    if (listError) throw new AccessError("UNAVAILABLE", 503);
    if (factors.totp.some((f) => f.status === "verified"))
      return { message: "Ya tenés un factor verificado. Ingresá su código." };
    for (const factor of factors.all.filter((f) => f.status === "unverified")) {
      const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
      if (error) throw new AccessError("UNAVAILABLE", 503);
    }
    const { data, error } = await client.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Merivo",
      issuer: "Merivo",
    });
    if (error) throw new AccessError("UNAVAILABLE", 503);
    return {
      qr: data.totp.qr_code,
      secret: data.totp.secret,
      factorId: data.id,
    };
  } catch (error) {
    return { message: accessMessage(error) };
  }
}
export async function verifyAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const factorId = z.uuid().parse(form.get("factorId"));
    const code = z
      .string()
      .regex(/^\d{6}$/)
      .parse(form.get("code"));
    const client = await sessionClient();
    const { error } = await client.auth.mfa.challengeAndVerify({
      factorId,
      code,
    });
    if (error)
      return {
        message: "El código no es válido o venció. Probá con el código actual.",
      };
  } catch (error) {
    return { message: accessMessage(error) };
  }
  redirect("/app");
}
export async function passwordAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const password = z.string().min(10).max(128).parse(form.get("password"));
    const client = await sessionClient();
    const { error } = await client.auth.updateUser({ password });
    if (error)
      return {
        message:
          "No pudimos actualizar la contraseña. Revisá que cumpla los requisitos.",
      };
    return { message: "Contraseña actualizada." };
  } catch (error) {
    return { message: accessMessage(error) };
  }
}
export async function inviteAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const requestId = getRequestId();
  try {
    const businessId = z.uuid().parse(form.get("businessId"));
    const key = z.uuid().parse(form.get("key"));
    const input = inviteSchema.parse({
      email: form.get("email"),
      role: form.get("role"),
      token: form.get("token"),
    });
    await rpc(
      "invite_member",
      {
        p_business_id: businessId,
        p_email: input.email,
        p_role: input.role,
        p_token: input.token,
        p_key: key,
      },
      undefined,
      undefined,
      requestId,
    );
    revalidatePath(`/app/${businessId}/miembros`);
    return {
      request_id: requestId,
      message:
        "Invitación creada. Copiá el enlace ahora: se muestra una sola vez y vence en 7 días.",
      link: `/invitaciones#t=${input.token}`,
    };
  } catch (error) {
    return { message: accessMessage(error), request_id: requestId };
  }
}
export async function updateMemberAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const requestId = getRequestId();
  try {
    const businessId = z.uuid().parse(form.get("businessId"));
    const memberId = z.uuid().parse(form.get("memberId"));
    const rawVersion = form.get("version");
    const version =
      rawVersion === null || rawVersion === ""
        ? null
        : z.coerce.number().int().positive().parse(rawVersion);
    const key = z.uuid().parse(form.get("key"));
    const input = updateMemberSchema.parse({
      role: form.get("role"),
      status: form.get("status"),
    });
    await rpc(
      "update_member",
      {
        p_business_id: businessId,
        p_member_id: memberId,
        p_role: input.role,
        p_status: input.status,
        p_key: key,
        p_expected: version,
      },
      undefined,
      undefined,
      requestId,
    );
    revalidatePath(`/app/${businessId}/miembros`);
    return { message: "Membresía actualizada.", request_id: requestId };
  } catch (error) {
    return { message: accessMessage(error), request_id: requestId };
  }
}
export async function acceptAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const requestId = getRequestId();
  try {
    const { token } = acceptSchema.parse({ token: form.get("token") });
    const key = z.uuid().parse(form.get("key"));
    await rpc(
      "accept_invitation",
      { p_token: token, p_key: key },
      undefined,
      undefined,
      requestId,
    );
  } catch (error) {
    return { message: accessMessage(error), request_id: requestId };
  }
  redirect("/app");
}

export async function sendAccessInviteAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const requestId = getRequestId();
  try {
    const businessId = z.uuid().parse(form.get("businessId"));
    const memberId = z.uuid().parse(form.get("memberId"));
    const member = z.object({ email: z.email().max(254) }).parse(
      await rpc(
        "prepare_member_auth_invite",
        {
          p_business_id: businessId,
          p_member_id: memberId,
        },
        undefined,
        undefined,
        requestId,
      ),
    );
    const { error } = await authAdminClient().inviteUserByEmail(member.email);
    if (error)
      return {
        request_id: requestId,
        message:
          "Si la persona ya tiene cuenta, debe usar su acceso habitual. Si no recibió el correo de alta, revisá el servicio de email antes de reintentar.",
      };
    return {
      request_id: requestId,
      message:
        "Email de alta enviado. La persona debe confirmar el código en /auth/alta, definir su contraseña y abrir su enlace de invitación al negocio.",
    };
  } catch (error) {
    return { message: accessMessage(error), request_id: requestId };
  }
}
export async function verifyInviteEmailAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const email = z.email().max(254).parse(form.get("email"));
    const token = z
      .string()
      .regex(/^\d{6}$/)
      .parse(form.get("code"));
    const client = await createServerSupabaseClient();
    if (!client) throw new AccessError("UNAVAILABLE", 503);
    const { error } = await client.auth.verifyOtp({
      email,
      token,
      type: "invite",
    });
    if (error)
      return {
        message:
          "El código no es válido o venció. Solicitá un nuevo correo de alta.",
      };
  } catch (error) {
    return { message: accessMessage(error) };
  }
  redirect("/seguridad");
}

export async function manageInvitationAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  const requestId = getRequestId();
  try {
    const businessId = z.uuid().parse(form.get("businessId"));
    const memberId = z.uuid().parse(form.get("memberId"));
    const rawVersion = form.get("version");
    const expected =
      rawVersion === null || rawVersion === ""
        ? null
        : z.coerce.number().int().positive().parse(rawVersion);
    const key = z.uuid().parse(form.get("key"));
    const intent = z.enum(["renew", "revoke"]).parse(form.get("intent"));
    const token =
      intent === "renew"
        ? acceptSchema.parse({ token: form.get("token") }).token
        : null;
    await rpc(
      "manage_invitation",
      {
        p_business_id: businessId,
        p_member_id: memberId,
        p_token: token,
        p_key: key,
        p_expected: expected,
      },
      undefined,
      undefined,
      requestId,
    );
    revalidatePath(`/app/${businessId}/miembros`);
    return token
      ? {
          request_id: requestId,
          message:
            "Invitación renovada por 7 días. El enlace anterior ya no sirve.",
          link: `/invitaciones#t=${token}`,
        }
      : { message: "Invitación revocada.", request_id: requestId };
  } catch (error) {
    return { message: accessMessage(error), request_id: requestId };
  }
}
