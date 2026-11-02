# S2 — A-M06: retención y purga de idempotencia

Fecha: 2026-11-01. **C-06 implementado y validado exclusivamente en entorno descartable.**
No aplicado al propietario. No se inició S3 ni se instaló scheduler.

## Preparación e inventario

Se revisaron AGENTS, S2_AM03_REPORT, S2_AM04_AM05_REPORT, el plan de compatibilidad
y las diez migraciones existentes. Antes de modificar se capturaron hashes de 164
archivos anteriores no ignorados/no secretos. Las diez migraciones se preservan;
el harness ahora comprueba también los hashes A-M04/A-M05 antes de iniciar Docker.

Comparación final: tres archivos previos modificados y cinco nuevos listados abajo;
los otros 161 archivos anteriores permanecen intactos, incluidas las diez migraciones.
SHA-256 de la migración nueva:
`48d6d5a5a523a094bf2f8fc3e457065495a49146f752068151af44e0f1a2cfd0`.

Preflight ejecutado: **228 pgTAP + 17 escenarios independientes + Auth/PostgREST y
regresión HTTP S2**, correctos. Los informes anteriores distinguen implementación
descartable de aplicación al propietario; esta fase no consulta su historial de DB.

Inventario de runtime actual, resuelto por las definiciones finales A-M03/A-M04:

| Entrada                         | Coordinador lector/escritor | Operación en member_requests | Protección contra efecto antiguo repetido                                   |
| ------------------------------- | --------------------------- | ---------------------------- | --------------------------------------------------------------------------- |
| api.invite_member               | app.manage_member           | invite                       | Unicidad lógica de email/membresía en todos los estados del negocio         |
| api.update_member               | app.manage_member           | update                       | Versión esperada y guardas actuales de actor/objetivo                       |
| api.manage_invitation con token | api.manage_invitation       | renew_invitation             | Versión de miembro, estado no vinculado y rol vigente                       |
| api.manage_invitation sin token | api.manage_invitation       | revoke_invitation            | Versión de miembro, estado no vinculado y rol vigente                       |
| api.accept_invitation           | api.accept_invitation       | accept                       | Token/identidad/email/MFA/negocio vigentes, accepted_by y estado de consumo |

No hay otros lectores/escritores de negocio de member_requests en src. Envío Auth
usa prepare_member_auth_invite y no guarda replay; listados/paginación tampoco.
Fixtures/scripts de prueba acceden a la tabla sólo en DB descartable. Las referencias
de migraciones anteriores son historia, no entradas adicionales activas.

## Archivos

| Archivo                                                          | Cambio                                                                                                                      |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| supabase/migrations/20261101000800_expire_membership_replays.sql | Nueva: índice created_at, helper privado de reconocimiento, purgador privado y reemplazos controlados de tres coordinadores |
| supabase/tests/am06.test.sql                                     | Nuevo: 46 checks de ventana, PK reutilizada, guardas, permisos, lotes y fallo con rollback                                  |
| scripts/lib/am06-concurrency.mjs                                 | Nuevo: seis escenarios de locks/fallo con conexiones independientes                                                         |
| scripts/lib/am06-integration.mjs                                 | Nuevo: contratos HTTP dentro/fuera de ventana, revocación y conservación de datos                                           |
| scripts/test-s2-security-isolated.mjs                            | Agrega dos hashes inmutables, suite concurrente y HTTP C-06                                                                 |
| supabase/function-catalog.md                                     | Contratos, grants y operación de las funciones nuevas                                                                       |
| docs/CHANGELOG.md y este informe                                 | Registro de alcance y resultados                                                                                            |

No se modifica TypeScript, UI, stack, dependencias, configuración Supabase o las
migraciones anteriores. La comparación mecánica de los tres cuerpos respecto de
A-M04 confirmó que sólo cambian la lectura de replay y el timestamp privado de inserción.

## Ventana y expiración lógica

Registro reconocible si **created_at > reloj_servidor − 48 horas**. A igualdad o
mayor antigüedad está vencido. No es una ventana deslizante: replay no modifica
created_at ni origin_request_id. Los timestamps existentes no se reescriben.
Las nuevas escrituras establecen created_at con clock_timestamp al insertar el
resultado exitoso, evitando anclar la retención a una transacción iniciada mucho
antes de ejecutar la operación. La política se mide desde ese valor, no desde el
cliente ni como promesa de 48 h exactas desde commit.

Punto de reconocimiento: después de coordinar raíz y adquirir el lock de la fila de
replay, usando clock_timestamp. No se usa now() de una transacción antigua ni se
decide antes de esperar el lock. Un intento reconocido dentro de ventana puede
terminar/entregarse después del límite: el punto de decisión es el lookup bloqueado,
no el instante en que el cliente recibe la respuesta.

app.lock_member_request es invoker privado. Busca por negocio + auth.uid + operación

- key, toma FOR UPDATE y devuelve el registro sólo si sigue vigente. Si venció,
  elimina exclusivamente esa PK bloqueada y devuelve NULL. Esto evita que un registro
  físico viejo provoque una falsa colisión de unicidad al escribir un comando nuevo.
  La limpieza oportunista forma parte de la transacción de negocio: si la versión,
  estado o permiso falla después, también se revierte ese DELETE. Aunque la fila
  continúe físicamente, la siguiente lectura vuelve a considerarla vencida.

No se usa el hash, resultado, UUID, actor ni versión de una key vencida para
autorizar. El request completo debe satisfacer los guards actuales. Dentro de la
ventana se preserva replay exacto autorizado y 409 por intención/expected distintos;
la expiración no depende de ejecutar el purgador ni de su disponibilidad.

## Comportamiento después del vencimiento

| Solicitud                                                               | Resultado comprobado antes y después de purga                                                                 |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Update antiguo con expected anterior                                    | 412 PRECONDITION_FAILED; no vuelve a mutar                                                                    |
| Renew/revoke antiguo con expected anterior                              | 412 mientras el objetivo siga no vinculado; estado consumido también rechaza por guard vigente                |
| Invite antiguo del mismo email                                          | 409 DUPLICATE_RESOURCE; no crea otro miembro/invitación                                                       |
| Accept ya consumido                                                     | 404 NOT_FOUND; no activa de nuevo ni duplica auditoría                                                        |
| Request nuevo sin expected                                              | 428 PRECONDITION_REQUIRED después de autorización; no 409 por un replay vencido                               |
| Actor revocado/tenant ajeno                                             | 403/404 según guard vigente, sin acceso al resultado antiguo                                                  |
| Request deliberadamente nuevo con versión actual e intención autorizada | Puede ejecutarse como operación nueva y registrar nuevo created_at/origin; no hay garantía de replay perpetuo |

No se detectó una repetición insegura en las cinco operaciones S2, por lo que no fue
necesario bloquear una unidad. La prueba distingue replay de un comando nuevo: una
key vieja nunca sustituye permisos/versiones. Clientes deben refrescar el estado y
usar una key nueva para una nueva intención; no reintentar a ciegas tras 48 h.
Esto no promete exactamente una vez a perpetuidad ni cubre DML de mantenimiento
que borre/recree identidades de recursos o futuras operaciones sin guard equivalente.

La vigencia de la invitación sigue siendo independiente. Purgar el replay de invite
no borra su token hash/accepted_by ni impide aceptar por primera vez una invitación
todavía válida. Tampoco permite reutilizar una ya consumida/revocada/vencida.

## Purga privada y permisos

app.purge_member_requests(p_batch_size integer default 500) devuelve cantidad borrada.
Acepta 1…500; NULL/0/>500 producen PT400 VALIDATION_ERROR. Captura un cutoff por
llamada, elige registros vencidos ordenados por created_at/PK con FOR UPDATE SKIP
LOCKED y borra como máximo ese lote. El índice created_at sirve al barrido.

Modo invoker, owner postgres, search_path vacío, sin elevación de privilegios.
PUBLIC, anon, authenticated, app_server y service_role no reciben EXECUTE; tampoco
reciben DML ni lectura del ledger. No hay RPC API/endpoint de purga. Por defecto
sólo el owner SQL/administración de plataforma ya privilegiada puede ejecutarlo.

Mantenimiento es global sobre esta tabla privada de membresías, no una operación
de owner/admin de negocio. Aislamiento de aplicación permanece por tenant/actor;
ninguna key, JWT de miembro o business_id habilita mantenimiento global. No se crea
rol worker ni se amplían permisos de app_server/service_role para facilitarlo.

El purgador sólo toca member_requests. No elimina audit_logs, member_invitations,
users, business_members, sesiones o factores MFA. No se ejecuta purga de datos como
parte de la migración: DDL/definiciones solamente. El DELETE posterior es explícito
de mantenimiento o limpieza de la PK vencida en una transacción autorizada.

## Coordinación y concurrencia

Escritores: preautorización → raíz FOR UPDATE → reautorización fresca → helper
replay FOR UPDATE → miembro → invitación → efectos/audit/origen atómicos. Mantienen
READ COMMITTED y todas las guardas C-01/C-02/C-07. El guard último owner no cambia.

Purgador: sólo filas de replay, nunca raíz/miembros después. SKIP LOCKED salta filas
retenidas por escritores/replays o por otro purgador. Si purga llega primero, un
escritor de la misma key puede esperar su commit y luego debe validar versión/estado
como request nuevo; no existe espera inversa raíz←purgador que cierre un ciclo.
Los DELETE de esta tabla hija no introducen un lock de raíz por una FK entrante.

Seis escenarios nuevos, con procesos psql/backends distintos y barreras verificadas
mediante pg_stat_activity/markers:

1. Replay reconocido antes del límite mantiene su lock durante el vencimiento:
   purgador lo salta sin esperar y lo elimina recién después de commit.
2. Purga retenida sin commit primero; escritor antiguo espera y termina en 412.
3. Misma carrera, pero con versión vigente: escritor confirma una operación nueva
   una vez, sin conflicto de PK y con created_at nuevo.
4. Espera de raíz cruza las 48 h: lookup posterior rechaza replay antiguo con 412.
5. Dos purgadores mantienen lotes 300+300 sin commit inicial: conjuntos disjuntos,
   sin duplicados y sin borrar una fila reciente.
6. Fallo inyectado sólo en test detiene al purgador con una barrera advisory antes de
   lanzar P0001. Una escritura independiente del mismo negocio confirma mientras
   ese purgador está bloqueado; el fallo conserva su ledger/audit/invitación.

El advisory existe sólo en el trigger de fallo del harness, se elimina después y
no forma parte del protocolo de producción. pgTAP también provoca fallo en el segundo
DELETE del lote para comprobar rollback de una eliminación parcial real. No se
cuenta un timeout/deadlock como validación exitosa de permiso o atomicidad.

## Pruebas y resultados reales

Comando principal: `node scripts/test-s2-security-isolated.mjs`.
No carga .env ni accede a contenedores/volúmenes/red del propietario. Usa PostgreSQL,
Auth y PostgREST nuevos, credenciales sintéticas en memoria y cuentas example.test.

| Validación                   | Resultado                                                                                                                                            |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preflight previo a cambios   | PASS: 228 pgTAP, 17 escenarios independientes y regresión HTTP/Auth S2                                                                               |
| Harness final                | PASS completo                                                                                                                                        |
| SQL/pgTAP                    | **274**: 31 AM03 + 41 AM04/05 + 46 AM06 + 45 Auth + 42 privacidad/errores + 69 tenancy                                                               |
| Conexiones independientes    | **23** escenarios: 17 anteriores conservados + seis C-06                                                                                             |
| HTTP C-06 real               | PASS: ventana, 409, 412/428 tras vencer, mismo resultado antes/después de purga, versión nueva autorizada, revocación y no duplicación invite/accept |
| Preservación                 | Audit e invitaciones conservadas; aceptación válida después de purgar invite y consumo rechazado después de purgar accept                            |
| Fallo de purga               | PASS: rollback parcial y escritura independiente no bloqueada por raíz                                                                               |
| Regresión S1/S2              | PASS: Auth/contraseña/TOTP, roles, selector, privado/público, paginación, request_id, replay, LAST_OWNER HTTP409 y rollback                          |
| npm run lint                 | Correcto                                                                                                                                             |
| npm run typecheck            | Correcto                                                                                                                                             |
| npm run test                 | **109** tests en 11 archivos, correctos; no se agregaron tests TS que dupliquen el SQL                                                               |
| npm run build                | Correcto, fuera del sandbox por el EPERM de .next previamente comprobado; rutas de datos dinámicas sin queries al propietario                        |
| npm run format:check         | Falla sólo por los 15 documentos preexistentes de arquitectura-v1.1, preservados                                                                     |
| Formato acotado / diff check | Correctos                                                                                                                                            |
| Limpieza                     | Contenedores, volúmenes y red descartables eliminados; sin recursos merivo-s2-check restantes                                                        |

No se ejecutaron E2E originales del propietario. No cambió UI/TypeScript; la suite
de navegador descartable AM04/05 sigue disponible con --ui, pero no se repitió en
esta fase sin cambios de UI. Los resultados de navegador del informe anterior no
se presentan como ejecución nueva. No se detectaron regresiones en la cobertura actual.

## Restricciones operativas y pendientes

- No hay scheduler: vencimiento lógico funciona siempre, borrado físico requiere
  mantenimiento autorizado. Una fila que falla al reintentar puede permanecer hasta
  esa purga porque la limpieza oportunista se revierte con el error de negocio.
- Una llamada por transacción corta, commit entre lotes, sin I/O externo ni adquirir
  raíz después. No ejecutar un loop de lotes en una transacción larga ni mantener
  locks durante interacción humana. Registrar sólo fecha/conteo/resultado, no datos.
- Cero borradas puede indicar filas vencidas bloqueadas, no tabla totalmente limpia.
  Reintentar en otra corrida autorizada; no girar indefinidamente sobre locks.
- Un fallo deja el lote sin aplicar y no invalida operaciones de membresías; investigar
  permisos/locks antes de ampliar privilegios. No compensar borrando auditoría,
  invitaciones o reseteando bases/cuentas.
- Retención no garantiza reclamación inmediata de espacio físico; se conserva el
  mantenimiento normal de PostgreSQL. No se ejecuta VACUUM FULL ni se añade cron.
- Ventana de replay y auditoría son distintas: auditoría permanece; tras purga se
  pierde el vínculo privado key→origin del ledger. No se crea tombstone perpetuo.
- Nuevas operaciones sensibles sobre este ledger deberán demostrar guardas equivalentes
  antes de adoptar esta política; no extender la purga a outbox/tokens/invitaciones.
- Migración validada sólo en descartable. Aplicación al propietario o remoto requiere
  otra autorización y verificación del orden de migraciones pendientes. No se ejecutó
  db/CLI/query en su instancia ni se modificaron cuentas, contraseñas o MFA existentes.

Estado final: **C-06 completo en implementación y validación aislada**, sin bloqueo
detectado para las operaciones S2 existentes. Esto no aplica cambios al propietario,
no declara cerrado todo el DoD del MVP y no autoriza avanzar a S3.
