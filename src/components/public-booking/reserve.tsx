"use client";
import { useRef, useState } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import type { PublicCatalog } from "@/modules/businesses/public-catalog";
import {
  publicFetch,
  publicCommand,
  PublicClientError,
} from "@/modules/public-booking/client";
import {
  availabilitySchema,
  type PublicAvailability,
} from "@/modules/public-booking/schemas";
export function PublicReserve({ catalog }: { catalog: PublicCatalog }) {
  const slug = catalog.business.slug,
    base = `/api/v1/public/${slug}`;
  const [attempt, setAttempt] = useState<{
      id: string;
      privacy_policy_version: string | null;
      require_email: boolean;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [staff, setStaff] = useState(""),
    [service, setService] = useState(""),
    [date, setDate] = useState(""),
    [preview, setPreview] = useState<PublicAvailability | null>(null),
    [slot, setSlot] = useState(""),
    [locked, setLocked] = useState(false),
    [result, setResult] = useState<{ manage_url: string } | null>(null);
  const draft = useRef<{ body: unknown; id: string; key: string } | null>(null);
  const professional = catalog.professionals.find((p) => p.id === staff);
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
  async function begin() {
    const id = crypto.randomUUID();
    setAttempt(
      z
        .object({
          id: z.uuid(),
          privacy_policy_version: z.string().nullable(),
          require_email: z.boolean(),
        })
        .parse(await publicFetch(base, "/attempts", { id })),
    );
  }
  async function previewSlots() {
    setPreview(
      availabilitySchema.parse(
        await publicFetch(
          base,
          `/availability?${new URLSearchParams({ staff_id: staff, service_id: service, from: date, days: "1" })}`,
        ),
      ),
    );
    setSlot("");
  }
  async function submit(form: HTMLFormElement) {
    if (!attempt || !preview || !slot) return;
    if (!draft.current) {
      const fields = new FormData(form),
        id = crypto.randomUUID();
      draft.current = {
        id,
        key: crypto.randomUUID(),
        body: {
          id,
          attempt_id: attempt.id,
          staff_id: staff,
          service_id: service,
          starts_at: slot,
          quote_id: preview.quote_id,
          customer: {
            full_name: fields.get("full_name"),
            phone_raw: fields.get("phone_raw"),
            email: fields.get("email") || null,
            instagram_handle: null,
          },
          privacy_policy_version: attempt.privacy_policy_version,
        },
      };
    }
    setLocked(true);
    const pending = draft.current;
    try {
      const response = z
        .object({
          manage_url: z
            .string()
            .regex(/^\/b\/[a-z0-9-]+\/r\/[a-f0-9-]+#t=[A-Za-z0-9_-]{43}$/),
        })
        .parse(
          await publicCommand(
            base,
            "create",
            pending.id,
            "/appointments",
            pending.body,
            pending.key,
          ),
        );
      setResult(response);
      setMessage("Turno confirmado. Guardá el enlace de gestión.");
    } catch (error) {
      if (
        error instanceof PublicClientError &&
        [
          "VALIDATION_ERROR",
          "PRECONDITION_FAILED",
          "SLOT_TAKEN",
          "TIME_NOT_ALLOWED",
          "PUBLIC_CREATION_UNSUPPORTED",
        ].includes(error.code)
      ) {
        setLocked(false);
        draft.current = null;
      }
      throw error;
    }
  }
  return (
    <section className="product-card" id="reservar">
      <p className="product-eyebrow">RESERVA DE PRUEBA</p>
      <h2>Elegí tu próximo turno</h2>
      <p>
        Entorno descartable. Usá únicamente datos ficticios. No se enviarán
        mensajes.
      </p>
      <p className="form-feedback" role="status">
        {message}
      </p>
      {result ? (
        <>
          <p>
            Si perdés el enlace, el navegador y la cookie, esta prueba no
            permite recuperar el acceso automáticamente.
          </p>
          <a className="text-link" href={result.manage_url}>
            Abrir y guardar mi enlace de gestión
          </a>
        </>
      ) : !attempt ? (
        <Button disabled={busy} onClick={() => void run(begin)}>
          Comenzar reserva de prueba
        </Button>
      ) : (
        <>
          {!attempt.privacy_policy_version && (
            <p>
              El aviso de privacidad de prueba no está configurado. No se puede
              confirmar.
            </p>
          )}
          <details>
            <summary>Aviso de privacidad de prueba</summary>
            <p>
              Usá datos ficticios: se guardan sólo mientras exista este entorno
              descartable para probar la reserva y su gestión. No se envían
              mensajes ni se autoriza marketing. Un contacto declarado no
              acredita identidad o propiedad. Este aviso de prueba no habilita
              captar datos reales.
            </p>
          </details>
          <form
            className="access-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              void run(() => submit(form));
            }}
          >
            <fieldset disabled={busy || locked} className="access-form">
              <legend>Servicio y horario</legend>
              <label>
                Profesional
                <select
                  aria-label="Profesional público"
                  value={staff}
                  required
                  onChange={(e) => {
                    setStaff(e.target.value);
                    setService("");
                    setPreview(null);
                    setSlot("");
                  }}
                >
                  <option value="">Elegí un profesional</option>
                  {catalog.professionals.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.display_name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Servicio
                <select
                  aria-label="Servicio público"
                  value={service}
                  required
                  onChange={(e) => {
                    setService(e.target.value);
                    setPreview(null);
                    setSlot("");
                  }}
                >
                  <option value="">Elegí un servicio</option>
                  {professional?.services.map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Fecha
                <input
                  aria-label="Fecha pública"
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
                disabled={!service || !date}
                onClick={() => void run(previewSlots)}
              >
                Consultar horarios libres
              </Button>
              {preview && (
                <>
                  <p>
                    {new Intl.NumberFormat("es-AR", {
                      style: "currency",
                      currency: "ARS",
                    }).format(preview.price_cents / 100)}{" "}
                    · {preview.duration_minutes} min · Horarios de{" "}
                    {preview.timezone}
                  </p>
                  <label>
                    Horario
                    <select
                      aria-label="Horario público"
                      required
                      value={slot}
                      onChange={(e) => setSlot(e.target.value)}
                    >
                      <option value="">Elegí un horario libre</option>
                      {preview.slots.map((s) => (
                        <option key={s.start} value={s.start}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {preview.slots.length === 0 && (
                    <p>No hay horarios disponibles para ese día.</p>
                  )}
                </>
              )}
              <label>
                Nombre
                <input
                  name="full_name"
                  autoComplete="off"
                  required
                  maxLength={120}
                />
              </label>
              <label>
                Teléfono declarado
                <input
                  name="phone_raw"
                  type="tel"
                  autoComplete="off"
                  required
                  maxLength={64}
                />
              </label>
              <p className="field-hint">
                Un teléfono compartido no identifica a una persona ni demuestra
                su propiedad.
              </p>
              <label>
                {attempt.require_email ? "Email" : "Email (opcional)"}
                <input
                  name="email"
                  required={attempt.require_email}
                  type="email"
                  autoComplete="off"
                  maxLength={254}
                />
              </label>
              <label className="check-label">
                <input type="checkbox" required name="privacy" />
                Acepto usar datos ficticios y leí el aviso de prueba (
                {attempt.privacy_policy_version ?? "no disponible"}). Este
                registro no autoriza marketing.
              </label>
            </fieldset>
            {locked && (
              <p>
                Si no recibiste respuesta, reintentá esta misma confirmación; no
                generes otra reserva.
              </p>
            )}
            <Button disabled={busy || !slot || !attempt.privacy_policy_version}>
              {locked
                ? "Reintentar confirmación"
                : "Confirmar reserva de prueba"}
            </Button>
          </form>
        </>
      )}
    </section>
  );
}
