# PB-02/03/04/05 — circuito público de prueba

Fecha: 2026-11-02. Autorización: aprobación explícita de PB-D02…D10 del usuario y
sus condiciones adicionales. Exclusivamente desarrollo y pruebas descartables.
**PB-02/03/04/05 implementados y validados para el entorno descartable autorizado.**
Variante de escritura productiva bloqueada; no habilitado en la instancia del propietario.

## Resultado y alcance

Reutiliza PB-01. Profesional explícito, disponibilidad pública de hasta siete días,
alta de una ficha nueva por intención confirmada y reserva confirmed sólo si
auto_confirm=true. Sin Auth del cliente ni asociación por teléfono/email/Instagram.
Se respetan require_email y la versión de aviso de privacidad configurada. Nada de
marketing, fusión, importación, usuarios ficticios o cuenta Supabase para el cliente.

Una cookie HttpOnly autoriza el intento y replay de creación. La respuesta entrega
un enlace de gestión con fragmento; la página lo canjea por cookie HttpOnly acotada
al turno y limpia el fragmento antes del fetch. Permite detalle comercial mínimo,
cancelar y reprogramar con If-Match y políticas existentes, sin cambiar cliente,
profesional, servicio, precio, duración o buffer originales. La misma página procesa
un enlace reabierto por hashchange, incluido el caso inicial sin cookie válida.

Aviso visible de entorno descartable y datos ficticios, sin promesa de mensajes.
La falta de cookie/enlace y navegador no se recupera con UUID, key o contacto. No
se habilitan reservas reales, portal productivo, emails, worker, terminales o any-staff.

## Archivos y migración

Nueva supabase/migrations/20261102000400_public_booking.sql. No aplicada al propietario
y no modifica las dieciséis fuentes históricas, incluida PB-01. Cambios compatibles:

- Ocho tablas privadas app.public_booking_runtime, public_attempts, public_quotes,
  public_manage_tokens, public_booking_requests, public_rate_buckets,
  public_challenges y public_privacy_ack; RLS ENABLE/FORCE y sin SELECT/DML de
  anon/authenticated/app_server/service_role.
- appointments conserva created_by para origen usuario; nuevo creator_type y
  creator_attempt_id. Se permite NULL sólo con origen público y capacidad presente,
  mediante CHECK exclusivo y FK compuesta. Una intención sólo puede crear un turno.
- appointment_events distingue user (usuario+miembro) de public (intento), con
  CHECK exclusivo y FK tenant. audit_logs admite public sin actor_user_id y exige
  actor_attempt_id; los demás actores conservan su representación anterior.
- customers.source admite public_booking además de admin_api; validación y
  preservación de source en updates se mantienen. Sin unicidad por contacto.
- Helper invoker privado app.apply_appointment_change centraliza el bloque de
  escritura/ocupación/evento/outbox/audit; api.manage_appointment conserva guards,
  firma, preautorización, MFA, revalidación, versiones y ledger S2/IN propios.
- Helper invoker privado app.schedule_snapshot comparte la resolución de HS;
  api.schedule_preview_source conserva autorización y contrato. La función pública
  filtra slots libres dentro de SQL, sin retornar snapshot privado al navegador.
- app.guard_appointment protege también las columnas nuevas de origen, evitando
  cambiar un creador público por un usuario u otra capacidad.

Nuevos módulos src/modules/public-booking/{crypto,config,challenge,schemas,
repository,http,client}.ts; componentes src/components/public-booking/{reserve,
manage}.tsx; página src/app/b/[slug]/r/[id]/page.tsx; seis rutas bajo
src/app/api/v1/public/[slug]: attempts, availability, challenge, appointments,
manage/[id] y manage/[id]/[action]. La página /b/[slug] monta el formulario sólo
cuando configuración y marcador de BD están habilitados para fixture.

Compatibilidad TS: appointmentDetail admite actor_user_id nullable y actor_type;
customerDetail admite source público. No se amplían inputs administrativos ni sus
permisos, ni se muestran notas privadas por ello. Sin dependencias o stack nuevos.

Pruebas: supabase/tests/public_booking.test.sql; tres suites unitarias
public-booking-{crypto,security,http}.test.ts (tres archivos); scripts/lib/
public-booking-{fixture,concurrency,browser,http}.mjs. Harness y am0405 browser/
integration adaptados a fixtures/custodia. Inventario tenancy actualizado. AGENTS,
CHANGELOG y este informe registran autorización; documento nuevo de custodia
PUBLIC_BOOKING_KEY_CUSTODY.md. Sin cambios al logo, package-lock o GAS.

## Funciones y permisos

Nuevos definers propiedad postgres, search_path vacío y EXECUTE sólo app_server:

| app_internal         | Propósito                                                                                         |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| public_runtime_ready | Comprobar el marcador privado inicialmente false.                                                 |
| public_quota         | Cuota persistente compartida y consumo único de nonce del desafío.                                |
| public_issue_attempt | Registrar hash de una capacidad de intento nueva, 48 h.                                           |
| public_availability  | Resolver tenant, elegibilidad y snapshot; emitir quote opaca y sólo horarios libres.              |
| public_create        | Reautorizar intento, crear cliente independiente y turno en una transacción, emitir sobre/ledger. |
| public_read          | Capacidad vigente de una reserva, detalle mínimo sin datos de otras fichas.                       |
| public_change        | Cancelar/reprogramar con capacidad, versión, estado, cutoffs y límite de cambios.                 |

Inventario acumulado: 41 definers. PUBLIC/anon/authenticated/service_role sin EXECUTE
de estas operaciones internas. No schemas internos expuestos en PostgREST ni grants
de tablas nuevos para app_server. Los helpers, guardas, mantenimiento y rotación no
tienen EXECUTE de aplicación. Un argumento de actor no autoriza por sí solo: helpers
privados inaccesibles, wrapper administrativo verifica auth.uid()/membresía; wrapper
público verifica capacidad en SQL. No setter de identidad ni service_role de negocio.

## Disponibilidad, coordinación y atomicidad

Preflight no bloqueante de negocio/capacidad → raíz businesses FOR UPDATE → negocio,
marcador y capacidad revalidados → replay → staff/cliente/turno → mutaciones.
READ COMMITTED obligatorio. La capacidad vencida/revocada durante la espera se
rechaza antes de versiones o efectos. No SHARE/upgrades ni llamadas externas bajo
locks. HMAC y cifrado se preparan antes de la transacción principal; cuotas tienen
su propia transacción y no retienen locks durante la reserva.

Selección pública no autoriza escribir por sí sola. Quote UUID privada de 10 minutos
vincula negocio/staff/service/rango y versiones internas. No expone esas versiones;
el core las compara después de la raíz y revalida horario, grilla/DST, descansos,
cierre global, vigencia, bloques, anticipación, horizonte y elegibilidad. Cambios de
precio/catálogo/configuración producen revisión/412; lugar tomado→409 SLOT_TAKEN.

Fuente pública sólo devuelve quote_id, timezone, price_cents, duration_minutes y
slots date/start/end/label. Sin ocupación ajena, motivos, clientes o versiones de
control. Autogestión usa snapshots originales y excluye su propia ocupación.

Se reutiliza la exclusión histórica IN y su coherencia diferida. Servicio y buffer
ocupan; mover libera generación anterior y crea otra atómicamente. Crear/mover/
cancelar, cliente nuevo, evento, audit, outbox, token/envelope, evidencia de aviso y
ledger hacen rollback juntos si falla cualquier escritura. Cuotas/nonces de intento
son telemetría antiabuso independiente y deliberadamente no hacen rollback con un
fallo de negocio. No se modifican las invitaciones o auditoría por una purga TTL.

## HTTP, autoridad y replay

Base /api/v1/public/{slug}. Sin JWT de cliente; Host fijado al origen configurado,
Origin obligatorio en POST, cabecera X-Merivo-Public, rechazo de cross-site y cookie
HttpOnly/SameSite=Lax con paths acotados. Secure si el origen es HTTPS; el harness
usa HTTP sólo loopback, aunque compile Next en producción. Fuera de ese entorno no
se emite ninguna cookie o escritura pública. No confiar en X-Forwarded-For/Host.

| Método/ruta                          | Contrato                                                                                                                      |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| POST attempts                        | UUID v4 nuevo; cookie aleatoria de 32 bytes, TTL 48 h y versión de aviso/require_email.                                       |
| GET availability                     | staff_id/service_id UUID explícitos, from local, days 1–7.                                                                    |
| POST challenge                       | Sólo issuer sintético de fixture: purpose/resource, nonce/vigencia, firma HMAC; indica human_verification=false.              |
| POST appointments                    | UUID estable, attempt_id, quote_id, datos mínimos/aviso y fecha ISO con offset; key y desafío. 201/ETag/enlace con fragmento. |
| POST manage/{id}/exchange            | Token en body para canje a cookie; sin token en querystring o almacenamiento JS.                                              |
| GET manage/{id}                      | Detalle saneado y ETag; token/cookie actual obligatorios.                                                                     |
| GET manage/{id}/availability         | Rango, mismo recurso y duración/precio originales.                                                                            |
| POST manage/{id}/cancel o reschedule | Key, desafío e If-Match; límite de cambios, cutoffs y estado comprobados en SQL.                                              |

Errores 400 de forma; 403 de origen/desafío; 404 uniforme de capacidad inválida,
ausente, de otro intento/tenant, expirada o revocada; 428 falta de versión tras
autorización; 412 obsoleta/quote vencida; 409 de dominio/política; 429 cuota; 503
dependencia/custodia/interno seguro. Sin detalles PostgreSQL. Todos no-store,
Referrer-Policy no-referrer y request_id UUID por intento. Idempotency-Key es otro
identificador, no una prueba de autoridad. Correlación SQL local a la transacción
del pool, sin estado global de solicitud.

Ledger 48 h por negocio/autoridad/operación/key, hash canónico calculado en SQL y
resultado de metadatos. Replay reautoriza antes de versiones actuales; no repite
cliente, ocupación, evento, audit o outbox. El plazo efectivo está sujeto a la
capacidad vigente: una cookie emitida antes puede vencer antes que el ledger.
Generación revocada no vuelve a entregarse. UUID estable y versión siguen evitando
repetición tras TTL; una capacidad de creación no admite otro turno con distinta key.

La UI conserva cuerpo/key/UUID al no recibir una respuesta concluyente. Un error de
validación de respuesta tras ejecutar SQL es 503, no 400 que invite a crear otra
intención. Confirmación conocida deshabilita el envío anterior. Reabrir enlace
válido funciona incluso desde la misma página que mostró falta de cookie.

## Tokens y custodia

Manage token aleatorio de 32 bytes, hash privado único entre reservas/generaciones,
scope reserva/tenant, expiración inicio+24 h, revocación explícita. No sustituye
cutoffs ni estado. Cancelado permite sólo lectura hasta TTL. Movimiento administrativo
no revive/prorroga token vencido. Movimiento público autorizado cambia AAD/vigencia,
con condición adicional de que el token no haya vencido al actualizarlo.

AES-256-GCM, nonce nuevo, key_id y AAD de tenant/reserva/generación/expiración. Claves
fuera de PostgreSQL y Git; nada de secreto plano en ledger, eventos, audit, outbox,
logs o URLs de consulta. El enlace con fragmento se entrega sólo a la autoridad que
creó el turno. Cifrado/decrypt fuera de locks. Si falta una clave, se falla cerrado;
conservar el keyring anterior o restaurarlo desde backup cifrado permite replay sin
recrear el negocio. No se intenta otra clave ni se entrega un bearer nuevo como atajo.

Pruebas de custodia/rotación/recuperación y protocolo operativo en
[PUBLIC_BOOKING_KEY_CUSTODY.md](PUBLIC_BOOKING_KEY_CUSTODY.md). La prueba usa backup
cifrado con clave de recuperación separada en memoria; producción no tiene todavía
secret store, custodios o recuperación operativa provisionados. Rotación de token
es mantenimiento privado sin endpoint de aplicación; no recuperación por contacto.

## Antiabuso y mantenimiento

Dos gates: PUBLIC_BOOKING_ENVIRONMENT=discardable con origen loopback y configuración
privada completa, y app.public_booking_runtime.disposable=true. La migración deja
false; no existe setter con permisos de aplicación. El harness habilita sólo su BD
UUID. Un flag frontend, Origin o X-Forwarded-For no cambia esos gates.

Cuotas compartidas y persistentes por negocio/ingreso loopback del fixture: 100
solicitudes/min, 10 emisiones de intento/min y 20 escrituras/min. Incluyen solicitudes
malformadas tras el gate comercial. Nonce de desafío de un solo uso, propósito,
recurso y vencimiento firmados HMAC y verificados server-side antes de SQL. No se
usa un contador global de JS ni se atribuye identidad a cabeceras del cliente.

Esto prueba el adaptador sintético, no una prueba humana: el issuer de desafío es
abierto sólo en fixture y declara human_verification=false. Producción no tiene
adaptador real de desafío o ingreso/proxy confiable; esas funcionalidades se dejan
bloqueadas, no se simula que están listas. Cuotas no prueban identidad por persona
y pueden compartir presupuesto entre navegadores. max_active_bookings_per_customer
no se presenta como límite verificable por persona ni se fuerza uniendo contactos.

app.purge_public_booking, invoker privado sin grants de aplicación, limpia en lotes
de hasta 500 por colección ledger vencido, quotes vencidas, nonces vencidos y buckets
de más de dos minutos; SKIP LOCKED, sin raíz posterior ni scheduler. No borra turnos,
clientes, generaciones/token hashes, evidencia de aviso, historial, audit o invitaciones.
Retención/supresión de esos datos y ciphertext/backups sigue requiriendo decisión legal.

## Validaciones y vulnerabilidades

Ejecución final: node scripts/test-s2-security-isolated.mjs --ui, **sin**
--public-focus, exit 0. El modo focalizado se utilizó sólo para depurar fallos y no
se presenta como regresión completa.

| Check                                                   | Resultado real                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pgTAP descartable                                       | PASS: 554 aserciones, incluidas 49 nuevas de reservas públicas; suites de fixtures con rollback.                                                                                                                                                                                                                                                                                 |
| Conexiones PostgreSQL independientes                    | PASS: 57 escenarios totales, nueve nuevos públicos. Dos clientes mismo horario, admin compitiendo, replay simultáneo, capacidad expirada/revocada tras espera, cambio HS, cancelar vs mover, rollback previo al commit y purga fallida.                                                                                                                                          |
| HTTP público con SQL real                               | PASS: 23 escenarios; autoridad/replay, If-Match, pérdida/expiración/revocación de cookie/token, key_id/AAD alterados, recuperación con clave retenida, rotación, auto_confirm y nueve fallos inyectados.                                                                                                                                                                         |
| E2E público                                             | PASS: profesional/servicio/hora/datos ficticios→crear→enlace→mover→cancelar. Respuesta perdida antes y después de commit, mismo UUID/key/cookie y un solo efecto. Cookie HttpOnly, URL sin fragmento tras canje, cookie ausente denegada, enlace original reabierto en la misma página, cuota compartida entre navegadores pese a X-Forwarded-For arbitrario y origen rechazado. |
| Regresión acumulada S1/S2/catálogo/clientes/HS/IN/PB-01 | PASS: SQL/HTTP y navegador, login/password/MFA real de fixtures, roles/invitaciones, selector, LAST_OWNER, privacidad, tenants, cursores, request_id, replays y purgas.                                                                                                                                                                                                          |
| npm run test                                            | PASS: 226 tests / 23 archivos; diecinueve casos nuevos públicos, incluidos ocho criptográficos, tres de desafío/configuración y ocho de frontera HTTP.                                                                                                                                                                                                                           |
| Custodia y criptografía                                 | PASS: nonce nuevo; AAD de los cuatro atributos; nonce/tag/ciphertext incorrectos; key_id desconocido; keyring v2 con v1 retenida; rechazo al retirar v1; backup cifrado y recuperación con clave independiente; rechazo de clave/tag de recuperación incorrectos.                                                                                                                |
| npm run lint / typecheck / build                        | PASS. Next también compila y corre en copia temporal aislada dentro del harness.                                                                                                                                                                                                                                                                                                 |
| npm run format:check                                    | FAIL conocido: sólo quince Markdown históricos de arquitectura-v1.1, sin modificar. Archivos de esta entrega pasan Prettier.                                                                                                                                                                                                                                                     |
| git diff --check                                        | PASS.                                                                                                                                                                                                                                                                                                                                                                            |

Los nueve puntos de fallo HTTP fueron customer, appointment, occupancy, event,
audit, outbox, ledger, token/envelope y evidencia de aviso. Se compararon los nueve
agregados de negocio antes/después: ninguna escritura parcial. Las cuotas quedaron
fuera de esa comparación deliberadamente; su prueba de persistencia compartida no
resetea contadores. Los resets de contadores del bloque de inyección son sólo
mantenimiento del fixture para ejecutar todas las fallas, no un permiso de la app.

Las pruebas SQL también verifican cutoffs, max_client_reschedules, quotes sin
versiones internas, actor público real, teléfono compartido sin vínculo automático,
no revivir token vencido al mover administrativamente, límites y preservación al
purgar. Un fixture adicional intentó consultar settings como authenticated y fue
rechazado correctamente por A-08; se corrigió el fixture para capturar sólo su
versión bajo mantenimiento antes de cambiar rol, sin ampliar SELECT.

Los contenedores, volúmenes y redes del run final fueron retirados. El inventario
por etiqueta merivo.test.run quedó vacío, incluida la ejecución interrumpida que se
limpió separadamente con verificación estricta. Capturas de gestión desktop/móvil
inspeccionadas visualmente, sólo datos sintéticos y sin bearer visible, en
test-results ignorado por Git. No se ejecutó test:e2e con configuración local del
propietario ni SQL de escritura sobre su instancia.

Comparación SHA-256 con la captura previa: 260 archivos anteriores, 251 intactos,
nueve cambios acotados y 27 archivos nuevos; ninguno eliminado. Las dieciséis
migraciones previas, propuesta aprobada, dependencias/lockfile, assets de marca y
configuración permanecen intactos. No se añadieron secretos a archivos versionables.
SHA-256 de la migración 17:
`35cbffffd009d5df0eb1d131dab2c7710c42d95c3ae47fc545c21ad8498aea16`.

Hallazgos resueltos durante la implementación:

- JSONB del driver debía enlazarse como JSON, no texto serializado dos veces; el
  rechazo previo no había creado filas. Se corrigió con parámetros JSON del driver
  y se comprobó contra PostgreSQL real, no sólo mocks.
- Next puede construir un URL interno distinto del Host recibido; se fija Host al
  origen configurado, con Origin/custom-header y sin confiar en forwarded headers.
- Respuesta inconsistente después del commit debe ser 503 reintentable, evitando
  que una validación 400 libere el borrador para generar otra reserva accidental.
- Una key nueva no autoriza otra creación con la misma capacidad; índice y guard
  de una intención/un turno. Índice de token hash evita reutilizar bearer entre recursos.
- Cambiar sólo el fragmento de la página debe disparar canje de nuevo, sin dejar
  que una respuesta vieja de falta de acceso sobrescriba otra válida. Se usa una
  generación local de lectura y limpieza de URL, sin guardar el token en JS persistente.
- Riesgo de parámetros de fixtures en logs de PostgreSQL: el harness usa únicamente
  su administrador descartable para desactivar sentencias/valores sensibles y verifica
  los GUC antes de probar capacidades. No cambia logs del propietario.
- Un callback de interceptación del test no debe lanzar fuera del runner y saltarse
  cleanup. Se captura su resultado y se afirma dentro del flujo principal. Los tres
  contenedores/red de esa ejecución interrumpida se retiraron verificando etiqueta
  y prefijo UUID, sin tocar recursos del propietario.

## Límites y estado operativo

- Ninguna migración aplicada al propietario; PB-01 (16) y PB-02…05 (17) siguen fuera
  de sus quince versiones activadas. No se consultaron datos reales como fixtures,
  alteraron cuentas/MFA, contraseñas, sesiones o invitaciones del propietario.
- Sin email/notificaciones, terminales, any-staff, GAS, despliegue, commits o push.
  No se declara terminado el MVP ni listo para captar datos reales.
- Antes de cualquier habilitación real: aviso/retención/derechos revisados, proveedor
  de desafío real, ingreso confiable, TLS/cookies, logs, custodia/restore operacional,
  operación de purgas, staging y autorización de activación del lote concreto.
- No hay recuperación autónoma si se pierden enlace, cookie y navegador. El backend
  comprometido o la pérdida total de claves no se resuelven por conocer un contacto.
- Sin benchmark/p95 ni certificación de seguridad de hosting. Se conserva raíz
  exclusiva por negocio; no se optimiza con locks compartidos en este bloque.
- No se avanza automáticamente a notificaciones, integración o siguiente paquete.

Estado final por unidad: **PB-02, PB-03 y PB-04 validados en descartable**. **PB-05
valida cuotas persistentes, desafío sintético y fail-closed del circuito descartable;
el desafío humano y adaptador de red productivos permanecen bloqueados y sin implementar.**
La custodia criptográfica está probada; la custodia/recuperación operativa de una
infraestructura real no está provisionada. Ninguno de esos pendientes se declara
resuelto por los fixtures. No se habilitan reservas reales ni se cierra el MVP.
