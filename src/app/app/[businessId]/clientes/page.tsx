import Link from "next/link";
import { notFound } from "next/navigation";
import { requireBusinessPage } from "@/modules/auth/page-session";
import { listCustomers } from "@/modules/customers/service";
import { AccessError } from "@/modules/auth/service";
import { CustomerDirectory } from "@/components/customers/directory";
export default async function CustomersPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params,
    { member } = await requireBusinessPage(businessId);
  if (member.role === "barber") notFound();
  let initial: Awaited<ReturnType<typeof listCustomers>>;
  try {
    initial = await listCustomers(businessId);
  } catch (error) {
    if (error instanceof AccessError && [403, 404].includes(error.status))
      notFound();
    if (!(error instanceof AccessError) || error.status !== 503) throw error;
    return (
      <section className="product-card">
        <h1>El directorio todavía no está disponible.</h1>
        <p>
          Este entorno aún no está listo para consultar clientes. Intentá
          nuevamente cuando esté habilitado.
        </p>
        <Link className="back-link" href={`/app/${businessId}`}>
          Volver al negocio
        </Link>
      </section>
    );
  }
  return (
    <>
      <Link className="back-link" href={`/app/${businessId}`}>
        ← {member.name}
      </Link>
      <section className="product-title">
        <p className="product-eyebrow">PERSONAS, NO NÚMEROS</p>
        <h1>
          Clientes<span>.</span>
        </h1>
        <p>
          Organizá las fichas de tu negocio. Los contactos pueden ser
          compartidos.
        </p>
      </section>
      <CustomerDirectory businessId={businessId} initial={initial} />
    </>
  );
}
