# 05 — Especificación de la API REST v1

Base: `https://<host>/api/v1`. Formato: JSON UTF‑8. Contrato fuente de verdad: esquemas Zod → OpenAPI generado (`/api/v1/openapi.json`).

## 1. Convenciones

### 1.1 Modos de autenticación

| Modo                   | Header                                                    | Se usa en                                                         | Tenant                                                                                                                                                              |
| ---------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P** Público          | ninguno (+ Turnstile en escrituras)                       | `/public/{slug}/...`                                              | slug                                                                                                                                                                |
| **S** Sesión           | cookie de sesión Supabase / `Authorization: Bearer <JWT>` | `/businesses/{businessId}/...`                                    | `businessId` + membresía                                                                                                                                            |
| **T** Token de reserva | `X-Manage-Token: <token>`                                 | `/public/appointments/{id}/...`                                   | id de reserva                                                                                                                                                       |
| **I** Integración      | `Authorization: Bearer trn_...`                           | mismas rutas `/businesses/{businessId}/...` y `/integrations/...` | del token (el `businessId` de la ruta **debe coincidir**, si no → 404). **`service_key` = sólo lectura; las escrituras exigen `user_token` (identidad verificada)** |

Una sola API para UI, GAS y futuros clientes: la **autorización** se evalúa por (actor, acción, recurso) en `modules/auth`.

### 1.2 Headers

- `X-Request-Id`: se genera si falta y se devuelve; se propaga a logs, `appointment_events` y `audit_logs`.
- `Idempotency-Key` (UUID): **obligatorio** en `POST` de creación y de transición. Se resuelve dentro de la misma transacción de la operación (doc 06 §4.0).
- `If-Match: "<version>"`: **obligatorio** en modificaciones desde panel/integración (ver §1.8). Se acepta `3` o `"3"`.
- `ETag: "<version>"`: se devuelve en toda respuesta de un recurso versionado (además del campo `version` del cuerpo).
- ~~`X-Actor-Asserted`~~: **eliminado en v1.1**. Una identidad declarada por el cliente nunca se usa para autorizar ni para atribuir escrituras; la identidad sale de la sesión o de la credencial verificada.

### 1.3 Respuestas y errores (RFC 9457 `application/problem+json`)

```json
{
  "type": "https://docs.turnos.app/errors/slot-taken",
  "title": "El horario ya no está disponible",
  "status": 409,
  "code": "SLOT_TAKEN",
  "detail": "Otro cliente reservó este horario.",
  "request_id": "req_01HX...",
  "errors": [{ "field": "starts_at", "message": "..." }],
  "suggestions": ["2026-11-02T14:30:00-03:00"]
}
```

Éxito: objeto directo (`200/201`) o `{ "data": [...], "page": { "next_cursor": "...", "has_more": true } }` para listados.

| HTTP    | `code`                                                                                                                                                                                                                                                                         | Cuándo                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| 400     | `VALIDATION_ERROR`                                                                                                                                                                                                                                                             | Esquema inválido, teléfono no parseable, `If-Match` mal formado              |
| 401     | `UNAUTHENTICATED`                                                                                                                                                                                                                                                              | Falta/expiró credencial; token revocado                                      |
| 403     | `FORBIDDEN`                                                                                                                                                                                                                                                                    | Autenticado sin permiso (rol insuficiente, recurso `own` ajeno)              |
| 403     | `INSUFFICIENT_SCOPE`                                                                                                                                                                                                                                                           | Credencial sin el scope requerido; `service_key` intentando escribir         |
| 404     | `NOT_FOUND`                                                                                                                                                                                                                                                                    | No existe **o pertenece a otro tenant** o no se es miembro (no se distingue) |
| 409     | `SLOT_TAKEN`, `INVALID_STATE_TRANSITION`, `IDEMPOTENCY_KEY_REUSED`, `DUPLICATE_RESOURCE`, `ALREADY_LINKED`, `LINKED_SERVICE_RECORD`                                                                                                                                            | Conflictos de negocio                                                        |
| 410     | `MANAGE_LINK_EXPIRED`, `CURSOR_EXPIRED`                                                                                                                                                                                                                                        | Token de gestión vencido; cursor del feed fuera de retención                 |
| 412     | `VERSION_CONFLICT`                                                                                                                                                                                                                                                             | `If-Match` no coincide con la versión actual (incluye `current_version`)     |
| 422     | `POLICY_VIOLATION` (`reason`: `MIN_NOTICE`, `MAX_ADVANCE`, `CANCELLATION_WINDOW_CLOSED`, `RESCHEDULE_LIMIT`, `OUTSIDE_WORKING_HOURS`, `SERVICE_NOT_OFFERED`, `STAFF_INACTIVE`, `BLOCKED`, `MAX_ACTIVE_BOOKINGS`, `COMPLETION_TOO_EARLY`, `NO_SHOW_TOO_EARLY`, `REVERT_WINDOW`) | Reglas de negocio                                                            |
| 428     | `PRECONDITION_REQUIRED`                                                                                                                                                                                                                                                        | Falta `If-Match` donde es obligatorio                                        |
| 429     | `RATE_LIMITED`                                                                                                                                                                                                                                                                 | `Retry-After`                                                                |
| 500/503 | `INTERNAL_ERROR`, `UNAVAILABLE`                                                                                                                                                                                                                                                | Incluye agotamiento de reintentos por `40P01/40001`                          |

Los SQLSTATE `TS001…TS012` de la base de datos se traducen a estos códigos (tabla en doc 06 §4.0).

### 1.4 Paginación, filtros, orden

Cursor opaco: `?limit=50&cursor=...` (máx. 200; default 50). Orden estable por `(sort_field, id)`. Filtros por query (`status=confirmed,pending`, `staff_id=`, `from=`/`to=` ISO‑8601 con offset, `q=`). Las fechas de entrada/salida usan **ISO 8601 con offset** del negocio; el servidor guarda UTC.

### 1.5 Versionado

Prefijo `/v1`. Cambios compatibles (campos nuevos opcionales) no suben versión. Cambios incompatibles → `/v2` con ≥ 6 meses de convivencia; cabeceras `Deprecation` y `Sunset`.

### 1.6 Rate limiting (por clave de límite)

| Ámbito                                                     | Límite orientativo                                |
| ---------------------------------------------------------- | ------------------------------------------------- |
| Público GET availability                                   | 60/min por IP + 600/min por negocio               |
| Público POST appointments                                  | 5/10 min por IP, 3/h por teléfono, 10/h por email |
| Gestión por token                                          | 20/min por token                                  |
| Sesión                                                     | 300/min por usuario                               |
| Integración                                                | 120/min por token (configurable)                  |
| Respuestas incluyen `RateLimit-Remaining` / `Retry-After`. |

### 1.7 Validación, trazabilidad, idempotencia

- Zod en **toda** entrada; tamaño máximo de body 100 KB; rechazar campos desconocidos (`strict`).
- `request_id` propagado a logs, `appointment_events.request_id` y `audit_logs.request_id`.
- Idempotencia: misma `Idempotency-Key` + mismo endpoint + mismo hash de body → misma respuesta almacenada; mismo key con body distinto → `409 IDEMPOTENCY_KEY_REUSED`. Retención 48 h.
- Concurrencia optimista con `version`/`If-Match`: ver §1.8 (discrepancia → `412 VERSION_CONFLICT`).

### 1.8 Control de concurrencia optimista (`version` / `If-Match`)

**Recursos versionados** (campo `version` + `ETag`): negocio, settings, miembros, profesionales, servicios, clientes, reservas, mapeos externos. Cada modificación exitosa incrementa `version` en 1 (trigger de BD, doc 04 §3.21). Las colecciones hijas de un profesional (horarios, excepciones, servicios habilitados) se versionan **con el profesional**.

**Cuándo es obligatorio `If-Match`**

| Operación                                                                                                                        | `If-Match`                                | Si falta                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| `PATCH`/`PUT` de negocio, settings, miembro, profesional, servicio, cliente, mapeo                                               | Obligatorio (versión del recurso)         | `428 PRECONDITION_REQUIRED`                                                 |
| `PUT/DELETE` de horarios, excepciones y servicios habilitados de un profesional                                                  | Obligatorio (versión **del profesional**) | `428`                                                                       |
| Transiciones de reserva por **staff / admin / integración** (`confirm`, `complete`, `no-show`, `cancel`, `reschedule`, `revert`) | Obligatorio                               | `428`                                                                       |
| Transiciones del **cliente por token** (`cancel`, `reschedule`)                                                                  | Opcional (recomendado)                    | Se aplica sobre el estado actual; la máquina de estados impide doble efecto |
| `POST` de creación                                                                                                               | No aplica (`Idempotency-Key`)             | —                                                                           |
| `GET`                                                                                                                            | `If-None-Match` opcional → `304`          | —                                                                           |

**Orden de evaluación** (determina qué error ve el cliente): autenticación → **autorización y pertenencia al tenant** → _replay_ de idempotencia → **versión** → máquina de estados/políticas → efectos. (La versión se compara después de autorizar para que un `412` nunca revele recursos ajenos.)

**Atomicidad**: la función/consulta toma el lock de la fila (`SELECT … FOR UPDATE` o `UPDATE … WHERE id = $1 AND business_id = $2 AND version = $3`), **compara y luego escribe en la misma transacción**; no hay ventana entre lectura y escritura. Si el `UPDATE` afecta 0 filas, una segunda consulta (ya autorizada) distingue `404` de `412`.

**Respuesta ante conflicto**: `412 VERSION_CONFLICT` con `{ "code": "VERSION_CONFLICT", "current_version": 6 }`; **no se aplica ningún cambio**. El servidor **no reintenta** por sí mismo (sólo reintenta, hasta 2 veces, errores de infraestructura `40P01/40001`, que no son conflictos de versión).

**Solicitudes simultáneas — comportamiento definido**

| Caso                                                                            | Resultado                                                                                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Dos admins editan el mismo servicio con `If-Match: 5`                           | Primero `200` (v6); segundo `412` (`current_version: 6`). El cliente refetch, muestra diferencias y reenvía con `6` |
| Dos barberos pulsan «Completar» a la vez (`If-Match: 3`)                        | Primero `200` (v4); segundo `412`; la UI recarga y ve `completed`                                                   |
| Doble clic del cliente en «Cancelar» con claves distintas                       | Primero `200`; segundo `409 INVALID_STATE_TRANSITION` (ya cancelada)                                                |
| Reintento por timeout con la **misma** `Idempotency-Key`                        | Respuesta original almacenada (aunque la versión ya haya avanzado); la idempotencia se evalúa antes que la versión  |
| `reschedule` (staff) concurrente con `cancel` (cliente)                         | Se serializan por el lock de la reserva; el segundo ve el nuevo estado: `412` si envió `If-Match`, `409` si no      |
| El cliente reprograma por token mientras el admin edita notas con versión vieja | La reprogramación incrementa `version`; el `PATCH` del admin recibe `412`                                           |
| Apps Script lee agenda y luego completa un turno modificado por otro            | `412`; el script recarga la agenda y muestra el estado vigente                                                      |

**Reglas para clientes**: leer `version`/`ETag` del recurso y reenviarla; ante `412`, refetch y decisión explícita (nunca reintentar a ciegas); `TurnosClient` de Apps Script devuelve el `412` a la UI sin reintentar.

## 2. Catálogo de endpoints

Leyenda de actores: **P** público · **T** token reserva · **B** barbero · **A** admin/owner · **SA** superadmin · **I** integración (scope entre corchetes; **I(r)** lectura con `service_key` o `user_token`, **I(w)** escritura sólo con `user_token`).

### 2.1 Negocios

| Método | Ruta                                | Descripción                                                                                                 | Actor                 | Errores         |
| ------ | ----------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------- | --------------- |
| GET    | `/public/{slug}`                    | Config pública: nombre, logo, dirección, servicios activos, profesionales, políticas visibles, zona horaria | P                     | 404             |
| GET    | `/businesses/{businessId}`          | Config privada (settings completos)                                                                         | A, I[`business:read`] | 401,403,404     |
| PATCH  | `/businesses/{businessId}`          | Actualizar datos/configuración (`If-Match`)                                                                 | A                     | 400,403,404,409 |
| PATCH  | `/businesses/{businessId}/settings` | Políticas de reserva                                                                                        | A                     | 400,403,409     |

### 2.2 Profesionales

| Método          | Ruta                                                 | Descripción                                      | Actor                      |
| --------------- | ---------------------------------------------------- | ------------------------------------------------ | -------------------------- |
| GET             | `/businesses/{id}/staff`                             | Listar (`is_active`, `service_id`)               | A,B,I[`staff:read`]        |
| POST            | `/businesses/{id}/staff`                             | Crear                                            | A                          |
| GET             | `/businesses/{id}/staff/{staffId}`                   | Detalle + servicios + horarios                   | A,B(propio),I              |
| PATCH           | `/businesses/{id}/staff/{staffId}`                   | Modificar                                        | A                          |
| POST            | `/businesses/{id}/staff/{staffId}/deactivate`        | Desactivar (devuelve reservas futuras afectadas) | A                          |
| PUT             | `/businesses/{id}/staff/{staffId}/services`          | Reemplazar servicios habilitados                 | A                          |
| GET/PUT         | `/businesses/{id}/staff/{staffId}/working-hours`     | Jornada semanal (con vigencia)                   | A, B(si permitido)         |
| GET/POST/DELETE | `/businesses/{id}/staff/{staffId}/exceptions[/{id}]` | Excepciones por fecha                            | A, B(si permitido)         |
| GET/POST/DELETE | `/businesses/{id}/time-blocks[/{id}]`                | Bloqueos (`staff_id` opcional)                   | A, B(propios si permitido) |
| GET             | `/businesses/{id}/staff/{staffId}/availability`      | Disponibilidad (ver 2.4)                         | A,B,I                      |

### 2.3 Servicios

| Método | Ruta                                               | Descripción                               | Actor                  |
| ------ | -------------------------------------------------- | ----------------------------------------- | ---------------------- |
| GET    | `/businesses/{id}/services`                        | Listar                                    | A,B,I[`services:read`] |
| POST   | `/businesses/{id}/services`                        | Crear                                     | A                      |
| PATCH  | `/businesses/{id}/services/{serviceId}`            | Modificar (no afecta reservas existentes) | A                      |
| POST   | `/businesses/{id}/services/{serviceId}/deactivate` | Desactivar                                | A                      |

### 2.4 Disponibilidad

| Método | Ruta                            | Actor                      |
| ------ | ------------------------------- | -------------------------- |
| GET    | `/public/{slug}/availability`   | P                          |
| GET    | `/businesses/{id}/availability` | A,B,I[`availability:read`] |

Parámetros: `service_id` (req.), `staff_id` (uuid o `any`, default `any`), `date` (`YYYY-MM-DD`, en zona del negocio) **o** `from`/`to` (máx. 31 días).
Response:

```json
{
  "timezone": "America/Argentina/Buenos_Aires",
  "service": {
    "id": "…",
    "name": "Corte",
    "duration_minutes": 30,
    "price_cents": 1200000,
    "currency": "ARS"
  },
  "days": [
    {
      "date": "2026-11-02",
      "slots": [
        {
          "starts_at": "2026-11-02T10:00:00-03:00",
          "ends_at": "2026-11-02T10:30:00-03:00",
          "staff_ids": ["b3f…", "c91…"]
        }
      ]
    }
  ],
  "generated_at": "2026-10-29T15:00:00Z"
}
```

Con `staff_id=any` los slots listan `staff_ids` candidatos (en público se **omiten** para no exponer carga). La disponibilidad es **informativa**: la garantía real es la creación. Cache‑Control: `private, max-age=15` (público) para absorber ráfagas.

### 2.5 Reservas

Leyenda adicional: **I(r)** = integración de **lectura** (`service_key` o `user_token`); **I(w)** = integración de **escritura**, **sólo `user_token`** (identidad verificada, doc 07 §2). Toda escritura requiere `Idempotency-Key`; toda modificación de staff/integración requiere `If-Match` (§1.8).

| Método | Ruta                                                                          | Descripción                                                                              | Actor                                     |
| ------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------- |
| POST   | `/public/{slug}/appointments`                                                 | Crear reserva pública                                                                    | P                                         |
| GET    | `/public/appointments/{id}`                                                   | Ver reserva                                                                              | T                                         |
| POST   | `/public/appointments/{id}/cancel`                                            | Cancelar (política)                                                                      | T                                         |
| POST   | `/public/appointments/{id}/reschedule`                                        | Reprogramar (política)                                                                   | T                                         |
| GET    | `/businesses/{id}/appointments`                                               | Listar/filtrar (`from,to,staff_id,status,customer_id,q`)                                 | A, B(propias), I(r)[`appointments:read`]  |
| POST   | `/businesses/{id}/appointments`                                               | Crear manual (`override_policies` sólo si el rol lo permite)                             | A, B, I(w)[`appointments:write`]          |
| GET    | `/businesses/{id}/appointments/{apptId}`                                      | Detalle + eventos                                                                        | A, B(propia), I(r)                        |
| POST   | `/businesses/{id}/appointments/{apptId}/confirm`                              | `pending→confirmed`                                                                      | A, B(propia), I(w)[`appointments:status`] |
| POST   | `/businesses/{id}/appointments/{apptId}/cancel`                               | Cancelar con `reason`                                                                    | A, B(propia), I(w)[`appointments:write`]  |
| POST   | `/businesses/{id}/appointments/{apptId}/reschedule`                           | Cambiar fecha/profesional                                                                | A, B(propia), I(w)[`appointments:write`]  |
| POST   | `/businesses/{id}/appointments/{apptId}/complete`                             | `confirmed→completed` (guarda temporal)                                                  | A, B(propia), I(w)[`appointments:status`] |
| POST   | `/businesses/{id}/appointments/{apptId}/no-show`                              | `confirmed→no_show` (guarda temporal)                                                    | A, B(propia), I(w)[`appointments:status`] |
| POST   | `/businesses/{id}/appointments/{apptId}/revert`                               | Revertir `completed`/`no_show` (motivo obligatorio; owner fuera de `revert_window_days`) | **A únicamente** (nunca B ni integración) |
| PUT    | `/businesses/{id}/appointments/{apptId}/external-links/{system}`              | Vincular con registro de servicio externo (idempotente)                                  | A, B(propia), I(w)[`links:write`]         |
| DELETE | `/businesses/{id}/appointments/{apptId}/external-links/{system}/{entityType}` | Desvincular (auditado; necesario antes de revertir un `completed` vinculado)             | A                                         |

Errores comunes: `400`, `401`, `403` (`FORBIDDEN`/`INSUFFICIENT_SCOPE`), `404`, `409` (`SLOT_TAKEN`, `INVALID_STATE_TRANSITION`, `LINKED_SERVICE_RECORD`, `ALREADY_LINKED`, `DUPLICATE_RESOURCE`), `412 VERSION_CONFLICT`, `422` (`POLICY_VIOLATION` + `reason`), `428 PRECONDITION_REQUIRED`, `429`.

Reglas de transición y tiempos: doc 02 §3 y doc 06 §4.5. `complete`/`no-show` aceptan `{"completed_at": "…"}` opcional sólo en `complete`, nunca futuro.

### 2.6 Clientes

| Método | Ruta                                                   | Descripción                                                             | Actor                                  |
| ------ | ------------------------------------------------------ | ----------------------------------------------------------------------- | -------------------------------------- |
| GET    | `/businesses/{id}/customers`                           | Listar/buscar (`q`, `phone`, `instagram`, `updated_since`)              | A, B(limitado), I(r)[`customers:read`] |
| POST   | `/businesses/{id}/customers`                           | Crear (devuelve existente si coincide teléfono: `200` + `matched:true`) | A, B, I(w)[`customers:write`]          |
| GET    | `/businesses/{id}/customers/{customerId}`              | Detalle                                                                 | A, B(limitado), I                      |
| PATCH  | `/businesses/{id}/customers/{customerId}`              | Actualizar                                                              | A,B(limitado)                          |
| GET    | `/businesses/{id}/customers/{customerId}/appointments` | Historial                                                               | A,B(propias),I                         |
| POST   | `/businesses/{id}/customers/{customerId}/merge`        | Fusionar `source_id` → este                                             | A                                      |
| GET    | `/businesses/{id}/customers/duplicates`                | Candidatos a duplicado                                                  | A                                      |

### 2.7 Integraciones

**Dos tipos de credencial** (doc 07 §2): `service_key` = **sólo lectura** (negocio, sin persona); `user_token` = identidad de un miembro verificado, puede escribir según `scopes ∩ permisos del rol`.

| Método | Ruta                                                                          | Descripción                                                                                      | Actor                                                     |
| ------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------- |
| GET    | `/integrations/me`                                                            | Negocio, tipo de credencial, `read_only`, scopes, miembro asociado (si `user_token`), expiración | I                                                         |
| GET    | `/integrations/changes?entity=&cursor=&limit=`                                | Feed incremental sin pérdidas (§4.1)                                                             | I(r)[`changes:read`]                                      |
| GET    | `/integrations/reconcile?from=&to=`                                           | Resumen por día para detectar divergencias (§4.2)                                                | I(r)[`changes:read`]                                      |
| GET    | `/businesses/{id}/integrations/credentials`                                   | Listar credenciales (sin secretos)                                                               | A                                                         |
| POST   | `/businesses/{id}/integrations/credentials`                                   | Crear (secreto mostrado una vez; `service_key` sólo con scopes de lectura)                       | A; B sólo `user_token` propio                             |
| POST   | `/businesses/{id}/integrations/credentials/{credId}/rotate`                   | Rotar (gracia 24 h opcional)                                                                     | A, B(propio)                                              |
| POST   | `/businesses/{id}/integrations/credentials/{credId}/revoke`                   | Revocar (efecto inmediato)                                                                       | A, B(propio)                                              |
| GET    | `/businesses/{id}/integrations/mappings`                                      | Consultar mapeos                                                                                 | A, I(r)[`mappings:read`]                                  |
| PUT    | `/businesses/{id}/integrations/mappings`                                      | Crear/actualizar mapeos en lote (idempotente; `If-Match` para renombrar)                         | A, I(w)[`mappings:write`] (sólo `user_token` de un admin) |
| DELETE | `/businesses/{id}/integrations/mappings/{mappingId}`                          | Desvincular                                                                                      | A                                                         |
| GET    | `/businesses/{id}/members` · POST `…/members/invite` · PATCH `…/members/{id}` | Gestión de miembros                                                                              | A (owner para roles admin); `aal2`                        |

**Catálogo de scopes**

- Lectura (permitidos en `service_key` y `user_token`): `business:read`, `staff:read`, `services:read`, `availability:read`, `appointments:read`, `customers:read`, `changes:read`, `mappings:read`.
- Escritura (**sólo `user_token`**): `appointments:write`, `appointments:status`, `customers:write`, `mappings:write`, `links:write`.
- Un `service_key` **no puede** crearse con scopes de escritura (CHECK en BD) y cualquier intento de escritura con él responde `403 INSUFFICIENT_SCOPE`.

## 3. Ejemplos detallados

### 3.1 Crear reserva pública

`POST /api/v1/public/barberia-central/appointments` · `Idempotency-Key: 6f1c…`

```json
{
  "service_id": "7d0e…",
  "staff_id": "any",
  "starts_at": "2026-11-02T10:00:00-03:00",
  "customer": {
    "full_name": "Juan Pérez",
    "phone": "11 5555-1234",
    "email": "juan@ejemplo.com",
    "instagram": "@juanp"
  },
  "notes": "Primera vez",
  "consent": { "privacy_policy_version": "2026-10" },
  "turnstile_token": "0.abc…"
}
```

`201 Created`

```json
{
  "id": "a1b2…",
  "status": "confirmed",
  "starts_at": "2026-11-02T10:00:00-03:00",
  "ends_at": "2026-11-02T10:30:00-03:00",
  "staff": { "id": "b3f…", "display_name": "Lucas" },
  "service": {
    "name": "Corte",
    "price_cents": 1200000,
    "currency": "ARS",
    "duration_minutes": 30
  },
  "manage_url": "https://turnos.app/b/barberia-central/r/a1b2…#t=<token>",
  "version": 1
}
```

Reglas: tenant por slug; teléfono normalizado; `staff_id=any` → asignación en BD; el token sólo se devuelve aquí (y por email). Errores: `400`, `409 SLOT_TAKEN` (con `suggestions`), `422 POLICY_VIOLATION`, `429`.

### 3.2 Cancelar (cliente)

`POST /public/appointments/{id}/cancel` · `X-Manage-Token` · body `{ "reason": "Surgió un imprevisto" }` → `200 { "id": "…", "status": "cancelled", "cancelled_by": "customer" }`. Errores: `403` (token inválido → se responde `404` para no filtrar existencia), `410`, `409 INVALID_STATE_TRANSITION`, `422 CANCELLATION_WINDOW_CLOSED`.

### 3.3 Reprogramar

`POST /businesses/{id}/appointments/{apptId}/reschedule` · `If-Match: 3`

```json
{
  "starts_at": "2026-11-03T16:00:00-03:00",
  "staff_id": "b3f…",
  "override_policies": false,
  "reason": "Pedido del cliente"
}
```

`200` → reserva con `version: 4`, `reschedule_count: 1`. Atómico: si el nuevo horario no es válido la reserva **conserva** su horario original.

### 3.4 Completar y vincular con servicio efectivo (requiere identidad verificada)

`POST …/appointments/{apptId}/complete` · `If-Match: "3"` · `Idempotency-Key: …` · credencial: sesión o `user_token` con `appointments:status`
body `{ "completed_at": "2026-11-02T10:41:00-03:00" }` → `200 { "status": "completed", "version": 4 }`.
`PUT …/appointments/{apptId}/external-links/gas_sheets` body `{ "entity_type": "service_record", "external_id": "SR-8c1f…" }` → `200` (misma solicitud repetida: mismo resultado). Si `external_id` ya está vinculado a **otra** reserva: `409 DUPLICATE_RESOURCE`; si la reserva ya tiene **otro** registro: `409 ALREADY_LINKED`.
Con una `service_key` ambas llamadas responden `403 INSUFFICIENT_SCOPE`.

### 3.5 Agenda para Apps Script (lectura; sirve `service_key` o `user_token`)

`GET /businesses/{id}/appointments?from=2026-11-02T00:00:00-03:00&to=2026-11-02T23:59:59-03:00&staff_id=b3f…&status=confirmed,pending&limit=100`

```json
{
  "data": [
    {
      "id": "a1b2…",
      "status": "confirmed",
      "starts_at": "…",
      "ends_at": "…",
      "staff": { "id": "b3f…", "display_name": "Lucas" },
      "customer": {
        "id": "c77…",
        "full_name": "Juan Pérez",
        "phone_e164": "+5491155551234",
        "instagram_handle": "juanp",
        "completed_count": 4
      },
      "service": {
        "id": "7d0e…",
        "name": "Corte",
        "price_cents": 1200000,
        "duration_minutes": 30
      },
      "external_links": [],
      "version": 2,
      "updated_at": "…"
    }
  ],
  "page": { "next_cursor": null, "has_more": false }
}
```

Los datos de cliente dependen del scope y del rol (sin `internal_notes` para `service_key`; el barbero no ve notas de reservas ajenas).

### 3.6 Conflicto de versión

`POST …/appointments/{apptId}/complete` con `If-Match: "3"` cuando la reserva ya está en versión 4:

```json
HTTP/1.1 412 Precondition Failed
{ "type": "https://docs.turnos.app/errors/version-conflict", "status": 412, "code": "VERSION_CONFLICT",
  "title": "El recurso cambió", "current_version": 4, "request_id": "req_01HY…" }
```

Sin `If-Match`: `428 PRECONDITION_REQUIRED`.

## 4. Feed de cambios y reconciliación

### 4.1 `GET /integrations/changes`

Entrega **todos** los cambios confirmados, en orden estable, **sin pérdidas aunque las transacciones se confirmen fuera de orden**. Respaldo en BD: doc 04 §3.20 (`change_log` con `tx_id xid8`).

- **Cursor** opaco: base64url de `{"t":"<tx_id>","s":<seq>,"v":1}` (sin firma: el servidor siempre filtra por el negocio de la credencial; un cursor manipulado sólo puede repetir o saltar datos **propios**). Inicial: sin `cursor` ⇒ desde el comienzo de la retención.
- **Consulta**: `(tx_id, seq) > cursor` **y** `tx_id < horizonte`, donde `horizonte = pg_snapshot_xmin(pg_current_snapshot())` (la transacción abierta más antigua). Todo `tx_id` menor al horizonte ya terminó; por lo tanto ninguna fila nueva puede aparecer por debajo de él y el cursor nunca «se salta» una confirmación tardía.
- **Garantías**: (1) _no se pierden cambios_; (2) orden total por `(tx_id, seq)`; (3) entrega _al menos una vez_ (el consumidor es idempotente: upsert por `id` y descarte si `version` entrante ≤ almacenada); (4) varias entradas de la misma entidad en una página se colapsan en la última.
- **Costo conocido**: una transacción larga en el servidor retrasa el avance del feed (no lo corrompe). Se mitiga con `idle_in_transaction_session_timeout`, `statement_timeout` y alerta de retraso > 5 min.
- **Paginación**: `limit` ≤ 200; `has_more`. **Retención** 90 días: cursor anterior → `410 CURSOR_EXPIRED` → reconstruir con §4.2.

```json
{
  "data": [
    {
      "entity": "appointment",
      "op": "upsert",
      "id": "a1b2…",
      "version": 5,
      "payload": {
        "id": "a1b2…",
        "status": "completed",
        "starts_at": "…",
        "staff_id": "…",
        "customer_id": "…"
      }
    },
    {
      "entity": "customer_merge",
      "op": "upsert",
      "id": "c77…",
      "version": 3,
      "payload": { "merged_into_id": "c80…" }
    }
  ],
  "next_cursor": "eyJ0IjoiOTE4MjczIiwicyI6NDIsInYiOjF9",
  "has_more": false
}
```

Entidades: `appointment`, `customer`, `customer_merge` (tombstone), `service_record_link`. `op: "delete"` sólo para desvinculaciones/tombstones (retención 90 días).

### 4.2 `GET /integrations/reconcile` (reconciliación)

Mecanismo **independiente del cursor** para detectar y reparar divergencias (cursor perdido, hoja editada a mano, reinstalación, `410`).

`GET /integrations/reconcile?from=2026-10-25&to=2026-12-01` → por día **en la zona del negocio**:

```json
{
  "timezone": "America/Argentina/Buenos_Aires",
  "days": [{ "date": "2026-11-02", "count": 14, "checksum": "9b2f…" }]
}
```

`checksum = md5(string_agg(id || ':' || version, ',' ORDER BY id))` de las reservas del día (md5 sólo como suma de verificación, no como control de seguridad).
**Procedimiento del consumidor**: (1) calcular el mismo `checksum` sobre su réplica; (2) para cada día con `count` o `checksum` distintos, pedir `GET …/appointments?from&to&fields=id,version,status` y reparar **sólo** las filas distintas (upsert/borrado local); (3) registrar discrepancias en `Sync_Errors`; (4) si el cursor devolvió `410`, reconciliar la ventana completa `[hoy−30 d, hoy+60 d]` y luego pedir un cursor nuevo. Frecuencia: nocturna y bajo demanda.

## 5. Reglas de autorización (resumen implementable)

1. Resolver actor (sesión/token) → resolver tenant → verificar rol/scope → verificar **propiedad** del recurso (`business_id` coincide; barbero: `staff_member_id` propio) → ejecutar. En contextos sin sesión la verificación ocurre **dentro de la base de datos** (doc 08 §3.1); el API no es la única barrera.
2. La decisión autoritativa vive en SQL (`app.authorize` + `app.role_permissions`); el módulo TS `can()` se genera de la misma fuente (`supabase/permissions.json`) y sirve para la UI y para fallar rápido.
3. Para integración: `user_token` ⇒ **intersección** scopes del token ∩ permisos del rol del miembro asociado; `service_key` ⇒ sólo lectura, siempre.
4. Los IDs de otros negocios devuelven `404`.
5. Ninguna cabecera, parámetro o cuerpo puede declarar identidad, rol ni negocio con valor de autoridad.
