# Primer MVP de turnos internos — contrato para aprobación

Fecha: 2026-11-02. Estado: propuesta, no SQL ni funcionalidad implementada.
Continuidad después de clientes y HS-01/02/03. No autoriza aplicar migraciones al
propietario. No modifica decisiones/documentos históricos ni da por aprobado el
motor S6 completo.

## 1. Resultado concreto propuesto

Owner/admin entra al negocio, selecciona cliente existente, servicio, profesional
y horario, confirma el turno y lo ve en una agenda interna por fecha/profesional.
Puede moverlo de horario o cancelarlo mientras no haya comenzado. Dos personas
que intentan ocupar el mismo lugar no pueden obtener ambas una reserva confirmada.

**IN-01:** modelo/ocupación y motor SQL de creación, reprogramación y cancelación.
**IN-02:** disponibilidad interna que descuenta ocupación real, revalidada al guardar.
**IN-03:** agenda básica y formularios administrativos Merivo, sin drag-and-drop.

Se conservan HS, catálogo y clientes, incluido teléfono compartido y UUID de cliente
seleccionado explícitamente. No seleccionar ni unir clientes por contacto. Sin altas
de clientes implícitas dentro de crear turno.

Sin portal público, tokens de gestión, pending/expiración, any-staff, reasignación a
otro profesional, cambios de servicio/precio de un turno existente, completed,
no_show, correcciones, liberación parcial, estadísticas de visitas, campañas, envío
de emails, GAS, despliegue, commits ni push. El objetivo es probar el primer flujo
real de turnos, no declarar terminado todo el MVP.

## 2. Decisiones exactas propuestas

| ID     | Contrato que se propone aprobar                                                                                                                                                                                                                                                      |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| IN-D01 | Sólo owner/admin activos con MFA gestionan y leen esta agenda. Barber conserva horarios propios y consulta de sus intervalos ocupados sin datos de clientes; no se habilita directorio/ficha/agenda de clientes para barber.                                                         |
| IN-D02 | Crear produce confirmed directamente. Únicos estados escritos en esta fase: confirmed y cancelled. No inferir atención, ausencia o expiración por reloj.                                                                                                                             |
| IN-D03 | Reprogramar/cancelar sólo confirmed con starts_at > reloj servidor. Administración puede cancelar hasta el inicio; reprogramación respeta notice/horizonte actuales, sin override. Empezado/pasado→409, hasta diseñar transiciones de atención.                                      |
| IN-D04 | Ocupación en tabla privada separada, con historial de asignaciones; EXCLUDE sólo sobre filas no liberadas, según §3. No predicado por status ni reloj.                                                                                                                               |
| IN-D05 | Crear exige staff/servicio/cliente actuales, activos cuando corresponda, mismo tenant y asociación válida. Reprogramar conserva cliente, profesional, servicio y snapshots; exige staff/servicio actuales y elegibles. Cancelar no exige reactivar un cliente o catálogo archivados. |
| IN-D06 | Snapshots al crear: nombre de servicio, precio ARS, duración y buffer efectivos del catálogo/override, todos calculados por PostgreSQL. Reprogramar conserva esos snapshots y sólo valida nueva geometría/horarios con duración original.                                            |
| IN-D07 | Conservar raíz exclusiva UPDATE S2 para todas las escrituras, READ COMMITTED y reautorización. No introducir SHARE/upgrades todavía. Orden común §4.                                                                                                                                 |
| IN-D08 | UUID estable por turno, version propia e idempotencia privada 48 h por negocio/actor/operación/key. Replay autorizado sin duplicar ocupación, eventos, auditoría u outbox.                                                                                                           |
| IN-D09 | Configuración sólo se cambia si no invalida turnos futuros: horario/excepción/bloqueo en conflicto devuelve 409 con IDs autorizados y hace rollback. No force, no cancelación automática. La baja lógica de catálogo conserva las reservas y sus snapshots.                          |
| IN-D10 | Reserva + ocupación + evento + auditoría + outbox privado de metadatos se escriben atómicamente. Sin worker/proveedor/scheduler ni promesa de notificación.                                                                                                                          |

Estas filas son nuevas propuestas, no decisiones ya aprobadas. La autorización HS
anterior excluyó reservas y EXCLUDE. Este paquete solicita una aprobación física
**limitada** y mantiene pendientes estados terminales, P-02R/C/D y tokens públicos.

## 3. Ocupación y predicado físico que debe aprobarse

Representación propuesta, descrita sin DDL ejecutable:

- public.appointments: UUID estable, business_id, customer_id, staff_member_id,
  service_id con FKs compuestas; status confirmed/cancelled, starts_at, ends_at,
  blocked_until UTC, snapshots ARS/duración/buffer/nombre, version y timestamps.
- Derivar ends_at/blocked_until en trigger desde starts_at y minutos reales; CHECK
  de igualdad de diferencias y límites, no sólo end>start. Campos derivados nunca
  son autoridad del body. No columnas generadas con suma timestamptz+interval.
- app.appointment_occupancy: id, business_id, appointment_id, staff_member_id,
  generation, starts_at, blocked_until, released_at, created_at. FKs compuestas;
  generation única por turno. Cada fila guarda su rango original sin reescribirlo.
- Rango ocupado semiabierto [starts_at,blocked_until); extremos finitos y positivos.
- Exclusión GiST propuesta: mismo business_id y staff_member_id no pueden tener
  rangos que se intersecten **cuando released_at IS NULL**. Requiere btree_gist
  comprobado en la implementación futura; no usar NOW ni status en el predicado.
- Índice único parcial adicional: como máximo una asignación no liberada por turno
  en esta fase. Estado confirmado exige exactamente una; cancelado exige cero.
  Verificar coherencia al commit mediante guardas/constraint triggers revisados.

| Caso                                                           | Asignación                                                          | Ocupa               | Resultado exigido                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------- | -------------------------------------- |
| confirmed nuevo                                                | Una no liberada con extremos iguales al turno                       | Sí                  | Válido.                                |
| confirmed sin asignación o con dos actuales                    | Incoherente                                                         | —                   | Commit rechazado.                      |
| cancelled                                                      | Ninguna actual; fila previa conserva rango y released_at            | No                  | Válido.                                |
| cancelled con asignación actual                                | Incoherente                                                         | —                   | Commit rechazado.                      |
| Dos turnos contiguos A.blocked_until = B.starts_at             | Ambos actuales                                                      | Sin intersección    | Permitidos.                            |
| Rangos de servicio/buffer intersectados del mismo staff/tenant | Ambos actuales                                                      | Intersección        | Uno falla 409; cero efectos parciales. |
| Mismos instantes, distinto staff o negocio                     | Ambos actuales                                                      | Recursos distintos  | Permitidos.                            |
| Reprogramación válida                                          | Anterior liberada + nueva generación actual en la misma transacción | Sólo destino        | Conserva historia; una versión final.  |
| Destino tomado                                                 | Falla nueva generación                                              | Origen sigue actual | Rollback de toda la reprogramación.    |

Cancelar y reprogramar se limitan a turnos aún futuros: no eliminan un prefijo de
atención transcurrido ni deciden liberaciones retroactivas. completed/no_show no se
implementan ni se agregan al CHECK por anticipación. En una etapa posterior, su
ocupación conservada y cualquier liberación parcial requieren contratos/guardas
nuevos. La tabla separada evita basar la exclusión en una lista de estados, pero
no demuestra por sí sola todas las futuras transiciones de P-02.

No hard delete de turnos, ocupación o eventos desde la aplicación. El calendario
no convierte un confirmed pasado en completed: muestra que el horario transcurrió
y que aún no se implementó el registro del resultado de atención. Sin métricas falsas.

## 4. Identidad, locks y versiones

Preflight no bloqueante de identidad/membresía/MFA → raíz UPDATE → reautorizar →
replay → profesionales por UUID → cliente → turno → ocupación/hijos por orden estable.
Una sola operación/negocio por transacción. No llamadas externas con locks, upgrades,
setters de identidad ni SQL dinámico. No cambiar los coordinadores S2/catálogo/clientes.

Crear requiere UUID nuevo y vector observado staff/service/customer/calendar_control/
business_settings/business. Las versiones se validan dentro de SQL después de autorizar,
bajo raíz; nunca se confía en precio/duración o hash del cliente. Missing→428,
stale→412. El preview deberá incluir las versiones de settings/business que aún no
expone. No usar business.version como contador de cada turno.

Reprogramar requiere If-Match del turno y versiones de configuración staff/control/
settings/business para el nuevo horario. No toma precio/duración actuales como
reemplazo de snapshots. Cancelar sólo exige versión del turno y permiso vigente;
no queda bloqueado por una ficha o servicio archivados. Cada comando válido nuevo
incrementa el turno una vez; no aumenta staff/customer por crear una reserva.

El token de sesión Auth es la única identidad del operador. No hay manage_token,
actor del body, privilegio por conocer teléfono/key o acceso de app_server/service_role.
Tablas ENABLE/FORCE RLS, sin DML/grants directos de roles de aplicación. Definers api
con search_path vacío, dueño postgres y proyecciones explícitas; helpers privados.

## 5. Disponibilidad y compatibilidad con HS

La selección del navegador nunca garantiza la reserva. PostgreSQL valida nuevamente
eligibilidad, fecha local, grilla, notice/horizonte, vigencias, excepciones y bloqueos
después de adquirir raíz. Reusa la resolución de jornada/DST ya aprobada; verifica
servicio en un único intervalo y buffer contra bloqueos y ocupación real.

La creación usa snapshots nuevos de catálogo. La reprogramación usa duración/buffer
originales, aunque catálogo haya cambiado. SQL vuelve a validar el destino completo;
EXCLUDE es la última barrera de ocupación, no un reemplazo de las demás políticas.

Se amplía la lectura HS con ocupación activa del profesional consultado. Su vista
previa informa occupancy_checked=true cuando ya consulta esta nueva fuente, pero
can_book sigue false: sólo el comando autenticado puede confirmar. Adaptar conjuntamente
DTOs/UI/tests hoy tipados con literal false; mantener rutas HTTP existentes y flags
explícitos. No marcar fuente ausente como ocupación comprobada.

Los escritores de HS deben revisar sus turnos futuros bajo la misma raíz. Si una
propuesta de semana/excepción/bloqueo invalida alguno, responder 409 y revertir
plan/versión/replay/audit; listar sólo IDs/fechas permitidos para owner/admin. No
aprobar cambio de horario sin actualizar también ese control en esta misma entrega.
Barber no recibe esos IDs ni datos de clientes; para su consulta se devuelven sólo
intervalos ocupados de staff propio. No nuevo acceso a customers/notes/consentimientos.

Revisar RPC y consumidores reales de HS, catálogo y clientes antes de generar una
migración que reemplace funciones: pruebas acumuladas deben comprobar los nuevos
flags sin eliminar controles de autorización o volver a cuerpos antiguos.

## 6. API y agenda propuestas

Base `/api/v1/businesses/{businessId}/appointments`, autenticada owner/admin aal2:

| Método                | Entrada / salida mínima                                                                                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| POST base             | id, customer_id, staff_id, service_id, starts_at ISO con offset, context_versions y key UUID; 201, id/status/version/snapshots autorizados. |
| GET base              | from fecha local, days 1…7, staff_id opcional, limit 50…200/cursor. Proyección administrativa mínima, sin notas globales del cliente.       |
| GET /{id}             | Detalle administrativo, ETag, snapshots y eventos permitidos.                                                                               |
| POST /{id}/reschedule | starts_at, context_versions, reason opcional; If-Match y key. Sólo mismo cliente/staff/servicio.                                            |
| POST /{id}/cancel     | reason acotada, If-Match y key. No DELETE físico.                                                                                           |

Respuestas no-store, X-Request-Id UUID por intento, 401/403/404 y 428/412/409 vigentes;
sin error.detail de PostgreSQL. Intersección del EXCLUDE→409 SLOT_TAKEN sólo desde
la constraint identificada, no mapear cualquier CHECK/constraint como turno ocupado.
Body Zod strict, límites y validación SQL; CSRF/origen cookie y Bearer verificado.
No contactos/notas/tokens en logs, querystring, cursor o ledger de replay.

Agenda Merivo con día/rango, filtro de profesional y turnos ordenados por inicio/ID.
Formulario con cliente elegido del directorio, servicio, profesional y horarios;
precio/duración efectivos visibles antes de confirmar. Confirmación devuelve el
estado real y permite abrir el turno. Conflicto 409 solicita otro horario; 412 exige
recargar y revisar. Reprogramar fallido deja el turno anterior intacto.

Paginación keyset por starts_at/id ligada a tenant/filtros, reautorizada por página.
starts_at cambia al reprogramar: no prometer snapshot/export consistente; UI identifica
por UUID y recarga después de mutaciones. Sin truncamiento silencioso ni descargar
todo el directorio para autorizar. El navegador no recibe notas privadas por defecto.

## 7. Atomicidad, idempotencia y outbox

Ledger privado nuevo: scope tenant/actor/operation/key, canon_version, hash SQL de
intención/versiones, result sólo de metadatos, origin_request_id, created_at. TTL
48 h, purga privada ≤500, sin scheduler y sin tocar registros de citas/eventos.
Replay reautoriza antes de devolver; no compara versiones actuales para repetir
un resultado autorizado ni duplica efectos. Tras TTL, UUID estable y expected
siguen impidiendo repetir creación/movimiento/cancelación accidentalmente.

Eventos de dominio append-only con IDs, versiones, estado y cambios de horario;
motivo privado sólo en proyección administrativa. Auditoría general sólo metadatos.
Outbox privado por evento, payload de IDs/versiones, sin credenciales/contactos ni
manage_token. Sin worker ni envíos; la interfaz no dice «cliente notificado».
Fallo en ocupación, evento, audit, outbox o replay revierte todo el comando.

## 8. Pruebas y gates de ejecución

- Reconstruir las catorce fuentes existentes sin editarlas y añadir sólo migraciones
  nuevas después de inspeccionar estado real. No aplicar al propietario.
- pgTAP: matriz física §3, coherencia al commit, snapshots/derivados, tenant/FKs,
  estados, roles/MFA, versiones, TTL, privacidad y rollback inyectado de cada hijo.
- Conexiones independientes: mismo horario/diferentes keys, replay simultáneo,
  reprogramaciones contra creación, cancelación vs reprogramación, revocación de rol,
  plan/cierre/bloqueo vs reserva y purga. Ningún deadlock cuenta como éxito.
- HTTP/E2E descartable: elegir cliente→servicio→staff→hora→crear→ver agenda→mover→cancelar;
  SLOT_TAKEN/412 guiados y preservación del origen; cero datos del propietario.
- Regresión S1/S2/catálogo/clientes/HS, aislamiento y contraste entre validación SQL
  y cálculo de disponibilidad; lint, formato, tipos, unitarios y build.
- Pruebas sintéticas únicamente. Aviso/derechos/retención de clientes pendientes
  siguen siendo gate antes de uso real, sin resolverlo por crear turnos de fixture.

**Aprobación solicitada:** IN-D01…IN-D10, incluida representación/predicado/matriz §3,
y autorización de implementación IN-01/02/03 sólo en descartable. Sin autorización
se conserva esta propuesta y no se genera SQL de reservas. Una autorización de
desarrollo no permite activar clientes/HS/reservas en la instancia del propietario.
