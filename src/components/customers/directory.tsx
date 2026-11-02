"use client";
import { useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  customerPage,
  customerDetail,
  customerInput,
  type CustomerPage,
  type CustomerDetail,
} from "@/modules/customers/schemas";

type Filter = {
  state: "current" | "archived";
  field: "name" | "phone" | "email" | "instagram";
  value: string;
  mode: "prefix" | "exact";
};
const empty: Filter = {
  state: "current",
  field: "name",
  value: "",
  mode: "prefix",
};
export function CustomerDirectory({
  businessId,
  initial,
}: {
  businessId: string;
  initial: CustomerPage;
}) {
  const [result, setResult] = useState(initial),
    [filter, setFilter] = useState<Filter>(empty),
    [applied, setApplied] = useState<Filter>(empty),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const [selected, setSelected] = useState<CustomerDetail | null>(null),
    [editing, setEditing] = useState(false),
    [formEpoch, setFormEpoch] = useState(0);
  const intent = useRef<{ id: string; key: string; body: string } | null>(null),
    endpoint = `/api/v1/businesses/${businessId}/customers`;
  async function call(url: string, options?: RequestInit) {
    const response = await fetch(url, {
      ...options,
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const value = body as { title?: string };
      throw new Error(value.title ?? "No pudimos completar la operación.");
    }
    return body;
  }
  async function load(next: Filter, cursor: string | null = null) {
    const page = customerPage.parse(
      await call(`${endpoint}/search`, {
        method: "POST",
        body: JSON.stringify({
          ...next,
          value: next.value || null,
          cursor,
          limit: 50,
        }),
      }),
    );
    setResult(page);
    setApplied(next);
  }
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setMessage("");
    try {
      await task();
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
  async function open(id: string) {
    const detail = customerDetail.parse(await call(`${endpoint}/${id}`));
    setSelected(detail);
    setEditing(true);
    setFormEpoch((n) => n + 1);
    intent.current = null;
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await run(async () => {
      const input = customerInput.safeParse(
        Object.fromEntries(
          [
            "full_name",
            "phone_raw",
            "email",
            "instagram_handle",
            "private_notes",
          ].map((k) => [k, form.get(k) || null]),
        ),
      );
      if (!input.success)
        throw new Error("Revisá el nombre y el formato de los contactos.");
      const signature = JSON.stringify({
        data: input.data,
        version: selected?.version ?? null,
      });
      if (!intent.current || intent.current.body !== signature)
        intent.current = {
          id: selected?.id ?? crypto.randomUUID(),
          key: crypto.randomUUID(),
          body: signature,
        };
      const current = intent.current;
      await call(selected ? `${endpoint}/${selected.id}` : endpoint, {
        method: selected ? "PUT" : "POST",
        headers: {
          "Idempotency-Key": current.key,
          ...(selected ? { "If-Match": `"${selected.version}"` } : {}),
        },
        body: JSON.stringify(
          selected ? input.data : { id: current.id, data: input.data },
        ),
      });
      intent.current = null;
      await load(applied);
      setEditing(false);
      setSelected(null);
      setMessage(
        "Ficha guardada. Un contacto compartido puede aparecer en varias fichas.",
      );
    });
  }
  async function transition() {
    if (!selected) return;
    await run(async () => {
      const action = selected.deleted_at ? "restore" : "archive";
      const signature = JSON.stringify({
        action,
        id: selected.id,
        version: selected.version,
      });
      if (!intent.current || intent.current.body !== signature)
        intent.current = {
          id: selected.id,
          key: crypto.randomUUID(),
          body: signature,
        };
      await call(`${endpoint}/${selected.id}/${action}`, {
        method: "POST",
        headers: {
          "Idempotency-Key": intent.current.key,
          "If-Match": `"${selected.version}"`,
        },
        body: "{}",
      });
      setSelected(null);
      setEditing(false);
      intent.current = null;
      await load(applied);
      setMessage(
        action === "archive"
          ? "Ficha archivada. Los datos se conservan."
          : "Ficha restaurada.",
      );
    });
  }
  return (
    <>
      <form
        className="access-form product-card customer-search"
        onSubmit={(e) => {
          e.preventDefault();
          void run(() => load(filter));
        }}
        aria-label="Buscar clientes"
      >
        <div className="catalog-fields">
          <label>
            Buscar por
            <select
              value={filter.field}
              aria-label="Buscar por"
              onChange={(e) =>
                setFilter({
                  ...filter,
                  field: e.target.value as Filter["field"],
                })
              }
            >
              <option value="name">Nombre</option>
              <option value="phone">Teléfono</option>
              <option value="email">Email</option>
              <option value="instagram">Instagram</option>
            </select>
          </label>
          <label>
            Buscar
            <input
              name="search"
              value={filter.value}
              onChange={(e) => setFilter({ ...filter, value: e.target.value })}
              autoComplete="off"
              maxLength={254}
            />
          </label>
          <label>
            Estado
            <select
              value={filter.state}
              aria-label="Estado"
              onChange={(e) =>
                setFilter({
                  ...filter,
                  state: e.target.value as Filter["state"],
                })
              }
            >
              <option value="current">Actuales</option>
              <option value="archived">Archivados</option>
            </select>
          </label>
          <label>
            Coincidencia
            <select
              value={filter.mode}
              aria-label="Coincidencia"
              onChange={(e) =>
                setFilter({ ...filter, mode: e.target.value as Filter["mode"] })
              }
            >
              <option value="prefix">Empieza con</option>
              <option value="exact">Exacta</option>
            </select>
          </label>
        </div>
        <Button disabled={busy} type="submit">
          Buscar clientes
        </Button>
      </form>
      <p
        className="form-feedback customer-feedback"
        role="status"
        aria-live="polite"
      >
        {message}
      </p>
      <div className={editing ? "members-layout" : "customer-list-layout"}>
        <section>
          <div className="member-heading">
            <h2>
              {applied.state === "archived"
                ? "Clientes archivados"
                : "Clientes del negocio"}
            </h2>
            <Button
              disabled={busy}
              onClick={() => {
                setSelected(null);
                setEditing(true);
                setFormEpoch((n) => n + 1);
                intent.current = null;
              }}
            >
              Nuevo cliente
            </Button>
          </div>
          <div className="member-list">
            {result.data.map((c) => (
              <article className="product-card customer-card" key={c.id}>
                <h3>{c.full_name}</h3>
                <p className="field-hint">
                  {c.phone_raw ?? "Sin teléfono"}
                  {c.phone_status === "needs_review"
                    ? " · Formato pendiente de revisión"
                    : ""}
                </p>
                {c.email && <p className="field-hint">{c.email}</p>}
                {c.instagram_handle && (
                  <p className="field-hint">@{c.instagram_handle}</p>
                )}
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(() => open(c.id))}
                >
                  Abrir ficha
                </Button>
              </article>
            ))}
            {!result.data.length && (
              <div className="product-card">
                <h3>No hay clientes para mostrar</h3>
                <p>Agregá una ficha o cambiá los filtros de búsqueda.</p>
              </div>
            )}
          </div>
          <nav className="catalog-nav" aria-label="Páginas de clientes">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void run(() => load(applied))}
            >
              Primera página
            </Button>
            {result.page.has_more && (
              <Button
                disabled={busy}
                onClick={() =>
                  void run(() => load(applied, result.page.next_cursor))
                }
              >
                Ver más clientes
              </Button>
            )}
          </nav>
        </section>
        {editing && (
          <aside
            className="product-card invite-card"
            aria-label="Ficha de cliente"
          >
            <h2>{selected ? "Ficha de cliente" : "Nuevo cliente"}</h2>
            <p className="field-hint">
              Sólo el nombre es obligatorio. El teléfono declarado no acredita
              identidad ni autoriza marketing.
            </p>
            <form key={formEpoch} className="access-form" onSubmit={save}>
              <label>
                Nombre completo
                <input
                  name="full_name"
                  required
                  defaultValue={selected?.full_name}
                  disabled={Boolean(selected?.deleted_at)}
                />
              </label>
              <label>
                Teléfono
                <input
                  name="phone_raw"
                  type="tel"
                  defaultValue={selected?.phone_raw ?? ""}
                  maxLength={64}
                  disabled={Boolean(selected?.deleted_at)}
                  placeholder="+54… o número declarado"
                />
              </label>
              <label>
                Email
                <input
                  name="email"
                  defaultValue={selected?.email ?? ""}
                  maxLength={254}
                  disabled={Boolean(selected?.deleted_at)}
                />
              </label>
              <label>
                Instagram
                <input
                  name="instagram_handle"
                  defaultValue={selected?.instagram_handle ?? ""}
                  maxLength={31}
                  disabled={Boolean(selected?.deleted_at)}
                />
              </label>
              <label>
                Notas privadas
                <textarea
                  name="private_notes"
                  rows={4}
                  defaultValue={selected?.private_notes ?? ""}
                  disabled={Boolean(selected?.deleted_at)}
                />
              </label>
              <p className="field-hint">
                No ingreses información de salud ni otros datos sensibles.
                Archivar conserva la ficha; no elimina sus datos.
              </p>
              {!selected?.deleted_at && (
                <Button type="submit" disabled={busy}>
                  {busy ? "Guardando…" : "Guardar ficha"}
                </Button>
              )}
            </form>
            {selected && (
              <>
                <Button
                  className="catalog-state-form"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void run(() => open(selected.id))}
                >
                  Recargar ficha
                </Button>
                <Button
                  className="catalog-state-form"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void transition()}
                >
                  {selected.deleted_at ? "Restaurar ficha" : "Archivar ficha"}
                </Button>
              </>
            )}
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setEditing(false);
                setSelected(null);
              }}
            >
              Cerrar ficha
            </Button>
          </aside>
        )}
      </div>
    </>
  );
}
