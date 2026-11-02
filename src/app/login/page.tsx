import { AccessShell } from "@/components/auth/shell";
import { LoginForm } from "@/components/auth/forms";
import { getSupabaseConfig } from "@/lib/supabase/config";
export const dynamic = "force-dynamic";
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const enabled = !!getSupabaseConfig();
  const query = await searchParams;
  return (
    <AccessShell>
      <div className="access-grid">
        <section className="access-intro">
          <p className="product-eyebrow">TU ESPACIO MERIVO</p>
          <h1>
            El próximo paso
            <br />
            <span>es tuyo.</span>
          </h1>
          <p>
            Ingresá para acceder a tus negocios y administrar los permisos de tu
            equipo.
          </p>
          <div className="access-note">
            Acceso exclusivo para miembros invitados.
            <br />
            Cada negocio conserva su información y sus permisos.
          </div>
        </section>
        <section className="product-card access-card">
          <p className="product-eyebrow">BIENVENIDO DE NUEVO</p>
          <h2>Ingresá a tu cuenta</h2>
          <p>Usá el email con el que te invitaron.</p>
          {(!enabled || query.unavailable) && (
            <p className="form-feedback" role="status">
              El acceso todavía no está disponible. La página de inicio sigue
              funcionando; revisá la configuración de Supabase local.
            </p>
          )}
          <LoginForm enabled={enabled} />
          <p className="field-hint">
            Si es tu primer ingreso, abrí el email de alta que recibiste. No hay
            registro público.
          </p>
        </section>
      </div>
    </AccessShell>
  );
}
