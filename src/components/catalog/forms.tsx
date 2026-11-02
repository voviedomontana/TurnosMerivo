"use client";
import { useActionState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  saveServiceAction,
  saveStaffAction,
  catalogStateAction,
  type CatalogActionState,
} from "@/modules/services/actions";
import type { ServiceRecord } from "@/modules/services/schemas";
import type { StaffRecord } from "@/modules/staff/schemas";
type Base = {
  businessId: string;
  id: string;
  requestKey: string;
  version?: number;
};
function Hidden({ businessId, id, requestKey, version }: Base) {
  return (
    <>
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="key" value={requestKey} />
      <input
        type="hidden"
        name="action"
        value={version ? "update" : "create"}
      />
      {version && <input type="hidden" name="version" value={version} />}
    </>
  );
}
function Feedback({ state }: { state: CatalogActionState }) {
  return state.message ? (
    <p className="form-feedback" role="status">
      {state.message}
    </p>
  ) : null;
}
export function ServiceForm(props: Base & { service?: ServiceRecord }) {
  const [state, action, pending] = useActionState(saveServiceAction, {}),
    ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success && !props.version) ref.current?.reset();
  }, [state, props.version]);
  const s = props.service;
  return (
    <form ref={ref} action={action} className="access-form">
      <Hidden {...props} />
      <label>
        Nombre del servicio
        <input name="name" required maxLength={100} defaultValue={s?.name} />
      </label>
      <label>
        Descripción
        <textarea
          name="description"
          maxLength={1000}
          rows={2}
          defaultValue={s?.description ?? ""}
        />
      </label>
      <label>
        Categoría
        <input
          name="category"
          maxLength={100}
          defaultValue={s?.category ?? ""}
        />
      </label>
      <div className="catalog-fields">
        <label>
          Precio (ARS)
          <input
            name="price"
            inputMode="decimal"
            required
            placeholder="0,00"
            defaultValue={s ? (s.price_cents / 100).toFixed(2) : ""}
          />
        </label>
        <label>
          Duración (minutos)
          <input
            name="duration_minutes"
            type="number"
            min={5}
            max={480}
            required
            defaultValue={s?.duration_minutes ?? 30}
          />
        </label>
      </div>
      <div className="catalog-fields">
        <label>
          Tiempo posterior (minutos)
          <input
            name="buffer_minutes"
            type="number"
            min={0}
            max={120}
            required
            defaultValue={s?.buffer_minutes ?? 0}
          />
        </label>
        <label>
          Orden
          <input
            name="sort_order"
            type="number"
            min={0}
            max={10000}
            required
            defaultValue={s?.sort_order ?? 0}
          />
        </label>
      </div>
      <label className="check-label">
        <input
          name="active"
          type="checkbox"
          defaultChecked={s?.active ?? true}
        />
        Servicio activo
      </label>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "Guardando…" : s ? "Guardar servicio" : "Crear servicio"}
      </Button>
    </form>
  );
}
type Assignment = {
  staff_member_id: string;
  service_id: string;
  price_override_cents: number | null;
  duration_override_minutes: number | null;
};
export function StaffForm(
  props: Base & {
    staff?: StaffRecord;
    services: ServiceRecord[];
    assignments: Assignment[];
    members: {
      id: string;
      email: string;
      status: string;
      user_id: string | null;
    }[];
  },
) {
  const [state, action, pending] = useActionState(saveStaffAction, {}),
    ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state.success && !props.version) ref.current?.reset();
  }, [state, props.version]);
  const s = props.staff,
    selected = props.assignments.filter((a) => a.staff_member_id === props.id);
  const eligible = props.members.filter(
    (m) =>
      m.user_id !== null && (m.status === "active" || m.id === s?.member_id),
  );
  return (
    <form ref={ref} action={action} className="access-form">
      <Hidden {...props} />
      <label>
        Nombre del profesional
        <input
          name="display_name"
          required
          maxLength={100}
          defaultValue={s?.display_name}
        />
      </label>
      <label>
        Presentación
        <textarea
          name="bio"
          maxLength={1000}
          rows={2}
          defaultValue={s?.bio ?? ""}
        />
      </label>
      <label>
        Cuenta de acceso (opcional)
        <select name="member_id" defaultValue={s?.member_id ?? ""}>
          <option value="">Sin cuenta vinculada</option>
          {eligible.map((m) => (
            <option key={m.id} value={m.id}>
              {m.email}
              {m.status !== "active" ? " · Acceso suspendido" : ""}
            </option>
          ))}
        </select>
      </label>
      <p className="field-hint">
        Podés crear el perfil sin una cuenta. Vincular una cuenta no cambia sus
        permisos.
      </p>
      <label>
        Orden
        <input
          name="sort_order"
          type="number"
          min={0}
          max={10000}
          defaultValue={s?.sort_order ?? 0}
        />
      </label>
      <label className="check-label">
        <input
          name="active"
          type="checkbox"
          defaultChecked={s?.active ?? true}
        />
        Profesional activo
      </label>
      <label className="check-label">
        <input
          name="accepts_online"
          type="checkbox"
          defaultChecked={s?.accepts_online ?? true}
        />
        Habilitar para futuras reservas online
      </label>
      <fieldset className="catalog-assignments">
        <legend>Servicios habilitados</legend>
        {props.services
          .filter(
            (service) =>
              !service.deleted_at ||
              selected.some((a) => a.service_id === service.id),
          )
          .map((service) => {
            const link = selected.find((a) => a.service_id === service.id);
            if (service.deleted_at)
              return (
                <div className="field-hint" key={service.id}>
                  {service.name} · Archivado, vínculo conservado
                  <input type="hidden" name="service_ids" value={service.id} />
                  <input
                    type="hidden"
                    name={`price_${service.id}`}
                    value={
                      link?.price_override_cents == null
                        ? ""
                        : (link.price_override_cents / 100).toFixed(2)
                    }
                  />
                  <input
                    type="hidden"
                    name={`duration_${service.id}`}
                    value={link?.duration_override_minutes ?? ""}
                  />
                </div>
              );
            return (
              <div className="catalog-assignment" key={service.id}>
                <label className="check-label">
                  <input
                    type="checkbox"
                    name="service_ids"
                    value={service.id}
                    defaultChecked={Boolean(link)}
                  />
                  {service.name}
                  {!service.active ? " · Inactivo" : ""}
                </label>
                <div className="catalog-fields">
                  <label>
                    Precio especial (ARS)
                    <input
                      name={`price_${service.id}`}
                      inputMode="decimal"
                      placeholder="Usar precio del servicio"
                      defaultValue={
                        link?.price_override_cents == null
                          ? ""
                          : (link.price_override_cents / 100).toFixed(2)
                      }
                    />
                  </label>
                  <label>
                    Duración especial (min)
                    <input
                      name={`duration_${service.id}`}
                      type="number"
                      min={5}
                      max={480}
                      placeholder="Usar duración del servicio"
                      defaultValue={link?.duration_override_minutes ?? ""}
                    />
                  </label>
                </div>
              </div>
            );
          })}
        {!props.services.some((service) => !service.deleted_at) && (
          <p className="field-hint">
            Creá un servicio para habilitarlo en este perfil.
          </p>
        )}
      </fieldset>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>
        {pending
          ? "Guardando…"
          : s
            ? "Guardar profesional"
            : "Crear profesional"}
      </Button>
    </form>
  );
}
export function CatalogStateForm(
  props: Base & { kind: "staff" | "service"; archived: boolean },
) {
  const [state, action, pending] = useActionState(catalogStateAction, {});
  return (
    <form action={action} className="access-form catalog-state-form">
      <input type="hidden" name="businessId" value={props.businessId} />
      <input type="hidden" name="id" value={props.id} />
      <input type="hidden" name="key" value={props.requestKey} />
      <input type="hidden" name="version" value={props.version} />
      <input type="hidden" name="kind" value={props.kind} />
      <input
        type="hidden"
        name="action"
        value={props.archived ? "restore" : "archive"}
      />
      {!props.archived && (
        <p className="field-hint">
          Archivar conserva el perfil y sus vínculos. No cancela turnos.
        </p>
      )}
      <Feedback state={state} />
      <Button variant="outline" type="submit" disabled={pending}>
        {props.archived ? "Restaurar" : "Archivar"}
      </Button>
    </form>
  );
}
