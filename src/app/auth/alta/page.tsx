import { AccessShell } from "@/components/auth/shell";
import { VerifyInviteEmailForm } from "@/components/auth/forms";
export const dynamic = "force-dynamic";
export default function AccountActivationPage() {
  return (
    <AccessShell>
      <section className="product-card access-card invitation-card">
        <p className="product-eyebrow">PRIMER INGRESO</p>
        <h1>
          Activá tu cuenta<span>.</span>
        </h1>
        <p>
          Ingresá el código de 6 dígitos del correo de alta. Después podrás
          definir tu contraseña y configurar tu autenticador.
        </p>
        <VerifyInviteEmailForm />
      </section>
    </AccessShell>
  );
}
