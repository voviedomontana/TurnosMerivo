> Consolidación 2026-10-31: doc 14 incorporado. Propuestas P-xx y gates en
> [informe de consolidación](CONSOLIDATION_REPORT.md); esta edición no autoriza implementación.

> **Actualización de seguridad:** consultar `14_CORRECCIONES_CRITICAS.md` antes de implementar. Si existe contradicción, prevalecen esas correcciones.

# 08 — Seguridad, multi‑tenancy y protección de datos

## 1. Modelo de amenazas (resumen)

| Amenaza | Vector | Control principal |
|---|---|---|
| Acceso entre tenants | ID de otro negocio en URL/body, IDOR | `businessId` verificado + RLS + FKs compuestas + 404 uniforme |
| Escalamiento de privilegios | Auto‑asignarse rol, token con más scopes | Escrituras de membresía sólo por función; techo de rol; scopes ∩ rol |
| Abuso del endpoint público | Bots, reservas masivas, enumeración | Rate limit, Turnstile, límites por teléfono, respuestas no reveladoras |
| Robo de credenciales de integración | Fuga de token GAS | Hash en BD, scopes, expiración, rotación, revocación inmediata |
| Fuga por logs/errores | PII en logs | Redacción, no loguear body de públicos, Sentry con scrubbing |
| Manipulación de reservas | Token de gestión adivinado | 256 bits, hash en BD, expiración, rate limit por token |
| Inyección | SQL/XSS | Consultas parametrizadas, Zod, escapado React, CSP |

## 2. Autenticación

- **Staff/Admin**: Supabase Auth (email+contraseña con política mínima de 10 caracteres y verificación de email; magic link opcional; **TOTP/MFA obligatorio para `owner`/`admin`** desde el Sprint 2 de autenticación, recomendado para el resto).
- **Sesiones**: cookies `HttpOnly; Secure; SameSite=Lax` (patrón SSR de Supabase), expiración del access token ≤ 1 h con refresh rotatorio; cierre de sesión revoca refresh token; "cerrar sesión en todos los dispositivos" disponible.
- **Clientes**: sin cuenta. Token de gestión (`crypto.randomBytes(32)`, base64url) por reserva; se guarda SHA‑256; viaja en fragmento `#t=` (no llega a logs del servidor ni a `Referer`) y en header `X-Manage-Token`; vence 24 h tras el turno; invalidable.
- **Integraciones**: tokens (doc 07).
- **Plataforma**: `platform_admins` con MFA obligatorio; sin permisos implícitos sobre negocios.

## 3. Autorización y roles por negocio

- Modelo: `business_members(role ∈ owner|admin|barber)` + `staff_members` para el alcance "propio". Matriz en doc 02 §6.
- Roles **leídos de la BD en cada request** (no de claims del JWT). Un único evaluador `can(actor, action, resource)` + RLS como red de seguridad.
- **Prevención de escalamiento**:
  1. `business_members` sin permisos DML directos; sólo operación autorizada de membresía; identidad desde auth.uid(), permiso y MFA cuando corresponda (doc 04 §4).
  2. Nadie modifica su propio rol/estado; sólo `owner` crea/cambia `admin`; `admin` sólo gestiona `barber`; no se puede dejar al negocio sin `owner`.
  3. Tokens de integración: scopes ≤ permisos del creador; un `barber` sólo crea `user_token` propio.
  4. Invitaciones con token de un solo uso, 7 días, atadas a email.
  5. `SECURITY DEFINER` con `search_path=''` y verificación explícita del actor dentro de la función (nunca confiar en parámetros `p_actor_id` recibidos del cliente: se deriva de auth.uid() o de credencial/capacidad que la operación de BD verifica; no aceptar un actor inyectado como autoridad).
- **Acceso excepcional del superadmin**: `support_grants` con motivo, expiración (≤ 4 h), notificación al `owner`, y registro `audit_logs(actor_type='platform_admin')`. Sin lectura silenciosa.

### 3.1 Funciones privilegiadas y fronteras de confianza

Aplicar el contrato único de doc 04 §4. Derivar identidad dentro de la operación:
`auth.uid()` en sesión; credencial/capacidad verificada para integración/público;
trabajo reclamado para worker. No basta que Next.js pase actor_id por un parámetro.
Una GUC/setter de contexto accesible por el llamador no prueba identidad.

Revocar EXECUTE de PUBLIC y defaults; grants mínimos por función y esquema,
search_path vacío y nombres calificados. El núcleo privado no es RPC pública.
Helpers de membresía permitidos por RLS requieren catálogo y excepción acotada,
propietario revisado y tests antirrecursión. Una función con dueño BYPASSRLS debe
validar tenant y permiso por sí misma; FORCE no protege contra ese bypass.

El rol técnico, propietarios, wrappers y matriz DML se aprueban en P-01; no se
infieren de las credenciales por defecto del entorno local. La credencial de lectura
se rechaza también en la operación de BD si llega a una función de escritura.

## 4. Aislamiento multi‑tenant — capas

1. **Aplicación**: el tenant se resuelve de fuente confiable (doc 03 §4.2) y se pasa explícitamente a cada función de módulo.
2. **Base de datos (estructural)**: `business_id` NN en todo; **FKs compuestas** impiden vincular un cliente de A con un profesional de B; unicidades compuestas por negocio.
3. **RLS** ENABLE/FORCE en tablas de negocio; anon sin privilegios de negocio. Sensibles sin DML directo. P-01 debe aprobar el mapa de escrituras de configuración; propuesta única en doc 04 §4: operaciones autorizadas también allí para cumplir locks/versionado. No implementar DML alternativo por una frase genérica.
4. **Backend** con privilegios mínimos: propuesta app_server sin tablas y operaciones internas no expuestas, P-01. service_role no es acceso rutinario a datos; separado para Auth Admin/Storage. Todo definer valida tenant/autoridad aunque su dueño salte RLS (incluido FORCE).
5. **Pruebas automáticas** de aislamiento (pgTAP + e2e) en CI: bloquea el merge si falla.

### Escenarios de ataque y respuesta esperada

| # | Intento | Respuesta |
|---|---|---|
| X-01 | Admin del negocio A llama `GET /businesses/{B}/appointments` | `404 NOT_FOUND` (no es miembro de B); sin diferenciar de inexistente |
| X-02 | Admin A llama `GET /businesses/{A}/appointments/{id_de_B}` | `404`; además RLS devolvería 0 filas |
| X-03 | `POST /businesses/{A}/appointments` con `staff_id` del negocio B | FK compuesta falla → `422/404`; la función valida `(business_id, staff_id)` |
| X-04 | Barbero intenta `GET` reservas de otro barbero | RLS/`can()` → `403` (o lista vacía) |
| X-05 | Barbero hace `PATCH /members/{self}` `role=admin` | `403`; la función rechaza auto‑modificación |
| X-06 | Admin intenta crear otro `owner` | `403` (sólo owner) |
| X-07 | Token de integración del negocio A llama rutas de B | `404` (businessId ≠ token) |
| X-08 | service_key de lectura intenta confirmar/completar/ausente/crear/cancelar/reprogramar/vincular/importar/mapear | 403 en API y denegación de operación de BD; 0 escrituras |
| X-09 | Cliente con token de reserva X consulta reserva Y | `404` |
| X-10 | Usuario con JWT válido usa PostgREST directamente contra `appointments` con `INSERT` | Sin privilegio de INSERT → error de permisos |
| X-11 | Usuario miembro de A y B intenta mover un servicio de A a B | API/operación rechaza cambiar tenant; sin DML directo bajo P-01; si se aprobara DML, inmutabilidad adicional a WITH CHECK/FKs |
| X-12 | Fuerza bruta de IDs de reserva públicos | UUID v4 + token + rate limit + 404 uniforme |
| X-13 | Usuario miembro de A y B cambia el `businessId` de la URL | Se re‑verifica membresía por request; permisos son **por negocio** |
| X-14 | Cliente intenta ver si un teléfono ya existe (enumeración) | La reserva pública responde igual exista o no el cliente |

### Casos adicionales obligatorios

- X-15: actor/body/header falsificados no alteran identidad; usuario de otro negocio
  recibe 404 uniforme; no hay escritura ni resultado idempotente ajeno.
- X-16: invocación SQL/RPC directa de núcleo, setter de contexto o helper no permitido
  se deniega; catálogo comprueba propietario, search_path y grants mínimos.
- X-17: token revocado, miembro suspendido, soporte vencido o de otro tenant se
  rechazan en la siguiente solicitud; no sobrevive una autorización cacheada.
- X-18: If-Match ausente=428; versión obsoleta=412; conflicto de agenda=409;
  reintento exacto no duplica y key con payload/precondición diferente=409.
- X-19: mapeo polimórfico hacia otro negocio/tipo inexistente falla transaccionalmente;
  concurrencia con baja/fusión no deja referencias inválidas.

## 5. Protección de endpoints públicos y anti‑abuso

- Turnstile (o hCaptcha) en `POST` público; verificación server‑side.
- Rate limits (doc 05 §1.5) por IP, teléfono, email y negocio; límites de reservas activas por cliente.
- Honeypot y tiempo mínimo de formulario (≥ 3 s).
- Validación estricta; normalización de teléfono; bloqueo de dominios de email descartables (lista configurable).
- `pending` con TTL corto evita acaparamiento si se activa confirmación.
- Detección: alertas por picos de reservas/cancelaciones desde la misma IP/teléfono; lista de bloqueo por negocio.
- CORS cerrado: sólo orígenes propios; las integraciones server‑to‑server no necesitan CORS.
- Cabeceras: CSP estricta, HSTS, `X-Content-Type-Options`, `Referrer-Policy: strict-origin-when-cross-origin`, `frame-ancestors 'none'` salvo widget futuro.
- Subidas (logo/foto): sólo imágenes, validación de MIME real y tamaño, bucket con políticas por `business_id`.

## 6. Gestión de secretos y credenciales
- Variables separadas por entorno. SUPABASE_SERVICE_ROLE_KEY sólo backend Auth Admin/Storage cuando se implemente, nunca para negocio rutinario ni NEXT_PUBLIC_. Propuesta DATABASE_URL_APP_SERVER para rol técnico restringido, pendiente P-01. No enviar credenciales al HTML, GAS cliente, hojas o logs; doc 12 §3.
- Rotación semestral de secretos de plataforma; secreto de jobs internos distinto por entorno.
- `integration_credentials`: sólo hash; token visible una vez; escaneo de secretos en CI (gitleaks).
- Dependencias: Dependabot + `npm audit` en CI; versiones fijadas con lockfile.

## 7. Auditoría
`audit_logs` registra: cambios de rol/membresía, creación/rotación/revocación de credenciales, cambios de configuración del negocio, cambios de horarios/servicios, fusión de clientes, reversión de estados, acciones con `override_policies`/`force`, accesos de soporte, exportaciones. `appointment_events` cubre el ciclo de vida de reservas. Ambas **append‑only** (privilegios revocados + trigger que lanza excepción en UPDATE/DELETE). Las lecturas de Modo B registran credencial real y actor_type=integration en logs de acceso; asserted_actor opcional no verificado no atribuye una escritura a un humano. Modo A registra credential_id y miembro verificado. No hay escrituras de negocio permitidas en Modo B.

## 8. Backups y recuperación
- Backups diarios automáticos de Supabase + **PITR** (Point‑in‑Time Recovery; requiere plan/complemento adecuado — verificar). RPO objetivo ≤ 15 min con PITR (24 h sin él); RTO objetivo ≤ 4 h.
- Export lógico semanal (`pg_dump`) cifrado a un almacenamiento independiente del proveedor.
- **Simulacro de restauración trimestral** documentado (restaurar a proyecto temporal y validar conteos/constraints).
- Migraciones probadas en *staging* con copia anonimizada.

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
- [ ] Simulacro de restauración completado.
- [ ] Revisión legal de privacidad/términos completada.
- [ ] Prueba de penetración básica (OWASP ASVS L1/L2 checklist) sobre API pública y de integración.

## Estado implementado S2

Auth SSR local, email/contraseña, cookies HttpOnly/Secure en producción/SameSite=Lax,
TOTP y gestión autorizada de miembros implementados; ver SPRINT_2_REPORT.md. Auth
Admin queda separado para altas de cuentas y no concede membresía por sí solo.
No hay almacenamiento de sesión en JavaScript del cliente. Registro público bloqueado.
Las operaciones privilegiadas y lecturas privadas exigen aal2 desde SQL. Plataforma
no obtiene permisos sobre negocios ajenos. Invitación: hash, email confirmado, un uso,
7 días y renovación/revocación con versión. Recuperación de MFA y soporte requieren
procedimiento revisado antes de producción; no hay bypass público implementado.
