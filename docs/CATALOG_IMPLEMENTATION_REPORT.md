# Profesionales y servicios — implementación del bloque autorizado

Fecha: 2026-11-01. Alcance: catálogo interno de profesionales y servicios.

## Autorización y límites

El usuario aprobó expresamente «Aprobar e implementar profesionales y servicios»
con precios ARS, duración 5–480 minutos, buffer 0–120, gestión owner/admin con MFA,
consulta de barberos, profesionales con/sin cuenta y bajas sin cancelar reservas.
Incluye versiones por recurso, aislamiento por negocio y coordinación compatible
con S2. Esta aprobación sustituye la prohibición anterior de catálogo solamente
para este bloque; AGENTS.md y CHANGELOG.md registran esa diferencia.

No se aprueba el resto de S3-A/S3-B. No hay reservas, disponibilidad, EXCLUDE,
clientes, integración GAS, scheduler, despliegue, commits ni push. Los documentos
de propuestas originales se conservan. En esta fase no se consultó ni migró la base del propietario
ni se modificaron sus sesiones, cuentas, contraseñas o factores MFA.

## Archivos

Nueva migración: `supabase/migrations/20261101000900_create_professional_service_catalog.sql`.
Las once migraciones anteriores se conservan byte por byte; el runner verifica
sus hashes antes de aplicarlas exclusivamente en contenedores descartables.

Archivos nuevos:

- `src/modules/staff/schemas.ts`: perfiles y asignaciones validadas.
- `src/modules/services/{schemas,catalog,actions,http}.ts`: datos, lectura, acciones y API.
- `src/components/catalog/forms.tsx`: alta, edición, archivo y restauración.
- `src/app/app/[businessId]/{profesionales,servicios}/page.tsx`: pantallas internas.
- `src/app/api/v1/businesses/[businessId]/catalog/route.ts`.
- `src/app/api/v1/businesses/[businessId]/catalog/[kind]/route.ts`.
- `src/app/api/v1/businesses/[businessId]/catalog/[kind]/[resourceId]/route.ts`.
- `supabase/tests/catalog.test.sql` y `tests/unit/catalog{,-permissions}.test.ts`.
- `scripts/lib/catalog-{concurrency,browser}.mjs`.
- Este informe.

Archivos existentes modificados:

- `src/app/app/[businessId]/page.tsx`: accesos al catálogo desde el negocio.
- `src/app/globals.css`: formularios, asignaciones y adaptación móvil con tokens Merivo.
- `src/modules/auth/permissions.ts`: capacidades finitas catalog:read/write y denegación
  de capacidades desconocidas; reglas S2 existentes conservadas.
- `scripts/test-s2-security-isolated.mjs`, `scripts/lib/am0405-browser.mjs`: amplían
  el harness descartable existente, conservando regresiones S1/S2.
- `supabase/tests/{tenancy,s2_security_fixes}.test.sql`: inventario de nuevas capacidades.
- `supabase/function-catalog.md`, `AGENTS.md`, `docs/CHANGELOG.md`.

No cambian dependencias, lockfile, stack, carpetas existentes, logo ni aplicación GAS.

## Modelo y comportamiento

`staff_members`: UUID estable, negocio, membresía opcional del mismo negocio,
nombre, bio, active, accepts_online, orden, versión y baja lógica. Una membresía
puede vincularse a un solo perfil no archivado, incluso inactivo; archivar libera
esa vinculación para otro perfil. Restaurar comprueba conflictos de vinculación.
No se crean usuarios Auth. Suspender una membresía quita acceso pero conserva el
estado del profesional. Cambiar un vínculo exige una membresía activa y confirmada;
se permite conservar un vínculo previo suspendido sin restituir acceso.

`services`: precio entero en centavos ARS (0…2147483647), duración 5…480 minutos,
buffer posterior 0…120, nombre, descripción/categoría opcionales, active, orden,
versión y baja lógica. Nombre único entre no archivados por negocio, trim + NFC +
lower PostgreSQL. Duración inicial del formulario: 30; buffer: 0. Se admiten precios
cero; no hay conversión monetaria ni impuestos implícitos.

`staff_services`: FKs compuestas a ambos extremos del mismo negocio, asociación
única y overrides opcionales de precio/duración con iguales límites. Forma parte
del recurso profesional: cambiar sus asignaciones exige versión staff e incrementa
esa versión una sola vez. Cambiar un servicio incrementa sólo la versión service.

Archivar/restaurar conserva filas y vínculos. Inactivar no equivale a archivar.
No se pueden agregar vínculos nuevos a servicios archivados; se pueden conservar
los ya existentes al editar. No existe eliminación física desde la aplicación.
La ausencia de cancelación automática es estructural: no se implementaron reservas
y todavía no puede probarse compatibilidad con reservas futuras o snapshots.

## Seguridad y transacciones

| Actor                                        | Lectura                       | Escritura              |
| -------------------------------------------- | ----------------------------- | ---------------------- |
| owner/admin activos del negocio              | aal2                          | aal2                   |
| barber activo del negocio                    | aal1 o aal2; member_id oculto | Denegada               |
| anónimo, otro negocio o membresía suspendida | Denegada                      | Denegada               |
| app_server / service_role                    | Sin nuevas capacidades        | Sin nuevas capacidades |

Las cuatro tablas nuevas tienen ENABLE/FORCE RLS y no otorgan acceso directo a roles
de aplicación. Las dos RPC públicas conceden EXECUTE sólo a authenticated. La
proyección de lectura es explícita: no expone email, configuración privada ni vínculo
de cuenta a barberos. FORCE RLS no sustituye las guardas dentro del definer postgres.

Protocolo de escritura: preautorización no bloqueante → raíz exclusiva del negocio
con `app.lock_managed_business` → reautorización con snapshot fresco READ COMMITTED
→ replay → recurso → validación de referencias → mutación, auditoría y replay en la
misma transacción. Reutiliza el coordinador S2 sin modificarlo. No hace llamadas
externas bajo locks. La raíz exclusiva serializa todas las escrituras del negocio;
se acepta ese coste conservador para el catálogo inicial.

`app.catalog_requests` es independiente de `app.member_requests`: reconocimiento
48 horas desde created_at, expiración lógica, purga privada invoker 1…500 con
SKIP LOCKED. Sólo mantenimiento postgres, sin endpoint ni scheduler. La purga no
toma la raíz ni escribe recursos, evitando invertir el orden de locks. Auditoría e
invitaciones no se eliminan. No se amplía la política S2 de membresías.

La intención canónica incluye tipo, acción, UUID del recurso, datos normalizados
y versión esperada. Replay autorizado devuelve el resultado original sin nueva
mutación/auditoría, aunque haya cambiado la versión; la misma key con distinta
intención dentro de su operación produce 409. Keys están separadas por negocio,
actor y operación. Tras vencimiento vuelve a exigirse la versión vigente. La
creación exige UUID estable: una repetición con ese UUID después del vencimiento
produce 409, incluso si el recurso fue archivado. Cambiar deliberadamente el UUID
constituye una nueva alta; profesionales distintos pueden compartir nombre.

request_id UUID por intento HTTP/acción, diferente de la key; llega a PostgreSQL,
auditoría y origin_request_id. Auditoría y replay guardan sólo metadatos del recurso,
sin nombres, bio, cookies, credenciales ni tokens.

## Contratos nuevos

Base: `/api/v1/businesses/{businessId}/catalog`. kind: `staff` o `service`.

| Método / ruta       | Contrato                                                                 |
| ------------------- | ------------------------------------------------------------------------ |
| GET base            | Proyección interna; `include_archived=true/false`, false predeterminado. |
| POST `/{kind}`      | `{id: UUID, data: objeto}`; Idempotency-Key UUID; 201 y ETag.            |
| PUT `/{kind}/{id}`  | Reemplazo de campos editables, no patch parcial; key e If-Match.         |
| POST `/{kind}/{id}` | `{action: "archive" o "restore"}`; key e If-Match.                       |

Escritura devuelve id, business_id, kind, version, active y deleted_at. If-Match
es una versión positiva entre comillas; ausente llega a la guarda SQL para devolver
428 después de autorización. Versión obsoleta: 412; conflicto: 409; no autenticado:
401; sin permiso: 403; recurso/negocio ajeno o ausente: 404. Errores internos no
exponen PostgreSQL. Respuestas private/no-store y X-Request-Id. Sesión por cookie
exige mismo origen para escribir; Bearer se verifica con Auth.

Las RPC/endpoints de S1/S2 no cambian. El selector de membresías completo se usa
como opciones de vinculación sólo para owner/admin; no autoriza escrituras. La
autorización siempre consulta el miembro real en SQL y se revalida tras el lock.

## Validación y operación

Comando de regresión SQL/HTTP/concurrencia/UI: `node scripts/test-s2-security-isolated.mjs --ui`.
Crea PostgreSQL/Auth/PostgREST y red con prefijo aleatorio propio, aplica migraciones
sólo allí, genera cuentas sintéticas y compila una copia temporal de Next sin copiar
.env. Al terminar elimina únicamente sus contenedores, volúmenes, red y copia.
No se ejecuta `npm run test:e2e` contra su configuración habitual porque apuntaría
al entorno del propietario; Playwright se ejecuta desde este harness aislado.

Resultados finales:

| Validación                           | Resultado real                                                                                                                                                                                                                            |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`                       | PASS, sin warnings.                                                                                                                                                                                                                       |
| `npm run typecheck`                  | PASS.                                                                                                                                                                                                                                     |
| `npm run test`                       | PASS: 139 tests / 13 archivos (30 nuevos).                                                                                                                                                                                                |
| `npm run build`                      | PASS; rutas nuevas compiladas, landing generada. No consultas de negocio durante build.                                                                                                                                                   |
| SQL / pgTAP descartable              | PASS: 317 aserciones, 43 de catálogo; cada archivo con rollback.                                                                                                                                                                          |
| Conexiones PostgreSQL independientes | PASS: 26 escenarios; 3 nuevos de catálogo.                                                                                                                                                                                                |
| Auth / PostgREST / Next HTTP         | PASS: login real, TOTP aal2, lectura privada/pública, selector, roles, invitaciones, LAST_OWNER, correlación, replay y paginación S2. Catálogo: 201/ETag, replay sin auditoría duplicada, barber 403, lectura propia y negocio ajeno 404. |
| Playwright descartable               | PASS: equipo S2 1280/390 px; catálogo alta/edición/archivo/restauración, staff sin cuenta y vínculo a servicio, barber sólo lectura en ambas pantallas, cero pageerror en recorrido de gestión y sin overflow móvil.                      |
| `npm run format:check`               | FAIL preexistente: 15 Markdown de docs/arquitectura-v1.1; conservados sin cambios. Archivos de esta entrega formateados con Prettier.                                                                                                     |
| Integridad de fuentes previas        | Once migraciones históricas, dependencias y assets originales conservados; sin archivos previos eliminados.                                                                                                                               |

Carreras nuevas: dos editores con versión 1 producen una sola escritura y 412
para el otro; administrador revocado mientras espera la raíz recibe 404 y no
escribe; dos altas concurrentes con igual UUID/key producen un perfil y una
auditoría. Ningún deadlock se acepta como rechazo correcto. Los escenarios S2
mantienen último propietario, reautorización de invitaciones, caducidad/purga y
aislamiento por negocio. No se detectaron regresiones en los recorridos ejecutados.

Capturas con datos sintéticos: `test-results/catalog-desktop.png` y
`test-results/catalog-mobile.png`, inspeccionadas visualmente, ignoradas por Git.
No se registran cuerpos con credenciales ni cookies. `.env.local` continúa ignorado;
no hay secretos rastreados agregados. La ejecución final eliminó sus contenedores,
volúmenes y red descartables.

## Pendientes y restricciones

- Al cerrar esta implementación, la migración sólo estaba verificada en descartable.
  Posteriormente el usuario autorizó la activación en su instancia local, realizada
  con respaldo y sin reset. Ver [informe de activación](LOCAL_CATALOG_ACTIVATION_REPORT.md).
  No se autorizan aplicaciones remotas ni futuras migraciones automáticamente.
- No se publica catálogo anónimo todavía. La proyección pública S1 del negocio
  permanece intacta; accepts_online es configuración sin habilitar reservas.
- Foto/Storage y color por profesional quedan pendientes; se entrega bio. No se
  eliminan de requisitos futuros ni se incorporan proveedores/dependencias ahora.
- No hay clientes, agenda, snapshots, notificaciones ni tokens de gestión pública.
  P-02, EXCLUDE y el cierre completo P-03/P-06 siguen pendientes para reservas.
- Matriz implementada mediante capacidades TS y guardas SQL S2; no se incorpora
  todavía un registro JSON general de permisos ni permisos personalizados.
- Lectura completa del catálogo y selector legado de cuentas sin truncamiento;
  futuras escalas pueden requerir paginación/búsqueda específica. No se modifica C-04.
- No se considera listo el MVP operativo ni se despliega al completar este bloque.
