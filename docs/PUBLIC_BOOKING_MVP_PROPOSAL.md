# Portal público — continuidad del MVP

Fecha: 2026-11-02. Base real: quince migraciones; clientes, HS y agenda interna
activados localmente. Pedido actual: «avanza con el resto». Se continúa el MVP por
bloques; no se interpreta como autorización de despliegue, GAS o cambios de cuentas.

## Alcance inmediato y decisiones

PB-01 es la lectura pública del catálogo y su pantalla /b/{slug}, derivada del
contrato público existente. Se implementa como primer tramo independiente: sólo
negocios activos/no archivados y public_booking_enabled; sólo profesionales activos,
no archivados, accepts_online y sus servicios activos asociados. Proyección explícita
de información comercial, precios/duración efectivos por profesional. Sin notas,
miembros/usuarios, contactos de clientes, facturación, versiones privadas, turnos o
intervalos ocupados. No se habilita un botón que simule una reserva confirmada.

Una RPC app_internal nueva, de sólo lectura, con EXECUTE únicamente app_server,
resuelve tenant por slug validado dentro de PostgreSQL. No se amplían grants a tablas,
anon/authenticated/service_role, ni se altera get_public_business. Nueva migración
16 probada sólo en descartable; no activación local automática. UI/logo/tokens Merivo.

PB-02 es disponibilidad pública; PB-03 creación y replay seguro; PB-04 autogestión;
PB-05 defensas de abuso. Los siguientes contratos están propuestos, no aprobados por
el pedido genérico: las decisiones de capacidad anónima/P-06 requieren cierre expreso.

| ID     | Contrato propuesto                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PB-D01 | PB-01 lectura del catálogo comercial con el alcance anterior. No implica poder reservar, ni publicar el negocio en Internet.                                                                                                                                                                                                                                                                                                                                                                                                          |
| PB-D02 | Primera reserva pública con profesional explícito. Sin cuenta Auth del cliente. staff=any permanece en backlog del MVP, no se elimina: se difiere su selección atómica hasta probar el primer circuito público y su criterio de asignación.                                                                                                                                                                                                                                                                                           |
| PB-D03 | Crear una ficha nueva por cada nueva intención pública confirmada, source=public_booking; no buscar, devolver ni enlazar automáticamente por teléfono/email/Instagram. Se admite contacto compartido. Un replay conserva la ficha original. Duplicados quedan para revisión administrativa sin fusión automática.                                                                                                                                                                                                                     |
| PB-D04 | Crear confirmed directamente sólo si auto_confirm=true; con auto_confirm=false deshabilitar creación hasta implementar pending, sin ignorar la configuración. Misma geometría/EXCLUDE, snapshots, raíz exclusiva, revalidación, evento/auditoría/outbox atómicos que IN. Actor público explícito, nunca impersonar owner ni crear usuarios Auth. No agregar pending, completed/no_show ni cambiar sus reglas.                                                                                                                         |
| PB-D05 | Servicio, profesional, pertenencia y accepts_online se revalidan en BD bajo raíz, junto con jornada, grilla, notice, horizonte, bloqueos y ocupación. Máximo siete días por consulta. La salida pública sólo ofrece horarios libres; no revela rangos ocupados, clientes ni motivos de cierres.                                                                                                                                                                                                                                       |
| PB-D06 | Capacidad de intento aleatoria de 32 bytes en cookie HttpOnly/SameSite=Lax, Secure en producción, limitada a negocio e intención durante 48 h; hash privado en BD. UUID/key no autorizan replay. CSRF/origen y autoridad actual en cada intento. Sin cookie no se recupera una respuesta secreta sólo con teléfono/key.                                                                                                                                                                                                               |
| PB-D07 | manage_token aleatorio 32 bytes, scope una reserva/tenant/generación, hash SHA-256 privado. Permite detalle saneado, cancelar y reprogramar según política; nunca directorio/notas/admin. TTL inicio vigente +24 h; revocado/vencido no revive por mover administrativamente el turno. Tras cancelación sólo lectura hasta TTL. Rotación explícita para recuperación futura.                                                                                                                                                          |
| PB-D08 | Replay de creación 48 h, autorizado por capacidad original; secreto recuperable sólo en sobre AES-256-GCM con nonce nuevo, key_id y AAD que incluya tenant/reserva/generación/expiración. Claves privadas fuera de Git/BD; ningún secreto plano en tablas, replay, audit, outbox o logs. Intento nuevo de token/envelope se genera antes de adquirir locks; replay usa la generación original vigente y nunca reemite una revocada.                                                                                                   |
| PB-D09 | Cancelar/reprogramar públicos respetan cancellation_cutoff_hours, reschedule_cutoff_hours y max_client_reschedules actuales; nunca turno iniciado/cancelado ni cambio de staff/servicio/cliente/snapshots en este primer tramo. If-Match obligatorio en esta nueva UI para evitar cambios inadvertidos en varias pestañas; no altera endpoints internos. Autorización antes de comparar versiones.                                                                                                                                    |
| PB-D10 | Desarrollo y pruebas públicas sólo en descartable, con aviso visible de prueba. Sin proveedor de correo ni envíos reales todavía. Antiabuso de escritura obligatorio antes de habilitación pública: cuota compartida comprobada, identidad de red fiable del entorno, validación server-side de desafío y fail-closed fuera del modo de pruebas aislado. Nada de confiar en X-Forwarded-For arbitrario ni contador global en memoria. No considerar terminado S7 ni listo para hosting sin esos gates y aviso de privacidad revisado. |

## Contratos de seguridad que deben cerrarse al implementar PB-02…05

- Nuevas migraciones, sin editar las quince anteriores; sin ampliar rol app_server
  a tablas, pertenencias o comandos administrativos. Sus RPC públicas verifican
  slug/capacidad/política en BD; no setter de actor ni bypass de owner/admin.
- El core actual exige created_by de usuario y eventos con actor miembro; el nuevo
  actor público requiere una evolución explícita y guardas de actor exclusivo. No
  resolverlo con un usuario ficticio ni quitando NOT NULL indiscriminadamente.
- Extraer sólo el núcleo necesario a helpers privados sin EXECUTE de aplicación;
  conservar los guards actuales de manage_appointment y toda regresión IN/S2. No
  copiar la función interna como RPC pública ni usar service_role para negocio.
- Hashes de intención calculados en BD; no aceptar un hash del body como autoridad.
  Secretos sólo transitorios en canales internos revisados y parámetros, nunca URLs
  querystring, errores o analítica. Registrar request_id sin mezclarlo con key.
- Token entregado por fragmento del enlace, canje a capacidad de gestión HttpOnly y
  limpieza inmediata de URL; no localStorage. Referrer-Policy no-referrer y no-store.
  Doble pestaña, cookie perdida, respuesta perdida y rotación requieren pruebas.
- Generar cifrado/validarlo fuera de locks; persistir sobre y hash junto con todos
  los efectos en una transacción. Ningún proveedor/HTTP/Auth Admin bajo locks.
- Ledger nuevo por tenant/capacidad/operación/key; TTL distinto de token. Purga
  privada ≤500 con SKIP LOCKED sin raíz posterior, sin scheduler todavía. No borrar
  evidencia de reservas/auditoría/invitaciones por TTL de replay.
- Aviso de privacidad versionado y tratamiento de datos para reserva separados de
  marketing. Este documento no constituye revisión legal ni autoriza captar datos
  reales públicamente. Proveedores, política de retención y recuperación verificada
  por email se diseñan antes de su activación, no se simulan.

## Migraciones y compatibilidad

PB-01: nueva función de catálogo explícito; ningún cambio en tablas o RPC anteriores.
PB-02: fuente pública de disponibilidad y contrato de versiones observable o ticket
opaco de selección, separado de versiones privadas del negocio. Nunca convertir la
RPC schedule_preview_source autenticada en pública.
PB-03/04: actor público, source de customer, capacidades, sobre cifrado y ledger;
core de transacción revisado, guardas y permisos específicos. Lote bloqueado por
PB-D02…D10. PB-05: infraestructura de cuota/desafío y entorno confiable de red;
sin dependencia nueva o proveedor contratado implícitamente.

No aplicar estos lotes a la instancia del propietario por el pedido de desarrollo.
Cada activación local posterior necesita una autorización referida a su lote concreto.

## Criterios de aceptación y pruebas

PB-01: pgTAP de proyección, tenants, modo deshabilitado, suspended/deleted, servicios
no asociados/archivados, accepts_online=false, overrides, roles/grants/definer; HTTP
200/404/503 seguros; UI anónima desktop/móvil sin datos privados ni falsa confirmación.
No requerir Auth ni cookies para consultar. Conservación de S1 público y API interna.

PB-02…05: SQL/HTTP de autoridad antes de precondiciones, secreto ausente/incorrecto/
revocado/vencido, replay idéntico/intención distinta/actor ajeno, expiración tras locks,
respuesta perdida antes/después de commit, cifrado/AAD/nonce alterados y key_id
desconocido, doble pestaña/rotación/cookie perdida. Nunca devolver secreto de otra
generación o ficha encontrada por contacto. No contactos ni secretos en capturas/logs.

Conexiones independientes: dos clientes y un admin por el mismo lugar; mismo replay;
revocación/cierre mientras espera; cambio de catálogo; cancelación contra movimiento;
purga y fallos. Cero efectos parciales y sin deadlocks aceptados como éxito. Inyectar
fallos de customer/event/audit/outbox/ledger/envelope. Regresión acumulada S1/S2/IN,
lint/formato/tipos/unit/build y E2E descartable; nunca probar sobre el propietario.

## Pendientes posteriores conservados

Riesgo de identidad pendiente de cierre antes de escrituras públicas: la configuración
max_active_bookings_per_customer no puede convertirse en «límite por persona» cuando
un anónimo crea una ficha nueva y comparte contactos. No fusionar ni elegir otra
ficha para intentar imponerlo. Las cuotas por capacidad/IP son antiabuso, no prueban
identidad y se pueden eludir cambiando navegador/red. Definir un vínculo verificable
o aceptar explícitamente esa limitación de piloto; no afirmar el requisito resuelto
por un contador de teléfono. La implementación dependiente se detiene si el contrato
de producto exige una garantía de persona que el flujo anónimo no puede demostrar.

Asignación any-staff; finalizaciones/ausencias y liberación histórica explícita;
notificaciones con proveedor/worker y deduplicación; recuperación por canal verificado;
acceso mínimo barber vinculado a sus turnos; integración/GAS según permisos y alcance;
privacidad, operación, staging y hosting. No se eliminan del proyecto ni se certifica
el MVP completo por terminar PB-01 o por aprobar este contrato parcial.
