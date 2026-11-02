import Link from "next/link";
import { AccessShell } from "@/components/auth/shell";
import { MfaForm, PasswordForm } from "@/components/auth/forms";
import { requirePageSession } from "@/modules/auth/page-session";
import { sessionClient } from "@/modules/auth/service";
import { logoutAction } from "@/modules/auth/actions";
import { Button } from "@/components/ui/button";
export const dynamic = "force-dynamic";
export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { me, aal } = await requirePageSession();
  const client = await sessionClient();
  const { data, error } = await client.auth.mfa.listFactors();
  const factor = data?.totp.find((f) => f.status === "verified");
  const query = await searchParams;
  return (
    <AccessShell signedIn>
      <Link className="back-link" href="/app">
        ← Mis negocios
      </Link>
      <section className="product-title">
        <p className="product-eyebrow">CUIDÁ TU ACCESO</p>
        <h1>
          Seguridad<span>.</span>
        </h1>
        <p>{me.email}</p>
      </section>
      <div className="business-grid">
        <section className="product-card security-card">
          <h2>Autenticación en dos pasos</h2>
          <p>
            Obligatoria para propietarios y administradores. Usá una aplicación
            de autenticación para generar tus códigos.
          </p>
          {aal === "aal2" ? (
            <p className="form-feedback">
              Segundo factor verificado para esta sesión.
            </p>
          ) : error ? (
            <p role="status">
              No pudimos consultar tus factores. Intentá nuevamente.
            </p>
          ) : (
            <MfaForm factorId={factor?.id} />
          )}
        </section>
        <section className="product-card security-card">
          <h2>Contraseña y sesiones</h2>
          <PasswordForm />
          {query.error && (
            <p role="status">
              No pudimos cerrar la sesión. Intentá nuevamente.
            </p>
          )}
          <form action={logoutAction} className="session-actions">
            <input type="hidden" name="scope" value="global" />
            <Button type="submit" variant="outline">
              Cerrar sesión en todos los dispositivos
            </Button>
          </form>
          <p className="field-hint">
            Los tokens de acceso ya emitidos pueden seguir vigentes hasta su
            vencimiento, como máximo una hora.
          </p>
        </section>
      </div>
    </AccessShell>
  );
}
