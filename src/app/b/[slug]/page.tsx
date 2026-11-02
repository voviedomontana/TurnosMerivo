import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BrandLogo } from "@/components/brand-logo";
import { PublicReserve } from "@/components/public-booking/reserve";
import { publicConfig, runtimeGate } from "@/modules/public-booking/config";
import { publicQuery } from "@/modules/public-booking/repository";
import { readPublicCatalog } from "@/modules/businesses/public-catalog-repository";
import {
  resolvePublicCatalog,
  type PublicCatalog,
} from "@/modules/businesses/public-catalog";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Servicios y profesionales | TurnosMerivo",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export default async function PublicCatalogPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let catalog: PublicCatalog | null = null,
    unavailable = false;
  try {
    catalog = await resolvePublicCatalog(slug, readPublicCatalog);
  } catch {
    unavailable = true;
  }
  if (!unavailable && !catalog) notFound();
  let publicEnabled = false;
  try {
    const gate = runtimeGate(publicConfig());
    publicEnabled =
      (await publicQuery(gate.statement, gate.values, crypto.randomUUID())) ===
      true;
  } catch {
    /* Public writes stay disabled without isolated runtime custody. */
  }
  const money = (value: number) =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
    }).format(value / 100);
  return (
    <div className="product-shell">
      <header className="product-header">
        <BrandLogo href="/" />
        <span className="role-badge">Servicios y profesionales</span>
      </header>
      <main className="product-main">
        {catalog ? (
          <>
            <section className="product-title">
              <p className="product-eyebrow">TU PRÓXIMO CORTE EMPIEZA ACÁ</p>
              <h1>
                {catalog.business.name}
                <span>.</span>
              </h1>
              <p>
                Conocé a los profesionales y encontrá el servicio que buscás.
              </p>
              {[
                catalog.business.address_line,
                catalog.business.city,
                catalog.business.region,
              ].filter(Boolean).length > 0 && (
                <p>
                  {[
                    catalog.business.address_line,
                    catalog.business.city,
                    catalog.business.region,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              )}
              {catalog.business.phone && (
                <p>Contacto del negocio: {catalog.business.phone}</p>
              )}
            </section>
            {!publicEnabled && (
              <aside className="access-note">
                <strong>La reserva online todavía no está habilitada.</strong>
                <p>Por ahora, coordiná tu turno directamente con el negocio.</p>
              </aside>
            )}
            {publicEnabled && <PublicReserve catalog={catalog} />}
            <section
              aria-label="Profesionales y servicios disponibles"
              className="business-grid"
            >
              {catalog.professionals.map((p) => (
                <article key={p.id} className="product-card">
                  <p className="product-eyebrow">PROFESIONAL</p>
                  <h2>{p.display_name}</h2>
                  {p.bio && <p>{p.bio}</p>}
                  <ul className="public-service-list">
                    {p.services.map((s) => (
                      <li key={s.id}>
                        <div>
                          <h3>{s.name}</h3>
                          {s.description && <p>{s.description}</p>}
                          <p>{s.duration_minutes} min</p>
                        </div>
                        <strong>{money(s.price_cents)}</strong>
                      </li>
                    ))}
                  </ul>
                </article>
              ))}
            </section>
            {!catalog.professionals.length && (
              <section className="product-card">
                <h2>El catálogo se está preparando</h2>
                <p>
                  El negocio todavía no tiene profesionales con servicios
                  disponibles online.
                </p>
              </section>
            )}
          </>
        ) : (
          <section className="product-card">
            <h1>No pudimos cargar el catálogo.</h1>
            <p>Intentá nuevamente más tarde.</p>
          </section>
        )}
      </main>
      <footer className="product-footer">
        <strong>MERIVO</strong>
        <p>Tu próximo turno, más cerca.</p>
      </footer>
    </div>
  );
}
