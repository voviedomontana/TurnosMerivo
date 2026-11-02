> Consolidación 2026-10-31: doc 14 incorporado. Propuestas P-xx y gates en
> [informe de consolidación](CONSOLIDATION_REPORT.md); esta edición no autoriza implementación.

> **Actualización de seguridad:** consultar `14_CORRECCIONES_CRITICAS.md` antes de implementar. Si existe contradicción, prevalecen esas correcciones.

# 05 — Especificación de la API REST v1

Base: `https://<host>/api/v1`. Formato: JSON UTF‑8. Contrato fuente de verdad: esquemas Zod → OpenAPI generado (`/api/v1/openapi.json`).

## 1. Convenciones

### 1.1 Modos de autenticación
| Modo | Header | Se usa en | Tenant |
|---|---|---|---|
| **P** Público | ninguno (+ Turnstile en escrituras) | `/public/{slug}/...` | slug |
| **S** Sesión | cookie de sesión Supabase / `Authorization: Bearer <JWT>` | `/businesses/{businessId}/...` | `businessId` + membresía |
| **T** Token de reserva | `X-Manage-Token: <token>` | `/public/appointments/{id}/...` | id de reserva |
| **I** Integración | `Authorization: Bearer trn_...` | mismas rutas `/businesses/{businessId}/...` y `/integrations/...` | del token (el `businessId` de la ruta **debe coincidir**, si no → 404) |

Una sola API para UI, GAS y futuros clientes: `modules/auth` centraliza la evaluación de aplicación; la operación de BD vuelve a verificar identidad, tenant y permiso. En integración, `service_key` sólo lee; `user_token` escribe sólo con Modo A validado y scopes ∩ rol. Las tablas no habilitan escrituras por cambiar el cliente HTTP.

### 1.2 Headers
`X-Request-Id` (se genera si falta y se devuelve), `Idempotency-Key` (obligatorio en POST de creación y transiciones; UUID), `If-Match: "<version>"` (ETag fuerte, **obligatorio** para PATCH y transiciones de recursos existentes; `428 PRECONDITION_REQUIRED` si falta; `412 PRECONDITION_FAILED` si no coincide), `X-Actor-Asserted` (solo metadato opcional, no verificado, de auditoría; NUNCA autoriza operaciones).

### 1.3 Respuestas y errores (RFC 9457 `application/problem+json`)
```json
{ "type": "https://docs.turnos.app/errors/slot-taken",
  "title": "El horario ya no está disponible",
  "status": 409, "code": "SLOT_TAKEN",
  "detail": "Otro cliente reservó este horario.",
  "request_id": "req_01HX...", "errors": [{"field":"starts_at","message":"..."}],
  "suggestions": ["2026-11-02T14:30:00-03:00"] }
```
Éxito: objeto directo (`200/201`) o `{ "data": [...], "page": { "next_cursor": "...", "has_more": true } }` para listados.

| HTTP | `code` | Cuándo |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Esquema inválido, teléfono no parseable |
| 401 | `UNAUTHENTICATED` | Falta/expiró credencial |
| 403 | `FORBIDDEN` | Autenticado sin permiso |
| 404 | `NOT_FOUND` | No existe **o pertenece a otro tenant** (no se distingue) |
| 409 | `SLOT_TAKEN`, `INVALID_STATE_TRANSITION`, `IDEMPOTENCY_KEY_REUSED`, `DUPLICATE_RESOURCE` | Conflictos |
| 410 | `MANAGE_LINK_EXPIRED`, `CURSOR_EXPIRED` | Token de gestión vencido; cursor reservado para feed futuro |
| 412 | `PRECONDITION_FAILED` | Versión If-Match desactualizada |
| 428 | `PRECONDITION_REQUIRED` | Falta If-Match requerido |
| 422 | `POLICY_VIOLATION` (`reason`: `MIN_NOTICE`, `MAX_ADVANCE`, `CANCELLATION_WINDOW_CLOSED`, `RESCHEDULE_LIMIT`, `OUTSIDE_WORKING_HOURS`, `SERVICE_NOT_OFFERED`, `STAFF_INACTIVE`, `BLOCKED`, `MAX_ACTIVE_BOOKINGS`) | Reglas de negocio |
| 429 | `RATE_LIMITED` | `Retry-After` |
| 500/503 | `INTERNAL_ERROR`, `UNAVAILABLE` | |

### 1.4 Versionado
Prefijo `/v1`. Cambios compatibles (campos nuevos opcionales) no suben versión. Cambios incompatibles → `/v2` con ≥ 6 meses de convivencia; cabeceras `Deprecation` y `Sunset`.

### 1.5 Rate limiting (por clave de límite)
| Ámbito | Límite orientativo |
|---|---|
| Público GET availability | 60/min por IP + 600/min por negocio |
| Público POST appointments | 5/10 min por IP, 3/h por teléfono, 10/h por email |
| Gestión por token | 20/min por token |
| Sesión | 300/min por usuario |
| Integración | 120/min por token (configurable) |
Respuestas incluyen `RateLimit-Remaining` / `Retry-After`.

### 1.6 Validación, trazabilidad, idempotencia
- Zod en **toda** entrada; tamaño máximo de body 100 KB; rechazar campos desconocidos (`strict`).
- `request_id` propagado a logs, `appointment_events.request_id` y `audit_logs.request_id`.
- Idempotencia: tenant + autoridad/capacidad verificada + operación + `Idempotency-Key`
  forman el ámbito. Hash canónico de método, ruta/recurso, payload semántico e
  If-Match si existe; excluir secretos de autenticación y request_id del hash.
  Misma key/ámbito y hash → replay del resultado autorizado; hash distinto →
  `409 IDEMPOTENCY_KEY_REUSED`. Autenticar y autorizar de nuevo **antes** de leer/revelar
  un replay; un token revocado no obtiene resultados anteriores. Retención 48 h.
- Una petición reclama su key de forma atómica (unicidad/lock); solicitudes iguales
  concurrentes esperan o reintentan de forma acotada. Mutación, evento, auditoría,
  outbox y respuesta idempotente se confirman en **una** transacción. Un fallo revierte
  el conjunto. No ejecutar RPC separadas para aparentar atomicidad.
- En reintentos exactos se reconoce el replay autorizado antes de comparar la versión
  actual; una operación nueva sí exige versión vigente. No devolver respuesta vieja
  con payload o precondición diferente. Persistencia y recuperación segura del token
  de gestión devuelto en creación quedan bloqueadas por P-06 antes de S6: no guardar
  secretos sin protección en response_body.
- Lecturas/mutaciones autorizadas devuelven `version` y ETag fuerte `"N"`. `PATCH` y transiciones requieren `If-Match` con `version`; ausencia → `428 PRECONDITION_REQUIRED`; discrepancia → `412 PRECONDITION_FAILED` con versión actual autorizada. `409` se reserva a conflictos de negocio, como `SLOT_TAKEN`.

La escritura comprueba versión **dentro** de la transacción con update condicional
`WHERE business_id = ctx.business_id AND id = resource_id AND version = expected`;
incrementa `version` y crea auditoría/eventos atómicamente. Cero filas no distingue
otro tenant/inexistencia; la clasificación 404/412 se realiza sólo tras autorización.
El body nunca asigna la nueva versión. No basta comparar en Next.js y luego escribir.
Para PUT/DELETE de vínculos, horarios y colecciones existentes se exige también
la versión de su recurso de control. Definirlo en P-06 antes de S5; no usar la
ausencia de version en una fila hija para permitir overwrites ciegos.

### 1.7 Paginación, filtros, orden
Cursor opaco: `?limit=50&cursor=...` (máx. 200; default 50). Orden estable por `(sort_field, id)`. Filtros por query (`status=confirmed,pending`, `staff_id=`, `from=`/`to=` ISO‑8601 con offset, `q=`). Las fechas de entrada/salida usan **ISO 8601 con offset** del negocio; el servidor guarda UTC.


## 2. Catálogo de endpoints

Leyenda de actores: **P** público · **T** token reserva · **B** barbero · **A** admin/owner · **SA** superadmin · **I** integración (scope entre corchetes).

### 2.1 Negocios
| Método | Ruta | Descripción | Actor | Errores |
|---|---|---|---|---|
| GET | `/public/{slug}` | Config pública: nombre, logo, dirección, servicios activos, profesionales, políticas visibles, zona horaria | P | 404 |
| GET | `/businesses/{businessId}` | Config privada (settings completos) | A, I[`business:read`] | 401,403,404 |
| PATCH | `/businesses/{businessId}` | Actualizar datos/configuración (`If-Match`) | A | 400,403,404,409,412,428 |
| PATCH | `/businesses/{businessId}/settings` | Políticas de reserva (`If-Match`) | A | 400,403,404,409,412,428 |

### 2.2 Profesionales
| Método | Ruta | Descripción | Actor |
|---|---|---|---|
| GET | `/businesses/{id}/staff` | Listar (`is_active`, `service_id`) | A,B,I[`staff:read`] |
| POST | `/businesses/{id}/staff` | Crear | A |
| GET | `/businesses/{id}/staff/{staffId}` | Detalle + servicios + horarios | A,B(propio),I |
| PATCH | `/businesses/{id}/staff/{staffId}` | Modificar | A |
| POST | `/businesses/{id}/staff/{staffId}/deactivate` | Desactivar (devuelve reservas futuras afectadas) | A |
| PUT | `/businesses/{id}/staff/{staffId}/services` | Reemplazar servicios habilitados | A |
| GET/PUT | `/businesses/{id}/staff/{staffId}/working-hours` | Jornada semanal (con vigencia) | A, B(si permitido) |
| GET/POST/DELETE | `/businesses/{id}/staff/{staffId}/exceptions[/{id}]` | Excepciones por fecha | A, B(si permitido) |
| GET/POST/DELETE | `/businesses/{id}/time-blocks[/{id}]` | Bloqueos (`staff_id` opcional) | A, B(propios si permitido) |
| GET | `/businesses/{id}/staff/{staffId}/availability` | Disponibilidad (ver 2.4) | A,B,I |

### 2.3 Servicios
| Método | Ruta | Descripción | Actor |
|---|---|---|---|
| GET | `/businesses/{id}/services` | Listar | A,B,I[`services:read`] |
| POST | `/businesses/{id}/services` | Crear | A |
| PATCH | `/businesses/{id}/services/{serviceId}` | Modificar (no afecta reservas existentes) | A |
| POST | `/businesses/{id}/services/{serviceId}/deactivate` | Desactivar | A |

### 2.4 Disponibilidad
| Método | Ruta | Actor |
|---|---|---|
| GET | `/public/{slug}/availability` | P |
| GET | `/businesses/{id}/availability` | A,B,I[`availability:read`] |

Parámetros: `service_id` (req.), `staff_id` (uuid o `any`, default `any`), `date` (`YYYY-MM-DD`, en zona del negocio) **o** `from`/`to` (máx. 31 días).
Response:
```json
{
  "timezone": "America/Argentina/Buenos_Aires",
  "service": { "id": "…", "name": "Corte", "duration_minutes": 30, "price_cents": 1200000, "currency": "ARS" },
  "days": [
    { "date": "2026-11-02",
      "slots": [
        { "starts_at": "2026-11-02T10:00:00-03:00", "ends_at": "2026-11-02T10:30:00-03:00",
          "staff_ids": ["b3f…","c91…"] }
      ] }
  ],
  "generated_at": "2026-10-29T15:00:00Z"
}
```
Con `staff_id=any` los slots listan `staff_ids` candidatos (en público se **omiten** para no exponer carga). La disponibilidad es **informativa**: la garantía real es la creación. Cache‑Control: `private, max-age=15` (público) para absorber ráfagas.

### 2.5 Reservas
| Método | Ruta | Descripción | Actor |
|---|---|---|---|
| POST | `/public/{slug}/appointments` | Crear reserva pública | P |
| GET | `/public/appointments/{id}` | Ver reserva | T |
| POST | `/public/appointments/{id}/cancel` | Cancelar (política) | T |
| POST | `/public/appointments/{id}/reschedule` | Reprogramar (política) | T |
| GET | `/businesses/{id}/appointments` | Listar/filtrar (`from,to,staff_id,status,customer_id,q,updated_since`) | A,B(propias),I[`appointments:read`] |
| POST | `/businesses/{id}/appointments` | Crear manual (`override_policies` opcional) | A,B,I[`appointments:write`] |
| GET | `/businesses/{id}/appointments/{apptId}` | Detalle + eventos | A,B(propia),I |
| POST | `/businesses/{id}/appointments/{apptId}/confirm` | pending→confirmed | A,B,I[`appointments:status`] |
| POST | `/businesses/{id}/appointments/{apptId}/cancel` | Cancelar con `reason` | A,B(propia),I[`appointments:write`] |
| POST | `/businesses/{id}/appointments/{apptId}/reschedule` | Cambiar fecha/profesional | A,B(propia),I[`appointments:write`] |
| POST | `/businesses/{id}/appointments/{apptId}/complete` | confirmed→completed | A,B(propia),I[`appointments:status`] |
| POST | `/businesses/{id}/appointments/{apptId}/no-show` | confirmed→no_show | A,B(propia),I[`appointments:status`] |
| POST | `/businesses/{id}/appointments/{apptId}/revert` | Revertir completed/no_show | A |
| PUT | `/businesses/{id}/appointments/{apptId}/external-links/{system}` | Vincular con registro externo (idempotente) | I[`links:write`], A |

Errores comunes: 400, 401, 403, 404, 409 (`SLOT_TAKEN`, `INVALID_STATE_TRANSITION`), 412 (`PRECONDITION_FAILED`), 428 (`PRECONDITION_REQUIRED`), 422 (`POLICY_VIOLATION`), 429. Toda escritura I de este catálogo requiere user_token Modo A validado; no basta el nombre de un scope.

### 2.6 Clientes
| Método | Ruta | Descripción | Actor |
|---|---|---|---|
| GET | `/businesses/{id}/customers` | Listar/buscar (`q`, `phone`, `instagram`, `updated_since`) | A, B(limitado), I[`customers:read`] |
| POST | `/businesses/{id}/customers` | Crear (devuelve existente si coincide teléfono: `200` + `matched:true`) | A,B,I[`customers:write`] |
| GET | `/businesses/{id}/customers/{customerId}` | Detalle | A, B(limitado), I |
| PATCH | `/businesses/{id}/customers/{customerId}` | Actualizar | A,B(limitado) |
| GET | `/businesses/{id}/customers/{customerId}/appointments` | Historial | A,B(propias),I |
| POST | `/businesses/{id}/customers/{customerId}/merge` | Fusionar `source_id` → este | A |
| GET | `/businesses/{id}/customers/duplicates` | Candidatos a duplicado | A |

### 2.7 Integraciones
| Método | Ruta | Descripción | Actor |
|---|---|---|---|
| GET | `/integrations/me` | Quién soy: negocio, scopes, miembro asociado, expiración | I |
| GET (reservado, no habilitado) | `/integrations/changes?entity=appointments&cursor=...&limit=` | Feed futuro condicionado al protocolo y pruebas de §4 | I[`changes:read`] |
| GET | `/businesses/{id}/integrations/credentials` | Listar credenciales (sin secretos) | A |
| POST | `/businesses/{id}/integrations/credentials` | Crear (secreto mostrado una vez) | A; B sólo `user_token` propio |
| POST | `/businesses/{id}/integrations/credentials/{credId}/rotate` | Rotar (período de gracia 24 h opcional) | A, B(propio) |
| POST | `/businesses/{id}/integrations/credentials/{credId}/revoke` | Revocar | A, B(propio) |
| GET | `/businesses/{id}/integrations/mappings` | Consultar mapeos existentes | I[`mappings:read`], A |
| PUT | `/businesses/{id}/integrations/mappings` | Crear/actualizar mapeos en lote autorizado | I[`mappings:write`] sólo Modo A validado con rol suficiente, A |
| GET | `/businesses/{id}/members`, POST `/…/members/invite`, PATCH `/…/members/{id}` | Gestión de miembros | A (owner para roles admin) |

Scopes: `mappings:read`, `business:read`, `staff:read`, `services:read`, `availability:read`, `appointments:read`, `appointments:write`, `appointments:status`, `customers:read`, `customers:write`, `changes:read`, `mappings:write`, `links:write`.

## 3. Ejemplos detallados

### 3.1 Crear reserva pública
`POST /api/v1/public/barberia-central/appointments` · `Idempotency-Key: 6f1c…`
```json
{
  "service_id": "7d0e…",
  "staff_id": "any",
  "starts_at": "2026-11-02T10:00:00-03:00",
  "customer": { "full_name": "Juan Pérez", "phone": "11 5555-1234", "email": "juan@ejemplo.com", "instagram": "@juanp" },
  "notes": "Primera vez",
  "consent": { "privacy_policy_version": "2026-10" },
  "turnstile_token": "0.abc…"
}
```
`201 Created`
```json
{
  "id": "a1b2…", "status": "confirmed",
  "starts_at": "2026-11-02T10:00:00-03:00", "ends_at": "2026-11-02T10:30:00-03:00",
  "staff": { "id": "b3f…", "display_name": "Lucas" },
  "service": { "name": "Corte", "price_cents": 1200000, "currency": "ARS", "duration_minutes": 30 },
  "manage_url": "https://turnos.app/b/barberia-central/r/a1b2…#t=<token>",
  "version": 1
}
```
Reglas: tenant por slug; teléfono normalizado; `staff_id=any` → asignación en BD; el token sólo se devuelve aquí (y por email). Errores: `400`, `409 SLOT_TAKEN` (con `suggestions`), `422 POLICY_VIOLATION`, `429`.

### 3.2 Cancelar (cliente)
`POST /public/appointments/{id}/cancel` · `X-Manage-Token` · `Idempotency-Key` · `If-Match: "3"` · body `{ "reason": "Surgió un imprevisto" }` → `200 { "id": "…", "status": "cancelled", "cancelled_by": "customer" }`. Errores: `404` (token inválido o recurso ajeno), `410`, `412 PRECONDITION_FAILED`, `428 PRECONDITION_REQUIRED`, `409 INVALID_STATE_TRANSITION`, `422 CANCELLATION_WINDOW_CLOSED`.

### 3.3 Reprogramar
`POST /businesses/{id}/appointments/{apptId}/reschedule` · `If-Match: "3"` · `Idempotency-Key`
```json
{ "starts_at": "2026-11-03T16:00:00-03:00", "staff_id": "b3f…", "override_policies": false, "reason": "Pedido del cliente" }
```
`200` → reserva con `version: 4`, `reschedule_count: 1`. Atómico: si el nuevo horario no es válido la reserva **conserva** su horario original.

### 3.4 Completar y vincular con servicio efectivo
`POST …/appointments/{apptId}/complete` · `Idempotency-Key` · `If-Match: "3"` · body `{ "completed_at": "2026-11-02T10:41:00-03:00" }` → `200 {status:"completed"}`.
`PUT …/appointments/{apptId}/external-links/gas_sheets` · `If-Match` de la reserva recién leída · body `{ "entity_type": "service_record", "external_id": "SR-8c1f…" }` → `200` (mismo vínculo no genera duplicado; sigue sujeto a precondición). Si `external_id` ya está vinculado a **otra** reserva: `409 DUPLICATE_RESOURCE`. Autenticación individual en TurnosMerivo o Modo A validado; Modo B recibe 403. Un PUT repetido con precondición obsoleta no elude If-Match: recargar estado y verificar vínculo; la idempotencia del efecto no promete replay con cualquier versión.

### 3.5 Agenda para Apps Script
`GET /businesses/{id}/appointments?from=2026-11-02T00:00:00-03:00&to=2026-11-02T23:59:59-03:00&staff_id=b3f…&status=confirmed,pending&limit=100`
```json
{ "data": [ { "id": "a1b2…", "status": "confirmed", "starts_at": "…", "ends_at": "…",
   "staff": {"id":"b3f…","display_name":"Lucas"},
   "customer": {"id":"c77…","full_name":"Juan Pérez","phone_e164":"+5491155551234","instagram_handle":"juanp","completed_count":4},
   "service": {"id":"7d0e…","name":"Corte","price_cents":1200000,"duration_minutes":30},
   "external_links": [], "version": 2, "updated_at": "…" } ],
  "page": { "next_cursor": null, "has_more": false } }
```
Los datos de cliente incluidos dependen del scope y del rol (el barbero no ve `internal_notes` de reservas ajenas).

## 4. Reconciliación MVP y feed reservado

### 4.1 Flujo habilitable en el MVP

Agenda bajo demanda y barridos **completos paginados** del alcance de reportes,
con reconciliación periódica (doc 07 §6). `updated_since` sirve como filtro auxiliar,
no como garantía de sincronización. Volver a recorrer todo el alcance permite
recuperar commits tardíos en barridos posteriores; una ventana fija no cubre historia
anterior. Se busca convergencia eventual, no un snapshot transaccional instantáneo.
El alcance temporal y tratamiento de movimientos entre rangos se aprueban en P-05.

Consumidor: clave `(business_id,entity_type,id)`, aplicar sólo versiones nuevas,
checkpoint después del lote persistido. No borrar filas por ausencia en una página
o barrido incompleto; para bajas/fusiones conservar tombstones versionados o usar
un snapshot autoritativo completo diseñado y probado. Una corrida fallida no publica
un reemplazo parcial de KPIs. Recuperación: repetir páginas o reiniciar barrido,
sin duplicar filas ni perder correcciones antiguas. Las bajas que no sean reservas
no se limitan al rango de fechas de turnos.

### 4.2 `/integrations/changes` — reservado, no habilitado

Precondiciones: outbox durable escrito en la transacción de negocio, publicador que
observe sólo eventos confirmados, orden seguro de publicación y watermark que no
salte eventos sin publicar. Ni timestamp+id, ni solapamiento fijo, ni secuencia de
inserción garantizan orden de commit. La selección/claim, exclusión entre
publicadores y el avance del cursor aún requieren diseño y pruebas P-05; no se
afirma un algoritmo aprobado ni se agrega CDC al stack MVP.

Contrato conceptual futuro: eventos con business_id implícito/autorizado, entidad,
id, version, op upsert/delete, payload mínimo y cursor **opaco de publicación** (no
un timestamp codificado). Consumidor idempotente por `(business_id,entity_id,version)`;
checkpoint sólo tras aplicar lote. Tombstones durante 90 días como objetivo de
retención existente; cursor fuera de retención → `410 CURSOR_EXPIRED` y barrido
completo de **todo** el alcance afectado, no sólo días recientes. La retención y la
convergencia deben probarse con commits fuera de orden, abortos y fallos parciales.


## 5. Reglas de autorización (resumen implementable)
1. Resolver actor (sesión/token) → resolver tenant → verificar rol/scope → verificar **propiedad** del recurso (`business_id` coincide; barbero: `staff_member_id` propio) → ejecutar.
2. `can(actor, action, resource)` central y testeado; los handlers no hacen `if (role === …)` sueltos.
3. Para actores de integración: intersección **scopes del token ∩ permisos del rol del miembro asociado** (en tokens de usuario).
4. Los IDs de otros negocios devuelven `404`.

## Implementación de sesión S2

Los endpoints de miembros y /me se implementaron según SPRINT_2_REPORT.md. Invite
recibe {email,role,token}: capacidad base64url de 32 bytes generada antes del POST;
la respuesta no contiene el secreto. Las mutaciones requieren Idempotency-Key y
PATCH además If-Match. Cookies requieren Origin coincidente, Bearer verificado por
Auth; no-store y validación strict. El core SQL revalida identidad/tenant/rol/MFA.
Renovar/revocar enlaces desde la UI usa api.manage_invitation y la misma capa de
servicio. No se implementan endpoints de integración, catálogo o reservas.
