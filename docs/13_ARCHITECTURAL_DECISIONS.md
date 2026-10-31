# 13 — Registro de decisiones arquitectónicas (ADR)

Formato: **Decisión · Justificación · Alternativas · Riesgos · Impacto futuro**. Estado: *Propuesta* hasta que se acepte explícitamente.

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
- **Riesgos**: *noisy neighbor*; error de política RLS; rendimiento de políticas con subconsultas.
- **Impacto futuro**: se puede migrar tenants grandes a BD dedicada exportando por `business_id`; particionado posible.

## ADR-003 — Prevención de doble reserva con `EXCLUDE USING gist` + función transaccional
- **Decisión**: restricción de exclusión sobre `(staff_member_id, tstzrange(starts_at, blocked_until,'[)'))` para estados ocupantes; lock de fila del profesional en la función para validar horarios/bloqueos sin carreras.
- **Justificación**: garantía en el motor de datos, independiente del cliente; correcta bajo concurrencia sin `SERIALIZABLE`.
- **Alternativas**: (a) validar sólo en aplicación — carreras; (b) `SERIALIZABLE` con reintentos — más complejo y costoso; (c) tabla de slots pre‑generados con UNIQUE — rígida ante cambios de duración/horarios; (d) bloqueos advisory — ok como complemento, no sustituye el constraint.
- **Riesgos**: `blocked_until` debe calcularse correctamente (almacenado, no generado, por volatilidad de `timestamptz + interval`); bloqueos (`time_blocks`) no están cubiertos por el constraint y dependen del lock + función.
- **Impacto futuro**: multi‑recurso (sillas, salas) requeriría constraints adicionales; multi‑servicio por turno exige `appointment_items`.

## ADR-004 — Escrituras de `appointments` sólo mediante funciones SQL
- **Decisión**: revocar `INSERT/UPDATE/DELETE` a `anon` y `authenticated`; operaciones vía funciones `SECURITY DEFINER` (`search_path=''`) que verifican actor y tenant.
- **Justificación**: un único camino que aplica reglas (horarios, políticas, snapshot, eventos, outbox); evita bypass desde PostgREST.
- **Alternativas**: lógica sólo en TypeScript (más fácil de depurar, pero evitable desde otras rutas); triggers (invisibles, difíciles de testear).
- **Riesgos**: lógica de negocio en SQL → curva de mantenimiento; riesgo de `SECURITY DEFINER` mal escrito (escalamiento). Mitigación: revisión, tests pgTAP, actor derivado de `auth.uid()`/contexto del servidor.
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

## ADR-007 — Integración GAS híbrida (agenda bajo demanda + sincronización incremental de reportes)
- **Decisión**: ver doc 07 §1. Sincronización unidireccional Postgres→Sheets para reservas; GAS ejecuta comandos vía API.
- **Justificación**: latencia real donde importa; reportes robustos ante caídas; sin sobrescrituras.
- **Alternativas**: sólo on‑demand (reportes lentos y caros en cuota); sólo sync (agenda desfasada); doble escritura bidireccional (conflictos).
- **Riesgos**: cuotas de `UrlFetchApp`, desfase en reportes (≤ 15 min). **Impacto**: la hoja `Turnos_RO` es descartable y reconstruible.

## ADR-008 — Credenciales de integración: `service_key` + `user_token`, con modo degradado
- **Decisión**: tokens aleatorios de 256 bits (hash SHA‑256), scopes, expiración, rotación; token por usuario cuando GAS permita identidad individual; Modo B con restricciones y actor asertado no verificado.
- **Justificación**: una credencial compartida no prueba identidad; se limita el daño y se mejora cuando es posible.
- **Alternativas**: OAuth 2.0 / Google ID token (verificar identidad Google del usuario desde GAS con `ScriptApp.getIdentityToken()` si el manifiesto lo permite — **evaluar en spike**, mejora el Modo B); JWT firmados por el servidor; mTLS (no viable en GAS).
- **Riesgos**: filtración de token en hoja/log; usuario pega token en lugar equivocado.
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
- **Decisión**: membresía y rol se consultan por request (con caché corto en servidor); no se usan *custom claims* para autorización.
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
- **Riesgos**: dependencia adicional; si cae → política *fail‑open* para lectura y *fail‑closed* para creación pública. **Impacto**: sustituible.

## ADR-017 — Feed de cambios con cursor `(updated_at, id)` y solapamiento
- **Decisión**: ver doc 05 §4; consumidor idempotente.
- **Justificación**: simple y robusto frente a commits fuera de orden.
- **Alternativas**: secuencia global (mismos huecos de visibilidad), CDC/logical replication (excesivo), webhooks (futuro, complementarios).
- **Riesgos**: reprocesar duplicados (inocuo por idempotencia). **Impacto**: webhooks salientes cuando existan terceros.

## ADR-018 — Superadmin sin acceso implícito; acceso de soporte con motivo y expiración
- **Decisión**: `support_grants` + auditoría + aviso al owner.
- **Justificación**: confianza de los tenants y cumplimiento.
- **Alternativas**: acceso total permanente (riesgo legal y de seguridad).
- **Riesgos**: fricción para soporte. **Impacto**: base para certificaciones futuras.

---

## Decisiones diferidas (con punto de extensión definido)
| Tema | Cuándo decidir | Punto de extensión ya presente |
|---|---|---|
| Proveedor de pagos y modelo de señas | Al priorizar cobros | `pending` + `expires_at` + `payment_ref` |
| Planes/suscripciones del SaaS | Antes de abrir a terceros | `businesses.plan_id`, `billing_customer_ref`, `app.check_limit()` |
| Sucursales | Primer cliente multi‑sede | Agregar `locations` y FK nullable |
| WhatsApp | Tras validar email | `notifications.channel`, `NotificationProvider` |
| Dominios personalizados | Demanda comercial | Resolvedor de tenant único |
| Cola externa de jobs | Si el volumen lo exige | Outbox + workers idempotentes |
