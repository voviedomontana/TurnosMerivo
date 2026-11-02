# 11 — Estrategia de pruebas

## 1. Principios

1. Las reglas críticas (disponibilidad, doble reserva, aislamiento) se prueban **donde viven**: en PostgreSQL (pgTAP) y en el módulo puro `scheduling` (Vitest).
2. **TDD obligatorio** en: `scheduling`, funciones SQL de reservas, `can()` y normalización de teléfonos.
3. Todo código generado por Codex requiere tests; sin tests no se aprueba el PR.
4. Pruebas deterministas: reloj inyectable (`now`), semillas fijas en property‑based, datos de prueba por _factories_.

## 2. Pirámide y herramientas

| Nivel                     | Qué cubre                                                                   | Herramienta                                             | Cuándo corre             |
| ------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------ |
| Unit                      | Utilidades, `computeSlots`, políticas, `can()`, normalización               | Vitest + fast‑check                                     | Cada commit              |
| Base de datos             | Constraints, EXCLUDE, FKs compuestas, RLS, funciones, privilegios, triggers | pgTAP (`supabase test db`)                              | Cada PR                  |
| Integración API           | Route Handlers con BD real (Supabase local), auth real                      | Vitest + supertest‑like fetch                           | Cada PR                  |
| Contrato                  | Respuestas contra OpenAPI; compatibilidad hacia atrás                       | Schemathesis/`openapi-diff`                             | Cada PR                  |
| E2E                       | Flujos completos (público móvil, panel por rol)                             | Playwright (Chromium + WebKit móvil)                    | PR a main + nightly      |
| Concurrencia/carga        | Doble reserva, ráfagas, disponibilidad                                      | k6 + script SQL                                         | Nightly/previo a release |
| Seguridad                 | Aislamiento tenants, abuso, dependencias, secretos                          | pgTAP + e2e + OWASP ZAP baseline, gitleaks, `npm audit` | PR / nightly             |
| Accesibilidad/rendimiento | axe, Lighthouse CI                                                          | Playwright + LHCI                                       | PR a main                |

## 3. Pruebas del motor (resumen; casos B‑01…B‑56 en doc 06 §7 y §7.1)

- **Unit/Property** (`scheduling`): para cualquier conjunto aleatorio de horarios, excepciones, bloqueos y reservas, los slots devueltos: (1) están dentro de jornada, (2) no solapan bloqueos ni reservas (con buffer), (3) respetan grilla, notice y ventana. Idempotencia: mismo input → mismo output. Casos DST con zonas de prueba.
- **pgTAP**: `EXCLUDE` rechaza solape y acepta contigüidad; `status` fuera del predicado libera el slot; CHECKs (`blocked_until >= ends_at`, `pending ↔ expires_at`).
- **Concurrencia real**:
  - Test 1: 50 conexiones simultáneas llaman `create_appointment` por el mismo slot → exactamente 1 éxito.
  - Test 2: 200 solicitudes a 20 slots con "cualquier profesional" y 4 profesionales → ningún solape, asignación balanceada, ningún error 500.
  - Test 3: reprogramaciones cruzadas simultáneas (A→slot de B y B→slot de A) → sin deadlock persistente (orden consistente de locks; reintento en `40P01`).
  - Test 4: creación de bloqueo concurrente con reserva en el mismo rango → uno de los dos falla de forma controlada.
  - Test 5: expiración de `pending` simultánea con nueva reserva.
- **Deadlocks**: las funciones toman locks en orden determinista (por `staff_member_id` ascendente); manejo de `40001/40P01` con reintento acotado.

## 4. Pruebas de aislamiento multi‑tenant (obligatorias en CI)

Fixture: negocios A y B; usuarios `ownerA`, `barberA`, `ownerB`, usuario multi‑negocio `ownerA+barberB`, token de integración A y B, token de reserva.
Para **cada tabla** con `business_id`: con cada actor, `SELECT/INSERT/UPDATE/DELETE` sobre filas del otro negocio ⇒ 0 filas/denegado. Más los casos X‑01…X‑25 (doc 08). Test generador: recorre `information_schema` y **falla** si una tabla con `business_id` carece de RLS habilitada o de política.

## 5. Pruebas de autorización

Tabla de verdad generada desde la matriz (doc 02 §6): (actor × acción × recurso propio/ajeno) → esperado. Se ejecuta en unit (`can()`), en SQL (`app.authorize`) y se verifica en API con 3–4 casos representativos por endpoint. **Test de equivalencia**: la matriz del doc 02 §6, `supabase/permissions.json`, `app.role_permissions` y `can()` deben coincidir (falla el CI si divergen). Casos de escalamiento: auto‑promoción, creación de `owner` por `admin`, token con scope extra, creación de token ajeno.

## 6. Pruebas de integración con GAS

- Entorno _staging_ de API + hoja y script de pruebas (clon).
- **Modo R (sólo lectura)**: lectura de agenda; `Turnos_RO` por feed; «Pendientes de registrar» (completed sin `ID Turno`); registro precargado con doble clic (dos ejecuciones simultáneas) → 1 fila gracias a `LockService` + lookup; reconciliación detecta una fila alterada; cursor expirado (`410`) → resync; 429 con reintento; token revocado → error claro; **cualquier intento de escritura con `service_key` → error local `WRITE_NOT_ALLOWED` y, si se fuerza, `403 INSUFFICIENT_SCOPE`**.
- **Modo A (si el spike lo habilita)**: completar con `user_token` + `If-Match`; `412` mostrado a la UI sin reintento; fallo entre `append` y `link` → el siguiente intento de vínculo es idempotente y la reconciliación lo detecta; token de otro usuario no disponible (propiedades por usuario).
- Pruebas unitarias de lógica GAS extraída a funciones puras (con `clasp` + Jest) cuando sea posible.

## 7. Pruebas de notificaciones

Proveedor simulado con modos (OK, 5xx, timeout, 4xx permanente). Verificar: backoff, `dead` tras 5 intentos, dedupe (ejecutar el worker 2× en paralelo), cancelación de recordatorios al cancelar/reprogramar, contenido correcto por tipo, zona horaria en el texto.

## 8. E2E principales

1. Reserva pública en móvil (servicio→profesional→hora→datos→confirmación→email).
2. Conflicto: dos navegadores eligen el mismo slot; el segundo recibe alternativas.
3. Gestión por token: cancelar dentro/fuera de política; reprogramar.
4. Admin: crear reserva manual con `override`, bloquear vacaciones, ver conflictos.
5. Barbero: ve sólo lo propio; completa turno.
6. Invitación de miembro, MFA, cambio de negocio.

## 9. Datos de prueba y entornos

Factories (TypeScript) + semillas SQL: 2 negocios, 3 profesionales, 5 servicios, horarios con descanso, feriado, DST (negocio auxiliar `America/New_York`). Nunca datos reales en dev/staging; copia anonimizada de producción sólo con scripts de anonimización aprobados.

## 10. Criterios de calidad / gates de CI

- Cobertura: ≥ 90 % líneas en `scheduling` y `auth`; ≥ 80 % en `booking`; funciones SQL críticas con 100 % de ramas probadas (pgTAP).
- Cero tests marcados `skip` en áreas críticas.
- Gate de PR: lint + typecheck + unit + pgTAP (incl. **catálogo de funciones definer**) + integración + aislamiento. Gate de release: + e2e + k6 + ZAP baseline + Lighthouse.
- Flaky tests: se arreglan o se eliminan en < 1 semana.

## 11. Pruebas de carga (objetivos)

| Prueba                | Carga                    | Objetivo                          |
| --------------------- | ------------------------ | --------------------------------- |
| Disponibilidad        | 50 req/s durante 5 min   | p95 < 600 ms, 0 errores           |
| Reservas              | 20 req/s sobre 200 slots | 0 solapes, p95 < 800 ms           |
| Changes feed          | 10 req/s con 100 k filas | p95 < 400 ms                      |
| Worker notificaciones | 1 000 pendientes         | procesadas < 3 min sin duplicados |

## 12. Pruebas de identidad en funciones privilegiadas (v1.1)

**Test de catálogo** (pgTAP, bloquea el merge): sobre `pg_proc` de los esquemas `app`, `api`, `app_internal`:

1. Toda función `SECURITY DEFINER` tiene `proconfig` con `search_path=""`.
2. Ninguna es ejecutable por `PUBLIC` ni `anon`; las de `api` sólo por `authenticated`; las de `app_internal` sólo por `app_server`; las `app.*_core`, `app.authorize` y `app.ctx_*` por **nadie** salvo el dueño.
3. **Ningún parámetro** se llama como `%actor%`, `%user_id%`, `%member_id%`, `%role%`, `%created_by%`; `p_business_id` sólo en funciones `api.*` (selector).
4. Ninguna función PL/pgSQL contiene `SAVEPOINT`, `ROLLBACK TO` ni `COMMIT` (B‑41).
5. Toda función definer figura en `supabase/function-catalog.md`.
6. `app_server` no tiene privilegio alguno sobre tablas; `authenticated` no tiene `INSERT/UPDATE/DELETE` sobre `appointments`, `business_members`, `integration_credentials`, `external_id_mappings`.

**Matriz de pruebas de identidad** (cada fila = un test que llama a la función real con `SET LOCAL request.jwt.claims…` o con el rol/argumentos indicados):

| Contexto    | Caso                                                                                   | Esperado                                                                        |
| ----------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Sesión      | JWT válido, miembro activo de A, `p_business_id`=A, rol suficiente                     | OK                                                                              |
| Sesión      | Usuario sin membresía en B llama con `p_business_id`=B                                 | `TS005`                                                                         |
| Sesión      | Miembro `suspended` o invitación pendiente                                             | `TS005`                                                                         |
| Sesión      | Barbero llama acción de admin / reserva de otro barbero                                | `42501`                                                                         |
| Sesión      | Admin sin `aal2` en función sensible (`manage_member`, credenciales, settings)         | `42501` (`AAL2_REQUIRED`)                                                       |
| Sesión      | Sin JWT (`auth.uid()` NULL)                                                            | `42501`                                                                         |
| Público     | `public_create_appointment` con slug inexistente o negocio con reservas deshabilitadas | `TS005`                                                                         |
| Público     | Token de gestión de otra reserva / vencido / hash incorrecto                           | `TS005` / `TS010`                                                               |
| Público     | Intento de enviar `source` u `override`                                                | No existen como parámetros (test de catálogo)                                   |
| Integración | `user_token` válido con scope y rol suficientes                                        | OK; `audit_logs` con `credential_id` y `actor_user_id` derivados                |
| Integración | Token revocado, vencido, de otro negocio, miembro suspendido                           | `401`/`TS005` en la **siguiente** llamada                                       |
| Integración | `service_key` con cualquier función de escritura                                       | `TS012`                                                                         |
| Integración | `user_token` de barbero sobre reserva ajena                                            | `42501`                                                                         |
| Integración | Scope `appointments:read` en acción de escritura                                       | `TS012`                                                                         |
| Worker      | Función `worker_*` ejecutada por `authenticated`                                       | `42501`                                                                         |
| Worker      | `worker_dispatch_notifications` sólo toca filas reclamadas; no acepta `business_id`    | Verificado por catálogo + test de dos workers                                   |
| Núcleo      | `app_server`/`authenticated` llaman `app.create_appointment_core`                      | `42501`                                                                         |
| Atribución  | Cualquier escritura                                                                    | `created_by_*`, eventos y auditoría provienen del contexto, nunca de argumentos |

## 13. Transacciones, rollback y asignación automática (v1.1)

Casos B‑31…B‑40 del doc 06 §7.1, ejecutados con **conexiones reales concurrentes** (no mocks). Requisitos de la suite:

- Triggers _sólo de prueba_ (creados por el propio test y eliminados al finalizar) para inyectar una colisión `23P01` previa al `INSERT` principal (B‑33) y un fallo posterior (B‑34). Ningún hook de prueba existe en el código de producción.
- Aserciones sobre **estado completo** tras cada caso: filas en `appointments`, `appointment_events`, `notifications`, `idempotency_keys`, `change_log`, contadores del cliente.
- Pruebas de **lock ordering** (B‑37): mezcla de `create`, `reschedule`, `revert` de `no_show` y expiración, 1 000 iteraciones, métrica de `40P01` = 0 tras reintentos.
- Asignación automática (B‑32): 4 profesionales, 200 solicitudes, verificación de equilibrio y de ausencia de solapes con una consulta de solapamiento por profesional.

## 14. Feed de cambios y reconciliación (v1.1)

| #    | Escenario                                                                                                                     | Resultado esperado                                                                                      |
| ---- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| F-01 | Tx A escribe y queda **abierta**; Tx B escribe y **confirma**; el consumidor lee                                              | No recibe B todavía (horizonte); tras confirmar A recibe A y B, en orden `(tx_id, seq)`                 |
| F-02 | Tx A abierta con `updated_at` anterior; B confirma; el consumidor avanza; A confirma 10 min después                           | **Ningún cambio se pierde** (con `updated_at`+5 min el de A se perdería: caso de regresión documentado) |
| F-03 | Tx abortada                                                                                                                   | No aparece en el feed                                                                                   |
| F-04 | Varias actualizaciones de la misma reserva en una página                                                                      | Se colapsan en una entrada con la `version` más reciente                                                |
| F-05 | Corte de página en medio de una transacción con varias filas                                                                  | Siguiente página continúa por `seq`; sin duplicados ni saltos                                           |
| F-06 | Reintento de la misma página (cursor repetido)                                                                                | Misma respuesta (idempotente)                                                                           |
| F-07 | Cursor anterior a `purged_through_tx`                                                                                         | `410 CURSOR_EXPIRED`                                                                                    |
| F-08 | Cursor manipulado/mal formado                                                                                                 | `400`; si es válido pero ajeno, sólo expone datos del propio negocio                                    |
| F-09 | Fusión de clientes                                                                                                            | Entrada `customer_merge` (tombstone)                                                                    |
| F-10 | Tx larga (> 5 min) abierta                                                                                                    | El feed se retrasa pero **no** omite datos; alerta de retraso disparada                                 |
| R-01 | Reconciliación sin divergencias                                                                                               | `count`/`checksum` iguales ⇒ sin descargas                                                              |
| R-02 | Hoja editada a mano (cambio de estado local)                                                                                  | Día marcado distinto; reparación sólo de las filas diferentes                                           |
| R-03 | Cursor perdido o `410`                                                                                                        | Reconciliación de ventana completa + cursor nuevo; consistencia final verificada                        |
| R-04 | Checksum con zona horaria (día local)                                                                                         | Reservas cercanas a medianoche asignadas al día local correcto                                          |
| R-05 | Test de propiedad: aplicar el consumidor (upsert por `id`+`version`) sobre una secuencia aleatoria de escrituras concurrentes | Réplica final idéntica al estado de la BD                                                               |

## 15. Control de concurrencia (`version` / `If-Match`) (v1.1)

| #    | Escenario                                                                | Resultado esperado                                                     |
| ---- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| V-01 | `PATCH` sin `If-Match` en recurso versionado                             | `428 PRECONDITION_REQUIRED`                                            |
| V-02 | `If-Match` mal formado                                                   | `400`                                                                  |
| V-03 | `If-Match` correcto                                                      | `200`, `version+1`, `ETag` nuevo                                       |
| V-04 | `If-Match` desactualizado                                                | `412 VERSION_CONFLICT` con `current_version`; sin cambios              |
| V-05 | Dos `PATCH` simultáneos con el mismo `If-Match` (20 repeticiones)        | Exactamente 1 × `200`, 1 × `412`                                       |
| V-06 | Dos «Completar» simultáneos de dos barberos/usuarios                     | 1 × `200`, 1 × `412`; 1 evento                                         |
| V-07 | `cancel` del cliente (sin `If-Match`) concurrente con `cancel` del admin | 1 efecto; el otro `409 INVALID_STATE_TRANSITION`                       |
| V-08 | Mismo `Idempotency-Key` tras avanzar la versión                          | Respuesta original almacenada (la idempotencia precede a la versión)   |
| V-09 | Usuario sin permiso con versión errónea                                  | `403/404`, **nunca** `412` (la versión se evalúa después de autorizar) |
| V-10 | Recurso de otro tenant con cualquier `If-Match`                          | `404`                                                                  |
| V-11 | `PUT` de horarios con `If-Match` de la versión del profesional           | `200` y la versión del profesional incrementa; con versión vieja `412` |
| V-12 | Intento de enviar `version` en el body para forzarla                     | Ignorado (trigger la recalcula)                                        |
| V-13 | `UPDATE` sin cambios                                                     | No incrementa versión (la capa de servicio no escribe)                 |
| V-14 | Cliente GAS recibe `412`                                                 | No reintenta; muestra estado actual (test de la librería)              |

## 16. Mapeos de identificadores externos (v1.1)

| #    | Escenario                                                                 | Resultado esperado                                          |
| ---- | ------------------------------------------------------------------------- | ----------------------------------------------------------- |
| M-01 | Crear mapeo hacia entidad de otro negocio                                 | FK compuesta falla; `TS005`                                 |
| M-02 | Mismo `external_id` hacia dos clientes                                    | `TS008 DUPLICATE_RESOURCE` (`map_u_external`)               |
| M-03 | Dos `service_record` para una misma reserva                               | `TS009 ALREADY_LINKED` (`map_u_internal`)                   |
| M-04 | Un `service_record` para dos reservas                                     | `TS008`                                                     |
| M-05 | Mismo `PUT` repetido                                                      | `200` no-op                                                 |
| M-06 | Un cliente con 2 IDs externos distintos (fusión)                          | Permitido; un ID externo sigue siendo único                 |
| M-07 | `staff_member` con dos IDs externos                                       | `TS009`                                                     |
| M-08 | Cambiar `entity_type`, `business_id` o el destino de un mapeo             | Rechazado por `mapping_guard`                               |
| M-09 | `CHECK map_one_target`: dos destinos o destino que no corresponde al tipo | Rechazado                                                   |
| M-10 | `external_id` con espacios en los extremos, vacío o > 200                 | Rechazado                                                   |
| M-11 | `service_key` o `user_token` sin rol admin intentan `PUT`                 | `TS012`/`42501`                                             |
| M-12 | Merge de clientes con mapeos                                              | Mapeos reasignados al destino; duplicado idéntico eliminado |
| M-13 | Mapeo `needs_review`                                                      | No cuenta como vínculo efectivo en flujos de servicio       |
| M-14 | Revertir `completed` con vínculo                                          | `TS007`; tras desvincular, OK                               |

## 17. Integridad temporal y resultado de atención (v1.1)

Casos B‑42…B‑52 del doc 06 §7.1, más pruebas de **propiedad**: para secuencias aleatorias de `create/reschedule/adjust`, en toda fila se cumple `ends_at = starts_at + duration` y `blocked_until = ends_at + buffer`; para secuencias aleatorias de `complete/no_show/revert/cancel`, se cumple `appt_outcome_fields` y los contadores del cliente coinciden con los recomputados.
