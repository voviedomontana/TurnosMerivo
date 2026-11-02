"use client";
import { useState, useRef, type FormEvent } from "react";
import Link from "next/link";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  scheduleSchema,
  parseIntervals,
  minute,
  displayMinute,
  type StaffOption,
  type ScheduleData,
} from "@/modules/availability/schemas";
type Preview = {
  timezone: string;
  slots: { date: string; start: string; end: string; label: string }[];
  days: { date: string; warning: string | null }[];
  mode: "schedule_preview";
  can_book: false;
  occupancy_checked: boolean;
};
const weekdays = [
  "Lunes",
  "Martes",
  "Miércoles",
  "Jueves",
  "Viernes",
  "Sábado",
  "Domingo",
];
function weekText(
  intervals: { weekday: number; start_minute: number; end_minute: number }[],
) {
  return Object.fromEntries(
    weekdays.map((_, i) => [
      i + 1,
      intervals
        .filter((v) => v.weekday === i + 1)
        .map(
          (v) =>
            `${displayMinute(v.start_minute)}-${displayMinute(v.end_minute)}`,
        )
        .join(", "),
    ]),
  ) as Record<number, string>;
}
export function ScheduleManager({
  businessId,
  staff,
  services,
  assignments,
  initial,
}: {
  businessId: string;
  staff: StaffOption[];
  services: { id: string; name: string }[];
  assignments: { staff_member_id: string; service_id: string }[];
  initial: ScheduleData;
}) {
  const base = `/api/v1/businesses/${businessId}`;
  const [data, setData] = useState(initial),
    [selected, setSelected] = useState(initial.staff_id),
    [week, setWeek] = useState<Record<number, string>>(() =>
      weekText(
        initial.plans.filter((p) => p.effective_from <= initial.today).at(-1)
          ?.intervals ?? [],
      ),
    ),
    [effective, setEffective] = useState(initial.today),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [conflicts, setConflicts] = useState<{ id: string; starts_at: string }[]>(
      [],
    );
  const intent = useRef<{ signature: string; id: string; key: string } | null>(
    null,
  );
  async function call(path: string, options?: RequestInit) {
    const r = await fetch(base + path, {
      ...options,
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
    const value: unknown = await r.json();
    if (!r.ok) {
      const parsed = z
        .object({
          conflicts: z.object({
            appointments: z
              .array(z.object({ id: z.uuid(), starts_at: z.string() }))
              .max(20),
            has_more: z.boolean(),
          }),
        })
        .safeParse(value);
      if (parsed.success) setConflicts(parsed.data.conflicts.appointments);
      throw Error(
        (value as { title?: string }).title ??
          "No pudimos completar la operación.",
      );
    }
    return value;
  }
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    setConflicts([]);
    try {
      await task();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Revisá la configuración ingresada.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function reload(id = selected, reset = false) {
    const next = scheduleSchema.parse(await call(`/staff/${id}/schedule`));
    setData(next);
    setSelected(id);
    setPreview(null);
    if (reset) {
      setWeek(
        weekText(
          next.plans.filter((p) => p.effective_from <= next.today).at(-1)
            ?.intervals ?? [],
        ),
      );
      setEffective(next.today);
    }
    return next;
  }
  async function write(
    kind: "plan" | "exception" | "block",
    payload: unknown,
    global = false,
    action: "save" | "archive" = "save",
    resourceId?: string,
  ) {
    const version = global ? data.global_version : data.staff_version,
      signature = JSON.stringify({
        kind,
        payload,
        global,
        action,
        resourceId,
        version,
        selected,
      });
    if (!intent.current || intent.current.signature !== signature)
      intent.current = {
        signature,
        id: resourceId ?? crypto.randomUUID(),
        key: crypto.randomUUID(),
      };
    const current = intent.current,
      path =
        kind === "plan"
          ? `/staff/${selected}/working-hours`
          : `${global ? "" : `/staff/${selected}`}/${kind === "exception" ? "schedule-exceptions" : "time-blocks"}`;
    await call(path, {
      method: kind === "plan" ? "PUT" : "POST",
      headers: { "If-Match": `"${version}"`, "Idempotency-Key": current.key },
      body: JSON.stringify({ id: current.id, action, data: payload }),
    });
    intent.current = null;
    await reload();
    setMessage(
      "Configuración guardada. La vista previa debe calcularse nuevamente.",
    );
  }
  function saveWeek(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(() =>
      write("plan", {
        effective_from: effective,
        intervals: weekdays.flatMap((_, i) =>
          parseIntervals(week[i + 1] ?? "").map((v) => ({
            ...v,
            weekday: i + 1,
          })),
        ),
      }),
    );
  }
  function exception(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(() =>
      write(
        "exception",
        {
          date: form.get("date"),
          kind: form.get("kind"),
          intervals:
            form.get("kind") === "closed"
              ? []
              : parseIntervals(String(form.get("intervals") ?? "")),
          reason: form.get("reason") || null,
        },
        form.get("global") === "on",
      ),
    );
  }
  function block(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(() =>
      write(
        "block",
        {
          start_date: form.get("start_date"),
          start_minute: minute(String(form.get("start_time"))),
          end_date: form.get("end_date"),
          end_minute: minute(String(form.get("end_time")), true),
          kind: form.get("kind"),
          reason: form.get("reason") || null,
        },
        form.get("global") === "on",
      ),
    );
  }
  function calculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      const q = new URLSearchParams({
        staff_id: selected,
        service_id: String(form.get("service_id")),
        from: String(form.get("from")),
        days: String(form.get("days")),
      });
      setPreview((await call(`/schedule-preview?${q}`)) as Preview);
    });
  }
  const eligible = services.filter((s) =>
    assignments.some(
      (a) => a.staff_member_id === selected && a.service_id === s.id,
    ),
  );
  return (
    <>
      <div className="product-card access-form">
        <label>
          Profesional
          <select
            aria-label="Profesional"
            value={selected}
            disabled={busy}
            onChange={(e) =>
              void run(() => reload(e.target.value, true).then(() => {}))
            }
          >
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.active ? "" : " (inactivo)"}
              </option>
            ))}
          </select>
        </label>
        <p className="field-hint">
          Zona horaria: {data.timezone}. Los intervalos vacíos indican día
          cerrado.
        </p>
        <Button
          disabled={busy}
          variant="outline"
          onClick={() => void run(() => reload().then(() => {}))}
        >
          Recargar configuración
        </Button>
      </div>
      <p
        className="form-feedback customer-feedback"
        role="status"
        aria-live="polite"
      >
        {message}
      </p>
      {conflicts.length > 0 && (
        <section className="product-card">
          <h2>Turnos afectados</h2>
          <ul>
            {conflicts.map((c) => (
              <li key={c.id}>
                <Link
                  className="back-link"
                  href={`/app/${businessId}/agenda?appointment=${c.id}`}
                >
                  {new Intl.DateTimeFormat("es-AR", {
                    timeZone: data.timezone,
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(c.starts_at))}{" "}
                  · Abrir turno
                </Link>
              </li>
            ))}
          </ul>
          <p className="field-hint">
            Se muestran hasta 20 referencias. Consultá la agenda para revisar el
            rango completo.
          </p>
        </section>
      )}
      <div className="members-layout">
        <section className="product-card">
          <h2>Semana de atención</h2>
          {data.can_manage ? (
            <form
              className="access-form"
              onSubmit={saveWeek}
              aria-label="Semana de atención"
            >
              <label>
                Vigente desde
                <input
                  name="effective_from"
                  type="date"
                  value={effective}
                  min={data.today}
                  onChange={(e) => setEffective(e.target.value)}
                  required
                />
              </label>
              <p className="field-hint">
                Ejemplo: 09:00-13:00, 14:00-18:00. Un máximo de 14 intervalos
                por semana. Los cambios futuros posteriores se conservan.
              </p>
              {weekdays.map((day, i) => (
                <label key={day}>
                  {day}
                  <input
                    name={`weekday_${i + 1}`}
                    value={week[i + 1] ?? ""}
                    onChange={(e) =>
                      setWeek({ ...week, [i + 1]: e.target.value })
                    }
                    placeholder="Cerrado"
                  />
                </label>
              ))}
              <Button disabled={busy} type="submit">
                Guardar semana
              </Button>
            </form>
          ) : (
            <p className="field-hint">
              Consulta de tu horario. Los cambios los realiza la administración.
            </p>
          )}
          <h3 className="catalog-state-form">Planes vigentes y programados</h3>
          {data.plans.length ? (
            data.plans.map((p) => (
              <article className="schedule-record" key={p.id}>
                <strong>Desde {p.effective_from}</strong>
                <p className="field-hint">
                  {p.intervals
                    .map(
                      (i) =>
                        `${weekdays[i.weekday - 1]} ${displayMinute(i.start_minute)}–${displayMinute(i.end_minute)}`,
                    )
                    .join(" · ") || "Semana cerrada"}
                </p>
                {data.can_manage && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setEffective(
                        p.effective_from < data.today
                          ? data.today
                          : p.effective_from,
                      );
                      setWeek(weekText(p.intervals));
                    }}
                  >
                    Cargar plan en el editor
                  </Button>
                )}
              </article>
            ))
          ) : (
            <p>Sin plan: no se generan horarios posibles.</p>
          )}
        </section>
        <section className="product-card">
          <h2>Vista previa informativa</h2>
          <p>
            Horarios posibles según configuración. La confirmación se hace desde
            la agenda y vuelve a validar la disponibilidad.
          </p>
          <form
            className="access-form"
            onSubmit={calculate}
            aria-label="Vista previa"
          >
            <label>
              Servicio
              <select
                name="service_id"
                aria-label="Servicio"
                required
                key={selected}
              >
                {eligible.map((s) => (
                  <option value={s.id} key={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Desde
              <input
                name="from"
                type="date"
                min={data.today}
                defaultValue={data.today}
                key={data.staff_id}
                required
              />
            </label>
            <label>
              Días
              <input
                name="days"
                type="number"
                min={1}
                max={7}
                defaultValue={1}
                required
              />
            </label>
            <Button type="submit" disabled={busy || !eligible.length}>
              Calcular vista previa
            </Button>
          </form>
          {!eligible.length && (
            <p>Asigná un servicio activo al profesional para previsualizar.</p>
          )}
          {preview && (
            <div className="schedule-preview-results" aria-live="polite">
              {!preview.occupancy_checked && (
                <p>Este entorno todavía no comprueba ocupación de reservas.</p>
              )}
              <p>
                {preview.slots.length} horarios posibles · {preview.timezone}
              </p>
              {preview.days
                .filter((d) => d.warning)
                .map((d) => (
                  <p key={d.date}>
                    Revisá la jornada de {d.date}: una hora local no existe en
                    esa fecha.
                  </p>
                ))}
              <ul className="preview-slots">
                {preview.slots.map((s) => (
                  <li key={s.start}>
                    {s.date} · {s.label}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
      <div className="members-layout catalog-state-form">
        <section className="product-card">
          <h2>Excepciones por fecha</h2>
          {data.can_manage && (
            <form
              className="access-form"
              onSubmit={exception}
              aria-label="Nueva excepción"
            >
              <label>
                Fecha
                <input
                  name="date"
                  type="date"
                  min={data.today}
                  defaultValue={data.today}
                  required
                />
              </label>
              <label>
                Tipo
                <select name="kind" aria-label="Tipo de excepción">
                  <option value="closed">Cerrado</option>
                  <option value="custom_hours">Horario especial</option>
                </select>
              </label>
              <label>
                Intervalos especiales
                <input
                  name="intervals"
                  placeholder="10:00-13:00, 15:00-18:00"
                />
              </label>
              <label>
                Motivo privado
                <textarea name="reason" maxLength={500} />
              </label>
              <label className="check-label">
                <input name="global" type="checkbox" />
                Aplicar a todo el negocio
              </label>
              <p className="field-hint">
                Un cierre del negocio prevalece sobre aperturas individuales.
              </p>
              <Button disabled={busy} type="submit">
                Guardar excepción
              </Button>
            </form>
          )}
          {data.exceptions.map((e) => (
            <article className="schedule-record" key={e.id}>
              <strong>
                {e.date} · {e.staff_id ? "Profesional" : "Todo el negocio"} ·{" "}
                {e.kind === "closed" ? "Cerrado" : "Horario especial"}
              </strong>
              <p>
                {e.intervals
                  .map(
                    (i) =>
                      `${displayMinute(i.start_minute)}–${displayMinute(i.end_minute)}`,
                  )
                  .join(", ")}
              </p>
              {e.reason && <p className="field-hint">{e.reason}</p>}
              {data.can_manage && (
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    void run(() =>
                      write(
                        "exception",
                        {},
                        e.staff_id === null,
                        "archive",
                        e.id,
                      ),
                    )
                  }
                >
                  Retirar excepción
                </Button>
              )}
            </article>
          ))}
        </section>
        <section className="product-card">
          <h2>Bloqueos puntuales</h2>
          {data.can_manage && (
            <form
              className="access-form"
              onSubmit={block}
              aria-label="Nuevo bloqueo"
            >
              <div className="catalog-fields">
                <label>
                  Fecha de inicio
                  <input
                    name="start_date"
                    type="date"
                    min={data.today}
                    defaultValue={data.today}
                    required
                  />
                </label>
                <label>
                  Hora de inicio
                  <input
                    name="start_time"
                    placeholder="HH:mm"
                    defaultValue="10:00"
                    required
                  />
                </label>
                <label>
                  Fecha de fin
                  <input
                    name="end_date"
                    type="date"
                    min={data.today}
                    defaultValue={data.today}
                    required
                  />
                </label>
                <label>
                  Hora de fin
                  <input
                    name="end_time"
                    placeholder="HH:mm"
                    defaultValue="11:00"
                    required
                  />
                </label>
              </div>
              <label>
                Tipo
                <select name="kind" aria-label="Tipo de bloqueo">
                  <option value="manual">Manual</option>
                  <option value="vacation">Vacaciones</option>
                  <option value="other">Otro</option>
                </select>
              </label>
              <label>
                Motivo privado
                <textarea name="reason" maxLength={500} />
              </label>
              <label className="check-label">
                <input name="global" type="checkbox" />
                Aplicar a todo el negocio
              </label>
              <p className="field-hint">
                Horas en {data.timezone}. Si se repite una hora, se usa la
                primera ocurrencia. Las horas inexistentes se rechazan.
              </p>
              <Button type="submit" disabled={busy}>
                Guardar bloqueo
              </Button>
            </form>
          )}
          {data.blocks.map((b) => (
            <article className="schedule-record" key={b.id}>
              <strong>{b.staff_id ? "Profesional" : "Todo el negocio"}</strong>
              <p>
                {new Intl.DateTimeFormat("es-AR", {
                  timeZone: data.timezone,
                  dateStyle: "short",
                  timeStyle: "short",
                }).format(new Date(b.start))}{" "}
                —{" "}
                {new Intl.DateTimeFormat("es-AR", {
                  timeZone: data.timezone,
                  dateStyle: "short",
                  timeStyle: "short",
                }).format(new Date(b.end))}
              </p>
              {b.reason && <p className="field-hint">{b.reason}</p>}
              {data.can_manage && (
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    void run(() =>
                      write("block", {}, b.staff_id === null, "archive", b.id),
                    )
                  }
                >
                  Retirar bloqueo
                </Button>
              )}
            </article>
          ))}
        </section>
      </div>
    </>
  );
}
