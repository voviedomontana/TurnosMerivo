"use client";
import { useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import type { Catalog } from "@/modules/services/catalog";
import { customerPage, type CustomerPage } from "@/modules/customers/schemas";
import {
  appointmentPage,
  appointmentDetail,
  bookingPreview,
  type AppointmentPage,
  type AppointmentDetail,
  type BookingPreview,
} from "@/modules/appointments/schemas";

export function AgendaManager({
  businessId,
  initial,
  catalog,
  detail: initialDetail,
}: {
  businessId: string;
  initial: AppointmentPage;
  catalog: Catalog;
  detail: AppointmentDetail | null;
}) {
  const base = `/api/v1/businesses/${businessId}`;
  const [page, setPage] = useState(initial),
    [from, setFrom] = useState(initial.from),
    [days, setDays] = useState("1"),
    [filterStaff, setFilterStaff] = useState("");
  const [detail, setDetail] = useState(initialDetail),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [query, setQuery] = useState(""),
    [field, setField] = useState("name"),
    [customers, setCustomers] = useState<CustomerPage | null>(null),
    [customer, setCustomer] = useState<CustomerPage["data"][number] | null>(
      null,
    );
  const [staff, setStaff] = useState(""),
    [service, setService] = useState(""),
    [date, setDate] = useState(initial.from),
    [preview, setPreview] = useState<BookingPreview | null>(null),
    [slot, setSlot] = useState("");
  const [moveDate, setMoveDate] = useState(initial.from),
    [movePreview, setMovePreview] = useState<BookingPreview | null>(null),
    [moveSlot, setMoveSlot] = useState(""),
    [reason, setReason] = useState(""),
    [cancelOpen, setCancelOpen] = useState(false);
  // Retry only an identical intent with the same UUID/key. Changes get fresh identities.
  const attempt = useRef<{
    fingerprint: string;
    key: string;
    id: string;
  } | null>(null);
  function identity(body: unknown) {
    const fingerprint = JSON.stringify(body);
    if (attempt.current?.fingerprint !== fingerprint)
      attempt.current = {
        fingerprint,
        key: crypto.randomUUID(),
        id: crypto.randomUUID(),
      };
    return attempt.current!;
  }
  async function call(
    path: string,
    body?: unknown,
    extra?: Record<string, string>,
  ) {
    const response = await fetch(base + path, {
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json", ...extra },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
    });
    const value: unknown = await response.json();
    if (!response.ok) {
      const error = z.object({ title: z.string() }).safeParse(value);
      throw Error(
        error.success ? error.data.title : "No pudimos completar la operación.",
      );
    }
    return value;
  }
  async function run(work: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await work();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "No pudimos completar la operación.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function refresh(nextFrom = from, cursor?: string) {
    const params = new URLSearchParams({
      from: nextFrom,
      days,
      ...(filterStaff ? { staff_id: filterStaff } : {}),
      ...(cursor ? { cursor } : {}),
    });
    setPage(appointmentPage.parse(await call(`/appointments?${params}`)));
    setFrom(nextFrom);
  }
  async function open(id: string) {
    setDetail(appointmentDetail.parse(await call(`/appointments/${id}`)));
    setMovePreview(null);
    setMoveSlot("");
    setCancelOpen(false);
    setReason("");
  }
  async function search(cursor?: string) {
    const result = customerPage.parse(
      await call("/customers/search", {
        field,
        value: query || null,
        mode: "prefix",
        state: "current",
        limit: 50,
        cursor: cursor ?? null,
      }),
    );
    setCustomers(result);
  }
  async function loadPreview(moving = false) {
    const path =
      moving && detail
        ? `/appointments/${detail.id}/availability?${new URLSearchParams({ from: moveDate, days: "1" })}`
        : `/schedule-preview?${new URLSearchParams({ staff_id: staff, service_id: service, from: date, days: "1" })}`;
    const result = bookingPreview.parse(await call(path));
    if (moving) {
      setMovePreview(result);
      setMoveSlot("");
    } else {
      setPreview(result);
      setSlot("");
    }
  }
  async function create() {
    if (!preview || !customer || !slot) return;
    const body = {
      customer_id: customer.id,
      staff_id: staff,
      service_id: service,
      starts_at: slot,
      context_versions: {
        staff: preview.staff_version,
        service: preview.service_version,
        customer: customer.version,
        calendar: preview.global_version,
        settings: preview.settings_version,
        business: preview.business_version,
      },
    };
    const ids = identity(body),
      result = z
        .object({ id: z.uuid() })
        .parse(
          await call(
            "/appointments",
            { id: ids.id, ...body },
            { "Idempotency-Key": ids.key },
          ),
        );
    setPreview(null);
    setSlot("");
    attempt.current = null;
    await open(result.id);
    await refresh(date);
    setMessage("Turno confirmado.");
  }
  async function change(action: "reschedule" | "cancel") {
    if (!detail) return;
    const body =
      action === "cancel"
        ? { reason: reason || null }
        : {
            starts_at: moveSlot,
            reason: reason || null,
            context_versions: {
              staff: movePreview?.staff_version,
              calendar: movePreview?.global_version,
              settings: movePreview?.settings_version,
              business: movePreview?.business_version,
            },
          };
    const ids = identity({
      action,
      id: detail.id,
      version: detail.version,
      body,
    });
    await call(`/appointments/${detail.id}/${action}`, body, {
      "If-Match": `"${detail.version}"`,
      "Idempotency-Key": ids.key,
    });
    attempt.current = null;
    await open(detail.id);
    await refresh(action === "reschedule" ? moveDate : from);
    setMessage(
      action === "cancel"
        ? "Turno cancelado. El horario quedó libre."
        : "Turno reprogramado.",
    );
  }
  const money = (cents: number) =>
    new Intl.NumberFormat("es-AR", {
      style: "currency",
      currency: "ARS",
    }).format(cents / 100);
  const time = (instant: string) =>
    new Intl.DateTimeFormat("es-AR", {
      timeZone: page.timezone,
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(instant));
  const future =
    detail?.status === "confirmed" &&
    Date.parse(detail.starts_at) > Date.parse(detail.now);
  const eligible = catalog.services.filter(
    (s) =>
      s.active &&
      !s.deleted_at &&
      catalog.assignments.some(
        (a) => a.staff_member_id === staff && a.service_id === s.id,
      ),
  );
  function slots(
    data: BookingPreview | null,
    value: string,
    update: (s: string) => void,
    label: string,
  ) {
    if (!data) return null;
    return (
      <>
        <p>
          {data.duration_minutes} min + {data.buffer_minutes} min de preparación
          · {money(data.price_cents)}
        </p>
        {data.days.map((d) => d.warning && <p key={d.date}>{d.warning}</p>)}
        <label>
          {label}
          <select
            aria-label={label}
            value={value}
            onChange={(e) => update(e.target.value)}
          >
            <option value="">Elegí un horario</option>
            {data.slots.map((s) => (
              <option key={s.start} value={s.start}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {!data.slots.length && <p>No hay horarios disponibles para ese día.</p>}
        <p>El horario se vuelve a comprobar al confirmar.</p>
      </>
    );
  }
  return (
    <>
      <p role="status" className="form-feedback">
        {message}
      </p>
      <section className="product-card agenda-overview">
        <h2>Turnos del negocio</h2>
        <p>Zona horaria: {page.timezone}</p>
        <form
          className="access-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => refresh());
          }}
        >
          <label>
            Desde
            <input
              aria-label="Desde"
              type="date"
              required
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label>
            Días
            <select
              aria-label="Días"
              value={days}
              onChange={(e) => setDays(e.target.value)}
            >
              <option value="1">1 día</option>
              <option value="7">7 días</option>
            </select>
          </label>
          <label>
            Filtrar profesional
            <select
              aria-label="Filtrar profesional"
              value={filterStaff}
              onChange={(e) => setFilterStaff(e.target.value)}
            >
              <option value="">Todos</option>
              {catalog.staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.display_name}
                </option>
              ))}
            </select>
          </label>
          <Button variant="outline" disabled={busy}>
            Consultar agenda
          </Button>
        </form>
        <div className="agenda-list">
          {page.data.map((a) => (
            <article className="agenda-entry" key={a.id}>
              <div>
                <strong>
                  {time(a.starts_at)} · {a.staff_name}
                </strong>
                <h3>{a.customer_name}</h3>
                <p>
                  {a.service_name} · {money(a.price_cents)}
                </p>
                <p>
                  {a.status === "cancelled"
                    ? "Cancelado"
                    : Date.parse(a.starts_at) <= Date.parse(page.now)
                      ? "Horario transcurrido · atención no registrada"
                      : "Confirmado"}
                </p>
              </div>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void run(() => open(a.id))}
              >
                Ver turno
              </Button>
            </article>
          ))}
        </div>
        {!page.data.length && <p>No hay turnos en este período.</p>}
        {page.page.has_more && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(() => refresh(from, page.page.next_cursor!))
            }
          >
            Página siguiente de turnos
          </Button>
        )}
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => void run(() => refresh())}
        >
          Primera página de turnos
        </Button>
      </section>
      <div className="members-layout">
        <section className="product-card">
          <h2>Nuevo turno</h2>
          <p>
            Buscá y elegí una ficha. Un teléfono compartido no identifica a una
            persona.
          </p>
          <form
            className="access-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(() => search());
            }}
          >
            <label>
              Buscar por
              <select
                aria-label="Buscar por"
                value={field}
                onChange={(e) => {
                  setField(e.target.value);
                  setCustomers(null);
                }}
              >
                <option value="name">Nombre</option>
                <option value="phone">Teléfono</option>
              </select>
            </label>
            <label>
              Buscar cliente
              <input
                aria-label="Buscar cliente"
                maxLength={120}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setCustomers(null);
                }}
              />
            </label>
            <Button variant="outline" disabled={busy}>
              Buscar fichas
            </Button>
          </form>
          {customers && (
            <div className="access-form">
              <label>
                Ficha del cliente
                <select
                  aria-label="Ficha del cliente"
                  value={customer?.id ?? ""}
                  onChange={(e) =>
                    setCustomer(
                      customers.data.find((c) => c.id === e.target.value) ??
                        null,
                    )
                  }
                >
                  <option value="">Elegí una ficha explícitamente</option>
                  {customers.data.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name} · {c.phone_raw ?? "Sin teléfono"}
                    </option>
                  ))}
                </select>
              </label>
              {customers.page.has_more && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(() => search(customers.page.next_cursor!))
                  }
                >
                  Más fichas
                </Button>
              )}
            </div>
          )}
          {customer && (
            <p>
              Cliente elegido: <strong>{customer.full_name}</strong>. Teléfono
              declarado: {customer.phone_raw ?? "sin teléfono"}.
            </p>
          )}
          <form
            className="access-form"
            onSubmit={(e) => {
              e.preventDefault();
              void run(create);
            }}
          >
            <label>
              Profesional del turno
              <select
                aria-label="Profesional del turno"
                required
                value={staff}
                onChange={(e) => {
                  setStaff(e.target.value);
                  setService("");
                  setPreview(null);
                  setSlot("");
                }}
              >
                <option value="">Elegí un profesional</option>
                {catalog.staff
                  .filter((s) => s.active && !s.deleted_at)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.display_name}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Servicio del turno
              <select
                aria-label="Servicio del turno"
                required
                value={service}
                onChange={(e) => {
                  setService(e.target.value);
                  setPreview(null);
                  setSlot("");
                }}
              >
                <option value="">Elegí un servicio habilitado</option>
                {eligible.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Fecha del nuevo turno
              <input
                aria-label="Fecha del nuevo turno"
                type="date"
                required
                value={date}
                onChange={(e) => {
                  setDate(e.target.value);
                  setPreview(null);
                  setSlot("");
                }}
              />
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={busy || !staff || !service}
              onClick={() => void run(() => loadPreview())}
            >
              Consultar horarios
            </Button>
            {slots(preview, slot, setSlot, "Horario del nuevo turno")}
            <Button
              variant="default"
              disabled={busy || !customer || !slot || !preview}
            >
              Confirmar turno
            </Button>
          </form>
        </section>
        <section className="product-card">
          <h2>Detalle del turno</h2>
          {detail ? (
            <>
              <h3>{detail.customer_name}</h3>
              <p>
                {detail.staff_name} · {detail.service_name}
              </p>
              <p>
                {time(detail.starts_at)} — {time(detail.ends_at)} ·{" "}
                {detail.status === "confirmed" ? "Confirmado" : "Cancelado"}
              </p>
              <p>
                Precio acordado: {money(detail.price_cents)} ·{" "}
                {detail.duration_minutes} min + {detail.buffer_minutes} min de
                preparación
              </p>
              <p>Teléfono declarado: {detail.phone_raw ?? "sin teléfono"}</p>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void run(() => open(detail.id))}
              >
                Actualizar turno
              </Button>
              {future && (
                <form
                  className="access-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(() => change("reschedule"));
                  }}
                >
                  <h3>Reprogramar</h3>
                  <p>
                    Se conservan cliente, profesional, servicio, precio y
                    duración originales.
                  </p>
                  <label>
                    Nueva fecha
                    <input
                      aria-label="Nueva fecha"
                      type="date"
                      required
                      value={moveDate}
                      onChange={(e) => {
                        setMoveDate(e.target.value);
                        setMovePreview(null);
                        setMoveSlot("");
                      }}
                    />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void run(() => loadPreview(true))}
                  >
                    Consultar para reprogramar
                  </Button>
                  {slots(movePreview, moveSlot, setMoveSlot, "Nuevo horario")}
                  <label>
                    Motivo privado
                    <textarea
                      aria-label="Motivo privado"
                      maxLength={500}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                    />
                  </label>
                  <Button
                    variant="default"
                    disabled={busy || !moveSlot || !movePreview}
                  >
                    Confirmar reprogramación
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => setCancelOpen((v) => !v)}
                  >
                    Cancelar turno
                  </Button>
                  {cancelOpen && (
                    <>
                      <p>
                        El turno quedará cancelado y su horario se liberará. Se
                        conserva el registro.
                      </p>
                      <Button
                        type="button"
                        variant="default"
                        disabled={busy}
                        onClick={() => void run(() => change("cancel"))}
                      >
                        Confirmar cancelación
                      </Button>
                    </>
                  )}
                </form>
              )}
              <h3>Movimientos registrados</h3>
              <ol>
                {detail.events.map((e) => (
                  <li key={e.id}>
                    {time(e.created_at)} ·{" "}
                    {
                      {
                        created: "Creado",
                        rescheduled: "Reprogramado",
                        cancelled: "Cancelado",
                      }[e.event_type]
                    }
                    {e.reason && <p>Motivo: {e.reason}</p>}
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p>Elegí un turno de la agenda para ver sus datos.</p>
          )}
        </section>
      </div>
    </>
  );
}
