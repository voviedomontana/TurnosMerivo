# Turnos internos IN-01/02/03 — implementación

Fecha: 2026-11-02. Autorización explícita del usuario: IN-D01…IN-D10, incluida la
representación de ocupación y el predicado EXCLUDE de §3 de
INTERNAL_BOOKING_MVP_PROPOSAL.md. Las restricciones anteriores de HS se reemplazan
sólo para este alcance. No es una aprobación del motor S6 completo.

Estado: **IN-01/02/03 implementados y validados en entorno descartable**. No
aplicados a la instancia del propietario.

## Resultado y alcance

Agenda interna Merivo para owner/admin activos con MFA aal2. Selección explícita de
cliente existente, profesional y servicio habilitado; consulta de horarios con
ocupación real; confirmación, reprogramación o cancelación mientras el turno no
haya comenzado. Un teléfono compartido no elige ni fusiona personas.

Sólo estados confirmed/cancelled. Reprogramar conserva cliente, profesional,
servicio y snapshots originales de nombre/precio ARS/duración/buffer. Respeta la
anticipación y horizonte actuales. Cancelar permite liberar un turno futuro aunque
se haya archivado su cliente o catálogo. Pasado/ya cancelado produce 409; no se
inventan visitas, finalizaciones o ausencias por reloj. El detalle muestra eventos
reales y contacto declarado; nunca notas privadas globales del cliente.

Barber no accede a la agenda ni al directorio/ficha de clientes. Conserva la consulta
de horarios propios, con rangos UTC ocupados sin identidad de cliente o turno.
Anon, app_server y service_role no reciben nuevos permisos de negocio.

## Archivos

Nuevos:

- supabase/migrations/20261102000200_internal_appointments.sql.
- supabase/tests/appointments.test.sql.
- src/modules/appointments/{schemas,service,http}.ts.
- src/components/appointments/agenda.tsx.
- src/app/app/[businessId]/agenda/page.tsx.
- src/app/api/v1/businesses/[businessId]/appointments/route.ts,
  [appointmentId]/route.ts y [appointmentId]/[action]/route.ts.
- tests/unit/booking-input.test.ts y booking-http.test.ts.
- scripts/lib/appointment-concurrency.mjs y appointment-browser.mjs.
- Este informe. La propuesta aprobada se conserva sin cambios.

Cambios acotados:

- src/modules/auth/{permissions,service}.ts: permisos y proyección validada de
  conflictos HS; no se exponen detalles SQL arbitrarios.
- src/modules/availability/{compute,schemas,http,service}.ts: resta de ocupación,
  versiones de contexto y mensaje de conflicto.
- src/components/availability/manager.tsx y página horarios: flags reales y enlaces
  administrativos a turnos afectados, máximo 20 referencias sin contactos.
- src/app/app/[businessId]/page.tsx y src/app/globals.css: acceso a agenda y layout
  adaptable; botones compartidos y tokens Merivo, sin cambiar logo ni dependencias.
- tests/unit/availability.test.ts y supabase/tests/{tenancy,s2_security_fixes,
  scheduling}.test.sql: regresión e inventario de definers/RPC.
- scripts/test-s2-security-isolated.mjs y scripts/lib/{am0405-browser,
  schedule-browser}.mjs: pruebas acumuladas aisladas, hashes históricos y nuevo flag.
- AGENTS.md y docs/CHANGELOG.md: registro expreso del alcance autorizado.

## Migración, identidad e integridad

La migración 15 agrega cinco tablas con RLS/FORCE y sin DML/SELECT directo para
roles de aplicación: public.appointments, public.appointment_events,
app.appointment_occupancy, app.appointment_outbox y app.appointment_requests.
Todas las relaciones de negocio usan claves compuestas por tenant.

La ocupación conserva cada generación, sus extremos originales y liberación
explícita. GiST/btree_gist excluye intersecciones de
(business_id, staff_member_id, tstzrange(starts_at, blocked_until, '[)')) sólo
cuando released_at IS NULL. El buffer también ocupa. Dos rangos contiguos son
compatibles. Otro staff puede atender en el mismo instante. No se usa reloj ni
status en el predicado.

Índice parcial asegura como máximo una asignación activa por turno. Constraint
triggers diferidos verifican al commit confirmed = exactamente una asignación
coincidente y cancelled = ninguna. Los extremos se derivan con minutos UTC reales;
CHECK valida diferencias y finitud. Snapshot/identidades y extremos históricos son
inmutables; no hay hard delete de turnos, asignaciones o eventos desde la app.

Funciones nuevas privilegiadas, owner postgres, search_path vacío, EXECUTE revocado
a PUBLIC/anon/app_server/service_role:

| Función                         | Permiso y propósito                                                                                                   |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| api.manage_appointment          | authenticated; auth.uid(), membresía/tenant activos y owner/admin aal2, en cada intento y replay.                     |
| api.read_appointment            | authenticated; misma autorización, proyección explícita de detalle y eventos.                                         |
| api.list_appointments_page      | authenticated; misma autorización en cada página, resumen sin notas/contactos.                                        |
| api.appointment_preview_source  | authenticated; misma autorización y snapshots originales para reprogramar; excluye ocupación propia.                  |
| app.check_appointment_occupancy | Trigger privado diferido, sin EXECUTE de aplicación; comprueba coherencia aun al finalizar una llamada authenticated. |

Helpers invoker privados: guard_appointment, guard_appointment_allocation,
appointment_time_allowed, assert_schedule_appointments, appointment_context,
check_appointment_context y purge_appointment_requests. Sin grants de aplicación.
Inventario acumulado: 33 definers; se reemplazan dos cuerpos HS en la migración nueva,
sin alterar sus firmas ni los archivos aplicados: api.schedule_preview_source y
api.write_schedule. Se conservan autorización barber propia, MFA, límites y replay HS.

Preautorización no bloqueante → raíz businesses FOR UPDATE → reautorizar → replay →
staff → cliente → turno → ocupación → evento/outbox/audit/replay. READ COMMITTED;
las funciones S2 rechazan snapshots transaccionales incompatibles. No SHARE/upgrades,
red, Auth Admin ni correo mientras se mantienen locks. Misma raíz serializa edición
de catálogo, membresías, clientes, HS y turnos. Purga toma sólo filas del ledger con
SKIP LOCKED y nunca solicita la raíz, evitando ciclos con escritores.

PostgreSQL vuelve a comprobar horarios, vigencias, excepciones, cierre global,
bloqueos, grilla, DST, notice/horizonte y elegibilidad. La consulta del navegador no
reserva un lugar. La constraint nombrada appointment_occupancy_no_overlap es la única
exclusión traducida a SLOT_TAKEN. Otras constraints conservan respuestas internas
seguras. Fallos posteriores revierten turno, liberación, versión, evento, outbox,
auditoría y ledger juntos.

## Contratos HTTP y compatibilidad HS

Base: /api/v1/businesses/{businessId}/appointments.

| Operación              | Contrato                                                                                                                                                                                            |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST base              | UUID v4 estable, customer_id/staff_id/service_id, starts_at con offset explícito, context_versions; Idempotency-Key UUID. 201 + metadatos y ETag. Precio/nombre/duración no se aceptan del cliente. |
| GET base               | from local (por defecto hoy del negocio), days 1–7, staff_id opcional, limit 50 por defecto/200 máximo, cursor. Orden starts_at/id; cursor ligado a negocio y filtros.                              |
| GET /{id}              | Detalle autorizado y ETag, snapshots y eventos reales.                                                                                                                                              |
| GET /{id}/availability | from/days, disponibilidad con snapshots originales y sin descontar la propia asignación.                                                                                                            |
| POST /{id}/reschedule  | starts_at/context_versions/reason opcional, If-Match y key.                                                                                                                                         |
| POST /{id}/cancel      | reason opcional, If-Match y key. Sin DELETE.                                                                                                                                                        |

Creación observa versiones staff/service/customer/calendar/settings/business;
reprogramación staff/calendar/settings/business más If-Match del turno. Cancelación
sólo If-Match del turno. Falta de versión →428; obsoleta→412; conflicto de dominio→409;
identidad/permiso/tenant→401/403/404 según los contratos S2. Validación de forma no
sustituye autorización SQL. Body estricto y acotado, cookie CSRF/origen, Bearer
verificado, respuestas private/no-store, ETag y X-Request-Id por intento.

HS devuelve occupancy_checked=true y sólo intervalos UTC ocupados pertinentes al
período consultado, con margen temporal para transiciones de zona. can_book=false
continúa indicando que una vista previa no confirma un turno. La UI administrativa
muestra precio/duración/buffer calculados y requiere selección explícita de horario.
No hay reintentos automáticos de conflictos; el borrador se conserva.

Cambios de jornada/excepción/bloqueo prueban los turnos futuros con snapshots
originales, sin volver a aplicarles la anticipación que ya transcurrió. Conflicto
APPOINTMENTS_AFFECTED →409, rollback completo y máximo 20 IDs/staff/fechas autorizados
con indicador has_more. El servidor valida estrictamente esa única forma de
error.details antes de exponerla; otro detalle SQL se descarta. No hay override ni
cancelación automática.

La paginación no promete un snapshot entre páginas cuando se reprograman turnos.
Se recarga luego de cada mutación y se identifica siempre por UUID. Contactos se
buscan por POST y se elige una ficha; no se ponen en URLs ni almacenamiento local.

## Replay, auditoría y mantenimiento

Ledger separado por tenant/actor/operación/key, canon_version=1, hash calculado en
SQL con intención y versiones, resultado mínimo sin nombres/contactos/motivos y
origin_request_id. 48 horas desde created_at; evaluación tras locks. Replay autorizado
devuelve el resultado original sin repetir efectos ni registrar otra mutación.
UUID estable evita recreación después de TTL y versión esperada evita repetir
movimientos/cancelaciones. La UI conserva key/UUID ante fallos de transporte de una
intención idéntica; cambiar la intención genera otra key. Tras una creación conocida
como exitosa deshabilita la confirmación anterior aunque falle una lectura posterior.

Purga privada invoker sólo para mantenimiento privilegiado del entorno, lotes 1–500,
SKIP LOCKED. Sin scheduler ni grants a app_server/service_role/authenticated. No borra
turnos, ocupación histórica, eventos, auditoría o invitaciones. Falta definir su
operación periódica antes de producción.

Evento real por versión con actor y motivo privado. Auditoría general sólo metadatos;
request_id se conserva en evento/audit/origen. Outbox privado pendiente con IDs y
versiones, sin contactos, secretos, tokens o proveedor. No existe worker ni envío y
la UI no promete notificaciones.

## Validaciones y cierre

La suite final se ejecuta con node scripts/test-s2-security-isolated.mjs --ui.
PostgreSQL, GoTrue, PostgREST, fixtures de usuarios/MFA y Next temporal son propios
de la ejecución; no se carga .env del propietario en el harness. No se ejecuta el
script normal test:e2e porque apunta al entorno local del propietario.

| Check                                | Resultado real                                                                                                                                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQL/pgTAP descartable                | PASS: 486 aserciones totales; 80 de turnos. Todas las suites hacen rollback de sus fixtures.                                                                                                                                       |
| Conexiones PostgreSQL independientes | PASS: 48 escenarios totales; 10 nuevos de turnos, sin deadlocks aceptados como éxito.                                                                                                                                              |
| HTTP/Playwright aislado              | PASS: flujo crear/ver/reprogramar/cancelar; contactos compartidos con selección explícita, precio/duración/override, buffer ocupado, conflictos HS, 428/412, replay, privacidad barber y vista móvil sin overflow/pageerror.       |
| Regresión S1/S2/catálogo/clientes/HS | PASS en el mismo harness: login/password/TOTP real de fixtures, selector, permisos, roles, invitaciones, LAST_OWNER, tenants, lectura pública/privada, cursores, correlación, retención y rollback.                                |
| npm run test                         | PASS: 198 tests / 19 archivos. Incluye validación HTTP y de entradas, permisos y resta de ocupación.                                                                                                                               |
| npm run lint / typecheck             | PASS.                                                                                                                                                                                                                              |
| npm run build                        | PASS; además el harness compila y sirve una copia Next de producción con configuración sintética. Un intento local final encontró EPERM al crear una carpeta .next; se repitió con permisos de ejecución y completó correctamente. |
| npm run format:check                 | FAIL preexistente: sólo 15 Markdown de docs/arquitectura-v1.1, conservados intactos. Formato de archivos nuevos/modificados comprobado.                                                                                            |
| git diff --check                     | PASS.                                                                                                                                                                                                                              |

SQL prueba superposición de servicio/buffer y contigüidad, separación por staff,
FK de cliente ajeno, precios/duración originales tras cambios de catálogo, grilla,
horarios, claves/versión, borrado prohibido, coherencia diferida y conservación de
historial. Inyecta fallos separados de evento, audit, outbox y ledger; verifica
cero efectos parciales. También comprueba cancelación con catálogo archivado,
rechazo de pasado, cursores/filtros, límites, purga privada y rollback HS de cierre,
bloqueo y revisión semanal.

Las diez carreras nuevas usan conexiones psql independientes y barreras observadas
en pg_stat_activity: dos creaciones sobre el mismo lugar; replay simultáneo; mover
contra crear; cancelar contra mover; revocación durante replay en espera; reserva
que gana a un cierre; cierre que gana a un intento con contexto obsoleto; purga
abortada sin bloquear otra escritura; replay vencido que espera purga y conserva
UUID único; EXCLUDE directo entre transacciones de mantenimiento, sin depender de
la raíz RPC. Sólo esta última usa SQL privilegiado como fixture para probar la
constraint física; la aplicación no recibe esos permisos.

La primera ejecución ampliada detectó un permiso faltante del helper temporal
pg_temp.booking de la suite: se corrigió exclusivamente en el test. Las ejecuciones
posteriores completas terminaron con exit 0. Sin regresiones detectadas en los
recorridos ejecutados. Capturas sintéticas internal-agenda-desktop.png y
internal-agenda-mobile.png inspeccionadas visualmente, ignoradas por Git.

Comparación SHA-256 contra la captura previa al bloque funcional: 232 archivos,
213 intactos, 19 cambios acotados y 15 archivos nuevos; ninguno eliminado. Se
excluyeron archivos de entorno y resultados generados de esa comparación. Las
catorce migraciones previas, propuesta aprobada, documentos de arquitectura,
dependencias/lockfile y assets de marca permanecen intactos. Hash SHA-256 de la
migración nueva:
`14f8fd0adf146a55855f7f2dee09eefde47309ba54bc660b6cb97614a14a6aef`.

El harness retiró todos sus containers, volúmenes y red; inventario Docker por su
prefijo merivo-s2-check quedó vacío. .env.local, respaldos y capturas están ignorados;
Git no registra archivos de entorno/credenciales o respaldos. No se inspeccionaron
ni imprimieron valores secretos reales ni se usó la cuenta del propietario como
fixture. El build local carga su configuración de entorno mediante Next, sin
mostrar sus valores; las pruebas de escritura y navegador usan sólo configuración
sintética del harness.

## Límites operativos y pendientes

- Ninguna migración aplicada al propietario; no se modificaron cuentas, MFA,
  sesiones, invitaciones ni datos reales. Se preservan las catorce fuentes previas.
- No se activan clientes/HS/turnos en la instancia local. Para probar allí falta
  autorización específica del conjunto pendiente, respaldo y verificación de destino.
- No hay portal público, manage_token, confirmaciones por email/WhatsApp, pendientes
  con expiración, reasignación, drag-and-drop, completed/no_show, correcciones o
  liberaciones parciales. No hay GAS, despliegue, commit ni push.
- P-02 histórico futuro y tokens/replay público siguen pendientes. La aprobación
  física actual sólo cubre IN-D01…D10. Aviso de privacidad, retención de clientes,
  derechos y revisión legal permanecen como gate antes de datos reales.
- Sin benchmark de producción/p95. La raíz exclusiva serializa escrituras por negocio
  deliberadamente; cualquier optimización futura necesita diseño y pruebas propias.
- No se incorpora escritor de timezone/políticas del negocio. Uno futuro debe adoptar
  la misma coordinación y comprobar turnos afectados. No realizar cambios SQL manuales
  de configuración como flujo de aplicación.
- No se avanza automáticamente al próximo bloque.
