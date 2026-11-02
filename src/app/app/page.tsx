import Link from "next/link";
import { ArrowUpRight, Store, ShieldCheck } from "lucide-react";
import { requirePageSession } from "@/modules/auth/page-session";
const roles = {
  owner: "Propietario",
  admin: "Administrador",
  barber: "Barbero",
};
export default async function BusinessesPage() {
  const { me, aal } = await requirePageSession();
  const needsMfa =
    aal !== "aal2" &&
    (me.platform_admin || me.memberships.some((m) => m.role !== "barber"));
  return (
    <>
      <section className="product-title">
        <p className="product-eyebrow">TU ESPACIO DE TRABAJO</p>
        <h1>
          Mis negocios<span>.</span>
        </h1>
        <p>
          Elegí dónde querés trabajar. Tus permisos se verifican en cada
          negocio.
        </p>
      </section>
      {needsMfa && (
        <aside className="security-banner">
          <ShieldCheck aria-hidden />
          <div>
            <strong>Protegé tu cuenta</strong>
            <p>
              Para ingresar como propietario o administrador, configurá o
              verificá tu segundo factor.
            </p>
          </div>
          <Link href="/seguridad">Configurar seguridad →</Link>
        </aside>
      )}
      {me.memberships.length ? (
        <div className="business-grid">
          {me.memberships.map((member) => (
            <Link
              className="product-card business-tile"
              key={member.id}
              href={`/app/${member.business_id}`}
            >
              <Store aria-hidden />
              <span className="role-badge">{roles[member.role]}</span>
              <h2>{member.name}</h2>
              <p>/{member.slug}</p>
              <span className="tile-action">
                Ingresar al negocio <ArrowUpRight aria-hidden />
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <section className="product-card empty-state">
          <Store aria-hidden />
          <h2>Todavía no tenés negocios asignados</h2>
          <p>
            Pedile una invitación al propietario. Si ya la recibiste, abrí el
            enlace para aceptarla con esta cuenta.
          </p>
          <Link href="/invitaciones">Aceptar una invitación →</Link>
        </section>
      )}
      <p className="session-caption">Sesión iniciada como {me.email}</p>
    </>
  );
}
