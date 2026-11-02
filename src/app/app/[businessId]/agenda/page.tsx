import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireBusinessPage } from "@/modules/auth/page-session";
import { AccessError } from "@/modules/auth/service";
import {
  listInitialAppointments,
  readAppointment,
} from "@/modules/appointments/service";
import { readCatalog } from "@/modules/services/catalog";
import { AgendaManager } from "@/components/appointments/agenda";
export default async function AgendaPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ appointment?: string }>;
}) {
  const { businessId } = await params,
    { member } = await requireBusinessPage(businessId);
  if (member.role === "barber") notFound();
  let loaded: {
    initial: Awaited<ReturnType<typeof listInitialAppointments>>;
    catalog: Awaited<ReturnType<typeof readCatalog>>;
    detail: Awaited<ReturnType<typeof readAppointment>> | null;
  } | null = null;
  try {
    const id = z.uuid().safeParse((await searchParams).appointment);
    const [initial, catalog, detail] = await Promise.all([
      listInitialAppointments(businessId),
      readCatalog(businessId),
      id.success ? readAppointment(businessId, id.data) : null,
    ]);
    loaded = { initial, catalog, detail };
  } catch (error) {
    if (error instanceof AccessError && [403, 404].includes(error.status))
      notFound();
    if (!(error instanceof AccessError) || error.status !== 503) throw error;
  }
  if (!loaded)
    return (
      <section className="product-card">
        <h1>La agenda todavía no está disponible.</h1>
        <p>Este entorno aún no está habilitado para gestionar turnos.</p>
        <Link href={`/app/${businessId}`}>Volver al negocio</Link>
      </section>
    );
  return (
    <>
      <Link className="back-link" href={`/app/${businessId}`}>
        ← {member.name}
      </Link>
      <section className="product-title">
        <p className="product-eyebrow">TIEMPO PARA TUS CLIENTES</p>
        <h1>
          Agenda<span>.</span>
        </h1>
        <p>Organizá los turnos de tu negocio y confirmá cada horario.</p>
      </section>
      <AgendaManager businessId={businessId} {...loaded} />
    </>
  );
}
