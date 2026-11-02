# Horarios y vista previa — siguiente bloque del MVP

Fecha: 2026-11-02. Estado: propuesta para aprobación. No código, DDL ni cambios de
base de datos en esta entrega. La solicitud «avanza con lo siguiente» permite
preparar este contrato; no se interpreta como aprobación implícita de decisiones
P-03/P-06 pendientes ni de reservas, EXCLUDE o aplicación al propietario.

## 1. Base real y alcance

Se revisaron AGENTS, roadmap, docs 02/04/06, propuestas S3-A y el informe de clientes.
Hay trece fuentes de migración: doce aplicadas según el último informe local y una
de clientes validada sólo en descartable. No se consultó la instancia para recertificar
ese historial. Las trece fuentes, cuentas, MFA, invitaciones y datos se preservan.

Propuesta del bloque:

- **HS-01:** editor semanal por profesional, varios intervalos por día, descansos
  como huecos y cambios con vigencia por fecha.
- **HS-02:** excepciones por fecha del negocio/profesional y bloqueos puntuales.
- **HS-03:** vista previa interna por profesional/servicio, basada en los horarios,
  catálogo, políticas y bloqueos; cálculo puro y pruebas de zonas horarias.

Sin reservas, agenda de turnos, clientes públicos, any-staff, tokens de gestión,
notificaciones, edición de políticas del negocio, GAS, deploy ni cambios en la base
del propietario. Tampoco activa automáticamente el módulo de clientes.

La vista previa mostrará **«Horarios posibles según configuración. Todavía no se
pueden reservar»**. Contrato mode=schedule_preview, can_book=false y
occupancy_checked=false. No llamar «disponibilidad confirmada» a un cálculo que aún
no puede leer reservas. No hay botón Reservar ni endpoint público de disponibilidad.

## 2. Decisiones propuestas que necesitan aprobación

| ID     | Propuesta concreta                                                                                                                                 | Motivo / precedencia                                                                                                                                       |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HS-D01 | Owner/admin activos con MFA gestionan todos los horarios; barber sólo consulta su propio horario y vista previa, sin motivos privados ni escritura | Staff propio demostrado por staff_members.member_id = membresía actual del mismo negocio. No se habilita acceso a clientes.                                |
| HS-D02 | Cierre del negocio prevalece sobre cualquier apertura individual; después excepción individual, excepción global custom_hours y semana vigente     | Resuelve contradicción docs 04 §3.10 / 06 §3.1 frente a caso B-16. Un cierre global no puede reabrirse indirectamente desde un perfil.                     |
| HS-D03 | Intervalos locales [inicio,fin), jornadas por días ISO 1…7; sin cruces de medianoche en una fila; vigencia [desde,hasta) por fechas                | Reemplaza el límite inclusivo ambiguo de ejemplos antiguos. Turno cortado usa dos intervalos; cero intervalos significa cerrado.                           |
| HS-D04 | Cambios desde hoy local o una fecha futura; conservar versiones de planes y derivar fin por próximo plan vigente, sin borrar historia              | No editar fechas pasadas. La historia es por fecha y auditoría; no se promete reconstrucción de cada minuto intradía.                                      |
| HS-D05 | Servicio completo dentro de un único intervalo laboral; buffer puede superar cierre/descanso, pero jamás invadir un bloqueo                        | Mantiene RN-04; un servicio no puede cruzar descanso. Bloqueos se comprueban contra servicio + buffer.                                                     |
| HS-D06 | Grilla por reloj local desde medianoche y paso ya configurado en business_settings; notice y advance vigentes; nada de defaults nuevos             | Por ejemplo 09:10 con paso 15→09:15. No se edita settings ni se supone paso 15 si el negocio tiene otro.                                                   |
| HS-D07 | Hora inexistente: no desplazar silenciosamente, descartar candidato; ambigua: primera ocurrencia, offset mayor, una sola vez; duración real UTC    | Mantiene doc 06 §3.4. Extremo de intervalo inexistente invalida ese intervalo en esa fecha y se muestra advertencia; no se inventa una hora sustituta.     |
| HS-D08 | Raíz exclusiva S2 en todas las escrituras; horario/exception/block individual usa versión staff; global usa recurso calendar_control independiente | Aprobación parcial P-03/P-06 sólo para este bloque. No adoptar aún SHARE/UPDATE ni cambiar versiones S2, catálogo o clientes.                              |
| HS-D09 | Replay independiente, 48 h, reautorizado; UUID estables; purga privada ≤500 sin scheduler                                                          | Misma seguridad que catálogo/clientes, sin ampliar sus ledgers. Si no cambió nada, un comando nuevo válido conserva la semántica de UPDATE/version actual. |
| HS-D10 | Vista previa interna para un staff y un servicio, rango 1…7 fechas locales; fuente leída en un snapshot y sin caché compartida de autorización     | Alcance acotado, sin any-staff/portal público/ocupación falsa. Sólo staff/servicio actuales y activos con asociación válida.                               |

Aceptar estas filas no resuelve P-02, EXCLUDE, liberaciones históricas, manage_token,
replay anónimo ni cierre general del diseño de reservas. Esos gates siguen abiertos.

## 3. Semántica operativa

### Semana y vigencias

Un plan contiene toda la semana: hasta catorce intervalos en total, como límite
inicial propuesto (dos por día de promedio; se permiten más en un día sin superar
el total). weekday 1…7, start_minute 0…1439, end_minute 1…1440, start<end.
24:00 sólo como fin. Intervalos de un mismo día no se solapan; contiguos se normalizan
a uno. Las duraciones del servicio no tienen que ser múltiplos de la grilla.

Cada comando de plan usa UUID nuevo estable, effective_from y versión esperada staff.
Planes activos ordenados por effective_from: su fin exclusivo es el inicio del próximo;
sin próximo, infinito lógico. No plan aplicable→cerrado, sin asumir horario por defecto.
Plan con semana vacía→cerrado explícito desde esa fecha.

Crear un plan en una fecha que ya tiene uno lo sustituye lógicamente, conservando
la revisión anterior como superseded. Otros planes futuros **no se eliminan**: la
UI muestra el período que afecta hasta el próximo. Editar una revisión de fecha
pasada está denegado; cambiar desde hoy crea/sustituye la revisión de hoy, no reescribe
filas pasadas. Ante otra edición, 412; nunca pisar automáticamente cambios futuros.

### Excepciones y bloqueos

Una excepción por scope/fecha: closed o custom_hours con lista completa de intervalos.
Sin mezcla closed+horas ni varias excepciones rivales para el mismo scope/fecha.
La lista usa iguales límites/normalización que la semana. Motivo privado opcional
máximo 500, sólo owner/admin. Fechas pasadas no editables. Retirar excepción deja
historia y vuelve a la regla inferior; no borra la semana.

Precedencia: cierre global → excepción individual → excepción global custom_hours
→ semana. Bloqueos personales/globales siempre restan tiempo, incluso a excepciones
de apertura. Feriado cerrado no se vuelve a abrir por una excepción individual.

Bloqueo: intervalo UTC finito [starts_at,ends_at), ends>starts; kind manual/vacation/other,
staff opcional (NULL=global), motivo privado, baja lógica. Pueden solaparse y se usa
la unión al calcular. Sin ON DELETE CASCADE. Inicio de un bloqueo nuevo no puede
estar antes de now servidor; una corrección histórica queda fuera del mínimo.
La UI convierte fecha/hora en zona del negocio y muestra el instante/offset final.
Hora ambigua de bloqueo: primera ocurrencia con aviso; inexistente: pedir corrección.

Ninguna operación cancela turnos. Todavía no hay appointments: no devolver una lista
ficticia de «reservas afectadas» ni afirmar que se comprobó ausencia de conflictos
con reservas. Antes de habilitar reservas, estos escritores deberán ampliarse en
una entrega conjunta para detectar/reportar conflictos y conservar turnos existentes.

## 4. Modelo propuesto, no SQL ejecutable

| Objeto                     | Campos/constraints principales                                                                                                           | Versión y relación                                                                                                                                      |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| app.calendar_controls      | id UUID, business_id único/FK, version>0, created_at/updated_at                                                                          | Un recurso por negocio para cambios globales. Creación bajo raíz si falta, sin cambiar business.version.                                                |
| public.staff_working_plans | id UUID estable, business_id, staff_member_id, effective_from date finita, superseded_at NULL, created_at/actor                          | FK compuesta a staff. Una revisión no superseded por staff/fecha. UNIQUE(business_id,id).                                                               |
| public.working_hours       | business_id, plan_id, weekday, start_minute,end_minute, posición                                                                         | FK compuesta al plan; PK por plan/posición y validación de solapes del conjunto dentro del comando. Filas de una revisión publicada no se editan.       |
| public.schedule_exceptions | id UUID, business_id, staff_member_id opcional, local_date, kind, intervals JSON validado explícitamente, reason, deleted_at, timestamps | FKs tenant; unicidad viva scope/fecha con índices separados global/individual. JSON sólo array tipado de minutos, sin SQL arbitrario. Versión de padre. |
| public.time_blocks         | id UUID, business_id, staff_member_id opcional, starts_at,ends_at timestamptz, kind, reason, deleted_at, timestamps                      | FKs tenant; índices por tenant/staff/rango; sin EXCLUDE de reservas ni creación de appointments. Versión de padre.                                      |
| app.schedule_requests      | tenant/actor/operation/key, canon_version, hash, result de metadatos, origin_request_id, created_at                                      | PK tenant+actor+operación+key; 48 h, sin payload/reasons ni tokens en respuesta persistida.                                                             |

Todos ENABLE/FORCE RLS, deny-all sin grants directos a roles de aplicación. Definers
api sólo authenticated con guardas y proyección explícita; cores privados, search_path
vacío, dueño postgres, EXECUTE PUBLIC/defaults revocados. No grants nuevos app_server,
service_role o anon. FKs compuestas e índices tenant primero. No tablas de reservas
provisorias ni credenciales de integración. No app.touch_record sobre filas inmutables.

Plan nuevo, excepción y bloqueo individuales incrementan staff.version una vez; si
otro editor cambió bio/asociaciones del staff mientras tanto, 412 conservador correcto.
Global incrementa sólo calendar_controls.version, no todos los profesionales. Cualquier
comando compuesto que afecte ambos scopes deberá estar fuera del mínimo o exigir
vector explícito; no inventar una versión agregada de negocio que no existe.

Sin control global persistido, GET devuelve versión virtual 1 sin hacer INSERT.
El primer comando global exige If-Match 1 y, bajo raíz, crea el control y publica
el cambio con versión 2 en la misma transacción. Su id estable es el business_id;
los comandos posteriores actualizan ese recurso. Dos inicializaciones concurrentes
se serializan, sin grants de escritura en una lectura ni pérdida de precondiciones.

Owner/admin pueden preparar horarios de staff inactivo pero no archivado; escribir
sobre archivado da 409. La vista previa sólo ofrece candidatos de perfiles/servicios
activos y no archivados. Slots son alternativas y pueden solaparse entre sí: nunca
se representan como reservas confirmadas ni ocupan tiempo por haber sido calculados.

## 5. Seguridad, transacciones y compatibilidad

Reusar app.require_member y app.lock_managed_business. Preflight no bloqueante →
raíz UPDATE → reautorizar con snapshot fresco READ COMMITTED → replay → padre
(staff o calendar_control) → hijos por ID → validación y efectos/audit/replay atómicos.
No adquirir raíz después del hijo, upgrades SHARE→UPDATE ni I/O externo bajo locks.
Purga sólo replay con SKIP LOCKED y sin raíz posterior. Un comando por transacción.

Leer motivos privados exige owner/admin aal2. Barber debe demostrar staff propio
por membresía actual y obtiene sólo intervalos/calendario efectivo, sin motivos de
bloqueos/excepciones ni planes de otros profesionales. Sin enlace de cuenta no se
le asigna un staff por nombre/email. No puede escribir aunque una configuración
histórica barber_can_edit_availability exista: habilitarla requeriría otro alcance.

Replay exacto verifica actor/tenant/capacidad/recurso actuales y devuelve metadatos
originales antes de comparar versión; no recrea plan ni intervalo. Pasadas 48 h,
UUID estable y versión vigente siguen impidiendo repetición sensible. Hash SQL
versionado incluye scope, acción, IDs, intervalos normalizados, fecha y versiones;
request_id va aparte. Auditoría sólo IDs/versiones/acción, sin motivo ni PII.

Clientes, invitaciones, catálogo y último propietario conservan sus funciones y
contratos. Un cambio de rol S2 antes de adquirir la raíz invalida la escritura; si
el escritor obtuvo la raíz primero puede confirmar antes de la revocación. No se
afirma revocación retroactiva de lecturas ya respondidas.

## 6. API, cálculo y UX propuestos

Base autenticada /api/v1/businesses/{businessId}:

| Ruta                                                | Operación                                                                                        |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| GET /staff/{staffId}/schedule                       | Planes vigentes/futuros y calendario efectivo; motivos sólo administrativos.                     |
| PUT /staff/{staffId}/working-hours                  | Plan UUID estable, effective_from, semana completa; If-Match staff y key.                        |
| POST /staff/{staffId}/schedule-exceptions           | Alta con ID estable y versión staff; posteriores update/archive por ID con mismo padre.          |
| POST /schedule-exceptions                           | Variante global; versión calendar_control, nunca staff_id asertado como autoridad.               |
| POST /staff/{staffId}/time-blocks y /time-blocks    | Individual/global; altas/update/archive bajo versión del padre.                                  |
| GET /calendar-control                               | Versión del recurso global, owner/admin aal2.                                                    |
| GET /schedule-preview?staff_id&service_id&from&days | Máximo siete fechas locales, snapshot coherente, sin reserva ni promesa de ocupación comprobada. |

Zod strict, JSON acotado, UUID/fechas/enteros/horas válidos y normalización SQL de
intervalos. 401/403/404, 428/412/409 vigentes; If-Match fuerte, Idempotency-Key UUID
en mutaciones. Source/actor/version derivada/motivo no van en URL. CSRF cookie,
Bearer verificado, no-store, request_id UUID por intento. No alterar contratos S2.

Una RPC de lectura recopila configuración, catálogo/overrides, planes, excepciones,
bloqueos y sus versiones en un snapshot; no consultas separadas que mezclen versiones.
PostgreSQL valida zona y resuelve fechas locales a UTC con roundtrip y detección de
ambigüedad. Sin depender de timezone del proceso ni agregar librerías silenciosamente.
La estrategia concreta de resolución debe pasar vectores DST antes de habilitar UI.

computeSlots puro recibe intervalos UTC resueltos, candidatos de grilla local, duración
real/overrides, buffer, bloqueos, políticas y now inyectado. No DB, Auth o reloj global
dentro del cálculo. Respeta min_notice/max_advance; cruces [) contiguos no son solape.
Si no puede resolver un extremo local, no ofrece ese intervalo y reporta advertencia.
No sumar 24 h para pasar de fecha ni usar minutos de reloj como duración UTC.

Merivo: editor semanal, botón Agregar intervalo, fecha de vigencia visible y resumen
de próximos cambios; excepciones y bloqueos separados. Previsualizar servicio/fecha
sin botón de reserva. Motivos privados nunca en vista barber. Errores 412 preservan
borrador y piden recarga explícita. No historias/ocupación inventadas. Pantalla sin
migración habilitada muestra estado pendiente, no intenta crear tablas al abrir.

## 7. Implementación por lotes, sólo después de aprobar

1. **HS-01:** modelo de planes/intervalos y control global, RPC de semana, versiones,
   auditoría/replay, editor y pruebas. No dependencias de clientes o reservas.
2. **HS-02:** excepciones/bloqueos con precedencia y proyecciones por rol; editor.
3. **HS-03:** snapshot/cálculo puro/vista previa y pruebas de fechas/DST/overrides.

Migraciones nuevas posteriores a la última existente entonces; no editar las trece
actuales. Mantener stack/dependencias/estructura; módulos actuales staff/services/auth
y availability, handlers finos y componentes compartidos. Ningún lote se aplica al
propietario por autorización de desarrollo. Stop al completar HS-01/02/03.

## 8. Aceptación obligatoria propuesta

- pgTAP: FKs cross-tenant, RLS/grants, rol/MFA/own, intervalos vacíos/contiguos/
  solapados, vigencias y sustitución futura sin borrar planes; versiones y 48 h.
- Conexiones independientes: dos editores 200/412, cambio de rol durante espera,
  horario vs catálogo y cierre global; replay/purga; una versión/audit por comando.
- Cálculo puro: turno cortado, cierre global vs apertura individual, override duración,
  buffer fuera de cierre, buffer contra bloqueo, grid 09:10→09:15, notice/horizonte.
- DST: hueco y repetición New York, offset media hora Lord Howe, medianoche/día
  irregular, duración real y roundtrip; tests deterministas con fechas históricas
  de fixture. No cambiar reloj/zona del propietario ni afirmar tests aún no ejecutados.
- HTTP/E2E: editor Merivo desktop/mobile, barber sólo propio/sin motivos, 412 con
  borrador, vista previa claramente informativa y ninguna creación de reservas.
- Regresión completa S1/S2/catálogo/clientes, lint, formato, tipos, unitarios y build.
  Sólo entorno descartable. Objetivos de rendimiento se miden, no se prometen aquí.

## 9. Gate de aprobación

Se propone aprobar HS-D01…HS-D10 y autorizar implementación HS-01/02/03 sólo en
descartable. Esto cierra únicamente los contratos de coordinación/versiones necesarios
para horarios y su vista previa. P-02/EXCLUDE/estados/tokens de reservas siguen abiertos.
Hasta esa aprobación no se crean SQL ni funcionalidades de horarios.
