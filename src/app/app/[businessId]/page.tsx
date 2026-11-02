import Link from "next/link";
import { Users, ShieldCheck, Scissors, ClipboardList } from "lucide-react";
import { requireBusinessPage } from "@/modules/auth/page-session";
import { can } from "@/modules/auth/permissions";
export default async function BusinessPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const { me, member, aal } = await requireBusinessPage(businessId);
  const manage = can(
    { userId: me.id, businessId, role: member.role, aal, active: true },
    "members:read",
    { businessId },
  );
  return (
    <>
      <Link className="back-link" href="/app">
        ← Cambiar de negocio
      </Link>
      <section className="product-title">
        <p className="product-eyebrow">TU NEGOCIO</p>
        <h1>
          {member.name}
          <span>.</span>
        </h1>
        <p>
          Administrá tu equipo, los profesionales y los servicios de tu negocio.
        </p>
      </section>
      <div className="business-grid">
        {manage && (
          <Link
            href={`/app/${businessId}/agenda`}
            className="product-card business-tile"
          >
            <ClipboardList aria-hidden />
            <h2>Agenda</h2>
            <p>Confirmá, reprogramá y cancelá los turnos de tu negocio.</p>
            <span className="tile-action">Ver agenda →</span>
          </Link>
        )}
        <Link
          href={`/app/${businessId}/horarios`}
          className="product-card business-tile"
        >
          <ClipboardList aria-hidden />
          <h2>Horarios</h2>
          <p>Jornadas y vista previa informativa de horarios posibles.</p>
          <span className="tile-action">Ver horarios →</span>
        </Link>
        {manage && (
          <Link
            href={`/app/${businessId}/clientes`}
            className="product-card business-tile"
          >
            <Users aria-hidden />
            <h2>Clientes</h2>
            <p>Fichas privadas, contactos y notas de tu negocio.</p>
            <span className="tile-action">Ver clientes →</span>
          </Link>
        )}
        <Link
          href={`/app/${businessId}/profesionales`}
          className="product-card business-tile"
        >
          <Scissors aria-hidden />
          <h2>Profesionales</h2>
          <p>Perfiles de atención y servicios habilitados para cada persona.</p>
          <span className="tile-action">Ver profesionales →</span>
        </Link>
        <Link
          href={`/app/${businessId}/servicios`}
          className="product-card business-tile"
        >
          <ClipboardList aria-hidden />
          <h2>Servicios</h2>
          <p>Tu catálogo, precios y duraciones en un solo lugar.</p>
          <span className="tile-action">Ver servicios →</span>
        </Link>
        {manage && (
          <Link
            href={`/app/${businessId}/miembros`}
            className="product-card business-tile"
          >
            <Users aria-hidden />
            <h2>Equipo y permisos</h2>
            <p>Invitá personas y administrá su acceso a este negocio.</p>
            <span className="tile-action">Administrar equipo →</span>
          </Link>
        )}
        <Link href="/seguridad" className="product-card business-tile">
          <ShieldCheck aria-hidden />
          <h2>Seguridad de tu cuenta</h2>
          <p>
            Verificá tu autenticador, actualizá tu contraseña o cerrá tus
            sesiones.
          </p>
          <span className="tile-action">Ver seguridad →</span>
        </Link>
      </div>
      <aside className="access-note">
        La agenda interna requiere clientes, profesionales, servicios y horarios
        habilitados en este entorno.
      </aside>
    </>
  );
}
