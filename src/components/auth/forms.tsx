"use client";
import { useActionState, useState } from "react";
import Image from "next/image";
import { Button } from "@/components/ui/button";
import {
  loginAction,
  enrollAction,
  verifyAction,
  passwordAction,
  inviteAction,
  updateMemberAction,
  acceptAction,
  sendAccessInviteAction,
  verifyInviteEmailAction,
  manageInvitationAction,
  type ActionState,
} from "@/modules/auth/actions";
import type { MemberRole } from "@/modules/auth/permissions";
import { mfaQrImageSource } from "@/modules/auth/qr-code";

function Feedback({ state }: { state: ActionState }) {
  return state.message ? (
    <p className="form-feedback" role="status">
      {state.message}
    </p>
  ) : null;
}
export function LoginForm({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useActionState(loginAction, {});
  return (
    <form action={action} className="access-form">
      <label>
        Email
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
        />
      </label>
      <label>
        Contraseña
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={10}
          maxLength={128}
        />
      </label>
      <Feedback state={state} />
      <Button disabled={!enabled || pending} type="submit">
        {pending ? "Ingresando…" : "Ingresar"}
      </Button>
    </form>
  );
}
export function MfaForm({ factorId }: { factorId?: string }) {
  const [enrollment, enroll, pendingEnroll] = useActionState(enrollAction, {});
  const [state, verify, pending] = useActionState(verifyAction, {});
  const currentFactor = factorId || enrollment.factorId;
  return (
    <div className="access-form">
      {!factorId && (
        <form action={enroll}>
          <Button type="submit" disabled={pendingEnroll}>
            {pendingEnroll ? "Preparando…" : "Configurar autenticador"}
          </Button>
          <Feedback state={enrollment} />
        </form>
      )}
      {enrollment.qr && (
        <div className="mfa-setup">
          <Image
            src={mfaQrImageSource(enrollment.qr)}
            width={224}
            height={224}
            unoptimized
            alt="Código QR para configurar tu autenticador"
          />
          <p>
            Escaneá el QR con tu aplicación de autenticación. También podés
            ingresar esta clave manualmente:
          </p>
          <code>{enrollment.secret}</code>
          <p>No compartas esta clave.</p>
        </div>
      )}
      {currentFactor && (
        <form action={verify} className="access-form">
          <input type="hidden" name="factorId" value={currentFactor} />
          <label>
            Código de 6 dígitos
            <input
              name="code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              autoComplete="one-time-code"
              maxLength={6}
              minLength={6}
              required
            />
          </label>
          <Feedback state={state} />
          <Button type="submit" disabled={pending}>
            {pending ? "Verificando…" : "Verificar y continuar"}
          </Button>
        </form>
      )}
    </div>
  );
}
export function PasswordForm() {
  const [state, action, pending] = useActionState(passwordAction, {});
  return (
    <form action={action} className="access-form">
      <label>
        Nueva contraseña
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={10}
          maxLength={128}
        />
      </label>
      <p className="field-hint">Usá al menos 10 caracteres.</p>
      <Feedback state={state} />
      <Button type="submit" variant="outline" disabled={pending}>
        Actualizar contraseña
      </Button>
    </form>
  );
}
export function InviteForm({
  businessId,
  token,
  requestKey,
  isOwner,
}: {
  businessId: string;
  token: string;
  requestKey: string;
  isOwner: boolean;
}) {
  const [state, action, pending] = useActionState(inviteAction, {});
  return (
    <form action={action} className="access-form">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="token" value={token} />
      <input type="hidden" name="key" value={requestKey} />
      <label>
        Email de la persona
        <input
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="off"
        />
      </label>
      <label>
        Rol
        <select name="role" defaultValue="barber">
          <option value="barber">Barbero</option>
          {isOwner && (
            <>
              <option value="admin">Administrador</option>
              <option value="owner">Propietario</option>
            </>
          )}
        </select>
      </label>
      <Feedback state={state} />
      {state.link ? (
        <div className="invite-link">
          <p>Compartí este enlace de forma privada con la persona invitada:</p>
          <button
            type="button"
            className="text-link"
            onClick={() =>
              navigator.clipboard.writeText(
                new URL(state.link!, window.location.origin).href,
              )
            }
          >
            Copiar enlace de invitación
          </button>
          <a href={state.link}>Abrir invitación</a>
        </div>
      ) : (
        <Button type="submit" disabled={pending}>
          {pending ? "Creando…" : "Crear invitación"}
        </Button>
      )}
    </form>
  );
}
export function MemberForm({
  businessId,
  memberId,
  version,
  role,
  status,
  requestKey,
  isOwner,
}: {
  businessId: string;
  memberId: string;
  version: number;
  role: MemberRole;
  status: string;
  requestKey: string;
  isOwner: boolean;
}) {
  const [state, action, pending] = useActionState(updateMemberAction, {});
  return (
    <form action={action} className="access-form member-edit">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="key" value={requestKey} />
      <label>
        Rol
        <select name="role" defaultValue={role}>
          <option value="barber">Barbero</option>
          {isOwner && (
            <>
              <option value="admin">Administrador</option>
              <option value="owner">Propietario</option>
            </>
          )}
        </select>
      </label>
      <label>
        Estado
        <select name="status" defaultValue={status}>
          <option value="active">Activo</option>
          <option value="suspended">Suspendido</option>
        </select>
      </label>
      <Button type="submit" variant="outline" disabled={pending}>
        Guardar cambios
      </Button>
      <Feedback state={state} />
    </form>
  );
}
export function AcceptForm({ requestKey }: { requestKey: string }) {
  const [token, setToken] = useState("");
  const [state, action, pending] = useActionState(acceptAction, {});
  return (
    <form action={action} className="access-form">
      <input type="hidden" name="key" value={requestKey} />
      <label>
        Clave de invitación
        <input
          name="token"
          required
          value={token}
          onChange={(event) => setToken(event.target.value)}
          maxLength={43}
          minLength={43}
          autoComplete="off"
        />
      </label>
      <button
        type="button"
        className="text-link"
        onClick={() => {
          setToken(
            new URLSearchParams(window.location.hash.slice(1)).get("t") || "",
          );
          window.history.replaceState(null, "", "/invitaciones");
        }}
      >
        Usar invitación del enlace
      </button>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Aceptando…" : "Aceptar invitación"}
      </Button>
    </form>
  );
}
export function SendAccessInviteForm({
  businessId,
  memberId,
}: {
  businessId: string;
  memberId: string;
}) {
  const [state, action, pending] = useActionState(sendAccessInviteAction, {});
  return (
    <form action={action} className="access-form">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="memberId" value={memberId} />
      <Feedback state={state} />
      <Button type="submit" variant="outline" disabled={pending}>
        Enviar alta por email
      </Button>
      <p className="field-hint">
        Sólo para quien todavía no tiene cuenta. El email de alta y el enlace de
        este negocio son pasos separados.
      </p>
    </form>
  );
}
export function VerifyInviteEmailForm() {
  const [state, action, pending] = useActionState(verifyInviteEmailAction, {});
  return (
    <form action={action} className="access-form">
      <label>
        Email
        <input
          name="email"
          type="email"
          autoComplete="username"
          required
          maxLength={254}
        />
      </label>
      <label>
        Código del email
        <input
          name="code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          autoComplete="one-time-code"
          required
          minLength={6}
          maxLength={6}
        />
      </label>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>
        Confirmar mi email
      </Button>
    </form>
  );
}

export function InvitationLifecycleForm({
  businessId,
  memberId,
  version,
  requestKey,
  token,
}: {
  businessId: string;
  memberId: string;
  version: number;
  requestKey: string;
  token: string;
}) {
  const [state, action, pending] = useActionState(manageInvitationAction, {});
  return (
    <form action={action} className="access-form">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="memberId" value={memberId} />
      <input type="hidden" name="version" value={version} />
      <input type="hidden" name="key" value={requestKey} />
      <input type="hidden" name="token" value={token} />
      <Feedback state={state} />
      {state.link && (
        <a className="text-link" href={state.link}>
          Abrir nueva invitación
        </a>
      )}
      <Button
        type="submit"
        variant="outline"
        name="intent"
        value="renew"
        disabled={pending}
      >
        Renovar enlace de invitación
      </Button>
      <Button
        type="submit"
        variant="outline"
        name="intent"
        value="revoke"
        disabled={pending}
      >
        Revocar invitación
      </Button>
    </form>
  );
}
