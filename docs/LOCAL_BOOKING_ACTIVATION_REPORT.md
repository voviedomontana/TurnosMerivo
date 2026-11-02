# Activación local de clientes, horarios y turnos internos

Fecha: 2026-11-02, America/Buenos_Aires. Estado: **activado localmente**.

## Autorización y alcance

El usuario indicó «avanza con el siguiente paso» inmediatamente después de la
propuesta de respaldar la base, activar los módulos pendientes y comprobar el
arranque, preservando datos, cuentas y MFA. Esta autorización posterior reemplaza
la restricción de activación local sólo para las tres migraciones ya implementadas
y validadas. No autoriza otro bloque, portal público, hosting o escrituras de prueba
sobre datos del propietario.

Destino comprobado: proyecto turnosmerivo de supabase/config.toml, contenedor
supabase_db_turnosmerivo, PostgreSQL 17, base postgres, puerto local 54322. Sin
--linked, conexión remota, reset, seeds, importaciones ni cambios de credenciales.

## Respaldo y preservación

Respaldo completo custom, antes de cualquier cambio de esquema:

supabase/backups/booking-activation-2026-11-02T16-17-51-855Z/before-booking.dump

345172 bytes. SHA-256:
45091e22b9ea8141a45fb1403cc34ccf4bad1fa53c94edfba7fd949a5800e060.

Se verificaron cabecera PGDMP, inventario con Auth/MFA/membresías/historial y
descompresión completa mediante pg_restore hacia /dev/null. No se realizó un
simulacro de restauración. El respaldo contiene datos sensibles: está ignorado
por Git, debe permanecer privado y no debe compartirse ni adjuntarse a un chat.
La copia temporal del contenedor se retiró después de verificar el respaldo local.

manifest.json en el mismo directorio guarda hashes, versiones y huellas, sin filas
de personas. Se calcularon dentro de PostgreSQL conteo y huella de cada tabla
existente de auth/public/app/app_internal, sin imprimir filas, contactos o secretos.
Se compararon antes del respaldo, antes de migrar y después de migrar: **39 tablas
existentes idénticas**, incluidas sesiones, tokens, factores/challenges MFA, usuarios,
membresías, invitaciones, auditoría, idempotencia y catálogo. Ningún fixture cargado.
Las **13 tablas nuevas están vacías**. Se conservó el profesional y servicio existentes.

## Migraciones aplicadas

Se usó la CLI fijada del repositorio: supabase migration up --local. Orden exacto:

1. 20261101001000_create_customer_directory.sql: clientes administrativos.
2. 20261102000100_create_scheduling.sql: jornadas, excepciones y bloqueos.
3. 20261102000200_internal_appointments.sql: agenda y turnos internos.

Historial inicial: doce versiones, hasta 20261101000900. Historial final: quince,
hasta 20261102000200. Se comprobaron SHA-256 de las quince fuentes contra las
versiones validadas; no se modificó ninguna migración. PostgREST recibió NOTIFY
para recargar su esquema. No se ejecutó ninguna purga ni se instaló scheduler.

## Verificaciones

| Comprobación                                               | Resultado                                                                              |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Respaldo completo e integridad de archivo                  | PASS; sin simulacro de restore.                                                        |
| Historial exacto 12 → 15 y fuentes SQL                     | PASS.                                                                                  |
| Preservación de filas                                      | PASS, 39 tablas anteriores sin cambios.                                                |
| Tablas nuevas                                              | PASS, 13 vacías con RLS ENABLE/FORCE.                                                  |
| Grants directos anon/authenticated/app_server/service_role | PASS, ninguno en las tablas nuevas.                                                    |
| RPC nuevas de clientes/HS/turnos                           | PASS, 12 definers con EXECUTE authenticated; anon/app_server/service_role sin EXECUTE. |
| EXCLUDE appointment_occupancy_no_overlap                   | PASS, instalado.                                                                       |
| npm run lint / typecheck / build                           | PASS tras activación.                                                                  |
| npm run test                                               | PASS, 198 tests / 19 archivos.                                                         |
| npm run format:check                                       | FAIL conocido: 15 Markdown históricos de arquitectura-v1.1 intactos.                   |
| git diff --check                                           | PASS.                                                                                  |

Smoke HTTP local de sólo lectura: landing 200; /app y pantallas clientes/horarios/
agenda sin sesión redirigen 307; endpoints customers/calendar-control/appointments
sin sesión devuelven 401. Se inició Next dev en segundo plano, sólo en
127.0.0.1:3000; logs locales en test-results ignorado. No se inició sesión como
propietario ni se modificó su MFA para comprobar estas rutas.

Archivos de esta activación: nuevos scripts/activate-local-booking.mjs y este
informe; AGENTS.md y docs/CHANGELOG.md actualizados para registrar la autorización
y resultado. Sin cambios al código funcional, configuración o dependencias.

No se repiten SQL de escritura ni E2E autenticados sobre la cuenta local. La
validación funcional previa se ejecutó sólo en descartable: 486 aserciones pgTAP,
48 escenarios de concurrencia y recorrido HTTP/Playwright completo; ver
[INTERNAL_BOOKING_IMPLEMENTATION_REPORT.md](INTERNAL_BOOKING_IMPLEMENTATION_REPORT.md).
Esos resultados no se presentan como nuevas pruebas de escritura en esta base.

El script operativo nuevo scripts/activate-local-booking.mjs restringe proyecto,
puerto, contenedor, versiones y hashes. Exige --apply-local y exactamente el historial
inicial de doce versiones; después de esta activación se detiene si se intenta
ejecutar nuevamente. No es un comando de migraciones futuras ni una herramienta de
restauración. En caso de error registra etapa y se detiene sin reset/restore
automáticos. Se ajustó la tabla temporal de huellas antes de aplicar: su creación
debe ocurrir antes de la transacción READ ONLY; los intentos previos no migraron.

## Circuito manual para probar ahora

1. Abrir http://127.0.0.1:3000/app e ingresar con la cuenta y autenticador habituales.
2. Entrar al negocio. Revisar en Profesionales y Servicios la asociación y estado
   del catálogo existente; no se alteró su configuración.
3. En Horarios elegir el profesional, definir la semana de atención y una vigencia
   aplicable a la fecha que se quiere probar; contemplar descansos y cierres.
4. En Clientes crear una ficha de prueba identificable, elegida por vos. El sistema
   admite contactos compartidos; no se necesita una cuenta Auth para el cliente.
5. En Agenda buscar y elegir esa ficha, profesional, servicio y una fecha futura.
   Consultar horarios, revisar precio/duración y confirmar.
6. Revisar el turno, consultar otro horario y reprogramar. Cancelar mientras todavía
   sea futuro y comprobar que el horario vuelve a estar disponible.

No se cargaron horarios supuestos ni clientes automáticamente. Si no aparecen
horarios, revisar jornada/vigencia, asociación activa de servicio, bloqueos,
anticipación y horizonte. Para 409 consultar de nuevo; para 412 revisar versiones
y actualizar los datos antes de volver a confirmar. MFA continúa obligatorio.

## Límites y recuperación

Sólo operación local administrativa. Sin reserva pública, notificaciones,
completed/no_show, estadísticas de visitas, marketing, GAS, commit/push o despliegue.
Aviso de privacidad, retención y derechos del titular continúan pendientes antes
de una prueba con datos reales de clientes o producción.

Ante un problema, detener escrituras y revisar historial/manifest/causa. No ejecutar
reset ni restaurar el respaldo automáticamente sobre esta instancia. Probar primero
cualquier restauración en un entorno separado y autorizar esa intervención de forma
independiente. Conservar el respaldo privado hasta cerrar la validación manual.
