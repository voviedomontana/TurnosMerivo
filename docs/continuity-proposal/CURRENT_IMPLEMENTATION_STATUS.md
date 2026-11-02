# Estado actual de implementación — inspección estática

Fecha: 2026-11-01. No se ejecutó la aplicación, SQL, Docker, fixtures ni comandos de
aprovisionamiento en esta revisión. Las validaciones mencionadas son históricas.
No se leyó ningún archivo de secretos ni se comprobó el estado de la sesión del propietario.

## 1. Conclusión

S0, S1 y el corte autorizado de S2 tienen implementación local. Todavía no hay un
MVP operativo de turnos. La revisión v1.1 agrega obligaciones a S2/S3 que no están
implementadas; eso requiere una adaptación diseñada, no recrear lo ya entregado.
La DoD global con revisión, PR, CI remoto y staging no está acreditada.

Categorías: [DOCUMENTATION_PRECEDENCE.md](DOCUMENTATION_PRECEDENCE.md). IVL indica
código presente y verificación local **registrada anteriormente**, no test nuevo.

## 2. Inventario comprobable de capacidades

| Capacidad                                         | Estado                          | Evidencia estática                                                                        | Pruebas / límite                                                                                           |
| ------------------------------------------------- | ------------------------------- | ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Next/React/TS strict/Tailwind/shadcn/npm          | IVL                             | package.json, package-lock.json, tsconfig.json, componentes ui                            | Informes S1/S2 y validaciones posteriores; no npm ci nuevo                                                 |
| Landing y marca Merivo                            | IVL                             | src/app/page.tsx, globals.css, components/brand-logo.tsx, public/brand/merivo-logo.png    | tests/e2e/landing.spec.ts; no auditoría WCAG global acreditada                                             |
| Tenant raíz/configuración                         | IVL                             | migración init_tenancy; modules/businesses                                                | pgTAP e integración S1 registrados                                                                         |
| Lectura pública por slug                          | IVL                             | api/v1/public/[slug]/route.ts; businesses/repository.ts; app_internal.get_public_business | Sólo proyección base, sin catálogo/slots; flags activos comprobados en SQL                                 |
| Auth SSR y sesiones                               | IVL                             | lib/supabase/server.ts, proxy.ts, modules/auth/actions.ts                                 | E2E Auth registrados; registro público deshabilitado en config.toml                                        |
| Membresías, roles, MFA                            | IVL                             | app.require_member/is_active_member; permissions.ts; páginas seguridad/app                | SQL y E2E registrados; can TS es manual y acotado, no generado                                             |
| Invitaciones con expiración/renovación/revocación | IVL                             | tablas app.member_invitations/member_requests; RPC y actions                              | Separadas de alta Auth; un uso/7 días y email confirmado                                                   |
| Selector propio y equipo                          | IVL                             | api.me, api.list_members y src/app/app/*                                                  | No es un dashboard operativo de agenda                                                                     |
| Auditoría de membresías                           | IVL                             | public.audit_logs y reject_audit_mutation en migración Auth                               | Base UUID, before_data/after_data y request_id UUID; no auditoría completa del futuro MVP                  |
| Idempotencia y versión de membresía               | IVL                             | app.manage_member/api.manage_invitation, member_requests, touch_record                    | No equivale a idempotencia de reservas ni manejo seguro de manage_token                                    |
| Errores HTTP, body y Origin                       | IPV para contrato v1.1 completo | modules/auth/http.ts y service.ts, lib/http/*                                             | Existen tests; faltan orden auth/precondición, códigos v1.1, paginación y correlación audit/HTTP completos |
| Plataforma                                        | IPV                             | tabla platform_admins, boolean propio en api.me                                           | Sin support_grants, consola ni acceso temporal a negocios ajenos                                           |
| Permisos canónicos JSON/SQL/TS                    | NI                              | No existen supabase/permissions.json, app.role_permissions ni generador                   | La matriz de auth actual no acredita equivalencia v1.1                                                     |
| Profesionales/servicios/clientes                  | NI                              | Sin tablas ni handlers de catálogo/clientes; dominios aún sin funcionalidad               | No atribuir pruebas S2 a estos dominios                                                                    |
| Horarios/disponibilidad/reservas                  | BD                              | Sin esquema operativo o motor; P-02/P-03/P-06 abiertos                                    | No hay EXCLUDE operativo ni pruebas concurrentes de reservas ejecutadas                                    |
| Notificaciones de turnos/workers                  | NI                              | Sólo plantilla de alta Auth y Mailpit local                                               | No outbox de reservas, proveedor externo, cron ni reintentos de entrega                                    |
| Integración GAS/credenciales/mapeos               | BD                              | Sin tablas/handlers/librería implementados; P-04/P-05/P-08                                | No se inspeccionó ni modificó la app GAS externa                                                           |
| Observabilidad, health y seguridad de release     | NI/parcial según componente     | CI local definido; no rutas health, Sentry, OpenAPI o suite k6/ZAP/axe implementados      | Costos, planes, SMTP real y restauración no verificados                                                    |
| Entornos remotos y piloto                         | NI/no acreditado                | Workflow no contiene despliegues                                                          | No acceso a cuentas remotas, staging ni métricas productivas en esta revisión                              |

## 3. Cinco migraciones que se preservan

| Archivo                                             | Función del corte entregado                                                                                 |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 20261031231242_init_tenancy.sql                     | public.businesses/business_settings/users/business_members, RLS, rol técnico, helpers y bootstrap           |
| 20261031231400_allow_maintenance_server_role.sql    | postgres puede SET ROLE app_server para mantenimiento; nunca permiso inverso                                |
| 20261031232111_restrict_future_function_execute.sql | Revocación GLOBAL del default EXECUTE PUBLIC para futuras funciones de postgres                             |
| 20261101000100_auth_memberships.sql                 | Auth profile sync, platform_admins/audit_logs, tablas privadas de replay/invitación y operaciones de sesión |
| 20261101000200_invitation_lifecycle.sql             | Renovar/revocar invitaciones con versión, identidad, idempotencia y auditoría                               |

Son cinco archivos fuente, no una nueva consulta a migration history. Seis tablas
propias public y dos app son evidentes en los scripts; no se cuentan auth/Storage
del proveedor como funcionalidades de producto. El catálogo registra 11 definers
de aplicación como resultado histórico; revisar nuevamente al autorizar cambios.

## 4. Contratos actuales que no se deben romper por copiar ejemplos

- Función pública interna actual: app_internal.get_public_business; no renombrarla
  a public_get_business por uniformidad documental sin necesidad y compatibilidad.
- RPC de miembros: api.invite_member/update_member/accept_invitation/manage_invitation;
  app.manage_member es privado. No existe la RPC genérica api.manage_member de v1.1.
- API actual acepta ETag fuerte entre comillas; responde PRECONDITION_FAILED en 412;
  SQL usa PT400/PT401/PT403/PT404/PT409/PT412/PT428, no TSxxx.
- Privadas: DATABASE_URL_APP_SERVER y SUPABASE_AUTH_ADMIN_KEY; pública:
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. No copiar los nombres ANON_KEY/SERVICE_ROLE_KEY
  de la nueva guía ni reemplazar valores existentes. Aquí sólo se inspeccionaron
  referencias de nombres en código, no valores.
- Configuración lazy por capacidad: landing sin Supabase. No exigir secretos de
  correo, jobs o integraciones al arrancar páginas que no los necesitan.
- No hay DML directo de negocio para roles de app. Mantener ese contrato al
  reconciliar la alternativa permisiva de configuración que aparece en v1.1/04 y 08.

## 5. Hallazgos de implementación a validar antes de ampliar el backend

| ID   | Evidencia                                                                                             | Hallazgo estático y recomendación                                                                                                                                                                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C-01 | src/modules/auth/http.ts:67; service.ts:14–27                                                         | Falta If-Match se comprueba antes de rpc/sessionClient. Con entrada válida y credencial ausente/inválida puede emitirse 428 antes de autenticar. Diseñar pruebas de precedencia y autorización antes de clasificar precondición. No demuestra fuga de filas                    |
| C-02 | misma migración Auth:142–143; api.manage_invitation                                                   | Se toma lock del negocio antes de require_member. Revisar preautorización y revalidación bajo coordinación para evitar contención inducida por actores sin membresía; no se ejecutó ataque ni medición                                                                         |
| C-03 | src/modules/auth/http.ts:19; INSERT audit_logs en SQL                                                 | request_id HTTP nuevo vs request_id auditado = p_key. No hay correlación única conforme al contrato propuesto; separar request_id de Idempotency-Key                                                                                                                           |
| C-04 | http.ts:45; api.list_members                                                                          | Retorna toda la lista y next_cursor=null; no hay limit/cursor real ni ETag de cada lectura versionada                                                                                                                                                                          |
| C-05 | service.ts:30–34                                                                                      | No mapea TSxxx; cualquier 23514 se interpreta LAST_OWNER. No ampliar ese catch-all a las restricciones del nuevo modelo                                                                                                                                                        |
| C-06 | app.member_requests en SQL                                                                            | Autoridad/operación incluidas en clave: conservar mejora. No hay purga/TTL 48 h implementada; no sustituirla por PK genérica que pierda aislamiento por actor                                                                                                                  |
| C-07 | actions.ts:198–214                                                                                    | Envío Auth Admin autoriza mediante list_members; revisar techo de rol del destinatario y carreras con cambios de rol/invitación antes de nuevos usos. Cuenta Auth creada no concede membresía por sí sola                                                                      |
| C-08 | init_tenancy: businesses_member_read/settings_member_read y grants SELECT; helper actualizado en Auth | El miembro barbero puede leer directamente filas completas de su negocio/settings bajo RLS, mientras V11/02 §6 niega negocio privado al barbero. Proponer proyección/columnas o RPC privadas y comprobar compatibilidad; RLS por fila no filtra columnas sensibles por sí sola |

Estos hallazgos no autorizan una corrección de código en esta tarea. Requieren
tests específicos y paquete de compatibilidad aprobado; no constituyen certificación
de vulnerabilidad explotada ni invalidan por sí solos todas las pruebas históricas.

## 6. Evidencia histórica de validación y sus límites

| Origen                                | Último resultado registrado                                           | Ejecución de esta revisión                                                              |
| ------------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| SPRINT_2_REPORT, resolución final HMR | lint/format/typecheck/build aprobados, 62 unitarios                   | No repetidos                                                                            |
| Mismo informe y CHANGELOG final       | 4 E2E dev + 4 producción, desktop/móvil; QR e invitación completos    | No repetidos; E2E crea cuentas/filas y está fuera de este alcance                       |
| SPRINT_2_REPORT                       | 114 comprobaciones pgTAP, db:lint sin errores                         | No repetidos; no se consultó BD                                                         |
| SPRINT_2_REPORT e integración S1      | 3 pruebas HTTP con BD y servidor sin conexión DB                      | No repetidas                                                                            |
| Informe S1                            | Reconstrucción de las tres primeras migraciones antes de datos reales | No demuestra reconstrucción aislada actual de las cinco; no hacer reset del propietario |
| Informe S2                            | Comprobación de secretos y .env.local ignorado                        | No se leyeron secretos ni se repitió el escaneo de valores                              |

No hay logs firmados o CI remoto consultados. Los conteos son lo documentado y la
existencia de archivos de test se corroboró estáticamente. Móvil actual es emulación
iPhone sobre Chromium; no afirmar cobertura WebKit/iOS real de v1.1/11.

## 7. Pendientes de cierre formal

PR revisado y CI remoto, ambientes aislados, validación en staging, revisión humana
de SQL/seguridad, observabilidad, políticas de recuperación MFA/soporte, backups y
prueba de restauración, configuración de correo/dominio y piloto. S2 nuevo incluye
también permisos canónicos y spike GAS aún no realizados. No cerrar esos puntos
porque existan archivos o porque una compilación histórica haya terminado bien.

## 8. Comprobaciones realizadas en esta revisión

- Inventario estático de 15 Markdown V11 y documentos históricos/requeridos;
  contraste con fuente, cinco migraciones, catálogo, configuración y tests.
- Se crearon únicamente los seis Markdown de docs/continuity-proposal.
- Comparación SHA-256 de los **135 archivos previos no sensibles/no ignorados**
  inventariados al inicio: sin cambios ni pérdidas. Incluye documentos históricos,
  V11, AGENTS, código, configuración y migraciones. Los archivos de secretos se
  excluyeron de la lectura; no se inspeccionaron sus valores.
- Prettier de esta carpeta y git diff --check: aprobados. No se formateó V11 ni
  ningún documento previo para hacer pasar una comprobación global.
- Referencias Markdown locales y fences de los informes: sin errores detectados.
- Roadmap: 12 paquetes (S3-A/S3-B y S4–S13), cada uno con los 17 campos solicitados.
- No se ejecutaron lint/typecheck/build/unit, pruebas SQL, integración o E2E en
  esta tarea puramente documental; las tablas anteriores citan el historial real.
  No se inició/reinició ningún servicio, ni se consultó/modificó la base o cuentas.
