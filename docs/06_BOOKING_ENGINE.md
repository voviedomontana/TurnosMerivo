> Consolidación 2026-10-31: doc 14 incorporado. Propuestas P-xx y gates en
> [informe de consolidación](CONSOLIDATION_REPORT.md); esta edición no autoriza implementación.

> **Actualización de seguridad:** consultar `14_CORRECCIONES_CRITICAS.md` antes de implementar. Si existe contradicción, prevalecen esas correcciones.

# 06 — Motor de reservas y disponibilidad

## 1. Principio rector: dos capas con roles distintos

| Capa | Rol | Garantía |
|---|---|---|
| **Cálculo de slots** (módulo `scheduling`, TypeScript puro) | Mostrar opciones al usuario | **Informativa**: puede quedar desactualizada en milisegundos |
| **Creación/modificación** (funciones SQL + constraint) | Decidir | **Autoritativa**: la BD rechaza lo inválido aunque el frontend, la API o GAS fallen |

La disponibilidad que ve el cliente nunca es suficiente para confirmar. Toda mutación pasa por una operación autorizada de BD con contexto verificado; el núcleo privado no es una RPC abierta (doc 04 §4).

## 2. Modelo de ocupación

- Rango ocupado de una reserva: `[starts_at, blocked_until)` donde `blocked_until = starts_at + duración + buffer`.
- Estados futuros ocupantes: `pending`, `confirmed`. `completed` conserva historia. Propuesta **P-02 pendiente**: `no_show` también conserva rango histórico conforme a recomendación del doc 14; cancelación/expiración explícitas liberan. No implementar liberación por ausencia ni reutilización histórica arbitraria antes de cerrar P-02. Toda reversión revalida solapes bajo locks.
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
          if overlaps([start, blocked), busy ∪ blocks(staff) ∪ blocks(business)): continue
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
- **Asignación (en BD)**: selector staff nulo significa cualquiera. La preferencia sigue (a) menor carga del día, (b) sort_order, (c) id, pero **no** determina el orden de locks. Bloquear primero todos los candidatos afectados por orden `(business_id,staff_id)` y después elegir con datos revalidados (§4.0). Los intentos usan bloques `BEGIN ... EXCEPTION ... END`; capturar sólo conflictos esperados. No usar SAVEPOINT/ROLLBACK TO en funciones PL/pgSQL. Si ninguno es válido, SLOT_TAKEN sin efectos parciales.

## 4. Creación transaccional

### 4.0 Protocolo común de identidad y locks

- Operación de sesión: usuario desde `auth.uid()`, tenant selector validado por
  membresía activa y permiso. Público: slug/token; integración: credencial vigente;
  workers: filas reclamadas. El núcleo recibe un contexto **construido dentro de BD**,
  no un actor/rol/source arbitrarios de un body o header (doc 04 §4).
- Protocolo propuesto para cerrar P-03 antes de S5/S6: lock compartido del negocio
  para operaciones de un conjunto estable de profesionales; lock exclusivo del
  negocio para cambios globales o del conjunto de profesionales. Luego locks de
  filas de profesionales **siempre** por `(business_id,staff_id)` ascendente.
  Conjunto afectado completo antes de mutar; reprogramar bloquea origen y destino;
  cualquier profesional bloquea candidatos antes de ordenarlos por preferencia.
- Todas las rutas de escritura deben participar: crear, cambiar estado, cancelar,
  expirar holds (worker y oportunista), revertir, ajustar duración, importar,
  editar catálogo con impacto temporal, horarios, excepciones y bloqueos (también
  globales), activar/desactivar profesionales. No basta lockear sólo al reservar.
- Tras esos locks, tomar/volver a leer la reserva y su versión. Si cambió el
  profesional respecto de la lectura preliminar, abortar/reintentar la transacción
  con el conjunto correcto; nunca añadir locks fuera de orden. Revalidar membresía,
  catálogo y políticas después de locks. P-03 debe incluir orden de locks de
  recursos auxiliares para evitar ciclos con clientes/idempotencia/colas.
- `BEGIN ... EXCEPTION ... END` genera subtransacción; los locks tomados dentro de
  un bloque que falla se liberan. Adquirir locks de coordinación fuera del bloque
  de candidato. Errores 40P01/40001: reintento acotado de la **transacción completa**
  desde backend, con la misma Idempotency-Key. No hacer COMMIT dentro de funciones.

Pseudocódigo de diseño (no migración):

```text
operación pública(slug, payload validado, idempotency_key):
  ctx := resolver capacidad pública en BD; fijar source=public_web y override=false
  verificar autorización y reclamar key/hash (doc 05 §1.6)
  si replay autorizado exacto: devolverlo
  adquirir locks comunes P-03 antes de mutaciones
  releer negocio, servicio, candidatos y políticas en ctx.business_id
  para candidato en orden de preferencia, ya bloqueado:
    BEGIN (bloque con manejador de excepciones)
      expirar holds vencidos usando misma operación de transición/auditoría
      calcular snapshots y tiempos derivados; validar jornada, bloqueos y ocupación
      insertar reserva: EXCLUDE es respaldo final
      insertar evento, auditoría y outbox; guardar respuesta idempotente
      devolver resultado (commit pertenece a la transacción exterior)
    EXCEPTION sólo conflicto esperado de agenda:
      revertir efectos del candidato; continuar
    END
  si ninguno: abortar con SLOT_TAKEN
```

Mutación, versión, evento, auditoría, idempotencia y outbox se confirman o revierten
juntos en READ COMMITTED con el protocolo común probado. EXCLUDE no protege horarios
ni time_blocks: su consistencia depende de que **todas** las operaciones tomen locks.
No declarar garantía hasta aprobar P-02/P-03 y ejecutar pruebas con conexiones distintas.


### 4.1 Reprogramación (`app.reschedule_appointment`)
Misma validación de identidad, políticas, jornada y bloqueos de §4 sobre el nuevo destino, excluyendo la propia reserva; luego actualización condicional por tenant/id/version sobre `starts_at`, profesional y contador **en la misma fila**; derivar ends_at/blocked_until mediante trigger e incrementar version una sola vez. El `EXCLUDE` ignora la fila que se actualiza contra sí misma; si el destino falla, la transacción revierte y la reserva conserva su horario. Eventos: `rescheduled` con `{from, to}`; notificaciones pendientes se cancelan (`status='cancelled'`) y se re‑encolan con `dedupe_key` que incluye `reschedule_count`. Política de cliente: `reschedule_cutoff_hours` y `max_client_reschedules`.

### 4.2 Cancelación y liberación
`cancel_appointment` cambia estado (`cancelled`), registra `cancelled_by`, `cancel_reason`, evento, cancela recordatorios y encola aviso. Al salir del predicado del `EXCLUDE`, el slot **queda libre inmediatamente** (sin job). Contadores de cliente recalculados desde el estado final en la misma transacción, con el criterio funcional existente de cancelación por cliente; reintentos no duplican contadores.

### 4.3 Cambios de jornada y bloqueos con reservas existentes
- Toda modificación de working_hours, excepciones o time_blocks (profesional o negocio) toma el conjunto de locks de §4.0, **detecta** reservas afectadas y las devuelve (`affected_appointments`). No se cancelan automáticamente (RN-09). El admin puede reprogramarlas, cancelarlas o mantenerlas explícitamente (`force=true`, auditado).

### 4.4 Reservas temporales (futuro pago)
`pending` + `expires_at = now() + pending_hold_minutes` ocupa el slot. Confirmación de pago → `confirmed` (si `expires_at` ya pasó y el slot sigue libre, `confirm` revalida). Vencida → `expired` (job + limpieza oportunista de §4). Webhook de pago tardío sobre reserva `expired`: intentar re‑crear con revalidación; si no hay lugar → reembolso/solicitud manual. **No se implementa en el MVP**, el modelo ya lo soporta.

### 4.5 Transiciones de estado

Operación de transición con contexto verificado, id de recurso, acción, versión
esperada y motivo; ningún parámetro `actor` sirve como autoridad. Bajo §4.0 validar
estado, rol/propiedad, políticas y versión, ejecutar update condicional, evento,
auditoría y outbox; recalcular contadores desde reservas para evitar deriva.
`completed_at`/`no_show_at` deben corresponder a su estado, no coexistir ni estar en
el futuro. Conservar los límites de completar 30 min antes y ausente 10 min después
de doc 02, hasta que producto apruebe otros parámetros; no inventar nuevas ventanas.

Revertir exige admin y motivo, limpia campos del resultado revertido, registra
valores anteriores y revalida EXCLUDE/locks. Un conflicto de slot retorna 409 y
revierte toda la operación; una versión vieja retorna 412. No liberar historia por
un cambio de estado sin cerrar P-02. P-02 debe definir cómo se corrige un turno
terminado/no_show registrado erróneamente sin permitir dobles reservas.


## 5. Consultas de soporte

```text
withinWorkingHours(ctx, staffId, startUTC, endUTC):
  exigir referencia (ctx.business_id, staffId) autorizada
  resolver fecha local, vigencias, precedencia de excepciones y DST
  comprobar que inicio y fin del servicio pertenecen al mismo intervalo laboral
```


Rendimiento de disponibilidad: una consulta por rango (índices por `staff_member_id, starts_at` y GiST de bloqueos); caché de 15 s en público; la computación es O(profesionales × intervalos × slots) — trivial a esta escala.

## 6. Idempotencia y concurrencia en API

Aplicar doc 05 §1.6: If-Match requerido (428), versión desactualizada (412), conflicto de negocio (409); update condicional, resultado idempotente y efectos en una transacción. Un reintento con payload/precondición diferente no reutiliza resultado.
`Idempotency-Key` evita doble creación por reintento de red/GAS. Dos solicitudes *distintas* al mismo slot: una gana, la otra recibe `409 SLOT_TAKEN` (con 3 sugerencias cercanas calculadas post‑fallo).

## 7. Escenarios de prueba (resumen; detalle en doc 11)

| # | Escenario | Resultado esperado |
|---|---|---|
| B-01 | Dos clientes reservan el mismo slot simultáneamente (50 hilos) | Exactamente 1 `201`, resto `409 SLOT_TAKEN`; 1 fila ocupante |
| B-02 | Reservas contiguas (10:00–10:30 y 10:30–11:00) | Ambas OK (`[)`) |
| B-03 | Solape parcial (10:15 con reserva 10:00–10:30) | Rechazada |
| B-04 | Servicio que cruza un descanso | Rechazada (`OUTSIDE_WORKING_HOURS`) |
| B-05 | Servicio que termina exactamente al cierre | Aceptada |
| B-06 | Buffer de 10 min: reserva 10:30 siguiente a servicio que termina 10:30 con buffer | Rechazada hasta 10:40 |
| B-07 | Bloqueo creado entre consulta y confirmación | Rechazada (`BLOCKED`) |
| B-08 | Cancelar y reservar el slot liberado | Aceptada, sin esperar jobs |
| B-09 | `pending` vencida no purgada por job | No bloquea; se marca `expired` oportunistamente |
| B-10 | "Cualquier profesional" con A ocupado y B libre | Se asigna B |
| B-11 | "Cualquier profesional" y ambos ocupan el slot en carrera con otra reserva | `SLOT_TAKEN` sin asignación parcial |
| B-12 | Reprogramar a horario ocupado | Falla; el original intacto |
| B-13 | Reprogramar a un horario que solapa con su propio rango original | Aceptada |
| B-14 | Cambio de jornada con reservas futuras fuera del nuevo horario | Se devuelven conflictos; no se cancelan |
| B-15 | Vacaciones (`time_blocks`) de 7 días | Sin slots esos días |
| B-16 | Feriado de negocio (`closed`) con profesional con horario normal | Sin slots |
| B-17 | `custom_hours` de profesional prevalece sobre negocio | Slots según profesional |
| B-18 | Anticipación mínima 60 min a las 09:30 para slot 10:00 | Excluido; 10:30 incluido |
| B-19 | Ventana máxima 30 días | Slot día 31 excluido |
| B-20 | Zona con DST: slot en hora inexistente | No se genera |
| B-21 | Zona con DST: día de 23/25 h | Duraciones reales correctas |
| B-22 | Servicio no habilitado para el profesional | `SERVICE_NOT_OFFERED` |
| B-23 | Profesional inactivo | Sin slots; creación manual rechazada |
| B-24 | Insert directo a `appointments` con rol `authenticated` | Denegado por privilegios |
| B-25 | Reserva con `business_id` de otro tenant en `staff_id` | Falla FK compuesta |
| B-26 | Mismo `Idempotency-Key` repetido | Misma respuesta; 1 sola fila |
| B-27 | Precio del servicio cambia tras reservar | Snapshot intacto |
| B-28 | completed/no_show → revertir → confirmed bajo P-02 aprobado | Contadores/fechas consistentes; conflicto histórico no crea superposición |
| B-29 | Propiedad: cambios de `working_hours` con vigencias adyacentes | Sin solapes ni huecos accidentales |
| B-30 | Property‑based: slots devueltos nunca solapan reservas/bloqueos ni salen de jornada | Invariante verdadero en 10 000 casos aleatorios |
