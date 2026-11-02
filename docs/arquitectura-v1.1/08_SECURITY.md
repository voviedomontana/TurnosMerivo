# 08 — Seguridad, multi‑tenancy y protección de datos

## 1. Modelo de amenazas (resumen)

| Amenaza                                                       | Vector                                            | Control principal                                                                                                             |
| ------------------------------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Acceso entre tenants                                          | ID de otro negocio en URL/body, IDOR              | `businessId` verificado + RLS + FKs compuestas + 404 uniforme                                                                 |
| Escalamiento de privilegios                                   | Auto‑asignarse rol, token con más scopes          | Escrituras de membresía sólo por función; techo de rol; scopes ∩ rol                                                          |
| Abuso del endpoint público                                    | Bots, reservas masivas, enumeración               | Rate limit, Turnstile, límites por teléfono, respuestas no reveladoras                                                        |
| Robo de credenciales de integración                           | Fuga de token GAS                                 | Hash en BD, scopes, expiración, rotación, revocación inmediata; **`service_key` sólo lectura** (una fuga no permite escribir) |
| Parámetro de identidad falsificado en funciones privilegiadas | Llamada a RPC con `actor_id`/`business_id` ajenos | Identidad derivada en la función (§3.1), sin parámetros de autoridad, `EXECUTE` por rol único                                 |
| Pérdida de cambios en la sincronización                       | Transacciones confirmadas fuera de orden          | `change_log` por `tx_id` + horizonte + reconciliación (doc 05 §4)                                                             |
| Fuga por logs/errores                                         | PII en logs                                       | Redacción, no loguear body de públicos, Sentry con scrubbing                                                                  |
| Manipulación de reservas                                      | Token de gestión adivinado                        | 256 bits, hash en BD, expiración, rate limit por token                                                                        |
| Inyección                                                     | SQL/XSS                                           | Consultas parametrizadas, Zod, escapado React, CSP                                                                            |

## 2. Autenticación

- **Staff/Admin**: Supabase Auth (email+contraseña con política mínima de 10 caracteres y verificación de email; magic link opcional; **TOTP/MFA obligatorio para `owner`/`admin`** a partir del Sprint 3, recomendado para el resto).
- **Sesiones**: cookies `HttpOnly; Secure; SameSite=Lax` (patrón SSR de Supabase), expiración del access token ≤ 1 h con refresh rotatorio; cierre de sesión revoca refresh token; "cerrar sesión en todos los dispositivos" disponible.
- **Clientes**: sin cuenta. Token de gestión (`crypto.randomBytes(32)`, base64url) por reserva; se guarda SHA‑256; viaja en fragmento `#t=` (no llega a logs del servidor ni a `Referer`) y en header `X-Manage-Token`; vence 24 h tras el turno; invalidable.
- **Integraciones**: tokens (doc 07).
- **Plataforma**: `platform_admins` con MFA obligatorio; sin permisos implícitos sobre negocios.

## 3. Autorización y roles por negocio

- Modelo: `business_members(role ∈ owner|admin|barber)` + `staff_members` para el alcance "propio". Matriz en doc 02 §6.
- Roles **leídos de la BD en cada request** (no de claims del JWT). Un único evaluador `can(actor, action, resource)` + RLS como red de seguridad.
- **Prevención de escalamiento**:
  1. `business_members` sin permisos DML directos; sólo `api.manage_member()` (identidad = `auth.uid()`, `aal2`).
  2. Nadie modifica su propio rol/estado; sólo `owner` crea/cambia `admin`; `admin` sólo gestiona `barber`; no se puede dejar al negocio sin `owner`.
  3. Tokens de integración: scopes ≤ permisos del creador; un `barber` sólo crea `user_token` propio.
  4. Invitaciones con token de un solo uso, 7 días, atadas a email.
  5. Toda función `SECURITY DEFINER` sigue la verificación de identidad por contexto del §3.1 (sin parámetros de actor/rol; `search_path=''`; `EXECUTE` por rol único).
- **Acceso excepcional del superadmin**: `support_grants` con motivo, expiración (≤ 4 h), notificación al `owner`, y registro `audit_logs(actor_type='platform_admin')`. Sin lectura silenciosa.

### 3.1 Verificación de identidad en funciones privilegiadas (`SECURITY DEFINER`)

**Problema corregido**: las versiones previas de la especificación mostraban funciones que recibían `p_actor_id`/`p_business_id` por parámetro. Como las funciones definer corren como `postgres` (`BYPASSRLS`), un parámetro falsificado se habría convertido en autoridad. **Regla v1.1**: ninguna función privilegiada acepta identidad o rol como parámetro; la identidad se **deriva dentro de la función** y se verifica **membresía en el tenant** y **permiso efectivo** en cada llamada. Modelo de esquemas y privilegios: doc 04 §4.1.

| Contexto                                 | Quién invoca (rol de BD)                                                          | Cómo se **verifica la identidad**                                                                                                                                                                                                                                                                                                                                                                                            | Pertenencia al tenant                                                                                       | Permiso efectivo                                                                                                                                                                                                                             | Lo que **no** se acepta como autoridad                                               |
| ---------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Sesión Supabase** (admin, barbero)     | `authenticated` vía `api.*` (PostgREST con el JWT del usuario)                    | `auth.uid()` (JWT validado por Supabase/PostgREST); `app.ctx_session(p_business_id)` busca `business_members` con `user_id = auth.uid()` y `status='active'`; para operaciones sensibles exige `aal2` (`auth.jwt()->>'aal'`)                                                                                                                                                                                                 | El `p_business_id` es sólo _selector_: si el usuario no es miembro → `TS005` (el API lo muestra como `404`) | `app.authorize(ctx, action, staff_member_id)` con `app.role_permissions`; barbero: `staff_members.member_id` → su `business_members.user_id = auth.uid()`                                                                                    | `p_actor_id`, `p_user_id`, `p_role`, claims de rol del JWT, `business_id` del body   |
| **Reserva pública** (cliente sin cuenta) | `app_server` vía `app_internal.public_*`                                          | No hay identidad de usuario. Autoridad = **capacidad limitada**: (a) el tenant lo resuelve la función a partir del **slug** (`public_booking_enabled` y `status='active'`); (b) acciones sobre una reserva existente exigen `p_token_hash` que se compara en tiempo constante con `manage_token_hash` **y** `manage_token_expires_at > now()`; (c) Turnstile, rate limit y validación se aplican **antes** en la capa de API | Derivada del slug o de la fila de la reserva (nunca de un `business_id` recibido)                           | Conjunto fijo y mínimo: ver catálogo/disponibilidad, crear reserva, ver/cancelar/reprogramar **la reserva del token**. `source='public_web'`, `actor_type='customer'` y `override=false` están **fijados en la función** (no son parámetros) | `business_id`, `source`, `override_policies`, `status` inicial                       |
| **Integración** (Apps Script u otro)     | `app_server` vía `app_internal.integration_*`                                     | `app.ctx_integration(p_token_hash, p_required_scope)`: busca la credencial por `token_prefix`+hash; exige `status='active'`, `expires_at` vigente, negocio activo, y para `user_token` **miembro activo**. Se evalúa **en cada llamada, sin caché** (revocación inmediata)                                                                                                                                                   | Del registro de la credencial; el `businessId` de la ruta debe coincidir o → `404`                          | `scopes ∩ permisos del rol del miembro` (`user_token`); `service_key` **sólo lectura** (CHECK + `ctx_integration` rechaza scopes de escritura + las funciones de escritura exigen `credential_kind='user_token'`)                            | `X-Actor-Asserted`, nombres de usuario de Apps Script, cualquier `actor_id` del body |
| **Worker** (jobs)                        | `app_server` vía `app_internal.worker_*`; o `pg_cron` ejecutando SQL directamente | HTTP: secreto `INTERNAL_JOBS_SECRET` (comparación en tiempo constante, distinto por entorno) → luego rol de BD `app_server`. Las funciones `worker_*` **no tienen parámetros de negocio ni de actor**: reclaman filas por `FOR UPDATE SKIP LOCKED` y operan sólo sobre ellas                                                                                                                                                 | Cada fila trae su `business_id`; el worker no lo recibe de afuera                                           | Contexto fijo `actor_type='system'`, acciones limitadas a `notification.dispatch`, `appointment.expire`, `cleanup.*`                                                                                                                         | Cualquier identidad o filtro enviado por HTTP                                        |
| **Soporte de plataforma**                | `authenticated`                                                                   | `app.is_platform_admin()` (tabla `platform_admins`, MFA `aal2`) **más** `support_grants` vigente para ese negocio (motivo, ≤ 4 h)                                                                                                                                                                                                                                                                                            | `support_grants.business_id`                                                                                | Sólo lo que el _grant_ declara (lectura por defecto)                                                                                                                                                                                         | Rol de plataforma sin _grant_                                                        |

Reglas comunes:

1. **Errores que no filtran**: no ser miembro, recurso inexistente y recurso de otro tenant producen el mismo error (`TS005`); rol insuficiente dentro del tenant propio → `42501`.
2. **El tenant efectivo es siempre `ctx.business_id`**; toda consulta se filtra por él y las referencias se resuelven por `(business_id, id)`. Los IDs recibidos de otros negocios no encuentran filas.
3. **Funciones internas de núcleo** (`app.*_core`, `app.authorize`, `app.ctx_*`) no tienen `EXECUTE` para ningún rol de API: sólo se ejecutan desde los _wrappers_ definer.
4. **Doble barrera para `service_key`**: ante un intento de escritura se rechaza en el API (`403 INSUFFICIENT_SCOPE`) y, aunque el API fallara, la función de BD vuelve a rechazarlo (`TS012`).
5. **Auditoría**: toda escritura registra `actor_type`, `user_id/member_id` o `credential_id` **derivados del contexto**, nunca de parámetros.

**Catálogo de funciones privilegiadas** (extracto; la lista completa se mantiene en `supabase/function-catalog.md` y la verifica el test del doc 11 §12):

| Función                                                                                                                                                                                                 | Esquema / rol                 | Contexto                                   | Acción verificada                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------ | ------------------------------------------------------- |
| `api.create_appointment`, `api.reschedule_appointment`, `api.transition_appointment`, `api.adjust_appointment`                                                                                          | `api` / `authenticated`       | sesión                                     | `appointment.*` (barbero: propia)                       |
| `api.manage_member`, `api.create_integration_credential`, `api.revoke_integration_credential`, `api.update_business_settings`                                                                           | `api` / `authenticated`       | sesión (`aal2`)                            | `member.manage`, `credential.manage`, `business.update` |
| `api.merge_customers`, `api.upsert_mapping`, `api.delete_mapping`, `api.update_working_hours`, `api.create_time_block`                                                                                  | `api` / `authenticated`       | sesión                                     | `customer.merge`, `mapping.write`, `staff.hours.write`… |
| `app_internal.public_get_business`, `public_get_availability_data`, `public_create_appointment`, `public_manage_get/cancel/reschedule`                                                                  | `app_internal` / `app_server` | público                                    | capacidad pública                                       |
| `app_internal.integration_list_*`, `integration_changes`, `integration_reconcile` (lecturas)                                                                                                            | `app_internal` / `app_server` | integración (`service_key` o `user_token`) | scopes `*:read`                                         |
| `app_internal.integration_create_appointment`, `integration_transition_appointment`, `integration_reschedule_appointment`, `integration_link_service_record`, `integration_upsert_mapping` (escrituras) | `app_internal` / `app_server` | integración **sólo `user_token`**          | scopes `*:write`/`*:status` ∩ rol                       |
| `app_internal.worker_dispatch_notifications`, `worker_cleanup`                                                                                                                                          | `app_internal` / `app_server` | worker                                     | sistema                                                 |
| `app.create_appointment_core`, `app.transition_core`, `app.reschedule_core`, `app.authorize`, `app.ctx_*`                                                                                               | `app` / _ninguno_             | interno                                    | —                                                       |

### 3.2 Controles de verificación automática

- **Test de catálogo en CI** (pgTAP): toda función `SECURITY DEFINER` (a) tiene `search_path=''`, (b) no es ejecutable por `PUBLIC`/`anon`, (c) en `api` sólo por `authenticated` y en `app_internal` sólo por `app_server`, (d) **ningún parámetro** coincide con `%actor%|%user_id%|%member_id%|%role%|%created_by%`, (e) está listada en el catálogo.
- **Tests de identidad por contexto** (doc 11 §12): JWT falsificado/expirado, miembro de otro negocio, barbero ajeno, token revocado/vencido/de otro negocio, `service_key` en escritura, slug equivocado, token de gestión ajeno o vencido, llamada directa a `app.*_core`.
- **Revisión humana obligatoria** de toda función definer nueva (checklist del doc 04 §4.1).

## 4. Aislamiento multi‑tenant — capas

1. **Aplicación**: el tenant se resuelve de fuente confiable (doc 03 §4.2) y se pasa explícitamente a cada función de módulo.
2. **Base de datos (estructural)**: `business_id` NN en todo; **FKs compuestas** impiden vincular un cliente de A con un profesional de B; unicidades compuestas por negocio.
3. **RLS** (`ENABLE` + `FORCE`) en todas las tablas; `anon` sin privilegios; `authenticated` sólo `SELECT` en tablas sensibles y DML restringido por políticas en tablas de configuración.
4. **Rol de servidor `app_server` sin privilegios sobre tablas**: los contextos sin sesión (público, integración, workers) sólo acceden a datos mediante funciones `app_internal.*` que derivan el tenant del slug/credencial/fila (§3.1). La clave `service_role` de Supabase no se usa para datos de negocio.
5. **Pruebas automáticas** de aislamiento (pgTAP + e2e) en CI: bloquea el merge si falla.

### Escenarios de ataque y respuesta esperada

| #    | Intento                                                                                                      | Respuesta                                                                      |
| ---- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| X-01 | Admin del negocio A llama `GET /businesses/{B}/appointments`                                                 | `404 NOT_FOUND` (no es miembro de B); sin diferenciar de inexistente           |
| X-02 | Admin A llama `GET /businesses/{A}/appointments/{id_de_B}`                                                   | `404`; además RLS devolvería 0 filas                                           |
| X-03 | `POST /businesses/{A}/appointments` con `staff_id` del negocio B                                             | FK compuesta falla → `422/404`; la función valida `(business_id, staff_id)`    |
| X-04 | Barbero intenta `GET` reservas de otro barbero                                                               | RLS/`can()` → `403` (o lista vacía)                                            |
| X-05 | Barbero hace `PATCH /members/{self}` `role=admin`                                                            | `403`; la función rechaza auto‑modificación                                    |
| X-06 | Admin intenta crear otro `owner`                                                                             | `403` (sólo owner)                                                             |
| X-07 | Token de integración del negocio A llama rutas de B                                                          | `404` (businessId ≠ token)                                                     |
| X-08 | Token con scope `appointments:read` intenta `POST complete`                                                  | `403 INSUFFICIENT_SCOPE`                                                       |
| X-09 | Cliente con token de reserva X consulta reserva Y                                                            | `404`                                                                          |
| X-10 | Usuario con JWT válido usa PostgREST directamente contra `appointments` con `INSERT`                         | Sin privilegio de INSERT → error de permisos                                   |
| X-11 | Usuario modifica `business_id` en un `UPDATE` de `services`                                                  | `WITH CHECK` y FK compuesta lo impiden                                         |
| X-12 | Fuerza bruta de IDs de reserva públicos                                                                      | UUID v4 + token + rate limit + 404 uniforme                                    |
| X-13 | Usuario miembro de A y B cambia el `businessId` de la URL                                                    | Se re‑verifica membresía por request; permisos son **por negocio**             |
| X-14 | Cliente intenta ver si un teléfono ya existe (enumeración)                                                   | La reserva pública responde igual exista o no el cliente                       |
| X-15 | Usuario autenticado llama `api.create_appointment` con `p_business_id` de un negocio donde **no** es miembro | `TS005` → `404`; 0 filas escritas                                              |
| X-16 | Intento de pasar un actor falsificado (`p_actor_id`, `created_by`)                                           | No existe tal parámetro; el test de catálogo (§3.2) falla si alguien lo agrega |
| X-17 | `anon`/`authenticated` invocan `app_internal.*` o `app.*_core` vía PostgREST o SQL                           | Sin `USAGE`/`EXECUTE` → `42501`                                                |
| X-18 | `app_server` intenta `SELECT`/`INSERT` directo en tablas                                                     | Sin privilegios sobre tablas                                                   |
| X-19 | `service_key` (Modo R, sólo lectura) intenta cualquier escritura (`complete`, `link`, `mappings`, `cancel`…) | `403 INSUFFICIENT_SCOPE` en el API y `TS012` en la BD (doble barrera)          |
| X-20 | `user_token` de un barbero intenta completar la reserva de otro barbero                                      | `42501`/`403` (propiedad `own`)                                                |
| X-21 | Token revocado o vencido                                                                                     | `401` en la **siguiente** solicitud (sin caché)                                |
| X-22 | Token de gestión de la reserva A usado sobre la reserva B, o vencido                                         | `404` / `410 MANAGE_LINK_EXPIRED`                                              |
| X-23 | `service_key` o `user_token` crea un mapeo hacia una entidad de otro negocio                                 | FK compuesta + `ctx.business_id` → falla; 0 filas                              |
| X-24 | Barbero intenta `revert` o `unlink`                                                                          | `42501`                                                                        |
| X-25 | Dos solicitudes simultáneas modifican el mismo recurso con el mismo `If-Match`                               | Una `200`, otra `412 VERSION_CONFLICT` (doc 05 §1.8)                           |

## 5. Protección de endpoints públicos y anti‑abuso

- Turnstile (o hCaptcha) en `POST` público; verificación server‑side.
- Rate limits (doc 05 §1.6) por IP, teléfono, email y negocio; límites de reservas activas por cliente.
- Honeypot y tiempo mínimo de formulario (≥ 3 s).
- Validación estricta; normalización de teléfono; bloqueo de dominios de email descartables (lista configurable).
- `pending` con TTL corto evita acaparamiento si se activa confirmación.
- Detección: alertas por picos de reservas/cancelaciones desde la misma IP/teléfono; lista de bloqueo por negocio.
- CORS cerrado: sólo orígenes propios; las integraciones server‑to‑server no necesitan CORS.
- Cabeceras: CSP estricta, HSTS, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'` salvo widget futuro.
- Subidas (logo/foto): sólo imágenes, validación de MIME real y tamaño, bucket con políticas por `business_id`.

## 6. Gestión de secretos y credenciales

- Variables de entorno en Vercel (separadas por entorno); `SUPABASE_SERVICE_ROLE_KEY` sólo en servidor y únicamente para Auth Admin/Storage (nunca para datos de negocio ni `NEXT_PUBLIC_`); credencial de BD `DATABASE_URL_APP_SERVER` del rol `app_server`, distinta por entorno.
- Rotación semestral de secretos de plataforma; secreto de jobs internos distinto por entorno.
- `integration_credentials`: sólo hash; token visible una vez; escaneo de secretos en CI (gitleaks).
- Dependencias: Dependabot + `npm audit` en CI; versiones fijadas con lockfile.

## 7. Auditoría

`audit_logs` registra: cambios de rol/membresía, creación/rotación/revocación de credenciales, cambios de configuración del negocio, cambios de horarios/servicios, fusión de clientes, reversión de estados, acciones con `override_policies`/`force`, accesos de soporte, exportaciones. `appointment_events` cubre el ciclo de vida de reservas. Ambas **append‑only** (privilegios revocados + trigger que lanza excepción en UPDATE/DELETE). Las escrituras de integración se atribuyen a la **credencial y al miembro verificados** (`integration_credential_id` + `actor_user_id`); el Modo R (`service_key`) no realiza escrituras y sus lecturas quedan sólo en logs de aplicación.

## 8. Backups y recuperación

- Backups diarios automáticos de Supabase + **PITR** (Point‑in‑Time Recovery; requiere plan/complemento adecuado — verificar). RPO objetivo ≤ 15 min con PITR (24 h sin él); RTO objetivo ≤ 4 h.
- Export lógico semanal (`pg_dump`) cifrado a un almacenamiento independiente del proveedor.
- **Simulacro de restauración trimestral** documentado (restaurar a proyecto temporal y validar conteos/constraints).
- Migraciones probadas en _staging_ con copia anonimizada.

## 9. Protección de datos personales — Argentina

> **Aviso**: lo siguiente son medidas técnicas y puntos a validar. **No constituye asesoramiento legal.** Verificar normativa vigente con un abogado especializado antes del lanzamiento comercial.

### 9.1 Medidas técnicas recomendadas (Ley 25.326 — principios de calidad, finalidad, seguridad y confidencialidad)

- **Minimización**: sólo nombre, teléfono, email (opcional), Instagram (opcional). Sin datos sensibles (salud, etc.); evitar que `notes` los contengan (aviso en UI).
- **Finalidad y consentimiento informado**: checkbox explícito con versión de política registrada (`consent_version`, `consented_at`); consentimiento de marketing **separado** y opcional.
- **Seguridad y confidencialidad**: cifrado en tránsito (TLS) y en reposo (proveedor), RLS, mínimo privilegio, auditoría, backups cifrados.
- **Derechos de acceso, rectificación y supresión**: procedimiento y funciones: exportar datos de un cliente, rectificar, **anonimizar** (reemplazar nombre/teléfono/email por valores neutros conservando métricas) y eliminar cuando no exista obligación de conservación. Plazos de respuesta según normativa (validar).
- **Retención**: política definida por tipo de dato (doc 04 §6); purga/anonimización programada.
- **Incidentes**: runbook de brechas con evaluación, contención, notificación a afectados y a la autoridad si corresponde.
- **Roles de tratamiento**: en el modelo SaaS, cada barbería es responsable del tratamiento de sus clientes y la plataforma actúa como encargada/proveedor de servicios → requiere contrato/términos de tratamiento de datos.
- Separación lógica de datos por tenant (ya diseñada) y ausencia de uso de datos de un negocio para otro.

### 9.2 Cuestiones que requieren validación legal

1. Obligación de **registro de bases de datos** ante la autoridad de aplicación (AAIP) y quién debe registrar (barbería vs. plataforma).
2. **Transferencia internacional de datos**: Supabase/Vercel pueden alojar fuera de Argentina (p. ej. Brasil/EE. UU.); validar si aplica nivel de protección adecuado, cláusulas contractuales modelo o consentimiento, según normativa vigente.
3. Textos de **política de privacidad y términos**, leyenda de derechos del titular y datos de contacto del responsable.
4. Consentimiento para **WhatsApp/email de marketing** y requisitos de opt‑in/opt‑out (y políticas de Meta para WhatsApp Business).
5. Plazos de retención y de respuesta a derechos ARCO; contenido del procedimiento de anonimización.
6. Efectos de normas posteriores (p. ej. adhesión de Argentina al Convenio 108+, reformas en trámite): revisar el estado actual al momento del lanzamiento.
7. Contratos con proveedores (DPA) y subencargados (Supabase, Vercel, proveedor de email/WhatsApp).
8. Tratamiento de datos de Instagram (handle) como dato personal público/identificable.

## 10. Checklist de seguridad previo a producción

- [ ] RLS habilitada y forzada en todas las tablas; tests de aislamiento verdes.
- [ ] `anon` sin acceso a tablas; sin `INSERT/UPDATE/DELETE` directos sobre `appointments`.
- [ ] MFA obligatorio para owner/admin/superadmin.
- [ ] Rate limits y Turnstile verificados con pruebas de carga.
- [ ] Cabeceras de seguridad y CSP revisadas.
- [ ] Rotación/revocación de tokens probada end‑to‑end.
- [ ] Test de catálogo de funciones `SECURITY DEFINER` (search_path, EXECUTE por rol único, sin parámetros de actor) verde.
- [ ] `service_key` verificada como sólo lectura (CHECK + API + función) y revocación inmediata probada.
- [ ] Feed de cambios probado con transacciones confirmadas fuera de orden; reconciliación probada.
- [ ] Simulacro de restauración completado.
- [ ] Revisión legal de privacidad/términos completada.
- [ ] Prueba de penetración básica (OWASP ASVS L1/L2 checklist) sobre API pública y de integración.
