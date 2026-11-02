> Consolidación 2026-10-31: doc 14 incorporado. Propuestas P-xx y gates en
> [informe de consolidación](CONSOLIDATION_REPORT.md); esta edición no autoriza implementación.

# 02 — Requisitos funcionales y reglas de negocio

Convención: `RF-xx` requisito funcional, `RN-xx` regla de negocio. Prioridad: **M** = MVP, **D** = diferido.

## 1. Reglas de negocio transversales

| ID | Regla |
|----|-------|
| RN-01 | Todo dato de negocio pertenece a exactamente un `business_id`. Ninguna operación cruza tenants. |
| RN-02 | Todos los instantes se guardan en UTC (`timestamptz`). Los horarios laborales se guardan como hora local + zona del negocio y se resuelven a UTC al generar disponibilidad. |
| RN-03 | Un profesional no puede tener dos reservas activas (`pending`, `confirmed`, `completed`; inclusión histórica de `no_show` propuesta P-02, pendiente de aprobación antes de S3/S6) cuyos rangos ocupados se superpongan. Rango ocupado = `[starts_at, starts_at + duración + buffer)`. |
| RN-04 | El final del **servicio** debe caer dentro de un intervalo laboral; el **buffer** posterior puede exceder el cierre pero no puede chocar con otra reserva o bloqueo. |
| RN-05 | Un servicio no puede cruzar un descanso (los descansos son huecos entre intervalos laborales). |
| RN-06 | Precio, duración, buffer y nombre del servicio se **copian** a la reserva al crearla (snapshot) y no cambian si el catálogo cambia. |
| RN-07 | Baja lógica (`deleted_at`) para profesionales, servicios y clientes. Nunca se borran filas referenciadas por reservas. |
| RN-08 | Los cambios de estado se registran en `appointment_events` (append‑only) y las acciones sensibles en `audit_logs`. |
| RN-09 | Cambiar horarios laborales **no cancela** reservas existentes; el sistema informa conflictos y el admin decide. |
| RN-10 | Anticipación mínima y ventana máxima aplican a clientes públicos; admin/barbero pueden saltearlas explícitamente (`override_policies=true`), quedando auditado. |
| RN-11 | Reservar es posible sin cuenta. El cliente gestiona su reserva mediante un **token de gestión** por reserva, reutilizable hasta vencimiento o revocación (doc 08 §2); no es un token de un solo uso (alta entropía, guardado hasheado). |
| RN-12 | Las operaciones de creación y cambio de estado son **idempotentes** mediante `Idempotency-Key`. |

## 2. Políticas configurables por negocio (`business_settings`)

| Parámetro | Default | Descripción |
|-----------|---------|-------------|
| `slot_interval_minutes` | 15 | Grilla de inicio de turnos (5, 10, 15, 20, 30, 60). |
| `min_notice_minutes` | 60 | Anticipación mínima para reservar online. |
| `max_advance_days` | 30 | Ventana máxima de reserva. |
| `cancellation_cutoff_hours` | 2 | Límite para que el cliente cancele sin intervención. |
| `reschedule_cutoff_hours` | 2 | Límite para reprogramar. |
| `max_client_reschedules` | 2 | Reprogramaciones permitidas al cliente. |
| `auto_confirm` | true | Si false, reservas públicas entran `pending` hasta confirmación. |
| `pending_hold_minutes` | 10 | TTL de `pending` cuando exige confirmación/pago (D). |
| `allow_any_staff` | true | Permite "cualquier profesional". |
| `require_email` | false | Email obligatorio. Teléfono siempre obligatorio. |
| `reminder_offsets_minutes` | {1440,120} | Recordatorios previos. |
| `max_active_bookings_per_customer` | 3 | Anti‑abuso. |

## 3. Máquina de estados de reservas

Estados: `pending`, `confirmed`, `cancelled`, `completed`, `no_show`, `expired`.
"Reprogramado" **no es un estado**: es un evento (`rescheduled`) sobre la misma reserva (ADR-006).

```mermaid
stateDiagram-v2
    [*] --> pending: crear (requiere confirmación)
    [*] --> confirmed: crear (auto_confirm / admin)
    pending --> confirmed: confirmar
    pending --> cancelled: cancelar
    pending --> expired: vence expires_at
    confirmed --> cancelled: cancelar
    confirmed --> completed: completar
    confirmed --> no_show: marcar ausencia
    confirmed --> confirmed: reprogramar
    pending --> pending: reprogramar
    no_show --> confirmed: revertir (admin, auditado)
    completed --> confirmed: revertir (admin, auditado)
    cancelled --> [*]
    expired --> [*]
```

| Desde | Hacia | Actor permitido | Condiciones |
|-------|-------|-----------------|-------------|
| (nuevo) | pending | público, admin | `auto_confirm=false` o reserva con pago pendiente |
| (nuevo) | confirmed | público (auto), admin, barbero*, integración | slot válido |
| pending | confirmed | admin, barbero, sistema (pago) | no expirada |
| pending/confirmed | cancelled | cliente (dentro de política), admin, barbero*, integración | `starts_at > now()` salvo admin |
| pending | expired | sistema | `expires_at <= now()` |
| confirmed | completed | admin, barbero asignado, integración | `now() >= starts_at - 30 min` (configurable) |
| confirmed | no_show | admin, barbero asignado, integración | `now() >= starts_at + 10 min` |
| completed/no_show | confirmed | admin | motivo obligatorio; auditado |
| cancelled/expired | cualquiera | — | **terminales** |

\* Barbero: sólo sobre reservas propias y según permisos del negocio.

Al violar una transición: `409 INVALID_STATE_TRANSITION`. Toda integración de escritura requiere `user_token` de Modo A validado, scope y permiso del miembro vigente; `service_key` nunca escribe.

**Ocupación histórica P-02**: doc 14 recomienda conservar el rango de `completed` y `no_show`, sin reutilización histórica arbitraria. Se propone incluir `no_show` en el predicado ocupante; falta aprobación de producto antes de S3/S6. Hasta entonces no implementar liberación por ausencia. Toda reversión revalida solapes bajo lock; no puede causar superposición.

## 4. Requisitos funcionales por módulo

### A. Negocios (M)
- RF-A1: Crear/editar negocio: nombre, `slug` único e inmutable salvo cambio explícito (redirecciones D), logo, dirección, teléfono, zona horaria (validada contra IANA), configuración.
- RF-A2: Página pública sólo si `public_booking_enabled` y `status='active'`.
- RF-A3: En el MVP el negocio se crea por seed/script de plataforma, no por self‑service (D).

### B. Profesionales (M)
- RF-B1: Alta, edición, baja lógica, activo/inactivo, color de agenda, orden.
- RF-B2: Un profesional puede vincularse a un `business_member` (para login) o existir sin usuario (sólo agendable).
- RF-B3: Servicios habilitados (`staff_services`) con override opcional de precio y duración.
- RF-B4: Desactivar un profesional **no cancela** reservas futuras: el sistema las lista y exige decisión del admin (reasignar/cancelar).
- RN-B1: Al reasignar una reserva a otro profesional se revalida disponibilidad completa (misma función transaccional).

### C. Servicios (M)
- RF-C1: Nombre, descripción, precio (entero en centavos), duración (5–480 min, múltiplo del paso de grilla recomendado), buffer posterior, categoría (texto en MVP), activo.
- RF-C2: Un servicio sin profesionales habilitados no se muestra públicamente.

### D. Disponibilidad (M)
- RF-D1: Jornada semanal por profesional con **múltiples intervalos por día** (turno cortado/descanso).
- RF-D2: Vigencia (`valid_from`, `valid_until`) para cambios de jornada sin perder historial.
- RF-D3: Excepciones por fecha (cierre total, horario especial, feriado de negocio o individual).
- RF-D4: Bloqueos por rango absoluto (vacaciones, trámite, manual) por profesional o para todo el negocio.
- RF-D5: Consulta de slots por fecha(s), servicio y profesional o "cualquiera".
- Detalle algorítmico en `06`.

### E. Reservas públicas (M)
Flujo: negocio → servicio → profesional/cualquiera → fecha → horario → datos → confirmar → pantalla + email con enlace de gestión.
- RF-E1: Datos obligatorios: nombre, teléfono (validado y normalizado). Email opcional salvo política.
- RF-E2: Aceptación de política de privacidad/consentimiento (checkbox con versión registrada).
- RF-E3: Si el horario fue tomado entre selección y confirmación: error `SLOT_TAKEN` + sugerencia de 3 horarios cercanos.
- RF-E4: **Reserva sin autenticación obligatoria**: decisión recomendada (ADR‑012). Mitigaciones: rate limit, Turnstile, límite de reservas activas por teléfono, token de gestión, confirmación por email.
- RF-E5: Cancelar/reprogramar desde el enlace de gestión según políticas (cutoffs, máximo de reprogramaciones).

### F. Gestión de reservas (M)
- RF-F1: Estados y transiciones de la sección 3.
- RF-F2: Creación manual (admin/barbero) con cliente existente o nuevo, saltando políticas con `override_policies`.
- RF-F3: Cancelación con motivo; quién canceló (`customer|staff|system`).
- RF-F4: Reprogramación mantiene el ID, incrementa `reschedule_count`, registra evento con valores previos.

### G. Clientes (M)
- RF-G1: Alta automática al reservar (búsqueda por teléfono normalizado dentro del negocio).
- RF-G2: Campos: nombre, teléfono, email, Instagram (opcional), notas internas, opt‑in de marketing (separado del consentimiento transaccional).
- RF-G3: Contadores: visitas completadas, cancelaciones, ausencias, primera y última visita.
- RF-G4: **Identificación y vínculo** (ver sección 5).
- RF-G5: Fusión manual de duplicados (admin), con auditoría y redirección (`merged_into_id`).

### H. Notificaciones (M email / D otros)
- Tipos: `booking_confirmed`, `booking_cancelled`, `booking_rescheduled`, `reminder`, `admin_new_booking`, `admin_cancellation`.
- RF-H1: Se encolan dentro de la misma transacción que el cambio de estado (outbox).
- RF-H2: Reintentos con backoff exponencial (máx. 5), luego `dead` con alerta.
- RF-H3: Idempotencia por `dedupe_key`: el mismo evento no genera dos envíos.
- RF-H4: Recordatorios se cancelan si la reserva se cancela o reprograma (y se re‑encolan).

### I. Panel administrativo (M)
Agenda diaria/semanal con filtro por profesional, alta manual, cancelar/reprogramar (drag & drop D), bloqueos, clientes, estadísticas básicas (reservas por estado, ocupación, ausencias, por profesional, por canal).

### J. Panel del profesional (M)
Agenda del día, próximos turnos, ficha del cliente (nombre, teléfono, historial resumido, notas), marcar asistencia/completar.

## 5. Identificación y vinculación de clientes

1. **Clave natural dentro del negocio**: `phone_e164` normalizado. Unicidad parcial: `UNIQUE (business_id, phone_e164) WHERE phone_e164 IS NOT NULL AND deleted_at IS NULL AND merged_into_id IS NULL`.
2. **Normalización** (Argentina): quitar espacios/guiones; `0` inicial y `15` de celular → formato `+54 9 <área><número>`. Usar `libphonenumber-js` con país por defecto `AR`. Si no parsea → error de validación.
3. **Instagram**: se normaliza (minúsculas, sin `@`, sin URL) y se guarda en `instagram_handle`. **No es único**: un handle puede cambiar o ser compartido; se usa como *pista* de coincidencia.
4. **Match en reserva pública**: por teléfono. Si coincide, se reutiliza el cliente y se **actualiza el nombre sólo si estaba vacío** (no se sobrescribe; la respuesta pública **no revela** datos del cliente existente).
5. **Import desde Sheets** (una vez, luego incremental): para cada fila: (a) match por teléfono → vincular; (b) si no hay teléfono y hay Instagram → *candidato* a revisión manual (cola `customer_match_candidates` o estado en mapeo `needs_review`); (c) caso contrario → crear. **Nunca fusionar por nombre.**
6. **Vínculo externo**: `external_id_mappings(entity_type='customer', external_system='gas_sheets', external_id=<clave estable en Sheets>)`. Si la hoja usa Instagram como clave, la clave externa es el Instagram **tal como está hoy** y el mapeo permite que luego cambie.
7. **Fusión**: función `merge_customers(source, target)` mueve reservas y mapeos y deja `merged_into_id`.

## 6. Matriz de permisos (entidad × acción)

Las columnas de integración no agregan endpoints de escritura al MVP: son permisos máximos, sujetos al catálogo del doc 05 y al Modo A validado. El registro de servicios y los vínculos siguen disponibles desde el sistema autenticado en Modo B.

Leyenda: ✔ permitido · ◐ condicionado · ✖ denegado. "Propio" = reservas/agenda del profesional vinculado al usuario.

| Entidad / acción | Superadmin* | Owner/Admin | Barbero | Cliente (token) | Integración servicio | Integración usuario |
|---|---|---|---|---|---|---|
| Negocio: ver público | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Negocio: ver privado/editar | ✔ (auditado) | ✔ | ✖ / ✖ | ✖ | ✖ | ✖ |
| Miembros: gestionar | ✔ | ✔ (no puede asignar rol > propio) | ✖ | ✖ | ✖ | ✖ |
| Profesionales: listar | ✔ | ✔ | ✔ | ✔ (público) | ✔ | ✔ |
| Profesionales: crear/editar/desactivar | ✔ | ✔ | ✖ | ✖ | ✖ | ◐ (si miembro admin y scope) |
| Servicios: listar | ✔ | ✔ | ✔ | ✔ (activos) | ✔ | ✔ |
| Servicios: crear/editar/desactivar | ✔ | ✔ | ✖ | ✖ | ✖ | ◐ |
| Horarios/bloqueos propios | ✔ | ✔ | ◐ (según `barber_can_edit_availability`) | ✖ | ✖ | ◐ |
| Horarios/bloqueos de otros | ✔ | ✔ | ✖ | ✖ | ✖ | ◐ (admin) |
| Disponibilidad: consultar | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Reserva: crear | ✔ | ✔ | ◐ (propias o delegadas) | ✔ (con políticas) | ✖ | ◐ (según rol del usuario) |
| Reserva: ver | ✔ | ✔ todas | ✔ propias | ✔ la suya | ✔ (lectura) | ◐ por rol |
| Reserva: cancelar | ✔ | ✔ | ◐ propias | ◐ (política) | ✖ | ◐ por rol |
| Reserva: reprogramar | ✔ | ✔ | ◐ propias | ◐ (política) | ✖ | ◐ por rol |
| Reserva: confirmar | ✔ | ✔ | ✔ propias | ✖ | ✖ | ◐ (Modo A validado) |
| Reserva: completar / ausente | ✔ | ✔ | ✔ propias | ✖ | ✖ | ◐ propias/rol (Modo A validado) |
| Reserva: revertir completado/ausente | ✔ | ✔ | ✖ | ✖ | ✖ | ◐ (admin) |
| Clientes: ver | ✔ | ✔ | ◐ (sólo con reservas propias; sin notas de otros) | ✖ (sólo sus datos) | ✔ (lectura limitada) | ◐ |
| Clientes: crear/editar | ✔ | ✔ | ◐ (crear al agendar) | ✖ | ✖ | ◐ |
| Clientes: fusionar/exportar | ✔ | ✔ | ✖ | ✖ | ✖ | ✖ |
| Estadísticas | ✔ | ✔ | ◐ propias | ✖ | ✔ (agregadas) | ◐ |
| Auditoría | ✔ | ✔ (su negocio) | ✖ | ✖ | ✖ | ✖ |
| Credenciales de integración | ✔ | ✔ (crear/revocar) | ◐ (su token personal) | ✖ | ✖ | ✖ |

\* El superadmin **no** hereda acceso silencioso: usa "acceso de soporte" explícito, con motivo, límite de tiempo y registro en `audit_logs` (ver doc 08).

## 7. Requisitos no funcionales

Disponibilidad objetivo 99.5 %; p95 API < 500 ms (excepto disponibilidad < 600 ms); mobile‑first (320 px mínimo); accesibilidad WCAG 2.1 AA en flujo público; i18n preparada (es‑AR por defecto); observabilidad (logs estructurados con `request_id`, `business_id`).
