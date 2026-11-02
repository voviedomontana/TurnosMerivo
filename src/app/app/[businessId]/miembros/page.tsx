import { randomBytes, randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  InviteForm,
  MemberForm,
  SendAccessInviteForm,
  InvitationLifecycleForm,
} from "@/components/auth/forms";
import { requireBusinessPage } from "@/modules/auth/page-session";
import { AccessError, listMembersPage } from "@/modules/auth/service";
const roles = {
  owner: "Propietario",
  admin: "Administrador",
  barber: "Barbero",
};
const statuses = {
  active: "Activo",
  invited: "Invitado",
  suspended: "Suspendido",
};
export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{
    limit?: string | string[];
    cursor?: string | string[];
  }>;
}) {
  const { businessId } = await params;
  const { me, member } = await requireBusinessPage(businessId);
  if (member.role === "barber") notFound();
  const query = await searchParams;
  let result: Awaited<ReturnType<typeof listMembersPage>>;
  try {
    result = await listMembersPage(businessId, {
      limit: query.limit,
      cursor: query.cursor,
    });
  } catch (error) {
    if (error instanceof AccessError && [403, 404].includes(error.status))
      notFound();
    if (!(error instanceof AccessError) || error.status !== 400) throw error;
    return (
      <section className="product-card">
        <h1>No pudimos abrir esta página del equipo.</h1>
        <p>
          El enlace de paginación no es válido. Volvé al inicio para continuar.
        </p>
        <Link className="back-link" href={`/app/${businessId}/miembros`}>
          Volver a la primera página
        </Link>
      </section>
    );
  }
  const members = result.data;
  const nextQuery = result.page.next_cursor
    ? new URLSearchParams({
        limit: String(query.limit ?? 50),
        cursor: result.page.next_cursor,
      }).toString()
    : null;
  return (
    <>
      <Link className="back-link" href={`/app/${businessId}`}>
        ← {member.name}
      </Link>
      <section className="product-title">
        <p className="product-eyebrow">PERSONAS Y ACCESOS</p>
        <h1>
          Tu equipo<span>.</span>
        </h1>
        <p>
          Los permisos de esta pantalla se aplican únicamente a {member.name}.
        </p>
      </section>
      <div className="members-layout">
        <section>
          <h2>Miembros del negocio</h2>
          <div className="member-list">
            {members.map((person) => (
              <article className="product-card member-card" key={person.id}>
                <div className="member-heading">
                  <h3>{person.email}</h3>
                  <span className="role-badge">{statuses[person.status]}</span>
                </div>
                <p>
                  {roles[person.role]}
                  {person.user_id === me.id ? " · Vos" : ""}
                </p>
                {person.user_id === null ? (
                  <>
                    <p className="field-hint">
                      {person.status === "invited"
                        ? "Pendiente de aceptación"
                        : "Invitación revocada"}
                      {person.expires_at
                        ? ` · Vence el ${new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeZone: "America/Argentina/Buenos_Aires" }).format(new Date(person.expires_at))}`
                        : ""}
                      .
                    </p>
                    {(member.role === "owner" || person.role === "barber") && (
                      <>
                        <InvitationLifecycleForm
                          businessId={businessId}
                          memberId={person.id}
                          version={person.version}
                          requestKey={randomUUID()}
                          token={randomBytes(32).toString("base64url")}
                        />
                        {person.status === "invited" && (
                          <SendAccessInviteForm
                            businessId={businessId}
                            memberId={person.id}
                          />
                        )}
                      </>
                    )}
                  </>
                ) : person.user_id !== me.id &&
                  (member.role === "owner" || person.role === "barber") ? (
                  <MemberForm
                    businessId={businessId}
                    memberId={person.id}
                    version={person.version}
                    role={person.role}
                    status={person.status}
                    requestKey={randomUUID()}
                    isOwner={member.role === "owner"}
                  />
                ) : null}
              </article>
            ))}
          </div>
          <nav aria-label="Páginas del equipo">
            {query.cursor && (
              <Link className="back-link" href={`/app/${businessId}/miembros`}>
                Primera página
              </Link>
            )}
            {nextQuery && (
              <Link
                className="back-link"
                href={`/app/${businessId}/miembros?${nextQuery}`}
              >
                Ver más miembros →
              </Link>
            )}
            {!result.page.has_more && (
              <p className="field-hint">No hay más miembros para mostrar.</p>
            )}
          </nav>
        </section>
        <aside className="product-card invite-card">
          <p className="product-eyebrow">SUMÁ A TU EQUIPO</p>
          <h2>Invitar una persona</h2>
          <p>
            El enlace vence en 7 días y sólo puede usarlo una cuenta con ese
            email verificado.
          </p>
          <InviteForm
            businessId={businessId}
            token={randomBytes(32).toString("base64url")}
            requestKey={randomUUID()}
            isOwner={member.role === "owner"}
          />
        </aside>
      </div>
    </>
  );
}
