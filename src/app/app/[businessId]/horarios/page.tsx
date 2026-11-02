import Link from "next/link";
import { requireBusinessPage } from "@/modules/auth/page-session";
import { AccessError } from "@/modules/auth/service";
import {
  listScheduleStaff,
  readSchedule,
} from "@/modules/availability/service";
import { readCatalog } from "@/modules/services/catalog";
import { ScheduleManager } from "@/components/availability/manager";
export default async function SchedulePage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params,
    { member } = await requireBusinessPage(businessId);
  let loaded: {
    staff: Awaited<ReturnType<typeof listScheduleStaff>>;
    catalog: Awaited<ReturnType<typeof readCatalog>>;
    initial: Awaited<ReturnType<typeof readSchedule>> | null;
  } | null = null;
  try {
    const [staff, catalog] = await Promise.all([
      listScheduleStaff(businessId),
      readCatalog(businessId),
    ]);
    const initial = staff.length
      ? await readSchedule(businessId, staff[0].id)
      : null;
    loaded = { staff, catalog, initial };
  } catch (error) {
    if (!(error instanceof AccessError) || error.status !== 503) throw error;
  }
  if (!loaded)
    return (
      <section className="product-card">
        <h1>Horarios todavía no está disponible.</h1>
        <p>
          Este entorno aún no está habilitado para consultar la configuración.
        </p>
        <Link className="back-link" href={`/app/${businessId}`}>
          Volver al negocio
        </Link>
      </section>
    );
  const { staff, catalog, initial } = loaded;
  return (
    <>
      <Link className="back-link" href={`/app/${businessId}`}>
        ← {member.name}
      </Link>
      <section className="product-title">
        <p className="product-eyebrow">TIEMPO PARA ATENDER</p>
        <h1>
          Horarios<span>.</span>
        </h1>
        <p>
          Jornadas, descansos y excepciones. La vista previa es informativa y la
          confirmación se realiza desde la agenda.
        </p>
      </section>
      {initial ? (
        <ScheduleManager
          businessId={businessId}
          staff={staff}
          services={catalog.services.map((s) => ({ id: s.id, name: s.name }))}
          assignments={catalog.assignments}
          initial={initial}
        />
      ) : (
        <section className="product-card">
          <h2>No hay un profesional disponible para consultar</h2>
          <p>
            {member.role === "barber"
              ? "Tu membresía todavía no está vinculada a un perfil de atención."
              : "Creá un profesional desde el catálogo para configurar su jornada."}
          </p>
        </section>
      )}
    </>
  );
}
