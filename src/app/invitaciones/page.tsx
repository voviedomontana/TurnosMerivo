import { randomUUID } from "node:crypto";
import Link from "next/link";
import { AccessShell } from "@/components/auth/shell";
import { AcceptForm } from "@/components/auth/forms";
import { requirePageSession } from "@/modules/auth/page-session";
export const dynamic = "force-dynamic";
export default async function InvitationPage() {
  const { me } = await requirePageSession();
  return (
    <AccessShell signedIn>
      <section className="product-card access-card invitation-card">
        <p className="product-eyebrow">BIENVENIDO AL EQUIPO</p>
        <h1>
          Aceptá tu invitación<span>.</span>
        </h1>
        <p>
          Ingresaste como {me.email}. El email debe coincidir con la invitación.
        </p>
        <p>
          Si el rol requiere MFA,{" "}
          <Link href="/seguridad">configurá tu autenticador</Link> antes de
          aceptar y volvé a abrir el enlace.
        </p>
        <AcceptForm requestKey={randomUUID()} />
      </section>
    </AccessShell>
  );
}
