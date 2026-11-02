"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { publicFetch, publicCommand } from "@/modules/public-booking/client";
import {
  managementSchema,
  availabilitySchema,
  type PublicManagement,
  type PublicAvailability,
} from "@/modules/public-booking/schemas";
export function PublicManage({ slug, id }: { slug: string; id: string }) {
  const base = `/api/v1/public/${slug}`,
    path = `/manage/${id}`;
  const [detail, setDetail] = useState<PublicManagement | null>(null),
    [preview, setPreview] = useState<PublicAvailability | null>(null),
    [date, setDate] = useState(""),
    [slot, setSlot] = useState(""),
    [reason, setReason] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [confirm, setConfirm] = useState(false);
  const started = useRef(false),
    generation = useRef(0),
    attempt = useRef<{
      signature: string;
      key: string;
      version: number;
    } | null>(null);
  useEffect(() => {
    const load = () => {
      const fragment = new URLSearchParams(window.location.hash.slice(1)),
        token = fragment.get("t");
      if (started.current && !token) return;
      started.current = true;
      const current = ++generation.current;
      if (window.location.hash)
        window.history.replaceState(null, "", window.location.pathname);
      publicFetch(
        base,
        path + (token ? "/exchange" : ""),
        token ? { token } : undefined,
      )
        .then((value) => {
          if (current === generation.current) {
            setDetail(managementSchema.parse(value));
            setMessage("");
          }
        })
        .catch(() => {
          if (current === generation.current) {
            setDetail(null);
            setMessage(
              "No encontramos un acceso válido. Abrí tu enlace original; UUID o teléfono no permiten recuperar este turno.",
            );
          }
        });
    };
    window.addEventListener("hashchange", load);
    load();
    return () => window.removeEventListener("hashchange", load);
  }, [base, path]);
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
  async function refresh() {
    setDetail(managementSchema.parse(await publicFetch(base, path)));
    setPreview(null);
    setSlot("");
    setConfirm(false);
    attempt.current = null;
  }
  async function change(action: "cancel" | "reschedule") {
    if (!detail) return;
    const body =
        action === "cancel"
          ? { reason: reason || null }
          : {
              starts_at: slot,
              quote_id: preview?.quote_id,
              reason: reason || null,
            },
      signature = JSON.stringify({ action, body });
    if (attempt.current?.signature !== signature)
      attempt.current = {
        signature,
        key: crypto.randomUUID(),
        version: detail.version,
      };
    await publicCommand(
      base,
      action,
      id,
      path + `/${action}`,
      body,
      attempt.current.key,
      attempt.current.version,
    );
    await refresh();
    setMessage(
      action === "cancel"
        ? "Turno cancelado. Se liberó el horario."
        : "Turno reprogramado.",
    );
  }
  const when = (value: string) =>
    new Intl.DateTimeFormat("es-AR", {
      timeZone: detail?.timezone,
      dateStyle: "short",
      timeStyle: "short",
      hourCycle: "h23",
    }).format(new Date(value));
  return (
    <section className="product-card">
      <p className="product-eyebrow">TU TURNO</p>
      <h1>
        Gestioná tu reserva<span>.</span>
      </h1>
      <p>Entorno descartable de prueba. No se envían mensajes.</p>
      <p className="form-feedback" role="status">
        {message}
      </p>
      {detail ? (
        <>
          <h2>{detail.business_name}</h2>
          <p>
            {detail.service_name} · {detail.staff_name}
          </p>
          <p>
            {when(detail.starts_at)} — {when(detail.ends_at)} ({detail.timezone}
            )
          </p>
          <p>
            {new Intl.NumberFormat("es-AR", {
              style: "currency",
              currency: "ARS",
            }).format(detail.price_cents / 100)}{" "}
            · {detail.duration_minutes} min ·{" "}
            {detail.status === "confirmed" ? "Confirmado" : "Cancelado"}
          </p>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void run(refresh)}
          >
            Actualizar mi turno
          </Button>
          {detail.can_reschedule && (
            <form
              className="access-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(() => change("reschedule"));
              }}
            >
              <h3>Reprogramar</h3>
              <p>
                Se conservan profesional, servicio, precio y duración
                originales.
              </p>
              <label>
                Nueva fecha
                <input
                  aria-label="Nueva fecha pública"
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
                disabled={busy || !date}
                onClick={() =>
                  void run(async () => {
                    setPreview(
                      availabilitySchema.parse(
                        await publicFetch(
                          base,
                          path +
                            `/availability?${new URLSearchParams({ from: date, days: "1" })}`,
                        ),
                      ),
                    );
                    setSlot("");
                  })
                }
              >
                Buscar nuevo horario
              </Button>
              {preview && (
                <label>
                  Nuevo horario
                  <select
                    aria-label="Nuevo horario público"
                    required
                    value={slot}
                    onChange={(e) => setSlot(e.target.value)}
                  >
                    <option value="">Elegí un horario</option>
                    {preview.slots.map((s) => (
                      <option key={s.start} value={s.start}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <Button disabled={busy || !slot}>
                Confirmar cambio de horario
              </Button>
            </form>
          )}
          {detail.can_cancel && (
            <div className="access-form">
              <label>
                Motivo (opcional)
                <textarea
                  maxLength={500}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setConfirm((v) => !v)}
              >
                Cancelar mi turno
              </Button>
              {confirm && (
                <>
                  <p>Se conservará el registro y el horario quedará libre.</p>
                  <Button
                    disabled={busy}
                    onClick={() => void run(() => change("cancel"))}
                  >
                    Confirmar cancelación pública
                  </Button>
                </>
              )}
            </div>
          )}
          {!detail.can_cancel && detail.status === "confirmed" && (
            <p>
              La cancelación ya no está habilitada por las condiciones del
              negocio.
            </p>
          )}
        </>
      ) : (
        <p>
          Para consultar necesitás el enlace y su acceso válido. No busques un
          turno por teléfono o email.
        </p>
      )}
    </section>
  );
}
