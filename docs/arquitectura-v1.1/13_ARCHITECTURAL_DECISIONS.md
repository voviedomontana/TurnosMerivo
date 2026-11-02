# 13 — Registro de decisiones arquitectónicas (ADR)

Formato: **Decisión · Justificación · Alternativas · Riesgos · Impacto futuro**. Estado: _Propuesta_ hasta que se acepte explícitamente. **v1.1**: ADR‑003, 004, 007, 008 y 017 revisadas; ADR‑019 a 022 nuevas (ver `CHANGELOG.md`).

---

## ADR-001 — Monolito modular en Next.js (sin microservicios)

- **Decisión**: una sola aplicación Next.js con módulos de dominio en `src/modules/*`, API en Route Handlers, workers como rutas internas.
- **Justificación**: 5–10 usuarios internos y una barbería; un solo despliegue, un solo lenguaje, menor costo y carga operativa. La modularidad (dependencias unidireccionales, APIs públicas por módulo) permite extraer piezas luego.
- **Alternativas**: (a) microservicios — sobrecoste sin beneficio; (b) backend separado (NestJS/Fastify) — duplica despliegue y contratos; (c) sólo Supabase (PostgREST + Edge Functions) — lógica dispersa y menor testabilidad.
- **Riesgos**: handlers "gordos" que mezclan lógica; límites de duración de funciones serverless; acoplamiento accidental entre módulos.
- **Impacto futuro**: workers y motor de notificaciones son candidatos naturales a extraer; la API v1 desacopla clientes.

## ADR-002 — Multi‑tenancy: base compartida, `business_id`, RLS y FKs compuestas

- **Decisión**: un esquema, `business_id` en todas las tablas de negocio, `UNIQUE(business_id,id)` + FKs compuestas, RLS forzada, tenant resuelto por fuente confiable.
- **Justificación**: costo y operación mínimos; el aislamiento estructural en BD impide referencias cruzadas aun con bugs de aplicación.
- **Alternativas**: (a) esquema por tenant — migraciones N veces, complejidad con PostgREST/Supabase; (b) BD por tenant — aislamiento máximo pero caro e inmanejable a escala pequeña; (c) sin RLS (sólo aplicación) — una falla = fuga.
- **Riesgos**: _noisy neighbor_; error de política RLS; rendimiento de políticas con subconsultas.
- **Impacto futuro**: se puede migrar tenants grandes a BD dedicada exportando por `business_id`; particionado posible.

## ADR-003 — Prevención de doble reserva con `EXCLUDE USING gist` + función transaccional _(revisada v1.1)_

- **Decisión**: restricción de exclusión sobre `(staff_member_id, tstzrange(starts_at, blocked_until,'[)'))` para estados ocupantes (`pending`,`confirmed`,`completed`); función `app.create_appointment_core` que **bloquea en orden ascendente todas las filas de profesionales candidatas** antes de validar, valida horarios/bloqueos/políticas bajo ese lock y hace cada `INSERT`/`UPDATE` sujeto al `EXCLUDE` dentro de un **bloque `BEGIN … EXCEPTION WHEN exclusion_violation`** (subtransacción implícita). **No se usan `SAVEPOINT`/`ROLLBACK TO`/`COMMIT` en funciones** (no existen en PL/pgSQL).
- **Justificación**: garantía en el motor de datos, independiente del cliente; correcta bajo concurrencia con `READ COMMITTED` (lock + constraint); el bloque `EXCEPTION` permite probar el siguiente candidato en «cualquier profesional» sin efectos residuales.
- **Alternativas**: (a) validar sólo en aplicación — carreras; (b) `SERIALIZABLE` con reintentos — más complejo; (c) tabla de slots pre‑generados con UNIQUE — rígida; (d) advisory locks — complemento, no sustituto del constraint; (e) `PROCEDURE` con `COMMIT/ROLLBACK` — descartado: no puede usarse dentro de bloque de transacción ni de bloques `EXCEPTION`, y rompería la atomicidad de efectos (eventos/outbox).
- **Riesgos**: lock de todos los candidatos serializa reservas con candidatos solapados (aceptable a esta escala); costo de subtransacciones (limitado a un `INSERT` por intento); `time_blocks` no están en el constraint y dependen del lock + `check_slot`.
- **Impacto futuro**: multi‑recurso exigiría constraints adicionales; multi‑servicio exige `appointment_items`.

## ADR-004 — Escrituras de `appointments` sólo mediante funciones SQL con identidad derivada _(revisada v1.1)_

- **Decisión**: revocar `INSERT/UPDATE/DELETE` a `anon`, `authenticated` y `app_server`; toda escritura vía funciones `SECURITY DEFINER` cuya identidad se **deriva dentro de la función** (ADR-019).
- **Justificación**: un único camino que aplica reglas (horarios, políticas, snapshot, eventos, outbox, versión); evita bypass desde PostgREST.
- **Alternativas**: lógica sólo en TypeScript (evitable desde otras rutas); triggers (invisibles).
- **Riesgos**: lógica en SQL → mantenimiento; riesgo de definer mal escrito → ADR-019 y test de catálogo.
- **Impacto futuro**: portabilidad a otro Postgres gestionado conserva la lógica.

## ADR-005 — Identificación de clientes por teléfono E.164; Instagram como atributo y mapeo

- **Decisión**: unicidad parcial `(business_id, phone_e164)`; Instagram opcional, no único; vínculos externos en `external_id_mappings`; duplicados por cola de revisión y `merge_customers`.
- **Justificación**: el teléfono es estable y requerido para reservar; Instagram cambia, puede ser compartido o inexistente.
- **Alternativas**: (a) Instagram como clave — frágil; (b) email — no siempre disponible; (c) cuenta de cliente con OTP — mejor verificación, más fricción (diferido).
- **Riesgos**: números compartidos (familia) → un cliente ve el historial de otro; teléfono mal escrito crea duplicado. Mitigación: no revelar datos en reserva pública, fusión manual.
- **Impacto futuro**: añadir OTP/WhatsApp para verificar propiedad del número.

## ADR-006 — Reprogramar = actualizar la misma reserva (atómico) + evento

- **Decisión**: `UPDATE` de horario/profesional con revalidación; `reschedule_count`, evento `rescheduled`; sin estado "reprogramado".
- **Justificación**: atomicidad (no se pierde el slot original si falla), enlace de gestión estable, historial en eventos.
- **Alternativas**: crear nueva + cancelar vieja (dos filas, ventana de inconsistencia, métricas inflan cancelaciones).
- **Riesgos**: analítica de "cuántas reprogramaciones" depende de eventos. **Impacto**: ninguno relevante.

## ADR-007 — Integración GAS híbrida (agenda bajo demanda + sincronización incremental de reportes) _(ajustada v1.1: escritura sólo con identidad verificada)_

- **Decisión**: ver doc 07 §1. Sincronización unidireccional Postgres→Sheets para reservas; GAS **lee** con `service_key` y **escribe sólo con `user_token`** (ADR-008); en Modo R las acciones se hacen en el panel de turnos.
- **Justificación**: latencia real donde importa; reportes robustos ante caídas; sin sobrescrituras.
- **Alternativas**: sólo on‑demand (reportes lentos y caros en cuota); sólo sync (agenda desfasada); doble escritura bidireccional (conflictos).
- **Riesgos**: cuotas de `UrlFetchApp`, desfase en reportes (≤ 15 min). **Impacto**: la hoja `Turnos_RO` es descartable y reconstruible.

## ADR-008 — Credenciales de integración: `service_key` sólo lectura + `user_token` con identidad verificada _(revisada v1.1)_

- **Decisión**: tokens aleatorios de 256 bits (hash SHA‑256 en BD), scopes, expiración, rotación, revocación inmediata (verificación en BD en cada llamada). **`service_key`: sólo lectura**, garantizado por `CHECK`, por `ctx_integration` y por las funciones de escritura. **Toda escritura exige `user_token`** de un miembro (permisos = scopes ∩ rol). Si Apps Script no puede dar identidad individual (Modo R), **no escribe en el MVP**: las acciones se hacen en el panel de turnos. Sin «actor asertado»: ninguna cabecera declarada tiene valor de autorización.
- **Justificación**: una credencial compartida no prueba quién actúa; permitir escrituras «limitadas» con identidad declarada habilita suplantación y auditoría falsa.
- **Alternativas**: (a) `service_key` con escrituras de bajo riesgo + actor asertado — **descartada** (riesgo de suplantación y trazabilidad no confiable); (b) OAuth 2.0/OIDC con `ScriptApp.getIdentityToken()` — **a evaluar en el spike de S2**, sólo útil si el script corre como el usuario que accede; (c) JWT firmados por el servidor; (d) mTLS (no viable en GAS).
- **Riesgos**: menor comodidad en Modo R; filtración de `user_token` (mitigada por expiración 90 d, scopes ∩ rol, revocación inmediata, auditoría).
- **Impacto futuro**: sustituir por OAuth cuando existan integraciones de terceros.

## ADR-009 — Notificaciones con outbox transaccional en Postgres

- **Decisión**: tabla `notifications` escrita en la misma transacción del cambio; worker con `FOR UPDATE SKIP LOCKED`, backoff, `dedupe_key`.
- **Justificación**: sin pérdida ni envíos fantasma; sin broker; trivial de observar.
- **Alternativas**: llamar al proveedor dentro del request (pierde notificaciones/ralentiza); cola externa (SQS, Inngest, Trigger.dev) — valioso al crecer, innecesario ahora.
- **Riesgos**: duplicados si el proveedor no es idempotente (se mitiga con `provider_message_id` y reintentos prudentes); latencia por polling (≤ 1 min).
- **Impacto futuro**: la interfaz `NotificationProvider` permite WhatsApp/SMS; el worker puede migrar a cola dedicada.

## ADR-010 — Una API con tres modos de autenticación

- **Decisión**: mismas rutas para UI, GAS y terceros; autorización central `can()` y scopes.
- **Justificación**: un solo contrato, menos duplicación; probado una vez.
- **Alternativas**: APIs separadas por cliente (divergen); GraphQL (complejidad innecesaria).
- **Riesgos**: cambios de UI rompen integraciones → versionado y contract tests. **Impacto**: OpenAPI generado habilita SDKs.

## ADR-011 — Un servicio por reserva en el MVP

- **Decisión**: `appointments.service_id` único; sin `appointment_items`.
- **Justificación**: el 90 % de los turnos de barbería son de un servicio; simplifica el motor.
- **Alternativas**: multi‑servicio con suma de duraciones (ítems).
- **Riesgos**: clientes que quieren "corte + barba": se modelan como servicio combinado en el catálogo. **Impacto**: migración a `appointment_items` posible sin romper la API (campo `services[]` futuro).

## ADR-012 — Reserva pública sin autenticación obligatoria

- **Decisión**: sin cuenta; token de gestión + confirmación por email; mitigaciones anti‑abuso.
- **Justificación**: la fricción reduce conversión; el valor de una cuenta es bajo en barberías.
- **Alternativas**: cuenta obligatoria (alta fricción); OTP por SMS/WhatsApp (costo y complejidad; diferido); magic link por email (para gestión futura).
- **Riesgos**: reservas falsas/spam; suplantación por teléfono ajeno. Mitigación: Turnstile, límites, penalización por ausencias (futuro), lista de bloqueo.
- **Impacto**: activar OTP por negocio con un flag cuando sea necesario.

## ADR-013 — Roles leídos de la BD, no de claims del JWT

- **Decisión**: membresía y rol se consultan por request (con caché corto en servidor); no se usan _custom claims_ para autorización.
- **Justificación**: revocación inmediata y consistencia multi‑negocio; los claims quedan obsoletos hasta renovar token.
- **Alternativas**: claims en `app_metadata` (más rápido, pero stale y por‑negocio incómodo).
- **Riesgos**: una consulta extra por request (mínima, indexada). **Impacto**: optimizable con caché.

## ADR-014 — Almacenamiento en UTC + horario local en tablas de horarios; sin cambio de zona con reservas futuras

- **Decisión**: `timestamptz` UTC para instantes; `time`/`date` locales para jornadas; zona IANA en `businesses`.
- **Justificación**: correcto ante DST; horarios "9:00" siguen siendo 9:00 locales.
- **Alternativas**: guardar todo en hora local (ambigüedad DST).
- **Riesgos**: errores de conversión → librería única (Luxon), tests DST. **Impacto**: soporte multi‑país.

## ADR-015 — Sin ORM pesado: SQL/migraciones como fuente del esquema, tipos generados

- **Decisión**: migraciones SQL; tipos TS generados de la BD; consultas con Kysely o `supabase-js`.
- **Justificación**: aprovechamos constraints, funciones y RLS que un ORM oculta o no modela (EXCLUDE, RLS).
- **Alternativas**: Prisma/Drizzle — válidos para CRUD, pero la lógica crítica seguiría en SQL; Drizzle es una opción razonable para consultas tipadas si se prefiere.
- **Riesgos**: más SQL manual. **Impacto**: ninguno.

## ADR-016 — Rate limiting con Upstash Redis

- **Decisión**: límites distribuidos por IP/teléfono/token con Upstash Ratelimit.
- **Justificación**: serverless no comparte memoria; Redis gestionado y barato.
- **Alternativas**: contadores en Postgres (más carga y latencia), WAF de Vercel (complemento, no sustituto de límites por teléfono/token).
- **Riesgos**: dependencia adicional; si cae → política _fail‑open_ para lectura y _fail‑closed_ para creación pública. **Impacto**: sustituible.

## ADR-017 — Feed de cambios por `tx_id` con horizonte de visibilidad y reconciliación _(revisada v1.1; reemplaza `(updated_at, id)` + solapamiento de 5 min)_

- **Decisión**: tabla `change_log` (triggers en la misma transacción) con `tx_id xid8 = pg_current_xact_id()` y `seq`; el feed devuelve filas con `(tx_id, seq) > cursor` **y** `tx_id < pg_snapshot_xmin(pg_current_snapshot())`; consumidor idempotente por `id`+`version`; **reconciliación** por `count/checksum` diario (`/integrations/reconcile`) y retención de 90 días con `410 CURSOR_EXPIRED`.
- **Justificación**: `updated_at` (y las secuencias) se asignan al escribir, no al confirmar: una transacción confirmada tarde queda **detrás** del cursor y se pierde; un solapamiento fijo sólo cubre transacciones más cortas que la ventana. Con el horizonte, todo `tx_id` menor ya terminó, por lo que no pueden aparecer filas nuevas por debajo: **no hay pérdida por orden de confirmación**.
- **Alternativas**: (a) `updated_at` + solapamiento (heurístico, descartada); (b) secuencia global (mismo problema de visibilidad); (c) CDC/logical replication (excesivo para el MVP); (d) webhooks salientes (complemento futuro).
- **Riesgos**: una transacción larga retrasa el feed (no lo corrompe) → timeouts de sesión y alerta; requiere PG ≥ 13.
- **Impacto futuro**: el mismo `change_log` alimenta webhooks y notificaciones a terceros.

## ADR-018 — Superadmin sin acceso implícito; acceso de soporte con motivo y expiración

- **Decisión**: `support_grants` + auditoría + aviso al owner.
- **Justificación**: confianza de los tenants y cumplimiento.
- **Alternativas**: acceso total permanente (riesgo legal y de seguridad).
- **Riesgos**: fricción para soporte. **Impacto**: base para certificaciones futuras.

---

## ADR-019 — Identidad y autorización en funciones `SECURITY DEFINER` por contexto _(nueva v1.1)_

- **Decisión**: ninguna función privilegiada recibe `actor_id`/`user_id`/`role`/`created_by`. Esquemas `api` (sesión, `auth.uid()`), `app_internal` (servidor: público por slug/token de gestión, integración por hash de credencial, worker sin parámetros de negocio), `app` (núcleo no ejecutable por roles de API). `app_server` sin privilegios sobre tablas. `business_id` es sólo selector validado contra el contexto. Autorización con `app.authorize` + `app.role_permissions` (fuente `permissions.json`). Test de catálogo en CI.
- **Justificación**: los definers corren como `postgres` (`BYPASSRLS`); un parámetro de identidad falsificable sería autoridad. Verificar dentro de la BD protege incluso si el API tiene un bug.
- **Alternativas**: confiar en el servidor (service role + `p_actor_id`) — descartada; RLS puro sin funciones — insuficiente para reglas transaccionales; GUC de sesión inyectado por el servidor — descartada por ser igualmente falsificable por quien tenga acceso SQL.
- **Riesgos**: más funciones/wrappers; curva de mantenimiento; la clave de `app_server` es crítica (rotación, entorno). Si se compromete `app_server`, el atacante sólo puede ejecutar funciones **con credenciales/slug/tokens válidos**, no leer tablas.
- **Impacto futuro**: nuevos contextos (webhooks de pago) se agregan como nuevo `ctx_*` con su verificación.

## ADR-020 — Concurrencia optimista con `version`, `If-Match` y `412` _(nueva v1.1)_

- **Decisión**: `version` por trigger en recursos mutables; `If-Match` obligatorio para staff/integración (`428` si falta), opcional para el cliente por token; desajuste → `412 VERSION_CONFLICT` con `current_version`; comparación **tras** autorizar y **bajo lock** de fila; la idempotencia se evalúa **antes** que la versión; el servidor no reintenta conflictos de versión.
- **Justificación**: evita pérdida de actualizaciones (dos admins/barberos) y estados obsoletos en GAS; `412` es el código estándar de RFC 9110 para precondiciones.
- **Alternativas**: _last write wins_ (pierde cambios); bloqueo pesimista de UI (frágil); `409` genérico (menos semántico).
- **Riesgos**: fricción de UX ante conflictos → recarga guiada. **Impacto**: ETags habilitan caché condicional.

## ADR-021 — Integridad temporal por derivación + `CHECK`, y reglas de resultado/reversión _(nueva v1.1)_

- **Decisión**: fuente única `starts_at` + snapshots de duración/buffer; `ends_at` y `blocked_until` derivados por trigger y verificados por `CHECK` con operadores inmutables; snapshots inmutables salvo `adjust_appointment`; `completed_at`/`no_show_at` excluyentes (`CHECK`); guardas temporales configurables; `revert` sólo admin/owner con motivo, bloqueado si hay vínculo externo; contadores **recalculados**.
- **Justificación**: las columnas generadas no admiten `timestamptz + interval` (no inmutable); derivar+verificar da coherencia sin confiar en el llamador y permite el `EXCLUDE`.
- **Alternativas**: columnas generadas (inviables), confiar en la aplicación (frágil), tabla de intervalos separada (complejidad).
- **Riesgos**: trigger adicional; migraciones que cambien la fórmula deben revalidar datos. **Impacto**: soporta multi‑servicio al derivar de ítems.

## ADR-022 — Mapeos externos con FKs tipadas e índices únicos por negocio _(nueva v1.1)_

- **Decisión**: columnas `customer_id`/`staff_member_id`/`service_id`/`appointment_id` con FKs compuestas `(business_id, x)`, `CHECK` de destino único coherente con `entity_type`, `UNIQUE` por `(negocio, sistema, tipo, external_id)` y 1:1 inverso salvo `customer`; inmutabilidad por trigger; escritura sólo por funciones con identidad verificada.
- **Justificación**: una columna polimórfica `internal_id` no admite FK y permite referencias huérfanas o entre tenants.
- **Alternativas**: `internal_id` + triggers de validación (más frágil); una tabla por tipo (más tablas sin necesidad).
- **Riesgos**: columnas nulas por tipo (acotado por `CHECK`). **Impacto**: nuevos tipos requieren columna y migración (intencional).

## Decisiones diferidas (con punto de extensión definido)

| Tema                                 | Cuándo decidir            | Punto de extensión ya presente                                    |
| ------------------------------------ | ------------------------- | ----------------------------------------------------------------- |
| Proveedor de pagos y modelo de señas | Al priorizar cobros       | `pending` + `expires_at` + `payment_ref`                          |
| Planes/suscripciones del SaaS        | Antes de abrir a terceros | `businesses.plan_id`, `billing_customer_ref`, `app.check_limit()` |
| Sucursales                           | Primer cliente multi‑sede | Agregar `locations` y FK nullable                                 |
| WhatsApp                             | Tras validar email        | `notifications.channel`, `NotificationProvider`                   |
| Dominios personalizados              | Demanda comercial         | Resolvedor de tenant único                                        |
| Cola externa de jobs                 | Si el volumen lo exige    | Outbox + workers idempotentes                                     |
