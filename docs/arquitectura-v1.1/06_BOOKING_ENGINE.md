# 06 — Motor de reservas y disponibilidad

## 1. Principio rector: dos capas con roles distintos

| Capa                                                        | Rol                         | Garantía                                                                            |
| ----------------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------- |
| **Cálculo de slots** (módulo `scheduling`, TypeScript puro) | Mostrar opciones al usuario | **Informativa**: puede quedar desactualizada en milisegundos                        |
| **Creación/modificación** (funciones SQL + constraint)      | Decidir                     | **Autoritativa**: la BD rechaza lo inválido aunque el frontend, la API o GAS fallen |

La disponibilidad que ve el cliente nunca es suficiente para confirmar. Toda reserva pasa por `app.create_appointment_core`, invocada únicamente desde el _wrapper_ de su contexto verificado (§4.0).

## 2. Modelo de ocupación

- Rango ocupado de una reserva: `[starts_at, blocked_until)` donde `ends_at = starts_at + duration_minutes_snapshot` y `blocked_until = ends_at + buffer_minutes_snapshot`; ambos **derivados por la BD** y verificados por `CHECK` (doc 04 §3.13).
- Estados que ocupan: `pending`, `confirmed`, `completed`. No ocupan: `cancelled`, `expired`, `no_show` (el slot se libera, p. ej. para un cliente espontáneo tras la espera; por eso revertir un `no_show` puede entrar en conflicto, §4.5).
- Semiabierto `[)`: una reserva que termina a las 10:30 no choca con otra que empieza a las 10:30.
- Regla RN-04: el fin del servicio (`ends_at`) debe estar dentro de un intervalo laboral; el buffer puede extenderse más allá del cierre pero no solaparse con reservas/bloqueos.

## 3. Generación de slots (algoritmo)

Entradas: `business` (timezone, settings), `service` (duración, buffer), candidatos de profesional(es), rango de fechas, `now`.
Una sola consulta carga, para los profesionales candidatos y el rango: `working_hours` vigentes, `schedule_exceptions`, `time_blocks` que intersectan, reservas ocupantes que intersectan.

```text
function computeSlots(ctx, serviceId, staffSel, fromDate, toDate, now):
  candidates = staffEligible(serviceId, staffSel)      # activos, aceptan online, con staff_services
  result = {}
  for date in daysBetween(fromDate, toDate) in ctx.timezone:
    for staff in candidates:
      free = workIntervals(staff, date)                # ver §3.1  -> lista de [startUTC, endUTC)
      free = subtract(free, blocks(staff) ∪ blocks(business))
      busy = occupied(staff)                           # [starts_at, blocked_until) de reservas activas
      dur  = durationFor(staff, service); buf = bufferFor(service)
      for interval in free:
        for start in gridStarts(interval, ctx.slotInterval, ctx.timezone):
          end     = start + dur
          blocked = end + buf
          if end > interval.end:                continue       # RN-04
          if overlaps([start, blocked), busy):  continue
          if start < now + minNotice:           continue       # sólo clientes públicos
          if start > now + maxAdvance:          continue
          result[date][start].add(staff.id)
  return result  # staff "any": unión de profesionales por slot
```

### 3.1 `workIntervals(staff, date)` — resolución de jornada

Orden de precedencia (primero que aplica):

1. `schedule_exceptions` del **profesional** para `date`: `closed` → `[]`; `custom_hours` → esos intervalos.
2. `schedule_exceptions` del **negocio** para `date` (mismo criterio).
3. `working_hours` del profesional con `weekday = isoWeekday(date)` y `valid_from <= date <= valid_until|∞`.
   Convertir cada intervalo local `HH:mm` de `date` a instantes UTC **usando la zona del negocio sobre la fecha local** (nunca sumando 24 h al día anterior).

### 3.2 Grilla de inicios

`gridStarts` genera inicios alineados al reloj local (múltiplos de `slot_interval_minutes` desde 00:00), dentro de cada intervalo libre. Si un intervalo comienza a las 09:10 y el paso es 15, el primer inicio es 09:15. (Alternativa "empaquetar" desde el inicio del hueco queda como opción futura: reduce huecos muertos pero complica la UX.)

### 3.3 Cruce de descansos

Los descansos son **huecos** entre intervalos laborales; un servicio de 45 min a las 12:30 con descanso 13:00–14:00 falla `end > interval.end`. No hay lógica especial.

### 3.4 Zonas horarias y horario de verano

- Almacenamiento UTC; presentación en zona del negocio (`Intl`/Luxon con IANA).
- Argentina no usa DST hoy, pero el motor debe ser correcto para futuros tenants:
  - **Hueco de primavera** (hora inexistente, p. ej. 02:30): el inicio local inexistente se descarta; Luxon normaliza hacia adelante → se omite el slot si el instante resultante no coincide con la hora local pedida.
  - **Repetición de otoño** (hora ambigua): se usa la primera ocurrencia (offset mayor) y se documenta; los slots de la hora repetida se generan una sola vez.
  - La duración se mide en minutos **reales** (UTC), no en reloj local.
- Fechas de excepción y `valid_from/until` son `date` locales del negocio.
- Cambiar la zona horaria de un negocio con reservas futuras está **bloqueado** (requiere soporte).

### 3.5 Servicios por profesional

Sólo se consideran profesionales con fila en `staff_services`. Duración/precio efectivos = `override` si existe, si no los del servicio.

### 3.6 "Cualquier profesional"

- **Vista**: slot disponible si lo está ≥ 1 candidato.
- **Asignación (en BD)**: `app.create_appointment_core` recibe `staff_id = NULL` (vía el _wrapper_ del contexto) y elige entre candidatos **libres** ordenados por (a) menor cantidad de reservas ese día (equilibrio), (b) `sort_order`, (c) `id`. Se intenta cada candidato; si uno falla con `23P01`, se prueba el siguiente dentro de un bloque `BEGIN … EXCEPTION` por intento (§4.1). Si ninguno → `SLOT_TAKEN`.

## 4. Creación transaccional

### 4.0 Capas de funciones, identidad y errores

Cada contexto entra por una función propia que **construye un contexto verificado** (`app.ctx`) y delega en un núcleo que **ningún rol de API puede ejecutar**. Detalle de verificación por contexto: doc 08 §3.1; esquemas y privilegios: doc 04 §4.1.

| Función                                                        | Esquema        | `EXECUTE`                                      | Identidad (fuente)                                                                   | Fija en el contexto                                                                  |
| -------------------------------------------------------------- | -------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `api.create_appointment(p_business_id, …)`                     | `api`          | `authenticated`                                | `auth.uid()` → miembro activo del negocio → rol                                      | `actor_type='member'`, `source` ∈ (`admin`,`staff`)                                  |
| `app_internal.public_create_appointment(p_slug, …)`            | `app_internal` | `app_server`                                   | **slug → negocio** (resuelto en la BD); sin usuario                                  | `actor_type='customer'`, `source='public_web'`, `override=false` **no es parámetro** |
| `app_internal.integration_create_appointment(p_token_hash, …)` | `app_internal` | `app_server`                                   | credencial verificada por hash; **sólo `user_token`** con scope `appointments:write` | `actor_type='integration'`, miembro de la credencial                                 |
| `app.create_appointment_core(p_ctx app.ctx, …)`                | `app`          | _nadie_ (sólo los wrappers `SECURITY DEFINER`) | recibe el contexto ya verificado                                                     | —                                                                                    |

Todas las operaciones de escritura siguen este patrón (`transition`, `reschedule`, `cancel`, `adjust`, `merge_customers`, `upsert_mapping`…): wrapper por contexto + `*_core`.

**Idempotencia dentro de la misma transacción** (wrappers que reciben `p_idem_key`, `p_request_hash`): `INSERT INTO idempotency_keys … ON CONFLICT DO NOTHING`; si ya existía → devuelve la respuesta guardada (o `TS006` si el hash difiere). Una solicitud concurrente con la misma clave **espera** al commit de la primera (bloqueo del índice único) y obtiene el mismo resultado. La respuesta se guarda antes de confirmar.

**Catálogo de errores de base de datos** (el API los traduce, doc 05 §1.3):

| SQLSTATE | `code`                     | HTTP | Notas                                                                                                                               |
| -------- | -------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `TS001`  | `SLOT_TAKEN`               | 409  | `DETAIL`: `REVERT_CONFLICT` si surge al revertir                                                                                    |
| `TS002`  | `POLICY_VIOLATION`         | 422  | `DETAIL` = motivo (`MIN_NOTICE`, `OUTSIDE_WORKING_HOURS`, `BLOCKED`, `COMPLETION_TOO_EARLY`, `NO_SHOW_TOO_EARLY`, `REVERT_WINDOW`…) |
| `TS003`  | `INVALID_STATE_TRANSITION` | 409  |                                                                                                                                     |
| `TS004`  | `VERSION_CONFLICT`         | 412  | `DETAIL`: `current_version`                                                                                                         |
| `TS005`  | `NOT_FOUND`                | 404  | también «no es miembro del negocio» y recursos de otro tenant                                                                       |
| `TS006`  | `IDEMPOTENCY_KEY_REUSED`   | 409  |                                                                                                                                     |
| `TS007`  | `LINKED_SERVICE_RECORD`    | 409  | revertir `completed` con registro vinculado                                                                                         |
| `TS008`  | `DUPLICATE_RESOURCE`       | 409  |                                                                                                                                     |
| `TS009`  | `ALREADY_LINKED`           | 409  |                                                                                                                                     |
| `TS010`  | `MANAGE_LINK_EXPIRED`      | 410  |                                                                                                                                     |
| `TS011`  | `PRECONDITION_REQUIRED`    | 428  | falta `p_expected_version` donde es obligatoria                                                                                     |
| `TS012`  | `INSUFFICIENT_SCOPE`       | 403  | credencial sin scope / `service_key` intentando escribir                                                                            |
| `42501`  | `FORBIDDEN`                | 403  | miembro con rol insuficiente                                                                                                        |

### 4.1 Creación (`app.create_appointment_core`)

> **Nota de implementación (corrección)**: en PL/pgSQL **no existen** `SAVEPOINT`, `ROLLBACK TO` ni `COMMIT` dentro de funciones. La reversión parcial se obtiene con un bloque `BEGIN … EXCEPTION … END`, que Postgres ejecuta como **subtransacción implícita**: si se captura una excepción, se revierten **sólo** los cambios hechos dentro de ese bloque. Reglas de uso: (a) el bloque contiene **únicamente** la sentencia que puede fallar (`INSERT`/`UPDATE` sujeto a `EXCLUDE`); (b) las variables PL/pgSQL **no** se revierten (se reasignan explícitamente); (c) los bloques con `EXCEPTION` tienen costo, por eso se limitan a un intento por candidato; (d) `COMMIT`/`ROLLBACK` sólo existen en `PROCEDURE` invocados fuera de bloque de transacción y **no se usan** aquí: la atomicidad es la de la transacción del llamador (una llamada a la función = una transacción).

```plpgsql
CREATE FUNCTION app.create_appointment_core(
  p_ctx app.ctx, p_customer_id uuid, p_service_id uuid, p_staff_id uuid /* NULL = cualquiera */,
  p_starts_at timestamptz, p_override boolean, p_notes text)
RETURNS public.appointments
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_biz     uuid := p_ctx.business_id;          -- ÚNICA fuente del tenant
  v_cands   uuid[];  v_staff uuid;  v_appt public.appointments;
  v_reason  text;    v_last  text := 'SLOT_TAKEN';
BEGIN
  -- 1. Autorización efectiva (rol/scope/propiedad). Nada se confía de parámetros.
  PERFORM app.authorize(p_ctx, 'appointment.create', p_staff_id);        -- 42501 / TS012
  IF p_override THEN PERFORM app.authorize(p_ctx, 'appointment.override_policies', NULL); END IF;

  -- 2. Entidades dentro del tenant (si no existen → TS005, sin distinguir otro tenant)
  PERFORM app.assert_customer_active(v_biz, p_customer_id);
  PERFORM app.assert_service_active(v_biz, p_service_id);
  v_cands := app.eligible_staff(v_biz, p_service_id, p_staff_id, p_ctx.actor_type);   -- activos, habilitados
  IF coalesce(array_length(v_cands,1),0) = 0 THEN RAISE EXCEPTION USING ERRCODE='TS002', MESSAGE='STAFF_NOT_AVAILABLE'; END IF;

  -- 3. Lock determinista de TODOS los candidatos (orden por id ascendente) ANTES del bucle:
  --    serializa contra reservas, bloqueos y cambios de horario del mismo profesional
  --    y evita deadlocks entre transacciones con candidatos solapados.
  PERFORM 1 FROM public.staff_members
   WHERE business_id = v_biz AND id = ANY (v_cands) ORDER BY id FOR UPDATE;

  -- 4. Liberar holds vencidos de esos profesionales (mismo tenant)
  UPDATE public.appointments SET status = 'expired', expires_at = NULL
   WHERE business_id = v_biz AND staff_member_id = ANY (v_cands)
     AND status = 'pending' AND expires_at <= now();

  -- 5. Intentar candidatos en orden (menor carga del día, sort_order, id)
  FOR v_staff IN SELECT s FROM app.rank_candidates(v_biz, v_cands, p_starts_at) AS s LOOP
    v_reason := app.check_slot(v_biz, v_staff, p_service_id, p_starts_at, p_override, p_ctx.actor_type, NULL);
    IF v_reason IS NOT NULL THEN v_last := v_reason; CONTINUE; END IF;   -- lecturas puras: nada que revertir

    BEGIN                                           -- subtransacción implícita (NO es SAVEPOINT explícito)
      INSERT INTO public.appointments (business_id, customer_id, staff_member_id, service_id, starts_at, status,
             service_name_snapshot, price_cents_snapshot, currency, duration_minutes_snapshot, buffer_minutes_snapshot,
             source, created_by_member_id, customer_notes, expires_at, manage_token_hash, manage_token_expires_at /* … */)
      SELECT /* snapshot desde services/staff_services (override) con v_biz */ …
      RETURNING * INTO v_appt;                      -- ends_at / blocked_until los deriva el trigger
    EXCEPTION WHEN exclusion_violation THEN         -- 23P01: otro rango ocupa el slot
      v_appt := NULL;                               -- las variables no se revierten: se limpian a mano
      v_last := 'SLOT_TAKEN';
    END;
    EXIT WHEN v_appt.id IS NOT NULL;
  END LOOP;

  IF v_appt.id IS NULL THEN
    IF v_last = 'SLOT_TAKEN' THEN RAISE EXCEPTION USING ERRCODE='TS001', MESSAGE='SLOT_TAKEN';
    ELSE RAISE EXCEPTION USING ERRCODE='TS002', MESSAGE='POLICY_VIOLATION', DETAIL=v_last; END IF;
  END IF;

  -- 6. Efectos en la MISMA transacción (si algo falla aquí, se revierte todo, incluida la reserva)
  INSERT INTO public.appointment_events (business_id, appointment_id, event_type, to_status, actor_type, actor_id, payload)
       VALUES (v_biz, v_appt.id, 'created', v_appt.status, p_ctx.actor_type, coalesce(p_ctx.member_id, p_ctx.credential_id), '{}');
  PERFORM app.enqueue_notifications(v_appt, 'booking_created');
  RETURN v_appt;                                    -- los triggers escriben change_log
END $$;
```

Puntos de diseño:

- **`app.check_slot(...)`** devuelve `NULL` (ok) o un código (`OUTSIDE_WORKING_HOURS`, `BLOCKED`, `MIN_NOTICE`, `MAX_ADVANCE`, `SERVICE_NOT_OFFERED`, `STAFF_INACTIVE`, `MAX_ACTIVE_BOOKINGS`…). Es de **sólo lectura** y re-calcula todo desde las tablas (jornada con vigencias y excepciones, bloqueos, ocupación) en la zona del negocio. No depende de lo que mostró la UI.
- **Garantía por capas**: (1) lock por profesional serializa a los escritores que respetan el protocolo; (2) `check_slot` valida horarios, bloqueos y políticas bajo ese lock; (3) el `EXCLUDE` es el respaldo **duro** frente a cualquier escritor que no lo respete (import, bug). La captura de `exclusion_violation` convierte esa carrera residual en `SLOT_TAKEN` (o en probar el siguiente candidato).
- **«Cualquier profesional»**: como se bloquean todos los candidatos primero, dos solicitudes con candidatos solapados se serializan; la segunda ve la ocupación ya confirmada de la primera. Costo aceptable a esta escala (documentado en ADR-003).
- **Idempotencia y efectos**: el outbox (`notifications`), `appointment_events` y `change_log` forman parte de la misma transacción; **no hay efectos parciales**.
- **Reintentos de infraestructura**: `40P01` (deadlock) y `40001` se reintentan hasta 2 veces en la capa de API (con la misma `Idempotency-Key`); no deberían ocurrir con el orden de locks de §4.6.

### 4.2 Reprogramación (`app.reschedule_core`)

1. Autorización: `appointment.reschedule` (barbero: propia; cliente por token: política de cutoffs y `max_client_reschedules`).
2. Leer `staff_member_id` actual **sin lock**; bloquear en orden ascendente los profesionales **origen y destino** y **luego** la reserva `FOR UPDATE` (orden global: _profesionales → reserva_, §4.6). Re-leer: si el profesional de la reserva cambió entre medio → `TS004`.
3. Comparar `version` (si es obligatoria) → `TS004`; estado ∈ (`pending`,`confirmed`) → si no `TS003`.
4. `check_slot(..., p_exclude_appointment => id)` para el destino (la propia reserva no cuenta como ocupación).
5. `UPDATE … SET starts_at = p_new_start, staff_member_id = …, reschedule_count = reschedule_count + 1, manage_token_expires_at = …` **dentro de `BEGIN … EXCEPTION WHEN exclusion_violation THEN … TS001 END`**. Como es un único `UPDATE`, si falla la fila **conserva** su horario original; los derivados (`ends_at`, `blocked_until`) los recalcula el trigger.
6. Evento `rescheduled` con `{from:{starts_at,staff}, to:{…}}`; cancelar notificaciones pendientes de la reserva y re-encolar con `dedupe_key` que incluye `reschedule_count`.

### 4.3 Cancelación y liberación

`cancel_core`: lock de la reserva, versión, estado ∈ (`pending`,`confirmed`), política por actor (cliente: `cancellation_cutoff_hours`; staff/admin: libre). Cambia a `cancelled` (`cancelled_at`, `cancelled_by`, `cancel_reason`), evento, cancela recordatorios y encola aviso. Al salir del predicado del `EXCLUDE` el slot **queda libre de inmediato**. `app.recompute_customer_stats()` en la misma transacción (las canceladas por el cliente cuentan en `cancelled_count`).

### 4.4 Cambios de jornada y bloqueos con reservas existentes

`app.update_working_hours` y `app.create_time_block` toman el **lock del profesional**, verifican `If-Match` contra `staff_members.version`, **detectan** reservas afectadas y las devuelven (`affected_appointments`) sin cancelarlas (RN-09). `force=true` (admin, auditado) permite aplicar el cambio con conflictos pendientes de resolución humana.

### 4.5 Transiciones de estado y resultado de la atención (`app.transition_core`)

Secuencia fija:

1. `SELECT … FROM appointments WHERE business_id = ctx.business_id AND id = p_id FOR UPDATE` (no existe/otro tenant → `TS005`).
2. `app.authorize(ctx, 'appointment.' || action, appt.staff_member_id)` (barbero: sólo propias).
3. Versión: `p_expected_version IS NULL` ⇒ `TS011` salvo actor `customer` (token); distinta de la actual ⇒ `TS004` (con `current_version`).
4. Validar origen→destino (doc 02 §3) y **guarda temporal** (tabla siguiente) → `TS003` / `TS002`.
5. `UPDATE` de estado y campos de resultado (los `CHECK appt_outcome_fields` y `appt_cancel_fields` son la red de seguridad).
6. `app.recompute_customer_stats(customer_id)`; evento; outbox; `change_log` (trigger).

| Acción     | Origen                 | Actor                                            | Guarda temporal / reglas                                                                                                                                                                    | Efecto                                              |
| ---------- | ---------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `confirm`  | `pending`              | admin, barbero propio, integración (user_token)  | `expires_at > now()` (si venció → `TS003`/`expired`)                                                                                                                                        | `confirmed`, `expires_at=NULL`                      |
| `complete` | `confirmed`            | admin, barbero propio, integración (user_token)  | `now() ≥ starts_at − completion_early_minutes`; `completed_at = coalesce(p_when, now())` con `p_when ≤ now()` y `≥ starts_at − completion_early_minutes`                                    | `completed`, `completed_at`                         |
| `no_show`  | `confirmed`            | ídem                                             | `now() ≥ starts_at + no_show_grace_minutes`                                                                                                                                                 | `no_show`, `no_show_at = now()`; libera el slot     |
| `revert`   | `completed`, `no_show` | **admin/owner** (jamás barbero ni `service_key`) | motivo obligatorio; dentro de `revert_window_days` (después, sólo `owner`); si `completed` y hay `service_record` vinculado → `TS007` (primero `unlink`); si `no_show` → revalida ocupación | `confirmed`, **`completed_at = no_show_at = NULL`** |

Reglas adicionales:

- **Sin salto directo** `completed ↔ no_show`: se hace `revert` y luego la acción correcta (dos eventos auditados).
- **Revertir `no_show`**: el slot pudo ser reutilizado. La función bloquea al profesional (orden §4.6) y hace el `UPDATE` dentro de `BEGIN … EXCEPTION WHEN exclusion_violation THEN RAISE TS001 (DETAIL 'REVERT_CONFLICT')`; la reserva permanece `no_show`. Revertir `completed` no puede colisionar (ambos estados ocupan).
- **Contadores**: `recompute_customer_stats` recalcula `completed_count`, `no_show_count`, `cancelled_count`, `first_visit_at`, `last_visit_at` desde `appointments` (idempotente; coherente tras cualquier secuencia de reversiones).
- **Repetición**: marcar `completed` dos veces → `TS003`; el reintento de red con la misma `Idempotency-Key` devuelve la respuesta original.
- **`completed`/`no_show` en el futuro** nunca se permiten, ni siquiera a admin (no existe `override` para esta guarda).

### 4.6 Orden de locks (anti‑deadlock)

Orden global: **(1) filas de `staff_members` por `id` ascendente → (2) fila de `appointments`**. Quien necesite ambos (reprogramar, revertir `no_show`, reasignar, crear con candidatos) los toma en ese orden. Las transiciones que sólo **liberan** o mantienen ocupación (`cancel`, `complete`, `no_show`, `confirm`) bloquean únicamente la reserva (no esperan por profesionales, por lo que no cierran ciclos). El expirado oportunista (§4.1 paso 4) y el job `expire_pending` sólo actualizan reservas `pending` y usan `FOR UPDATE SKIP LOCKED` en el job.

### 4.7 Reservas temporales (futuro pago)

`pending` + `expires_at = now() + pending_hold_minutes` ocupa el slot. Confirmación de pago → `confirmed` (si `expires_at` ya pasó y el slot sigue libre, `confirm` revalida con lock). Vencida → `expired` (job + limpieza oportunista). Webhook de pago tardío sobre reserva `expired`: recrear con revalidación; si no hay lugar → reembolso/solicitud manual. **No se implementa en el MVP**; el modelo ya lo soporta.

## 5. Consultas de soporte

```sql
-- Ejemplo ilustrativo: ¿el rango cae dentro de la jornada del profesional?
-- (versión simplificada; la real resuelve precedencia de excepciones, vigencias y DST)
select exists (
  select 1 from working_hours w
  where w.staff_member_id = $1 and w.weekday = extract(isodow from ($2 at time zone $tz))::int
    and ($2 at time zone $tz)::date between w.valid_from and coalesce(w.valid_until,'infinity')
    and ($2 at time zone $tz)::time >= w.start_time
    and ($3 at time zone $tz)::time <= w.end_time
    and ($2 at time zone $tz)::date = ($3 at time zone $tz)::date
);
```

Rendimiento de disponibilidad: una consulta por rango (índices por `staff_member_id, starts_at` y GiST de bloqueos); caché de 15 s en público; la computación es O(profesionales × intervalos × slots) — trivial a esta escala.

## 6. Idempotencia y concurrencia en API

- `Idempotency-Key` evita doble creación por reintento de red/GAS y se resuelve **dentro de la misma transacción** que la operación (§4.0): requests concurrentes con la misma clave devuelven el mismo resultado.
- Dos solicitudes _distintas_ al mismo slot: una gana y la otra recibe `409 SLOT_TAKEN` (con 3 sugerencias cercanas calculadas **después** del fallo, en otra consulta).
- **Concurrencia optimista**: las modificaciones de staff/integración exigen `If-Match` (doc 05 §1.8). La función bloquea la fila, **compara la versión y recién entonces escribe**; desajuste ⇒ `412 VERSION_CONFLICT` sin efectos. Dos usuarios que actúan a la vez sobre la misma reserva se serializan por el lock de fila; el segundo obtiene `412` (si envió `If-Match`) o `409 INVALID_STATE_TRANSITION` (si es el cliente por token y la acción ya se aplicó).
- **Integridad temporal**: `ends_at` y `blocked_until` nunca provienen del cliente; los deriva la base de datos (doc 04 §3.13).

## 7. Escenarios de prueba (resumen; detalle en doc 11)

| #    | Escenario                                                                           | Resultado esperado                                           |
| ---- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| B-01 | Dos clientes reservan el mismo slot simultáneamente (50 hilos)                      | Exactamente 1 `201`, resto `409 SLOT_TAKEN`; 1 fila ocupante |
| B-02 | Reservas contiguas (10:00–10:30 y 10:30–11:00)                                      | Ambas OK (`[)`)                                              |
| B-03 | Solape parcial (10:15 con reserva 10:00–10:30)                                      | Rechazada                                                    |
| B-04 | Servicio que cruza un descanso                                                      | Rechazada (`OUTSIDE_WORKING_HOURS`)                          |
| B-05 | Servicio que termina exactamente al cierre                                          | Aceptada                                                     |
| B-06 | Buffer de 10 min: reserva 10:30 siguiente a servicio que termina 10:30 con buffer   | Rechazada hasta 10:40                                        |
| B-07 | Bloqueo creado entre consulta y confirmación                                        | Rechazada (`BLOCKED`)                                        |
| B-08 | Cancelar y reservar el slot liberado                                                | Aceptada, sin esperar jobs                                   |
| B-09 | `pending` vencida no purgada por job                                                | No bloquea; se marca `expired` oportunistamente              |
| B-10 | "Cualquier profesional" con A ocupado y B libre                                     | Se asigna B                                                  |
| B-11 | "Cualquier profesional" y ambos ocupan el slot en carrera con otra reserva          | `SLOT_TAKEN` sin asignación parcial                          |
| B-12 | Reprogramar a horario ocupado                                                       | Falla; el original intacto                                   |
| B-13 | Reprogramar a un horario que solapa con su propio rango original                    | Aceptada                                                     |
| B-14 | Cambio de jornada con reservas futuras fuera del nuevo horario                      | Se devuelven conflictos; no se cancelan                      |
| B-15 | Vacaciones (`time_blocks`) de 7 días                                                | Sin slots esos días                                          |
| B-16 | Feriado de negocio (`closed`) con profesional con horario normal                    | Sin slots                                                    |
| B-17 | `custom_hours` de profesional prevalece sobre negocio                               | Slots según profesional                                      |
| B-18 | Anticipación mínima 60 min a las 09:30 para slot 10:00                              | Excluido; 10:30 incluido                                     |
| B-19 | Ventana máxima 30 días                                                              | Slot día 31 excluido                                         |
| B-20 | Zona con DST: slot en hora inexistente                                              | No se genera                                                 |
| B-21 | Zona con DST: día de 23/25 h                                                        | Duraciones reales correctas                                  |
| B-22 | Servicio no habilitado para el profesional                                          | `SERVICE_NOT_OFFERED`                                        |
| B-23 | Profesional inactivo                                                                | Sin slots; creación manual rechazada                         |
| B-24 | Insert directo a `appointments` con rol `authenticated`                             | Denegado por privilegios                                     |
| B-25 | Reserva con `business_id` de otro tenant en `staff_id`                              | Falla FK compuesta                                           |
| B-26 | Mismo `Idempotency-Key` repetido                                                    | Misma respuesta; 1 sola fila                                 |
| B-27 | Precio del servicio cambia tras reservar                                            | Snapshot intacto                                             |
| B-28 | `completed` → revertir → `confirmed`                                                | Contadores consistentes                                      |
| B-29 | Propiedad: cambios de `working_hours` con vigencias adyacentes                      | Sin solapes ni huecos accidentales                           |
| B-30 | Property‑based: slots devueltos nunca solapan reservas/bloqueos ni salen de jornada | Invariante verdadero en 10 000 casos aleatorios              |

### 7.1 Pruebas de transacciones, rollback, asignación automática, identidad e integridad (nuevas, v1.1)

| #    | Escenario                                                                                                                                                                                           | Resultado esperado                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B-31 | 50 conexiones simultáneas reservan el mismo slot del mismo profesional                                                                                                                              | Exactamente 1 éxito; 49 `TS001`; 1 fila ocupante, 1 evento `created`, 1 juego de notificaciones (sin efectos parciales de los perdedores)                    |
| B-32 | «Cualquier profesional»: 4 profesionales, 20 slots, 200 solicitudes concurrentes                                                                                                                    | Exactamente 80 éxitos (4 por slot), 120 `TS001`; 0 solapes por profesional; 0 errores 500; asignación equilibrada (±1 por profesional en cada slot completo) |
| B-33 | **Rollback del bloque `EXCEPTION`**: trigger _sólo de prueba_ inserta, dentro de la misma transacción y antes del `INSERT` principal, una reserva conflictiva para el candidato 1 (provoca `23P01`) | La reserva se asigna al candidato 2; **la reserva conflictiva insertada por el trigger no persiste** (revertida con el sub-bloque); 1 sola fila nueva        |
| B-34 | Falla **después** del `INSERT` (trigger de prueba en `notifications` lanza error)                                                                                                                   | Toda la llamada revierte: 0 reservas, 0 eventos, 0 filas en `idempotency_keys`, contadores del cliente intactos                                              |
| B-35 | Candidato 1 rechazado por política (`BLOCKED`), candidato 2 libre                                                                                                                                   | Se reserva el 2; sin residuos del intento 1                                                                                                                  |
| B-36 | Ningún candidato válido: mezcla de `BLOCKED` y `SLOT_TAKEN`                                                                                                                                         | Error final coherente (`TS001` si el último motivo fue colisión, `TS002` con `DETAIL` en otro caso); 0 filas nuevas                                          |
| B-37 | 100 pares de reprogramaciones cruzadas + creaciones + expiración de `pending` durante 1 000 iteraciones                                                                                             | 0 deadlocks (`40P01`) con el orden de locks §4.6; si aparece alguno, el reintento (≤ 2) lo absorbe y se registra métrica                                     |
| B-38 | 20 solicitudes con la misma `Idempotency-Key` en paralelo                                                                                                                                           | 1 sola reserva; las 20 respuestas son idénticas                                                                                                              |
| B-39 | Misma clave con body distinto                                                                                                                                                                       | `TS006`/`409 IDEMPOTENCY_KEY_REUSED`                                                                                                                         |
| B-40 | Sub-bloque `EXCEPTION` en `reschedule`: destino ocupado                                                                                                                                             | `TS001`; la reserva conserva `starts_at`, `staff`, `reschedule_count`, `version` originales                                                                  |
| B-41 | Verificación de que el código **no** contiene `SAVEPOINT`/`ROLLBACK TO`/`COMMIT` en funciones PL/pgSQL                                                                                              | Test de catálogo/lint falla si aparecen en `pg_proc.prosrc` de `app`, `api`, `app_internal`                                                                  |
| B-42 | `INSERT` directo con `ends_at` inconsistente                                                                                                                                                        | El trigger lo corrige (se verifica el valor derivado); `UPDATE` directo que viole el `CHECK` es rechazado                                                    |
| B-43 | Cambiar `duration_minutes_snapshot` sin `app.adjust_appointment`                                                                                                                                    | Rechazado por `appointments_guard`                                                                                                                           |
| B-44 | `adjust_appointment` alarga la duración y choca con la reserva siguiente                                                                                                                            | `TS001`; sin cambios                                                                                                                                         |
| B-45 | `reschedule` cambia `starts_at`                                                                                                                                                                     | `ends_at` y `blocked_until` se actualizan coherentes; `CHECK` pasa                                                                                           |
| B-46 | `complete` antes de `starts_at − completion_early_minutes`                                                                                                                                          | `TS002 COMPLETION_TOO_EARLY`                                                                                                                                 |
| B-47 | `no_show` antes de `starts_at + no_show_grace_minutes`                                                                                                                                              | `TS002 NO_SHOW_TOO_EARLY`                                                                                                                                    |
| B-48 | `complete` con `completed_at` futuro                                                                                                                                                                | Rechazado                                                                                                                                                    |
| B-49 | `revert` de `no_show` cuyo slot fue reservado luego                                                                                                                                                 | `TS001 (REVERT_CONFLICT)`; sigue `no_show`                                                                                                                   |
| B-50 | `revert` de `completed` con `service_record` vinculado                                                                                                                                              | `TS007`; tras `unlink` explícito, `revert` OK                                                                                                                |
| B-51 | Secuencia `complete → revert → no_show → revert → complete`                                                                                                                                         | Estados y timestamps coherentes en cada paso (CHECK `appt_outcome_fields`); contadores del cliente = recomputados desde `appointments`                       |
| B-52 | Barbero intenta `revert`                                                                                                                                                                            | `42501`                                                                                                                                                      |
| B-53 | 2 `complete` simultáneos con `If-Match` igual                                                                                                                                                       | 1 × `200`, 1 × `412`; 1 evento `completed`                                                                                                                   |
| B-54 | `complete` simultáneo del barbero y `cancel` del cliente                                                                                                                                            | Se serializan; el segundo recibe `412`/`409` coherente con el estado final; sin estado intermedio inválido                                                   |
| B-55 | Llamar `api.create_appointment` con `p_business_id` de un negocio donde no se es miembro                                                                                                            | `TS005` → `404`                                                                                                                                              |
| B-56 | `app_internal.public_create_appointment` con slug de otro negocio y `staff_id` del primero                                                                                                          | Falla (`TS005`/FK compuesta); 0 filas                                                                                                                        |
