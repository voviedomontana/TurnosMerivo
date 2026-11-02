# Roadmap técnico propuesto S3–S13

Fecha: 2026-11-01. **Plan para revisión, no autorización de implementación.**
Base: S0–S2 locales preservados; V11 como referencia con excepciones del pedido
actual y [registro](DECISION_REGISTER.md). Ningún sprint se cierra por crear archivos.

## Supuestos, esfuerzo y camino crítico

Estimaciones en días-persona de ingeniería, incluyendo diseño detallado, revisión,
tests y corrección de fallos; una persona con conocimiento del repo. No son compromisos
de fecha ni sprints necesariamente de una semana. No incluyen esperas de aprobación,
contratación, revisión legal, incidencias externas o trabajo de la app GAS no inspeccionada.
Reestimar al cerrar cada diseño; no sumar como entrega realizada lo ya especificado.

| Paquete                          | dp estimados | Complejidad / dependencia principal                    |
| -------------------------------- | ------------ | ------------------------------------------------------ |
| S3-A diseño y aprobación         | 2–4          | Alta; P-02/P-03/P-06 y compatibilidad                  |
| S3-B esquema autorizado          | 5–8          | Alta; S3-A aprobado                                    |
| S4 catálogo                      | 4–6          | Media; esquema/privilegios y protocolo de elegibilidad |
| S5 disponibilidad                | 6–9          | Alta; P-03/P-06 y catálogo                             |
| S6 motor                         | 8–12         | Muy alta; P-02/03/06, slots y outbox base              |
| S7 portal público                | 5–7          | Alta; S6 y S9 para entrega completa con email          |
| S8 panel core + S8-I integración | 7–10         | Alta; core S6, parte I espera S10                      |
| S9 notificaciones                | 4–6          | Alta; S6, proveedor y operación de worker              |
| S10 API integración              | 5–8          | Alta; P-04/05/08, sin feed obligatorio                 |
| S11 GAS                          | 5–8          | Alta; S8-I/S10 y clon GAS inspeccionado                |
| S12 verificación integral        | 5–8          | Alta; todas las capacidades MVP                        |
| S13 despliegue/piloto            | 3–5          | Alta operativa; S12 y revisión legal                   |
| **Subtotal pendiente**           | **59–91**    | Más observación del piloto durante 2 semanas           |

Paquete compatible S2 de C01–C07, permisos/correlación: **2–4 dp adicionales** como
provisión inicial, sujeto a diseño; no ejecutar implícitamente dentro de un sprint
de otro nombre. Estimación global restante orientativa: 61–95 dp de ingeniería,
sin duplicar soporte temporal u otras funciones que requieran alcance específico.
Un piloto de dos semanas no implica diez días-persona completos ni está incluido
en el esfuerzo de preparación S13. No usar el total como promesa de calendario.

Camino técnico obligatorio: S3-A → aprobación → S3-B → S4 → S5 → S6.
Después, ramas S9→S7 (email real), S8-core y S10; S8-I necesita S10 y permite S11.
S7/S8/S9/S11 convergen en S12 → S13 → observación del piloto y decisión de lanzamiento.
Con una sola persona las ramas también consumen tiempo secuencial; no prometer
paralelismo por dibujar flechas. Recomendación a aprobar: ejecutar S9 antes de
cerrar S7, y diferir la parte de integración de S8 hasta S10. Conserva funcionalidades
del MVP y evita mocks presentados como producto o adelantos silenciosos de APIs.

DoD común (G): alcance/diseño aceptados, cambios revisados y versionados por PR cuando
el usuario lo autorice, CI local y remoto requerido verde, migraciones compatibles
en instancia aislada y staging, pruebas del requisito con roles reales, documentación,
catálogo de funciones, recuperación y evidencia de aceptación. Secretos fuera de
repo/logs, sin hallazgos críticos/altos abiertos. Si un entorno falta, informar
entrega local parcial, no certificar G ni todo el sprint.

## S3-A — reconciliación y aprobación del diseño

1. **Objetivo funcional:** tener un contrato aprobable del esquema operativo sin afectar accesos S2.
2. **Alcance:** cerrar matriz de entidades, permisos, ocupación, temporalidad, locks,
   versiones/replay y compatibilidad; resolver ADR duplicados y excepciones V11.
3. **Dependencias:** este análisis, docs V11/históricos, código y aceptación del usuario.
4. **Decisiones previas:** alcance S3-A y si incluye diseñar el paquete S2 compatible;
   P-02 A provisional no basta para autorizar DDL.
5. **Módulos:** análisis de auth/businesses/staff/services/availability/appointments/customers/notifications.
6. **Tablas:** inventario existente + restantes, sin crearlas; clasificar mapeos/credenciales fuera de S3 base.
7. **Endpoints:** contratos propuestos y compatibilidad S2, sin handlers nuevos.
8. **UI:** flujos y restricciones de permisos/Merivo; sin pantallas implementadas.
9. **Reglas:** decisiones §2–5 del registro, especialmente ausencia no libera automáticamente.
10. **Seguridad:** matriz por tabla/función/rol, identidad vs argumento de recurso, helpers/owners revisados.
11. **Unit:** especificar tabla de permisos y escenarios de política, no afirmar ejecución.
12. **Integración:** especificar invariantes SQL, carreras y recuperación; no consultar BD del propietario.
13. **E2E:** plan de preservación de login/MFA/invitaciones y futuros flujos; no ejecutarlos en una revisión pura.
14. **Aceptación:** cada objeto con gate, propietario, contrato y criterio de prueba; decisiones firmadas por alcance.
15. **DoD:** revisión documental y registro de aceptación de decisiones; no requiere fingir G de una funcionalidad.
16. **Riesgos:** criterios ambiguos prolongan el cierre; no aprobar todo V11 en bloque.
17. **Estimación:** 2–4 dp, alta por conciliación; espera de producto no incluida.

## S3-B — implementación del esquema autorizado

1. **Objetivo funcional:** base operativa íntegra para habilitar catálogo y motor posteriores.
2. **Alcance:** migraciones nuevas en lotes compatibles: catálogo/clientes, recursos
   de agenda, reservas/ocupación autorizada, eventos/outbox y tipos. Sin reservas utilizables todavía.
3. **Dependencias:** S3-A y decisiones aceptadas; entorno DB aislado sin datos del propietario.
4. **Decisiones previas:** P-02/03/06 físicos, defaults, authz canónica, permisos y adaptación S2; P-04 sólo si se adelanta DDL externo.
5. **Módulos:** tipos/repositorios mínimos de dominios existentes y auth; sin reorganización.
6. **Tablas:** staff_members, services, staff_services, customers, working_hours,
   schedule_exceptions, time_blocks, appointments/ocupación aprobada, appointment_events,
   notifications e idempotencia de reservas aprobada; control global versionado.
7. **Endpoints:** ninguno de negocio nuevo; mantener público base y S2. Tipos generados no habilitan RPC por sí mismos.
8. **UI:** conservar landing/accesos; no presentar agenda ficticia.
9. **Reglas:** FKs por tenant, unicidades, baja lógica, precios/duración/buffer válidos,
   derivados exactos, snapshots/eventos protegidos, estados compatibles con P-02.
10. **Seguridad:** ENABLE/FORCE, deny-all inicial de writes, SELECT mínimo por rol/own,
    helpers sin recursión ni bypass silencioso; grants por función y defaults globales.
11. **Unit:** parseo de tipos/esquemas y políticas aprobadas que exista razón de probar.
12. **Integración:** pgTAP de FK/RLS/EXCLUDE/derivados/ACL/inmutabilidad, reconstrucción
    de cinco migraciones previas+nuevas en instancia descartable; upgrade sin pérdida.
13. **E2E:** acceso/MFA/equipo/landing dev y producción preservados.
14. **Aceptación:** inserción inter-tenant rechazada, rangos/flags históricos coherentes,
    reproducción aislada, sin grants de negocio prematuros ni pérdida de datos.
15. **DoD:** G; catálogo actualizado, revisión humana SQL, evidencia de upgrade/roll-forward.
16. **Riesgos:** slots históricos/recurso global sin aprobar, tests como postgres que no prueban API,
    triggers temporales incompletos. Bloquear lote dependiente, no debilitar constraint.
17. **Estimación:** 5–8 dp, alta; no incluye feed, GAS ni motor transaccional S6.

## S4 — profesionales y servicios

1. **Objetivo funcional:** owner/admin administra un catálogo real, barbero consulta lo permitido.
2. **Alcance:** crear/editar/listar/baja lógica/activar y desactivar, servicios habilitados,
   overrides precio/duración, orden y preview de reservas futuras afectadas.
3. **Dependencias:** esquema S3-B; contrato para cambios de elegibilidad bajo coordinación P-03.
4. **Decisiones previas:** matriz de columnas editables, versión del padre en asociaciones,
   política de desactivación con reservas existentes; sin cancelación automática.
5. **Módulos:** staff, services, auth, businesses; handlers finos.
6. **Tablas:** staff_members, services, staff_services; miembros como vínculo opcional; auditoría.
7. **Endpoints:** GET/POST staff, GET/PATCH staff/{id}, POST deactivate; GET/POST services,
   PATCH services/{id}, POST deactivate; PUT staff/{id}/services, bajo /api/v1/businesses/{id}.
8. **UI:** listas/formularios catálogo Merivo, asociación, errores y conflictos 412.
9. **Reglas:** nombres únicos por negocio, límites de overrides, sin mover tenant;
   vinculación a miembro del mismo negocio, no convertir baja de login en baja de staff silenciosa.
10. **Seguridad:** owner/admin write con MFA, barbero lectura acotada; versión y audit;
    SELECT/grants sólo mínimos y RPC no dependiente de source/actor del body.
11. **Unit:** Zod strict, permisos, precios/intervalos y elegibilidad.
12. **Integración:** CRUD real, otro tenant, miembro ajeno, concurrent PATCH 200/412,
    asociación duplicada y desactivación sin borrar reservas/snapshots.
13. **E2E:** admin gestiona ambos catálogos y asociación; barbero no obtiene acciones prohibidas.
14. **Aceptación:** catálogo persistido y validado; servicio sin staff no se ofrece
    en proyección pública cuando se habilite; no implementar reserva como dependencia oculta.
15. **DoD:** G más formularios/estados vacíos y regresión S2; API documentada.
16. **Riesgos:** cambios de servicio compartido sin coordinación/versionado; nueva dependencia UI sin justificar.
17. **Estimación:** 4–6 dp, media, incluyendo API/UI/tests.

## S5 — horarios y disponibilidad

1. **Objetivo funcional:** consultar slots informativos correctos con descansos, vacaciones y zona del negocio.
2. **Alcance:** jornadas con vigencia, excepciones locales/globales, bloqueos, editor,
   computeSlots puro y lectura pública/privada. No confirma reservas.
3. **Dependencias:** S3-B/S4, P-03 y P-06 aceptadas antes de cualquier escritura de horarios.
4. **Decisiones previas:** precedencia de excepciones, versión global, política DST
   (hora inexistente/ambigua), grilla y semántica del buffer fuera de jornada.
5. **Módulos:** availability para cálculo, staff/services para datos; auth/businesses para contexto.
6. **Tablas:** working_hours, schedule_exceptions, time_blocks, controles versionados,
   staff/services/appointments para ocupación; auditoría.
7. **Endpoints:** GET/PUT working-hours, GET/POST/DELETE exceptions, GET/POST/DELETE time-blocks,
   GET public/{slug}/availability y businesses/{id}/availability, según contrato aprobado.
8. **UI:** editor semanal, descansos/vigencias, excepción/bloqueo y lista de afectados.
9. **Reglas:** [), servicio no cruza descanso, buffer no cruza bloqueo/reserva aunque
   pueda exceder cierre; fechas locales a UTC por día, no sumar 24 h; no cancelar por cambiar jornada.
10. **Seguridad:** pertenencia/rol/own; barber_can_edit_availability; globals sólo permiso
    administrativo; límite de rango y proyección pública mínima; no cachear autorización.
11. **Unit:** casos B02–23 aplicables, property-based, DST, buffer que invade un bloqueo,
    grilla, parámetros y reloj inyectado; permisos.
12. **Integración:** constraints/solapes de jornada, FK, versión padre/global y carreras
    de configuración; estado de reservas afectadas intacto.
13. **E2E:** editar turno cortado, feriado/vacación, mostrar sin slots y error 412 guiado.
14. **Aceptación:** slots válidos en fixture de 10 staff/60 días; p95 objetivo <600 ms
    medido en entorno definido, no prometido por un algoritmo escrito.
15. **DoD:** G y tests de cálculo/concurrencia de escritores; disponibilidad rotulada informativa.
16. **Riesgos:** buffer, DST, grants que permitan eludir coordinación, globals sin control de versión.
17. **Estimación:** 6–9 dp, alta por calendario y concurrencia.

## S6 — motor transaccional de reservas

1. **Objetivo funcional:** crear y gestionar reservas con garantía de ocupación/integridad en PostgreSQL.
2. **Alcance:** crear, any staff, confirmar/cancelar/reprogramar/reasignar, complete/no_show,
   reversión/ajuste/liberación aprobados, clientes y contadores, eventos/outbox, replay seguro.
3. **Dependencias:** S3-B/S4/S5, P-02/P-03/P-06 cerradas y compatibilidad HTTP revisada.
4. **Decisiones previas:** guarda temporal, liberación histórica, token/TTL/replay, últimos
   criterios de authz por estado y responsabilidades del worker de expiración.
5. **Módulos:** appointments, availability, customers, auth, notifications (encolado).
6. **Tablas:** appointments/ocupación, customers, events, audit, notifications, replay,
   catálogo/horarios para validar; no change_log obligatorio ni dependencia de GAS.
7. **Endpoints:** POST public/{slug}/appointments; consultas/acciones por token;
   GET/POST appointments y POST confirm/cancel/reschedule/complete/no-show/revert;
   clientes GET/POST/PATCH/merge/historial según matriz, bajo /api/v1.
8. **UI:** estados de error compartidos/contratos consumibles; no reemplazar S7/S8
   con dashboards ficticios. Harness de demo técnica separado de producto si se necesita.
9. **Reglas:** locks y revalidación completos, EXCLUDE, snapshots/derivados, duración
   real UTC, resultados excluyentes, versión/evento/audit/outbox/replay atómicos.
10. **Seguridad:** wrappers sesión/público con capacidad mínima; core no ejecutable;
    sin actor/source/override arbitrarios; 404 cross-tenant y token sólo para su reserva.
11. **Unit:** normalización AR, políticas, estados, guardas, intent hash y autorización.
12. **Integración:** B01–56 adaptados a A, concurrencia real con conexiones distintas,
    any/reprogramación cruzada/globals/release/expire, rollback inyectado y replay seguro tras timeout.
13. **E2E:** humo real de endpoints por rol, carrera 200/412/409 y gestión mediante token;
    portal visual completo se valida S7/S8.
14. **Aceptación:** cero solapes y efectos parciales en campañas de estrés definidas;
    fallo de reprogramar conserva origen; ausente no libera automáticamente; replays reautorizados.
15. **DoD:** G, revisión de SQL y protocolo; pruebas estadísticas del cliente y recuperación del token.
16. **Riesgos:** deadlock, token perdido/expuesto, límites por teléfono concurrentes,
    UX que trate disponibilidad como garantía, sobrescribir historia.
17. **Estimación:** 8–12 dp, muy alta; resolver decisiones antes del código reduce incertidumbre.

## S7 — portal público

1. **Objetivo funcional:** cliente reserva y gestiona desde el celular sin crear cuenta.
2. **Alcance:** página por negocio, servicio, profesional/any, fecha/horario, datos,
   revisión/confirmación, gestión por token, .ics, privacidad/SEO y manifest sencillo.
3. **Dependencias:** S4–S6; S9 para confirmación por email y cierre completo del flujo.
4. **Decisiones previas:** ciclo de token, email opcional/obligatorio y canal de recuperación,
   política/consentimiento, proveedor de anti-abuso y límites distribuidos justificados.
5. **Módulos:** businesses, staff/services, availability, appointments, customers;
   lib de rate limit/Turnstile al aprobar integración del proveedor.
6. **Tablas:** sólo operaciones autorizadas sobre entidades de S3/S6; no cuentas de clientes.
7. **Endpoints:** reutilizar public/{slug}, catálogo/disponibilidad/appointments y
   public/appointments/{id} y cancel/reschedule; no replicar un motor en React.
8. **UI:** flujo mobile-first de cinco pasos aprobado, resumen y enlaces de gestión Merivo.
9. **Reglas:** confirmar condiciones actuales, manejar SLOT_TAKEN con alternativas,
   no revelar cliente preexistente, cutoff/reprogramaciones, consentimiento versionado.
10. **Seguridad:** Turnstile/rate limit servidor, token en fragmento/header, no secretos
    en URL query/log/cache, CSP y validación; no cache sensible en service worker.
11. **Unit:** esquemas, validaciones, transformación de fechas/precios y políticas UI.
12. **Integración:** abuso/limites, tokens inválidos/expirados/ajenos, proveedor email y privacidad.
13. **E2E:** reservar/cancelar/reprogramar móvil, dos clientes mismo slot, email real
    de staging/Mailpit de prueba, axe y conflicto con teclado/lector.
14. **Aceptación:** recorrido completo sin cuenta; token recuperable según diseño;
    Lighthouse móvil objetivo ≥90 rendimiento/accesibilidad y WCAG AA del flujo verificados.
15. **DoD:** G más texto legal revisado para publicar; no decir email enviado si sólo se encoló.
16. **Riesgos:** spam, enumeración, pérdida de enlace, UX de conflicto, dependencia de S9 ignorada.
17. **Estimación:** 5–7 dp, alta por anti-abuso/accesibilidad y flujo de recuperación.

## S8 — panel administrativo/profesional; S8-I posterior

1. **Objetivo funcional:** owner/admin opera un día y barbero gestiona sólo su agenda.
2. **Alcance:** core: agenda diaria/semanal, detalle/alta/estados/bloqueos, clientes,
   búsqueda/fusión e indicadores básicos, PWA instalable. S8-I: vinculaciones,
   import dry-run y credenciales, después de S10.
3. **Dependencias:** core S4–S6/S9 para estado de avisos; S8-I espera contratos/API S10.
4. **Decisiones previas:** alcance de notas/historial propio, métricas/denominadores,
   undo sin revert prohibido, políticas de vínculos/reversión y defaults de import.
5. **Módulos:** appointments, customers, availability, analytics, auth y integrations en S8-I.
6. **Tablas:** reservas/eventos/clientes/staff/config; mappings/credentials en fase I;
   indicadores derivados, sin duplicar caja de Sheets.
7. **Endpoints:** reutilizar catálogo, agenda/acciones, clientes/merge y bloqueos;
   API de credenciales/mapeos/import sólo tras S10, sin endpoints simulados.
8. **UI:** AppShell, AgendaDay/Week, sheet detalle, formulario manual, clientes,
   Mi agenda, dashboard y pantallas de integración como entrega separada dependiente.
9. **Reglas:** cambios mediante comandos/versión; barbero own, no-show A y correcciones
   autorizadas; informes no se convierten en contabilidad; .ics no es Google Calendar.
10. **Seguridad:** checks servidor/BD por cada acción; UI permission gate sólo presentación;
    MFA privilegiado, auditoría, caché/PWA sin datos de clientes ni escrituras offline.
11. **Unit:** filtros/estadísticas, permisos, estados, parseo y previsualización de import.
12. **Integración:** búsquedas aisladas, fusión con mapeos/eventos, cambios simultáneos,
    contadores y exportaciones permitidas sin PII en logs.
13. **E2E:** día completo admin, barbero sólo propio, 412 con refetch/confirmación;
    S8-I import dry-run/confirmación y crear/rotar/revocar credencial mostrando secreto una vez.
14. **Aceptación:** operar sin tocar BD; nadie obtiene rol por UI; relaciones externas
    sólo confirmadas con identidad real; panel rápido en volumen objetivo medido.
15. **DoD:** G por ambas fases; S8 no se declara completo si parte I está diferida pendiente.
16. **Riesgos:** dependencia S8↔S10, permisos por componente divergentes, undo que invoca
    revert de barbero, ampliación a reportes financieros.
17. **Estimación:** 7–10 dp total orientativo (core 5–7; I 2–3), alta.

## S9 — notificaciones y jobs

1. **Objetivo funcional:** entregar avisos de reserva y recordatorios con estado recuperable.
2. **Alcance:** proveedor email, plantillas, dispatch/expiración, retries/backoff/dedupe,
   programación, observación de cola y errores; ejecutar antes del cierre completo S7.
3. **Dependencias:** outbox S3/S6, cron/proveedor en entorno de prueba y secretos por capacidad.
4. **Decisiones previas:** proveedor, cadencia, leases/ack e idempotencia de envío;
   no afirmar exactly-once si el proveedor no resuelve timeout tras aceptación.
5. **Módulos:** notifications, appointments para expiración revisada, lib jobs/provider.
6. **Tablas:** notifications, appointments/eventos/audit, job_runs si se aprueba,
   sin change_log de integración requerido.
7. **Endpoints:** job interno de dispatch autenticado y lectura de estado autorizada;
   expire_pending SQL/cron bajo protocolo aprobado, sin actor/tenant externo arbitrario.
8. **UI:** estado de avisos/cola/dead mínimo y plantillas Merivo; sin prometer notificación
   externa con el correo de alta Auth ya existente.
9. **Reglas:** outbox atómico con reserva, cancelar/reencolar recordatorios al cambiar;
   no reintentar errores permanentes ilimitadamente; zonas correctas en mensajes.
10. **Seguridad:** lease/job verificado, secretos distintos por entorno, payload mínimo,
    no I/O proveedor bajo locks agenda; autorización específica para reenvío manual.
11. **Unit:** backoff, dedupe, render y clasificación de errores del proveedor.
12. **Integración:** dos workers, crash antes/después de enviar/ack, timeout incierto,
    reprogramación/cancel simultánea y expiración contra confirmación.
13. **E2E:** reservar→recibir email correcto, cancel/reprograma→avisos sin recordatorio viejo;
    panel autorizado observa y recupera dead según runbook.
14. **Aceptación:** campañas controladas sin duplicados bajo garantías del proveedor;
    registrar límites, no ocultar ventana de entrega incierta. Dead genera alerta.
15. **DoD:** G y alertas/jobs probados; política de reenvío/documentación de recuperación.
16. **Riesgos:** entrega aceptada sin ack, destinatario opcional, cuotas/planes sin confirmar,
    jobs bloqueando reservas por orden de locks incorrecto.
17. **Estimación:** 4–6 dp, alta; DNS/proveedor externos pueden añadir espera no estimada.

## S10 — API de integración segura

1. **Objetivo funcional:** un consumidor autorizado consulta y reconcilia datos del negocio.
2. **Alcance:** service_key lectura, me/listados/barridos completos/reconciliación,
   scopes/rotación/revocación, mapeos tipados y links autenticados, OpenAPI.
   No feed incremental como requisito MVP; user_token escribe sólo si P-08 se aprueba.
3. **Dependencias:** S6, P-04/P-05, proyecciones/catálogo de permisos y revisión de identidad.
4. **Decisiones previas:** alcance histórico completo, bootstrap/fin de corrida,
   tombstones, mapeos/fusión/needs_review y manejo de links en Modo R.
5. **Módulos:** integrations, auth, appointments/customers/analytics, lib HTTP/rate limit.
6. **Tablas:** integration_credentials, external_id_mappings, staging de import/candidatos
   y controles de corrida aprobados; referencias a entidades operativas existentes.
7. **Endpoints:** integrations/me; businesses/{id}/appointments/customers/staff/services
   con proyección/scope; reconcile/listados por alcance; credentials create/rotate/revoke,
   mappings GET/PUT/DELETE y external-links de sesión. changes queda reservado/no habilitado.
8. **UI:** API habilita S8-I; panel de credenciales, vinculación/import, estado de corridas.
9. **Reglas:** upsert por ID/versión, corridas completas, no borrar tras página parcial,
   origen/destino de reprogramación reconciliados, ID externo estable/único por tenant.
10. **Seguridad:** credencial validada dentro de BD en cada llamada; service_key nunca
    escribe ni importa/mapea/linkea; proyecciones sin notas internas; límites y audit real.
11. **Unit:** scopes, cursor de paginación (no de feed), hashes/proyecciones, mapeos,
    import dry-run y consumidor convergente.
12. **Integración:** credencial revocada inmediatamente, cross-tenant, todas las escrituras
    compartidas denegadas API/SQL, carreras de fusión/links y barridos con mutaciones/fallos.
13. **E2E:** S8-I con sesión real, alta/rotación/revocación y reconciliación de réplica
    de prueba corrupta/interrumpida; Modo A sólo con evidencia aprobada.
14. **Aceptación:** réplica converge tras corridas completas/reintentos dentro de alcance;
    no duplicados ni borrados por corrida incompleta; revocación efectiva en la siguiente llamada.
15. **DoD:** G, OpenAPI/compatibilidad, criterios P-04/P-05 demostrados; feed no entregado ni anunciado.
16. **Riesgos:** checksum id:version no detecta contenido alterado, pérdidas históricas,
    cursores de lista tratados como garantía incremental, filtros que revelan datos ajenos.
17. **Estimación:** 5–8 dp, alta; cualquier feed o Modo A adicional se reestima/se aprueba aparte.

## S11 — integración con Google Apps Script

1. **Objetivo funcional:** GAS consume agenda y datos de turnos sin reemplazar sus módulos comerciales.
2. **Alcance:** TurnosClient/TurnosSync de lectura, Turnos_RO por barridos, reconcile,
   asociación de clientes/barberos/servicios, registro precargado y prevención de duplicados;
   Modo A condicional, jamás implícito por almacenar tokens en UserProperties.
3. **Dependencias:** S10 y S8-I; inspección de clon GAS y autorización específica de ese sprint.
4. **Decisiones previas:** P-08, IDs estables Registro/Clientes, fuente por campo,
   alcance histórico KPI, permisos de hojas y confirmación del vínculo en modo lectura.
5. **Módulos:** cliente/lógica GAS en carpeta/repo aprobado; integrations de Turnos sólo
   por API, sin acceso directo a PostgreSQL desde Sheets.
6. **Tablas:** credenciales/mapeos ya aprobados; hojas Turnos_RO, Registro de Servicios,
   ID/ID Turno, errores/corridas. No duplicar tablas de caja en PostgreSQL.
7. **Endpoints:** sólo contratos S10; escrituras de negocio desde panel con sesión;
   user_token/If-Match sólo tras aprobar identidad individual real.
8. **UI:** agenda/pendientes de registrar en GAS, deep-links al panel, estado de última
   sincronización/errores y confirmación de vinculación autenticada.
9. **Reglas:** Sheets conserva caja, pagos/propinas/comisiones y su lógica comercial;
   snapshots Turnos no son precios efectivos de caja. Lookup ID Turno+LockService impide duplicar registro.
10. **Seguridad:** secretos no en HTML/hojas/logs; credencial compartida sólo lectura;
    dos cuentas prueban aislamiento real antes de A; no fingir actor con nombre/cabecera.
11. **Unit:** consumidor idempotente, transformaciones, matching y cliente GAS puro.
12. **Integración:** staging+hoja clon, API caída/429, lote cortado, ID duplicado, filas
    históricas, reconciliación/link fallido y revocación.
13. **E2E:** reserva→complete en panel→registro precargado→vínculo autenticado/conciliado;
    doble clic una fila; KPIs usan réplica con fecha de éxito y no pisan datos financieros.
14. **Aceptación:** app GAS conserva operación si API cae; cero escritura Turnos por
    service_key, duplicados controlados y límites de consistencia entre sistemas documentados.
15. **DoD:** G, pruebas sobre clon con autorización, rollout reversible de columnas y
    datos históricos; ninguna garantía de transacción distribuida.
16. **Riesgos:** código GAS externo desconocido, edición manual, identidad, cuotas y
    formato de IDs; no prometer esfuerzo sin inspeccionar el clon.
17. **Estimación:** 5–8 dp, alta/incertidumbre elevada; reestimar tras spike/inspección.

## S12 — seguridad, concurrencia, rendimiento y recuperación

1. **Objetivo funcional:** demostrar que el MVP se puede operar y recuperar con aislamiento.
2. **Alcance:** auditoría integral, carga, fallos, restauración, escaneo de dependencias/secretos,
   accesibilidad, recuperación MFA/soporte aprobados y runbooks; no dejar la seguridad para este sprint.
3. **Dependencias:** S7/S8/S9/S11 completas y ambiente de staging con datos sintéticos/anonimizados.
4. **Decisiones previas:** SLOs, threat model actual, RPO/RTO financiables, mantenimiento
   real y procedimiento de recuperación humana sin bypass público.
5. **Módulos:** todos, operaciones/CI y herramientas de auditoría.
6. **Tablas:** cobertura completa de tenant/RLS/ACL, identidad global y excepciones
   deny-all catalogadas; backup sin exponer PII.
7. **Endpoints:** revisar todos, health público mínimo y health DB restringido como
   pendiente operativo autorizado; no habilitar integraciones/escrituras nuevas por auditoría.
8. **UI:** errores/estados/permisos y flujos públicos accesibles, PWA sin cache sensible.
9. **Reglas:** invariantes de ocupación, versiones, replay, reconciliación y estado
   completo después de fallos; no medir sólo tasa de éxito HTTP.
10. **Seguridad:** X01–25 adaptados, OWASP ASVS, ZAP/gitleaks, dependencias, headers/CSP,
    pruebas de revocación, restauración y acceso de plataforma autorizado/auditado.
11. **Unit:** cobertura y casos faltantes críticos; thresholds medidos, no inferidos del número de tests.
12. **Integración:** carga real con conexiones distintas, deadlocks/reintentos medidos,
    restore a proyecto temporal, fallo de worker/proveedor, pérdida de corrida.
13. **E2E:** público/paneles/roles/GAS en staging, Chromium+WebKit/iOS según soporte,
    axe/Lighthouse; recuperación asistida simulada sin usar cuenta propietaria real.
14. **Aceptación:** cero hallazgos críticos/altos abiertos, cero solapes, restauración
    con RPO/RTO objetivo comprobado y límites/alertas definidos.
15. **DoD:** G y acta de revisión independiente con evidencias, matriz de riesgos residual y aceptación.
16. **Riesgos:** tests destructivos sobre dueño, falsas garantías de exactly-once o
    feed no implementado, depender de una cuenta privilegiada para afirmar aislamiento.
17. **Estimación:** 5–8 dp, alta; hallazgos graves pueden requerir replanificar, no se absorben ocultamente.

## S13 — despliegue y piloto

1. **Objetivo funcional:** operar Merivo en producción con soporte y decisión de lanzamiento informada.
2. **Alcance:** entornos separados, CI/CD aprobado, dominio/HTTPS/DNS email,
   configuración productiva, monitoreo, backup/restore y piloto de dos semanas.
3. **Dependencias:** S12 aceptado, revisión legal, presupuesto/cuentas/planes y autorización explícita de despliegue.
4. **Decisiones previas:** responsables, accesos, región/proveedores vigentes, RPO/RTO,
   horarios de soporte, datos iniciales y criterios de rollback/pausa.
5. **Módulos:** configuración por capacidad, operaciones y bootstrap controlado;
   no reutilizar secretos ni cuentas de pruebas locales.
6. **Tablas:** aplicar nuevas migraciones aprobadas a staging/prod; alta de negocio y
   catálogo real por flujo autorizado; no reset sobre bases con datos.
7. **Endpoints:** mismos contratos versionados y jobs protegidos; health/monitoreo mínimos.
8. **UI:** branding Merivo, portal público final, paneles y textos legales; capacitación móvil.
9. **Reglas:** SQL fuente de verdad, aplicación GAS independiente, registros manuales
   de contingencia y reconciliación de avisos tras restore.
10. **Seguridad:** credenciales distintas por ambiente, MFA/roles mínimos, secretos
    gestionados, ramas protegidas y mantenimiento que bloquee todos los escritores.
11. **Unit:** mismas suites de la versión candidata; sin saltar fallos para desplegar.
12. **Integración:** smoke jobs/correo/DB, migración compatible, restore/roll-forward y
    conexión GAS staging/productiva separada según autorización.
13. **E2E:** reserva real de prueba controlada, gestión/panel y avisos en producción
    con consentimiento y limpieza autorizada; aceptación operativa de Merivo.
14. **Aceptación:** piloto sin incidentes severos, cero dobles reservas, métricas de
    latencia/avisos/sync registradas. Metas a 60 días no se certifican en dos semanas.
15. **DoD:** G, runbooks/guardia, acta del piloto y autorización de lanzamiento;
    cuentas/costos/contratos verificados, sin cierre automático al hacer deploy.
16. **Riesgos:** DNS/proveedor, migraciones irreversibles, datos sensibles, incidentes
    durante piloto y dependencia de una sola persona.
17. **Estimación:** 3–5 dp de preparación/entrega, más observación del piloto y esperas externas.

## Qué entregará concretamente el MVP final

Cliente móvil elige servicio/profesional/fecha/slot y reserva sin cuenta; consulta,
cancela o reprograma con una capacidad segura. Staff/admin opera catálogo, horarios,
agenda, clientes y resultados dentro de su negocio y rol; errores concurrentes
se resuelven sin solapes ni pérdida de historia. Notificaciones se procesan con
outbox recuperable. GAS consulta agenda y conserva caja/KPIs propios usando una
réplica reconciliable de turnos; escrituras/links requieren identidad individual
real. Producción cuenta con aislamiento comprobado, monitoreo, recuperación y piloto.

No se agregan cobros, suscripciones, WhatsApp, Google Calendar, multi-sucursal,
multi-servicio por reserva, feed incremental garantizado ni microservicios para
completar esta entrega. El roadmap propuesto requiere aceptación antes de reemplazar
al histórico o de comenzar cualquiera de sus paquetes.
