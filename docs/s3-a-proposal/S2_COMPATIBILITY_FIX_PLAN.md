# Paquete A — Plan de correcciones compatibles con S2

Fecha: 2026-11-01. Estado: **propuesta para aprobación; no implementada**.

Esta propuesta desarrolla C-01 a C-08 de los informes de
[continuidad](../continuity-proposal/CURRENT_IMPLEMENTATION_STATUS.md). No sustituye
esos informes, no aprueba S3-B y no modifica las cinco migraciones existentes.
Las referencias de línea corresponden al árbol local inspeccionado, no a un commit.
Las pruebas siguientes son criterios futuros: **no fueron ejecutadas** en esta fase.

## Contrato de compatibilidad

Se mantienen rutas Next.js, sesiones, MFA, roles owner/admin/barber, cuerpos de éxito,
ETag fuerte entre comillas, `PRECONDITION_FAILED` para 412 y scope de idempotencia
por negocio, usuario verificado, operación y key. No se agregan permisos a app_server
ni acceso de service_role a datos de negocio. Las nuevas funciones privilegiadas
deberán conservar `search_path=''`, nombres calificados y grants específicos.

Compatibilidad no significa perpetuar acceso indebido. C-08 restringe expresamente
SELECT directo a tablas; C-07 rechaza envíos antes permitidos indebidamente; C-01
corrige la prioridad de errores; C-05 deja de etiquetar errores ajenos como LAST_OWNER.
Estas excepciones deben aprobarse y probarse como cambios deliberados del contrato.

Abreviaturas de evidencia:

- M1: [20261031231242_init_tenancy.sql](../../supabase/migrations/20261031231242_init_tenancy.sql).
- M4: [20261101000100_auth_memberships.sql](../../supabase/migrations/20261101000100_auth_memberships.sql).
- M5: [20261101000200_invitation_lifecycle.sql](../../supabase/migrations/20261101000200_invitation_lifecycle.sql).

## C-08 — Configuración privada visible para barberos — prioridad crítica

**Evidencia.** M1:182–186 permite leer negocios/configuración a miembros activos;
M1:221 otorga SELECT sobre todas las columnas de ambas tablas a `authenticated`.
La definición de `app.is_active_member` en M4 permite al barbero activo con aal1.
`businesses` contiene `tax_id`, `legal_name`, `billing_customer_ref`, `plan_id` y
otros datos privados; `business_settings` no tiene proyección por rol. RLS filtra
filas, no columnas. Que la UI no los muestre no impide consultar PostgREST.

**Riesgo y condiciones.** Un barbero autenticado y activo puede consultar información
privada de su negocio. No se afirma lectura de otro tenant ni acceso anónimo.

**Corrección mínima.** Nueva migración que revoque SELECT de `authenticated` sobre
`businesses` y `business_settings`. Agregar `api.read_business_private(uuid)` con
proyección explícita y permiso owner/admin activo con aal2, negocio vigente y usuario
vigente. No usar `to_jsonb(fila)` ni otorgar columnas de configuración por comodidad.
Mantener `api.me` como selector con proyección acotada y el RPC público existente.
No revocar accidentalmente SELECT de perfil propio o membresía propia.

**Compatibilidad.** Las rutas/pantallas actuales consumen el selector y RPCs; no
necesitan recibir configuración privada. SELECT directo quedará denegado también
para owner/admin, que utilizarán el nuevo RPC. Inventariar consumidores y adaptar
fixtures antes del cambio; no prometer compatibilidad a clientes SQL/Table API.

**Migración.** Sí: revocaciones, función y grants nuevos; ninguna edición de M1.

**Regresión.** A-08: llenar campos privados con valores sintéticos; comprobar que
barbero, anon y app_server no pueden obtenerlos, incluyendo SELECT explícito de cada
campo, `*` y consultas relacionadas. Owner/admin aal1 no pueden usar el RPC privado;
aal2 sí en su negocio y nunca en otro. Selector, perfil propio, listado de equipo,
MFA y proyección pública permanecen operativos. Revisar grants heredados y cualquier
vista/RPC que pueda devolver esas columnas, no sólo la política principal.

**Riesgo de cambio.** Dependencias ocultas de lectura directa y tests acoplados al
grant amplio. Fallar cerrado y corregir la proyección; rollback no debe restituir
la exposición. No cambiar datos, cuentas ni factores MFA.

## C-07 — Autorización de envíos Auth y carreras — prioridad alta

**Evidencia.** [actions.ts](../../src/modules/auth/actions.ts):198–214 busca un miembro
invited en `listMembers(businessId)` y llama `inviteUserByEmail(member.email)`.
M4:121–132 autoriza listar a administradores sin limitar la lectura a barberos.
La restricción visual del formulario no protege una Server Action invocada directamente.
Entre lectura y envío no existe coordinación con cambios de rol/estado.

**Riesgo y condiciones.** Un admin autorizado a leer equipo puede disparar Auth Admin
para una invitación pendiente de owner/admin. Puede producir altas/correos no
autorizados por la matriz, aunque esto por sí solo no concede membresía activa.
Una revocación concurrente puede ocurrir después de autorizar y antes del proveedor.

**Corrección mínima.** Agregar RPC específico `api.prepare_member_auth_invite`:
identidad verificada → preautorización → raíz exclusiva del negocio → reautorización
actual → miembro objetivo → estado invited, usuario aún no vinculado y token no
vencido. Owner puede gestionar roles permitidos actualmente; admin sólo barber,
incluyendo el rol actual del objetivo. Devuelve únicamente destinatario obtenido de
DB e identificadores/versión necesarios. La acción usa ese destinatario inmediatamente;
no acepta email/rol/actor del formulario y deja de buscar en un listado de miembros.

Liberar la transacción antes de llamar Auth Admin. El punto de autorización es la
confirmación del RPC, **no** el instante de entrega del correo. Una revocación
posterior puede coexistir con el envío ya autorizado. La aceptación de membresía
debe volver a validar token, estado, identidad/email, negocio y MFA actuales: ningún
envío concede acceso por sí mismo. No mantener locks durante I/O ni prometer una
transacción distribuida. Aceptar este límite es una decisión explícita A-07.

Timeout del proveedor: informar resultado incierto y evitar reenvío automático ciego.
Cooldown/deduplicación persistente del envío puede aprobarse como extensión separada;
no introducir un outbox de negocio completo para corregir este permiso.

**Compatibilidad.** Sin cambiar endpoints de membresías ni el formato de login.
Invocaciones forjadas de admin sobre owner/admin pasan a rechazarse. Auth Admin sigue
limitado a Auth; no se reutiliza su clave para consultar datos del negocio.

**Migración.** Sí, nuevo RPC privado en datos devueltos y grants mínimos a la entrada
autenticada; cambios futuros en acción y pruebas. Depende del protocolo C-02.

**Regresión.** A-07: owner permitido; admin→barber permitido; admin→owner/admin y
barber→cualquier rol denegados aunque se invoque la acción directamente. Objetivo de
otro tenant, vencido, revocado o vinculado denegado. Con dos conexiones: revocar al
actor/objetivo mientras espera la raíz y verificar rechazo tras adquirirla. Con
proveedor artificialmente demorado: revocación posterior no habilita aceptación,
aunque el correo pueda llegar. No registrar tokens ni email real en logs de prueba.

**Riesgo de cambio.** Diferenciar invitación Auth de invitación a un negocio y estados
de una cuenta ya existente; mantener mensajes seguros sin filtrar existencia de
cuentas. No cancelar o borrar usuarios Auth como compensación de un envío fallido.

## C-05 — SQLSTATE 23514 no significa LAST_OWNER

**Evidencia.** [service.ts](../../src/modules/auth/service.ts):32 transforma cualquier
23514 en LAST_OWNER/409. M1:151 utiliza ese SQLSTATE para el último owner, pero
M1:117/133 lo utiliza para identidad inmutable/timezone y M4:255 para auditoría
inmutable, además de los CHECK de tablas.

**Riesgo y condiciones.** Cualquier CHECK/trigger alcanzado por una operación RPC
puede presentar un diagnóstico falso; no implica que todas esas rutas sean accesibles
hoy desde HTTP. Oculta errores internos y puede inducir reintentos/soporte incorrectos.

**Corrección mínima.** En nueva migración reemplazar el cuerpo de
`app.protect_last_owner` conservando función y trigger, pero emitir PT409 con mensaje
estable `LAST_OWNER` exclusivamente en esa condición. Eliminar la traducción genérica
23514 en TypeScript. Un 23514 no clasificado será 500 `INTERNAL_ERROR` seguro, sin
detalle SQL; otros errores conservan su manejo vigente. No parsear mensajes en inglés.

**Compatibilidad.** Último owner sigue dando 409/LAST_OWNER. Cambia deliberadamente
23514 ajeno de 409/LAST_OWNER a 500/INTERNAL_ERROR y el SQLSTATE del guard específico.
No renombrar 412 ni alterar 23505 dentro de esta corrección.

**Migración.** Sí para distinguir la condición en origen; un parche sólo TS no basta.

**Regresión.** A-05: último owner vía RPC y DML de mantenimiento controlado, CHECK
distinto, trigger de identidad y auditoría inmutable. Ninguno de los tres últimos
debe producir LAST_OWNER ni filtrar texto SQL. Verificar rollback total del intento.

**Riesgo de cambio.** Consumidores SQL que esperen 23514 para el último owner;
inventariarlos. Es el cambio acotado de menor complejidad del paquete.

## C-01 — Autenticación antes de precondiciones de estado

**Evidencia.** [http.ts](../../src/modules/auth/http.ts):66–74 emite 428 o parsea
If-Match antes del `rpc`; [service.ts](../../src/modules/auth/service.ts):14–27
verifica usuario recién al invocarlo. M4:149–158 comprueba ausencia de versión antes
del techo de rol del admin. Un Bearer sintácticamente válido no acredita identidad.

**Riesgo y condiciones.** Con IDs, key y body sintácticamente válidos, un usuario sin
sesión válida puede recibir 428 antes de 401; un admin sin permiso sobre el objetivo
puede obtener una clasificación de precondición antes del rechazo de autorización.
No equivale a lectura de la versión del objetivo.

**Corrección mínima.** Verificar identidad antes de clasificar If-Match; autorizar
negocio/objetivo en SQL antes de validar su precondición de estado. Permitir expected
nulo hasta ese punto, usando las firmas actuales, y aplicar C-02. Para una solicitud
nueva autorizada: ausencia→428, formato inválido→400, versión vieja→412. Si existe
key aún vigente, comparar intención completa: una key de un request con expected
distinto o ausente→409; replay exacto autorizado→resultado previo, antes de comparar
versión actual. Mover también el guard SQL de expected para no corregir sólo HTTP.

CSRF/origen, límites de tamaño y sintaxis de transporte pueden rechazarse primero;
esta excepción no habilita comparar estado de recursos antes de autorización.
No agregar consultas privilegiadas desde Next para averiguar un tenant ajeno.

**Compatibilidad.** Rutas, ETag y éxitos iguales. Cambia prioridad de errores inválidos;
no aceptar If-Match sin comillas ni crear un segundo dialecto para V11.

**Migración.** Sí, orden interno de guards/replay en funciones existentes, mediante
nueva migración; cambios TS sin nuevas credenciales. Coordinar con C-02 y C-06.

**Regresión.** A-01: sin sesión/Bearer inválido→401 en contexto de transporte válido;
tenant ajeno→404; rol insuficiente→403; autorizado sin versión→428; viejo→412;
replay exacto con versión ya superada→éxito sólo si conserva permiso actual; misma
key con expected diferente/ausente→409. Cross-origin cookie mantiene 403 de CSRF.

**Riesgo de cambio.** Tests/consumidores que dependan de la prioridad anterior;
evitar doble autenticación de red innecesaria al reutilizar cliente por request.

## C-02 — Preautorización y coordinación de locks

**Evidencia.** M4:142–143 y M5:7–8 bloquean `businesses FOR UPDATE` antes de
`app.require_member`. M1:145 toma raíz desde un trigger de miembro, cuando un UPDATE
directo ya puede haber adquirido la fila hija. M4:161 y M5:16 leen replay después
de coordinar la raíz, propiedad útil que debe preservarse.

**Riesgo y condiciones.** Una llamada autenticada sin membresía puede esperar/bloquear
la raíz antes de ser rechazada. Reordenar sólo a una autorización temprana dejaría
una carrera de revocación. Un escritor de mantenimiento hijo→raíz puede formar un
ciclo con las funciones raíz→hijo. No se afirma un deadlock demostrado en esta fase.

**Corrección mínima.** Preautorizar sin locks; adquirir raíz exclusiva; reautorizar
con estado actual después de la espera; luego objetivo/replay/efectos. Aplicar a
gestión, renovación y revocación. Aceptación de invitación requiere un preflight
específico por token/identidad, no membresía activa que todavía no existe. Sólo un
token vigente y la identidad elegible justifican coordinar; repetir guards bajo lock.

Usar coordinadores VOLATILE y consultas separadas posteriores al lock bajo READ
COMMITTED; no suponer que un helper STABLE llamado dentro del mismo snapshot ofrece
relectura fresca. Rechazar o rediseñar otro aislamiento antes de adoptarlo. Ninguna
red/servicio externo dentro del lock. Mantenimiento debe tomar raíz antes de tocar
miembros; un trigger no puede deshacer el orden de locks ya adquirido por el UPDATE.

**Compatibilidad.** Conserva firmas y serialización exclusiva S2. No introducir
advisory locks paralelos ni insertar el registro idempotente antes de la raíz.
El protocolo completo futuro está en [Paquete B](S3_A_DECISION_PROPOSAL.md#p-03--coordinación-y-orden-global).

**Migración.** Sí, reemplazos de cuerpos en migración adicional, nunca editar M4/M5.

**Regresión.** A-02: dos conexiones y barreras; usuario sin permiso no espera raíz
ocupada; revocación entre preflight y lock impide escribir; dos owners que intentan
quitarse mutuamente no dejan cero owners; orden raíz→miembro para mantenimiento;
aceptación/renovación/revocación concurrentes dejan un estado válido. Medir esperas y
abortos. Mocks o una única transacción pgTAP no demuestran ausencia de carreras.

**Riesgo de cambio.** Snapshot, locks implícitos FK y lectores de replay; no cambiar
modos de lock ni reglas del último owner por optimización incidental.

## C-03 — request_id de extremo a extremo

**Evidencia.** http.ts:19 genera UUID por request y lo devuelve; no lo propaga al RPC.
M4:188–190,246–248 y M5:32–34 escriben `p_key` como `audit_logs.request_id`.
La columna es UUID (M4:19). Correlación de intento e idempotencia están confundidas.

**Riesgo y condiciones.** Ante errores/replays no se puede relacionar inequívocamente
la petición HTTP con el registro original. No es un bypass de autorización.

**Corrección mínima.** Aceptar X-Request-Id sólo si es UUID válido; si falta/no es
válido generar uno y devolverlo. En Server Actions generar un UUID del lado servidor.
Propagarlo por header del cliente SSR **por request**, nunca estado global. Helper
privado SQL lee `request.headers`, valida UUID y genera fallback si no hay header;
los INSERT de auditoría usan ese valor. No cambiar firmas RPC ni abrir overloads.
Es metadata no confiable para autorización; IDs duplicados no conceden acceso.

Agregar `origin_request_id` nullable al registro privado de replay para nuevas
operaciones. Un replay B tiene request_id B, referencia al registro original A y no
genera otra auditoría de mutación. No guardar cuerpos ni tokens en logs. Request_id
no integra el hash de intención. Filas viejas quedan sin correlación confiable;
no reescribir auditoría histórica ni inventar IDs retrospectivos.

**Compatibilidad.** Sin cambios a cuerpo de éxito, ETag, scope/key o UUID de auditoría.
El header de entrada pasa a ser respetado cuando es válido. Replay conserva resultado.

**Migración.** Sí: columna nullable, helper privado y reemplazos de cuerpos de auditoría.

**Regresión.** A-03: HTTP A coincide con audit A; replay B no duplica efectos, conserva
referencia A y responde B; acción sin HTTP explícito tiene traza; header inválido/ausente
genera UUID; dos requests simultáneos no comparten estado de cliente; secreto no aparece
en logs. Compatibilidad con filas anteriores de `origin_request_id` nulo.

**Riesgo de cambio.** Interpretación de métricas históricas y confianza indebida en
header suministrado por cliente; documentar legado sin migrar su contenido.

## C-04 — Paginación de miembros

**Evidencia.** M4:121–132 hace `jsonb_agg` de todo el tenant ordenado por
`created_at,id`. service.ts:42–45 espera un array completo. http.ts:44–45 devuelve
siempre `next_cursor:null, has_more:false`. actions.ts:205 usa ese listado para enviar.

**Riesgo y condiciones.** Equipos grandes consumen memoria/tiempo sin límite; truncar
la llamada silenciosamente rompería acciones dirigidas a miembros fuera de página.

**Corrección mínima.** Nuevo RPC distinto `api.list_members_page`, keyset ascendente
`created_at,id`, default 50, máximo 200 y lectura de limit+1. Índice compuesto por
negocio/created_at/id. Cursor acotado base64url con versión de formato, negocio y
última tupla; validar estructura y pertenencia. Cursor no firmado es sólo un selector
no confiable: jamás acredita tenant, rol ni permiso; cada página reautoriza.

GET actual sin parámetros y RPC de un argumento conservan resultado completo por
compatibilidad, con deprecación documentada para una decisión posterior. Paginación
opt-in `?limit=50&cursor=...`, mismo envelope `data,page`. UI migra al opt-in con
navegación y estados claros. Corregir C-07 primero; no buscar objetivos en una página.
Cada miembro conserva su campo version para construir el If-Match de su edición;
un cursor o ETag de página no reemplaza la versión individual. No inventar una
versión global de lista ni otro endpoint de lectura sólo para cerrar este hallazgo.

**Compatibilidad.** No truncar el modo legado ni cambiar la firma existente. El riesgo
de tamaño legado continúa hasta aprobar su retiro; no declarar resuelto ese límite
para consumidores que sigan usando el modo completo. No prometer snapshot global
ante altas/cambios concurrentes.

**Migración.** Sí: índice y nuevo RPC; sin agregar campos de negocio a la proyección.

**Regresión.** A-04: más de 200 miembros, empates de created_at, última página vacía,
límites inválidos, cursor truncado/otro tenant, revocación entre páginas. Sin cambios
concurrentes recorrer cada miembro una sola vez; con cambios, orden estable sin
garantía de snapshot. GET/RPC legado y envío a miembro fuera de primera página siguen
funcionando. UI no oculta errores de permiso como página vacía.

**Riesgo de cambio.** Dependencias de listas completas, UX y dos modos temporales;
no cambiar DTOs de acciones ni nuevas claves/secretos para firmar un cursor innecesario.

## C-06 — Retención y purga de idempotencia

**Evidencia.** M4:32–41 define `app.member_requests`, created_at y PK
`(business_id,user_id,operation,key)`; M4:161/229 y M5:16 consultan sin TTL. No hay
proceso de purga en las cinco migraciones ni índice temporal dedicado.

**Riesgo y condiciones.** Crecimiento indefinido y replay más allá de la ventana
documentada; borrar sin coordinar puede cambiar semántica de reintentos en vuelo.

**Corrección mínima.** Aprobar ventana de 48 h desde `created_at` del registro exitoso
(timestamp servidor transaccional, no del cliente ni una promesa de 48 h exactas desde
commit). Definir expiración lógica en lectura, incluso si la purga física se demora.
Conservar la PK y hash existentes. Tras vencer no se garantiza replay: cualquier
solicitud debe autorizar y satisfacer versiones/unicidad actuales como operación
nueva; clientes deben usar nueva key y refrescar estado, nunca reintentar efectos a ciegas.

Agregar índice por created_at y función de mantenimiento privada con lotes máximos
de 500, filas vencidas y `SKIP LOCKED`. Escritores bloquean el registro de replay
que usan antes de actuar; purgador sólo bloquea replay y **nunca espera luego la raíz**.
MVCC impide purgar filas aún no confirmadas. No borrar auditoría, invitaciones ni
usuarios. No otorgar la purga a authenticated/app_server. Programador operativo
queda para el sprint de jobs; no instalar pg_cron ni abrir privilegios por esta fase.

**Compatibilidad.** Dentro de 48 h preserva replay exacto autorizado. Fuera de la
ventana cambia deliberadamente el comportamiento perpetuo actual. Old expected
continúa fallando con 412 o reglas de dominio; no ejecutar dos veces por omitir TTL
o por usar la key como autoridad. Aprobación de política de retención obligatoria.

**Migración.** Sí: índice, función privada y guards de TTL/lock en los lectores;
sin eliminar datos durante implementación de esquema ni backfill destructivo.

**Regresión.** A-06: límites antes/en/después de 48 h con reloj controlado; purga
demorada respeta expiración lógica; replay concurrente mantiene el registro bloqueado;
purgador salta filas ocupadas y termina por lote; fallo intermedio revierte el lote;
actor revocado no obtiene resultados; key ajena no revela nada; auditoría intacta.

**Riesgo de cambio.** Clientes offline, semántica de aceptar invitaciones ya consumidas
y retención de datos personales en resultados. Revisar esas operaciones una por una;
no aplicar un DELETE masivo ni una política genérica a futuros tokens/outbox.

## Aceptación y secuencia del paquete

1. Aprobar explícitamente las excepciones de compatibilidad y límites A-07/A-06.
2. C-05 es la unidad de menor complejidad; C-08 es la urgencia de seguridad y no debe
   esperar al catálogo ni a S3. Implementarlas como unidades independientes revisables.
3. C-01/C-02 y guard específico C-07 forman una unidad de autorización; revisar SQL,
   HTTP y acciones juntos. C-03 se aplica luego sobre todos sus caminos de auditoría.
4. C-04 depende de desacoplar C-07 del listado; C-06 requiere probar todos los lectores
   de replay ya consolidados. No adoptar el resto de S3 para cerrar estos hallazgos.
5. Durante una implementación autorizada, ejecutar lint, format, typecheck, unitarios,
   build, E2E y regresión S1/S2; SQL/HTTP/concurrencia sólo contra entorno de fixtures
   aislado y autorizado, sin reset ni alteración del propietario local. Registrar
   comandos, resultados reales, duración y limitaciones; nunca convertir una prueba
   propuesta en resultado aprobado.

Aceptación global: cinco migraciones originales byte a byte iguales, grants sin
escalada, ninguna lectura privada por barbero, ningún envío fuera de matriz, cada
efecto y replay atómico, contratos preservados salvo excepciones aprobadas, y tests
A-01…A-08 demostrados. Los cambios futuros se detallan en
[S3_B_MIGRATION_PLAN.md](S3_B_MIGRATION_PLAN.md); su inclusión allí no autoriza ejecutarlos.
