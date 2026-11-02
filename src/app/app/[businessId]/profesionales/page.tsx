import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireBusinessPage } from "@/modules/auth/page-session";
import { listMembers } from "@/modules/auth/service";
import { readCatalog } from "@/modules/services/catalog";
import { StaffForm, CatalogStateForm } from "@/components/catalog/forms";
export default async function ProfessionalsPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ archivados?: string }>;
}) {
  const { businessId } = await params,
    { member } = await requireBusinessPage(businessId),
    query = await searchParams;
  const catalog = await readCatalog(businessId, true),
    manage = member.role !== "barber",
    archived = query.archivados === "1";
  const members = manage ? await listMembers(businessId) : [],
    visible = catalog.staff.filter((s) => Boolean(s.deleted_at) === archived);
  return (
    <>
      <Link className="back-link" href={`/app/${businessId}`}>
        ← {member.name}
      </Link>
      <section className="product-title">
        <p className="product-eyebrow">QUIÉNES ATIENDEN</p>
        <h1>
          Profesionales<span>.</span>
        </h1>
        <p>Organizá los perfiles y los servicios que realiza cada persona.</p>
      </section>
      <nav className="catalog-nav" aria-label="Catálogo">
        <Link className="back-link" href={`/app/${businessId}/servicios`}>
          Ver servicios →
        </Link>
        <Link
          className="back-link"
          href={`/app/${businessId}/profesionales${archived ? "" : "?archivados=1"}`}
        >
          {archived ? "Ver perfiles actuales" : "Ver archivados"}
        </Link>
      </nav>
      <div className="members-layout">
        <section>
          <h2>
            {archived
              ? "Profesionales archivados"
              : "Profesionales del negocio"}
          </h2>
          <div className="member-list">
            {visible.map((s) => (
              <article className="product-card catalog-card" key={s.id}>
                <div className="member-heading">
                  <h3>{s.display_name}</h3>
                  <span className="role-badge">
                    {s.deleted_at
                      ? "Archivado"
                      : s.active
                        ? "Activo"
                        : "Inactivo"}
                  </span>
                </div>
                {s.bio && <p className="field-hint">{s.bio}</p>}
                <p className="field-hint">
                  {catalog.assignments
                    .filter((a) => a.staff_member_id === s.id)
                    .map(
                      (a) =>
                        catalog.services.find(
                          (service) => service.id === a.service_id,
                        )?.name,
                    )
                    .filter(Boolean)
                    .join(" · ") || "Sin servicios asignados"}
                </p>
                {manage && !s.deleted_at && (
                  <details>
                    <summary>Editar profesional</summary>
                    <StaffForm
                      businessId={businessId}
                      id={s.id}
                      version={s.version}
                      requestKey={randomUUID()}
                      staff={s}
                      services={catalog.services}
                      assignments={catalog.assignments}
                      members={members}
                    />
                  </details>
                )}
                {manage && (
                  <CatalogStateForm
                    businessId={businessId}
                    id={s.id}
                    version={s.version}
                    requestKey={randomUUID()}
                    kind="staff"
                    archived={Boolean(s.deleted_at)}
                  />
                )}
              </article>
            ))}
            {!visible.length && (
              <div className="product-card">
                <h3>
                  {archived
                    ? "No hay perfiles archivados"
                    : "Sumá tu primer profesional"}
                </h3>
                <p>
                  {manage
                    ? "Podés crear el perfil aunque todavía no tenga una cuenta de acceso."
                    : "El negocio todavía no cargó profesionales."}
                </p>
              </div>
            )}
          </div>
        </section>
        {manage && (
          <aside className="product-card invite-card">
            <p className="product-eyebrow">TU EQUIPO DE ATENCIÓN</p>
            <h2>Nuevo profesional</h2>
            <StaffForm
              businessId={businessId}
              id={randomUUID()}
              requestKey={randomUUID()}
              services={catalog.services}
              assignments={[]}
              members={members}
            />
          </aside>
        )}
      </div>
    </>
  );
}
