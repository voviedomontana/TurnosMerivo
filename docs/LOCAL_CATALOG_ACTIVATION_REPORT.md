# Activación local del catálogo

Fecha local: 2026-11-01 (respaldo 2026-11-02 00:45 UTC).

## Autorización y destino

El usuario autorizó: «Sí, activar el catálogo en mi entorno local», con respaldo
previo, sin reset y sin cambios de cuentas/MFA. Se levantó exclusivamente la
restricción de aplicación local de estas migraciones ya implementadas y validadas.
No se autoriza implementar otros bloques, modificar cuentas ni desplegar.

Destino verificado: contenedor `supabase_db_turnosmerivo`, base `postgres`, proyecto
`turnosmerivo` de supabase/config.toml. No se utilizaron --linked ni proyectos remotos.

Estado inicial: siete migraciones aplicadas, hasta 20261101000400 (A-05).

## Respaldo y aplicación

Antes de cambiar el esquema se creó un archivo pg_dump custom completo de la base,
sin imprimir sus datos ni leer archivos de entorno. Ubicación local ignorada por Git:

`supabase/backups/catalog-activation-2026-11-02T00-45-07-479Z/before-catalog.dump`

Se verificaron cabecera PGDMP, inventario con tablas de MFA, membresías e historial,
SHA-256 y descompresión completa con pg_restore hacia /dev/null. **No se hizo un
simulacro de restauración**; esta verificación no demuestra un restore completo.
Manifest y resultado de activación están en el mismo directorio ignorado. El
respaldo contiene datos sensibles de Auth: mantenerlo privado y fuera de Git.

Se ejecutó la CLI fijada del repositorio, equivalente a `npm run db:migrate`:
`supabase migration up --local`. Orden aplicado:

1. `20261101000500_reauthorize_membership_operations.sql`: C-01/C-02/C-07.
2. `20261101000600_correlate_membership_requests.sql`: C-03.
3. `20261101000700_paginate_business_members.sql`: C-04.
4. `20261101000800_expire_membership_replays.sql`: C-06.
5. `20261101000900_create_professional_service_catalog.sql`: catálogo.

Ninguna migración anterior se editó. Se recargó el esquema PostgREST mediante NOTIFY.
No se ejecutaron purgas, seeds, reset, login, aceptación/envío de invitaciones ni
operaciones de alta/edición de profesionales o servicios en esta instancia.

## Evidencia de preservación y smoke

Se compararon conteo y huella del contenido antes del respaldo, antes de migrar y
después de migrar, calculados dentro de PostgreSQL sin devolver filas ni secretos.
Las catorce tablas conservan su contenido:

- auth.users, auth.identities, auth.sessions, auth.refresh_tokens.
- auth.mfa_factors, auth.mfa_challenges, auth.mfa_amr_claims.
- public.users, public.businesses, public.business_settings, public.business_members.
- public.audit_logs, app.member_invitations, app.member_requests.

Para member_requests se excluye de la huella la columna nueva origin_request_id;
no se compara un cambio de forma con un cambio de datos. El historial final contiene
las doce versiones esperadas. Las doce fuentes SQL conservan sus hashes.

| Comprobación local de sólo lectura                                           | Resultado                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------- |
| RPC api.list_catalog / api.write_catalog instaladas como definers            | PASS, dos funciones.                              |
| RLS ENABLE/FORCE en las cuatro tablas nuevas                                 | PASS.                                             |
| Acceso directo de anon/authenticated/app_server/service_role a tablas nuevas | PASS, ningún grant.                               |
| Catálogo inicial                                                             | Cero profesionales y cero servicios; no fixtures. |
| GET landing en 127.0.0.1:3000                                                | 200.                                              |
| GET API catálogo sin sesión                                                  | 401.                                              |
| GET pantallas profesionales/servicios sin sesión                             | 307 hacia flujo de acceso.                        |

No se ejecutó E2E autenticado sobre la cuenta del propietario. Las pruebas de
escritura, MFA, concurrencia, HTTP autenticado y UI se ejecutaron previamente sólo
en descartable: [informe de implementación](CATALOG_IMPLEMENTATION_REPORT.md).
La activación no modifica código ni dependencias; los resultados históricos no se
presentan como pruebas nuevas sobre la cuenta local.

Checks del repositorio ejecutados nuevamente después de la activación: lint,
typecheck, 139 tests unitarios / 13 archivos y build PASS. `format:check` sigue
fallando exclusivamente en los quince Markdown preexistentes de arquitectura-v1.1;
los cuatro documentos de esta activación pasan Prettier. `git diff --check` PASS.
No se repitieron pruebas SQL de escritura ni E2E sobre esta instancia.

## Uso y recuperación

Con la sesión habitual, entrar al negocio desde `/app` y abrir **Profesionales** o
**Servicios**. Owner/admin mantienen su MFA requerido. No es necesario recrear
cuentas ni factores. La carga de datos reales se realiza desde esas pantallas.

Ante un fallo posterior, detener escrituras y revisar historial/causa antes de
intervenir. No restaurar automáticamente sobre esta instancia ni ejecutar reset.
Preferir corrección mediante migración nueva; si se requiere restauración, probar
primero el respaldo en una instancia separada con los roles compatibles. La
restauración es una operación independiente que requiere autorización.

Estado: **catálogo activado localmente**. Reservas, disponibilidad, clientes, EXCLUDE
y publicación en hosting permanecen pendientes y fuera del alcance de esta activación.
