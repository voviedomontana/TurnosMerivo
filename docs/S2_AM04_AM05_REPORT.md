# S2 — A-M04 y A-M05: C-03 / C-04

Fecha: 2026-11-01. **Implementados y validados exclusivamente en entorno descartable.**
Ninguna migración/query/prueba se ejecutó sobre la base del propietario. Sin C-06,
S3, GAS, dependencias nuevas, commit, push o despliegue.

## Preparación y compatibilidad previa

Se revisaron AGENTS, S2_AM03_REPORT y las ocho migraciones anteriores: las cinco
históricas, A-08/A-05 y A-M03. Se capturaron hashes de 156 archivos existentes no
ignorados/no secretos. El harness verifica ahora los ocho hashes de migraciones antes
de crear recursos. No se modifica ninguna migración anterior ni se reconsulta la base
del propietario para verificar su aplicación; incorporación aquí significa código en
repositorio y comportamiento probado en el esquema descartable completo.

Comparación final: 12 archivos anteriores modificados y ocho nuevos listados abajo;
los otros 144 archivos anteriores permanecen intactos, incluidas las ocho migraciones.

| Migración nueva                                  | SHA-256                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| 20261101000600_correlate_membership_requests.sql | `28a2832fe8db532b606f82ac80e42c1a497fd3fa2b2455a5a12b9461d0e4b465` |
| 20261101000700_paginate_business_members.sql     | `6bdfef52fe9f4d5643dd0b38d88c3ecfe59169b21d0c151f7493bd1df202a309` |

Preflight antes de modificar código: **187 pgTAP + 16 escenarios independientes +
Auth/PostgREST reales**, correctos. A-M03 preservado. Al terminar se compararon los
tres cuerpos SQL reemplazados con los de A-M03, deshaciendo sólo las sustituciones
de metadata: guards, locks, precondiciones, hashes, replay y efectos son idénticos.

## Archivos creados y modificados

| Archivo                                                              | Estado / propósito                                                                                  |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| supabase/migrations/20261101000600_correlate_membership_requests.sql | Nueva A-M04: helper privado, origen nullable y cuerpos auditados compatibles                        |
| supabase/migrations/20261101000700_paginate_business_members.sql     | Nueva A-M05: índice keyset y RPC de páginas                                                         |
| src/lib/http/request-id.ts                                           | Nuevo: normaliza UUID válido o genera UUID; metadata sin autoridad                                  |
| src/lib/supabase/server.ts                                           | Modificado: header X-Request-Id por instancia SSR, preservando cookies y Bearer                     |
| src/modules/auth/http.ts                                             | Modificado: acepta/retorna trace válido, propaga al RPC; listado opt-in                             |
| src/modules/auth/service.ts                                          | Modificado: contexto por invocación y servicio listMembersPage; legado completo                     |
| src/modules/auth/schemas.ts                                          | Modificado: validación de límite/cursor y DTO de página                                             |
| src/modules/auth/actions.ts                                          | Modificado: UUID por intento en las cinco acciones de negocio y metadata opcional de respuesta      |
| src/app/app/[businessId]/miembros/page.tsx                           | Modificado: páginas y enlaces con clases Merivo existentes, error de cursor recuperable             |
| supabase/tests/am04_am05.test.sql                                    | Nuevo: 41 aserciones SQL de correlación, replay, keyset, cursores y permisos                        |
| tests/unit/am04-am05.test.ts                                         | Nuevo: 25 casos HTTP/SSR/acciones y compatibilidad de paginación                                    |
| supabase/tests/tenancy.test.sql                                      | Modificado: inventario de definers 15→16 por el único RPC nuevo                                     |
| supabase/tests/s2_security_fixes.test.sql                            | Modificado: agrega sólo list_members_page a la allowlist revisada                                   |
| scripts/test-s2-security-isolated.mjs                                | Modificado: hash A-M03, prueba de legado, nuevas integraciones y opción --ui                        |
| scripts/lib/am03-concurrency.mjs                                     | Modificado: conserva 16 escenarios y agrega aislamiento de trazas entre dos escrituras concurrentes |
| scripts/lib/am0405-integration.mjs                                   | Nuevo: compatibilidad histórica de migración e integración HTTP PostgREST                           |
| scripts/lib/am0405-browser.mjs                                       | Nuevo: copia temporal de Next, gateway sintético, HTTP completo y navegador                         |
| supabase/function-catalog.md                                         | Modificado: contratos/privilegios de las capacidades nuevas                                         |
| docs/CHANGELOG.md y este informe                                     | Registro de implementación y evidencia                                                              |

## C-03 — Correlación y auditoría

HTTP auth acepta X-Request-Id en formato UUID canónico, normalizado a minúsculas.
Si falta o es inválido genera uno y lo devuelve en header y problemas de error.
No rechaza una operación sólo por metadata inválida. El cliente SSR transporta el
mismo valor en Auth/PostgREST; se instancia por request, sin singleton ni estado
global compartido. Los clientes antiguos sin header siguen funcionando.

Las acciones invite/update/accept/send-access/manage-invitation generan su UUID
del lado servidor por invocación, sin confiar en un campo del formulario. Las que
retornan ActionState agregan request_id opcional, incluso en error; aceptación
exitosa conserva la redirección /app. No se exponen IDs técnicos en el flujo visual.
Las acciones Auth/MFA que no escriben datos de negocio conservan sus contratos;
sus clientes SSR reciben metadata por instancia, sin inventar auditoría de negocio.

app.current_request_id lee request.headers, valida UUID y genera fallback seguro
si headers/valor no son válidos. Es invoker privado, sin EXECUTE de usuarios/roles
técnicos; no modifica identidad, permisos o contexto de seguridad. Cada coordinador
calcula una sola vez su UUID para nuevas escrituras de audit y replay.

- audit_logs.request_id continúa UUID y ahora registra el intento original real,
  separado de Idempotency-Key. No se modifica el tipo ni la auditoría histórica.
- member_requests.origin_request_id es nullable y privado. Filas anteriores quedan
  NULL: no se inventa correlación retrospectiva ni se reemplazan IDs legacy=p_key.
- Replay B con otra traza conserva resultado, origen A y auditoría A; vuelve a pasar
  autorización A-M03 y no incrementa versión ni crea registro de mutación B.
- Request_id no integra el hash ni la PK de idempotencia. UUID suministrado por un
  cliente es metadata no confiable; no se impone unicidad global ni se usa como permiso.
  Se correlaciona con el scope/key originales cuando hace falta distinguir intentos.
- No se incorporan logs de body, tokens, cookies, headers completos o credenciales.
  Los replays históricos no reciben un backfill al ser leídos.

Las firmas públicas y resultados de mutación permanecen iguales. La ampliación
opcional de ActionState no altera mensajes, links, MFA ni formularios existentes.
No se añadieron endpoints de auditoría o lectura de replay privado.

## C-04 — Contrato de paginación

Nuevo RPC: api.list_members_page(p_business_id uuid, p_limit integer default 50,
p_cursor text default null). Respuesta `data` y `page { next_cursor, has_more }`.
Usa guard actual require_member(...,true), con identidad confirmada, miembro/negocio
activos, rol owner/admin y aal2, **en cada página**.

Orden fijo ascendente por created_at,id; condición de continuación por la tupla
estrictamente mayor; índice business_id,created_at,id y lectura de limit+1. No se
pagina con OFFSET. Límite 1…200; omisión usa 50, explícito NULL/0/>200 falla con 400.
La proyección de cada miembro mantiene id/user_id/email/role/status/version/expires_at;
version individual sigue alimentando If-Match de edición, nunca un ETag de página.

Cursor base64url sin padding, máximo 1024 caracteres. JSON de formato v=1 y exactamente
business_id/created_at/id. Se validan estructura, tipos, negocio, UUID, fecha finita
con zona y precisión de microsegundos; fallos dan 400 VALIDATION_ERROR sin detalles
del decoder/SQL. El guard de tenant/rol precede la interpretación del cursor.
Cursor no firmado es un selector no confiable, no autoridad. Cambiarlo puede elegir
otra posición del propio negocio, nunca acceso a otro tenant.

Compatibilidad HTTP:

- GET /api/v1/businesses/:businessId/members **sin limit/cursor** conserva listado
  completo y envelope anterior con next_cursor nulo/has_more false.
- `?limit=50`, `?limit=200` o `?cursor=...` activa el RPC nuevo. Cursor solo usa 50.
  Parámetros repetidos, vacíos o inválidos se rechazan; no se truncan silenciosamente.
- api.list_members(uuid) y listMembers continúan completos, sin cambio de firma/cuerpo.
- Equipo usa páginas de 50, enlaces Ver más/Primera página y recuperación desde URL
  inválida. Se mantienen tokens visuales, clases, roles, versiones y formularios.
- La autorización de envío sigue exclusivamente en prepare_member_auth_invite:
  no se busca un objetivo dentro de la página ni del listado general. Se comprobó
  administración de un miembro fuera de la primera página.

Cada llamada tiene snapshot SQL consistente, pero no se promete snapshot entre
páginas ni conteo total congelado bajo altas/bajas concurrentes. Cursor no es un feed
incremental ni garantía de reconciliación. El modo legado conserva temporalmente el
riesgo de tamaño sin límite; retirarlo requiere autorización separada.

## Entorno descartable y pruebas completas

Comando principal: `node scripts/test-s2-security-isolated.mjs --ui`.
Sin --ui ejecuta SQL/concurrencia/Auth/PostgREST; --ui agrega el recorrido Next y
navegador. Requiere Docker, imágenes fijadas, dependencias instaladas y Chromium de
Playwright. Nunca carga .env ni usa red/volumen/contenedor del propietario.

Para navegador se copia sólo código/config/package files a merivo-ui-<aleatorio>
en TEMP y se enlazan las dependencias existentes. No se copian .env, backups o Git.
Build y servidor temporales reciben únicamente configuración sintética: gateway
loopback de Auth/PostgREST nuevos, public key de prueba y DB URL deshabilitada en
puerto 1. Ningún servidor de prueba apunta a los puertos de la instancia propietaria.
Sesiones reales de usuarios example.test con TOTP verificado sólo viven en ese Auth.

El gateway observa exclusivamente path/request_id en memoria; no registra cuerpos,
credenciales o cookies. Navegador no produce trace/HAR con tokens. Al terminar se
cierran browser/servidor/gateway y se elimina la copia temporal, previa verificación
del destino absoluto y remoción del junction para no recorrer node_modules. Docker
elimina únicamente sus contenedores/volúmenes/red de cada ejecución.

## Resultados reales

| Validación                               | Resultado                                                                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preflight A-08/A-05/A-M03                | 187 pgTAP y 16 escenarios correctos antes de cambios                                                                                                       |
| Harness final --ui                       | PASS completo                                                                                                                                              |
| SQL/pgTAP                                | **228** aserciones: 31 AM03 + 41 AM04/05 + 45 Auth + 42 privacidad/errores + 69 tenancy                                                                    |
| Migración con filas anteriores           | PASS: se inserta legado antes de A-M04 en transacción descartable, se aplica, comprueba NULL/JSON/timestamp/audit y revierte; luego migra limpio           |
| Conexiones PostgreSQL independientes     | **17** escenarios correctos: conserva los 16 AM03, fortalece misma key con trazas A/B y agrega dos escrituras con trazas distintas                         |
| HTTP PostgREST                           | Traza A audit/origin, replay B sin duplicación; 214 filas legado; keyset con empates, límites 50/200, cursores inválidos/ajenos y revocación entre páginas |
| HTTP Next real → SSR → PostgREST → audit | PASS: header A llega a audit/origin; replay B retorna resultado original con su header B; endpoint legado 214 y página 50                                  |
| Navegador Chromium 1280 px               | PASS: páginas distintas, retorno a primera, tamaño 200/última 14, edición fuera de primera página y cursor inválido recuperable                            |
| Navegador Chromium 390 px                | PASS: páginas 50, navegación y retorno, sin desbordamiento horizontal ni pageerror                                                                         |
| Server Action real desde navegador       | PASS: resultado visible, UUID del intento coincide con header SSR observado y audit/origin; key separada                                                   |
| npm run test                             | **109** tests en 11 archivos, correctos; 25 nuevos                                                                                                         |
| npm run lint                             | Correcto                                                                                                                                                   |
| npm run typecheck                        | Correcto                                                                                                                                                   |
| npm run build                            | Correcto; fuera del sandbox por el EPERM previamente comprobado en .next; rutas de datos dinámicas sin queries al propietario                              |
| npm run format:check                     | Falla sólo por los 15 Markdown preexistentes de arquitectura-v1.1, conservados intactos                                                                    |
| Formato acotado / diff check             | Correctos                                                                                                                                                  |
| Limpieza                                 | Sin contenedores/redes merivo-s2-check ni copias merivo-ui restantes                                                                                       |

Incidencias de desarrollo resueltas: el primer typecheck detectó un tipo incompatible
en el pipeline Zod; se corrigió con conversión tipada. Las primeras corridas de
navegador detectaron lectura de respuesta navegada y conteos antes de completar
navegación; se corrigieron las esperas del harness. La corrida final completa pasó;
no se presentan esos intentos fallidos como validaciones exitosas. La metadata
devuelta por ActionState se valida en unitarios; el navegador la correlaciona vía
header observado/audit, sin depender del cuerpo de una respuesta navegada.

## Compatibilidad A-M03 y pendientes

- Ocho migraciones anteriores intactas. A-M03 conserva guard de actor/objetivo,
  READ COMMITTED, lock raíz→replay→miembro→invitación, aceptación revalidada,
  protección del último owner y límites de rol/MFA. No se amplían grants técnicos.
- La matriz AM03 de revocación/promoción/rotación/expiración durante esperas,
  owners opuestos, misma key y aislamiento siguió pasando con trazabilidad nueva.
  Se verificó además que dos intentos concurrentes no mezclan sus IDs.
- C-03 y C-04 están **implementados y validados en descartable**, no aplicados al
  propietario. Antes de utilizar la pantalla nueva allí se deberán autorizar y aplicar
  en orden las migraciones pendientes A-M03/A-M04/A-M05. No hay fallback que eluda
  autorización si faltan funciones; no se ejecutaron E2E originales del propietario.
- Replay B no tiene nueva auditoría de mutación; su ID de respuesta se relaciona
  con el origen A por la key/scope privado. No se implementa un log durable de todos
  los intentos o errores ni un endpoint nuevo para ese registro.
- Legado sin correlación permanece NULL; no es posible reconstruir trazas reales
  retrospectivamente. UUID válido suministrado puede repetirse: no es identidad.
- Paginación no garantiza snapshot entre requests ni evita crecimiento del legado.
  No se firman cursores ni agregan secretos/dependencias para un selector sin autoridad.
- Correo autorizado tardío mantiene el límite aceptado de C-07; no se habilita
  aceptación de invitaciones inválidas ni se introduce outbox/deduplicación de envío.
- **C-06 no implementado**: no TTL, purga, scheduler ni borrado de replay/auditoría.
  S3, GAS, stack, estructura, identidad visual, commits, push y despliegue intactos.

Estado final: **C-03 y C-04 completos dentro del alcance autorizado de implementación
y pruebas aisladas.** La ejecución se detiene aquí.
