import { randomUUID } from "node:crypto";
import Link from "next/link";
import { requireBusinessPage } from "@/modules/auth/page-session";
import { readCatalog } from "@/modules/services/catalog";
import { ServiceForm, CatalogStateForm } from "@/components/catalog/forms";
export default async function ServicesPage({
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
  const visible = catalog.services.filter(
    (s) => Boolean(s.deleted_at) === archived,
  );
  return (
    <>
      <Link className="back-link" href={`/app/${businessId}`}>
        ← {member.name}
      </Link>
      <section className="product-title">
        <p className="product-eyebrow">CATÁLOGO MERIVO</p>
        <h1>
          Servicios<span>.</span>
        </h1>
        <p>Definí qué ofrecés, sus precios y el tiempo de cada atención.</p>
      </section>
      <nav className="catalog-nav" aria-label="Catálogo">
        <Link className="back-link" href={`/app/${businessId}/profesionales`}>
          Ver profesionales →
        </Link>
        <Link
          className="back-link"
          href={`/app/${businessId}/servicios${archived ? "" : "?archivados=1"}`}
        >
          {archived ? "Ver catálogo actual" : "Ver archivados"}
        </Link>
      </nav>
      <div className="members-layout">
        <section>
          <h2>{archived ? "Servicios archivados" : "Servicios del negocio"}</h2>
          <div className="member-list">
            {visible.map((s) => (
              <article className="product-card catalog-card" key={s.id}>
                <div className="member-heading">
                  <h3>{s.name}</h3>
                  <span className="role-badge">
                    {s.deleted_at
                      ? "Archivado"
                      : s.active
                        ? "Activo"
                        : "Inactivo"}
                  </span>
                </div>
                <p>
                  {new Intl.NumberFormat("es-AR", {
                    style: "currency",
                    currency: "ARS",
                  }).format(s.price_cents / 100)}{" "}
                  · {s.duration_minutes} min
                  {s.buffer_minutes
                    ? ` + ${s.buffer_minutes} min posteriores`
                    : ""}
                </p>
                {manage && !s.deleted_at ? (
                  <details>
                    <summary>Editar servicio</summary>
                    <ServiceForm
                      businessId={businessId}
                      id={s.id}
                      version={s.version}
                      requestKey={randomUUID()}
                      service={s}
                    />
                  </details>
                ) : (
                  s.description && <p className="field-hint">{s.description}</p>
                )}
                {manage && (
                  <CatalogStateForm
                    businessId={businessId}
                    id={s.id}
                    version={s.version}
                    requestKey={randomUUID()}
                    kind="service"
                    archived={Boolean(s.deleted_at)}
                  />
                )}
              </article>
            ))}
            {!visible.length && (
              <div className="product-card">
                <h3>
                  {archived
                    ? "No hay servicios archivados"
                    : "Tu catálogo empieza acá"}
                </h3>
                <p>
                  {manage
                    ? "Agregá un servicio con su precio y duración para comenzar."
                    : "El negocio todavía no cargó servicios."}
                </p>
              </div>
            )}
          </div>
        </section>
        {manage && (
          <aside className="product-card invite-card">
            <p className="product-eyebrow">LO QUE OFRECÉS</p>
            <h2>Nuevo servicio</h2>
            <p>Los precios se expresan en pesos argentinos.</p>
            <ServiceForm
              businessId={businessId}
              id={randomUUID()}
              requestKey={randomUUID()}
            />
          </aside>
        )}
      </div>
    </>
  );
}
