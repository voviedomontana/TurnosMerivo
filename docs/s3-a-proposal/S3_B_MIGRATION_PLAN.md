# Plan condicionado de migraciones S3-B y correcciones S2

Fecha: 2026-11-01. **Plan solamente: ningún archivo SQL creado y ninguna migración
ejecutada.** No se consultó DB. Los IDs A-M/B-M de este documento son unidades de
revisión, no nombres ni timestamps de migraciones definitivas.

El paquete A es mantenimiento compatible de S2 y se aprueba por separado de S3-B.
El paquete B es diseño; sus migraciones sólo se habilitan después de aceptar sus
[decisiones](S3_A_APPROVAL_MATRIX.md) y autorizar expresamente implementar S3-B.
No se exige esperar ocupación/EXCLUDE para corregir permisos de S2.

## Base inmutable

Las cinco migraciones existentes se preservan byte a byte. SHA-256 capturado del
árbol local al comenzar esta fase documental:

| Archivo en supabase/migrations                      | SHA-256                                                            |
| --------------------------------------------------- | ------------------------------------------------------------------ |
| 20261031231242_init_tenancy.sql                     | `82cdc1ec871e1f4be005e97ad4f1651c3a2b6626f21b44a5b8ab3fc4ba8e48a2` |
| 20261031231400_allow_maintenance_server_role.sql    | `90ad4dbf1b05b01a8eb2a890ba64fc81fa51609c0fdc03ec0a443711e1da2fe6` |
| 20261031232111_restrict_future_function_execute.sql | `f0044e46afe66865e5c806296c6f47636d0601797a997c888bd884b78f1276f1` |
| 20261101000100_auth_memberships.sql                 | `f8534225fba134cf5a5d88e0bec65f555d10b446b21ab54f6db92701a76f74ec` |
| 20261101000200_invitation_lifecycle.sql             | `147292d9b1a93bf3ce56735ed2f029a4c8b877521e44faa0b85b02e1279119ed` |

Se reconoce el estado aplicado informado por los reportes; esta tarea no intenta
certificar el historial remoto/local consultando la base. No recrear ni editar estas
migraciones, no reset, no nuevo seed de propietario ni cambios de MFA.

## A — Unidades independientes de decisiones S3

Todas requieren autorización del paquete A; «independiente» significa que no dependen
de P-02/P-03/P-06 de reservas, no que puedan ejecutarse sin aprobación.

| Unidad propuesta       | Objetos/efectos mínimos                                                                                                                    | Dependencias                                                                     | Verificación específica                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| A-M01 / C-05           | Reemplazar cuerpo protect_last_owner con código específico; adaptar traducción TS                                                          | A-05; preservar guard y trigger                                                  | LAST_OWNER real 409, otros CHECK no; SQLSTATE nuevo aceptado                                     |
| A-M02 / C-08           | Revocar SELECT de authenticated sobre businesses/settings; RPC privado fijo con owner/admin aal2 y grants precisos                         | A-08, inventario de consumidores; no requiere catálogo/permisos canónicos nuevos | Matriz de columnas/roles/tenants, selector y público intactos                                    |
| A-M03 / C-01/C-02/C-07 | Reemplazar cuerpos de gestión/aceptación/lifecycle: preflight, revalidación, prioridad de precondiciones; nuevo prepare_member_auth_invite | A-01/A-02/A-07; revisar familia completa y mantenimiento                         | Carreras con roles/tokens y último owner; ninguna red bajo lock; guard de destinatario en acción |
| A-M04 / C-03           | Helper privado de trace header, origin_request_id nullable en replay, reemplazar INSERT audit de todas las familias                        | A-03; basarse en cuerpos A-M03 para no pisar sus cambios                         | Correlación por intento y replay; legado NULL; grants/helper cerrados                            |
| A-M05 / C-04           | Índice tenant/created_at/id, RPC list_members_page distinto; TS/UI/query opt-in                                                            | A-04; C-07 ya no busca en listado                                                | Legacy GET/RPC completo, paginación y envío fuera de página                                      |
| A-M06 / C-06           | Índice temporal, purgador privado por lote y TTL/locks de replay en cada escritor                                                          | A-06, A-M03/M04 consolidados; sin scheduler ni borrado en la migración           | Frontera 48 h, purga/replay concurrentes, sin borrar auditoría                                   |

A-M01 y A-M02 son independientes entre sí; C-08 tiene prioridad de seguridad.
A-M03 debe revisarse como una unidad coherente SQL/HTTP/acciones; dividir commits de
trabajo en el futuro no autoriza desplegar sólo la mitad del contrato. A-M04/M06
reemplazan algunos mismos cuerpos: secuenciarlas y revisar diffs acumulados para no
reintroducir guards antiguos. A-M05 puede avanzar sin M06, después de desacoplar envíos.

## B — Independientes de ocupación/EXCLUDE, condicionadas a sus contratos

No comenzar estas unidades ahora. Una vez aprobadas las filas concretas y autorizado
S3-B, permiten progresar sin resolver el predicado de ocupación.

| Unidad propuesta | Superficie                                                                                                    | Aprobaciones mínimas                                                     | Dependencias/riesgos                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| B-M01            | Registro finito de acciones/guards y proyección canónica, si se decide persistir seed SQL                     | B-PERM y paridad S2; A-08 antes de ampliar lecturas                      | No crear una segunda autoridad; no otorgar comandos sin implementación; JSON/TS son artefactos, no migraciones |
| B-M02            | Staff, services y asociación; claves compuestas, límites/índices, versionado, baja lógica, RLS y proyecciones | B-CAT, B-CAT-S, B-REL, B-PERM, B-06V; B-03 antes de habilitar escritores | Sin reservas, sin EXCLUDE ni cuenta Auth obligatoria; mantener carpeta y naming actual                         |
| B-M03            | Clientes base: normalización, unicidad por tenant, consentimientos, proyección y RLS                          | B-CLI, B-REL, B-PERM, B-06V                                              | Sin merge, alias ni mapeos; escrituras posteriores exigen B-03/B-06I                                           |

Aunque un CREATE TABLE pudiera ejecutarse deny-all sin writers, no crear tablas
definitivas con restricciones de producto ambiguas. «Independiente» no permite elegir
un rango de duración, unicidad de teléfono o modelo de permisos sin aceptar su fila.
No es obligatorio adelantar catálogo a SQL hasta autorizar S3-B.

## B — Bloqueadas por decisiones pendientes de agenda/seguridad

| Unidad propuesta | Qué contendría                                                                               | Bloqueo preciso                                                                 | Condición de desbloqueo                                                                                                                 |
| ---------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| B-M04            | Campos nuevos de política/defaults en business_settings                                      | B-02D y defaults de producto no aceptados                                       | Tabla completa de tipos/rangos/defaults, tratamiento de negocios existentes y permisos; no sobrescribir settings actuales               |
| B-M05            | Control global de agenda, horarios/excepciones/bloqueos con versiones padre                  | B-03/B-06V y relaciones/permisos                                                | Recurso global y modo de lock por escritor aprobados, pruebas con S2 y catálogo concurrentes                                            |
| B-M06            | Reservas, intervalos/snapshots, estado y representación de ocupación                         | P-02 A sigue provisional; B-02R/C/D; falta elección física y EXCLUDE; P-03/P-06 | Aprobar geometría, modelo físico, predicado específico y matriz de verdad; concurrencia/rollback demostrados antes de habilitar writers |
| B-M07            | Replays de nuevos comandos, sobres cifrados, capacidades de intento, eventos/outbox privados | B-06I/T/E/A, recurso appointment y custodia de claves                           | Protocolo de autoridad anónima/replay, TTL, revocación, rotación, recuperación y AAD cerrados; ningún secreto plano                     |

M06/M07 pueden necesitar una única migración transaccional de tablas relacionadas
o etapas deny-all con habilitación final conjunta. Decidir división al revisar DDL;
no publicar una función creadora de reservas sin evento/outbox/replay atómicos.
No adelantar EXCLUDE con el predicado V11 para «completar tablas» y corregirlo después.

## Objetos diferidos fuera de S3-B propuesto

- Credenciales, links/mappings e importación: P-04/S10; no almacenar secretos ni
  sembrar service keys. Cliente base y claves compuestas no aprueban merge.
- Feed/change cursor xid8: no necesario para MVP; barridos completos y reconciliación
  siguen vigentes. No crear feed por timestamp/secuencia como sustituto.
- Workers/scheduler operativo: sprint de jobs. Diseñar outbox no instala cron ni
  autoriza envío real; no reutilizar Auth email como correo de reservas.
- Escrituras GAS: bloqueadas P-08; no modificar Apps Script ni introducir actor
  afirmado por headers, UserProperties o una key compartida de lectura.
- Pagos, suscripciones y soporte temporal no se añaden por el plan de continuidad.

## Estrategia de implementación futura, no ejecutada

1. Registrar filas aprobadas y unidades exactas; crear sólo migraciones posteriores
   a las cinco existentes. Releer estado real para no sobrescribir trabajo paralelo.
2. En entorno de fixtures aislado autorizado, reproducir secuencia histórica y añadir
   unidad nueva; contrastar schema/grants/default privileges/FKs. No resetear el
   entorno usado por el propietario ni tocar su cuenta/factores.
3. Revisar SECURITY DEFINER: owner, search_path, calificación, grants/revokes PUBLIC
   globales existentes, default privileges y lista de helpers RLS. No confiar en FORCE
   para proteger un acceso que hace bypass por owner. Nuevas tablas deny-all antes de
   habilitar entradas explícitas; app_server sin tablas, service_role fuera de negocio.
4. Revisar compatibilidad de PostgREST/schema cache y firmas; nuevas funciones con
   nombre distinto cuando cambia retorno. No crear overload ambiguo con args default.
   Definir despliegue expand→app compatible→retirar legado sólo con otra autorización.
5. Ejecutar pruebas específicas por unidad, regresión S1/S2, pgTAP/HTTP y concurrencia
   independiente donde corresponda. Después lint, format, typecheck, unitarios,
   build y E2E. Registrar resultados y limitaciones del entorno; no heredar cifras
   de un reporte anterior como validación del nuevo esquema.
6. Revisar diff de tipos generados y handlers para no introducir `any`, dependencias,
   rutas nuevas o rol privilegiado por facilidad. Generar tipos es tarea de código
   de la implementación aprobada, no una migración adicional aquí.
7. Aceptar la unidad con sus evidencias; despliegue, commit y push requieren su
   autorización propia. No pasar automáticamente al siguiente paquete/sprint.

## Concurrencia y compatibilidad como gates

Antes de habilitar writers B, demostrar que la raíz se toma **antes** de DML/FKs,
que no se escala SHARE→UPDATE y que S2 toma la misma coordinación. Probar índices
únicos de teléfono, FKs de replay y triggers, no sólo locks escritos explícitamente.
Si un writer antiguo/operación de mantenimiento toma hijo→raíz, bloquear su uso o
adaptarlo antes de coexistir; no declarar el sistema seguro por un helper nuevo.

No renombrar PRECONDITION_FAILED ni convertir UUID audit a bigint. No cambiar
`api.me` para exigir MFA antes de permitir que el usuario complete el enrolamiento.
No reemplazar membresías/usuarios actuales por el modelo de clientes de reservas.
Las cuentas/MFA y el diseño visual Merivo permanecen fuera de estas migraciones.

## Fallos, rollback y datos existentes

- Cada unidad de esquema se diseña transaccionalmente cuando PostgreSQL lo permita;
  si un índice necesitara ejecución concurrente se revisa esa excepción antes, sin
  afirmar atomicidad del lote completo. Volumen y timeouts se miden en fixtures.
- Preferir corrección hacia adelante. Revertir app no debe abrir SELECT privado,
  reinstalar un envío sin techo de rol ni perder reautorización. Para C-08 mantener
  denegación y arreglar consumidor; una falla de UI no justifica reexponer datos.
- No DROP/CASCADE, reescrituras de PK, cambio de hashes/token, borrado de auditoría
  o datos de propietario. No borrar filas de replay como parte de DDL de retención.
- Nuevos campos sobre tablas existentes: nullable/default compatible y backfill
  sólo cuando haga falta y esté aprobado. No rellenar request_id histórico ficticio.
- Cifrado: no desplegar escrituras si falta clave privada válida; no crear tokens
  inseguros de fallback. Restauración necesita keyring externo conservado, no secretos
  guardados en una migración o backup de configuración dentro de Git.

## Checklist exacto de comienzo

- [ ] Aprobar por ID el subconjunto del paquete A y sus excepciones de compatibilidad.
- [ ] Para S3-A, registrar elección/condiciones de cada fila B relevante; P-02 sigue
      provisional hasta confirmar transiciones y geometría, EXCLUDE en gate aparte.
- [ ] Para S3-B, obtener autorización posterior con unidades B-M exactas; no inferirla
      de un «documento aprobado» ni de aprobaciones históricas S1/S2.
- [ ] Confirmar hashes de las cinco migraciones y snapshot de trabajo previo intactos.
- [ ] Inventariar consumidores Table API/SQL, RPCs y mantenimiento afectados por A.
- [ ] Cerrar autorización+precondición+replay y root-first antes de nuevos escritores.
- [ ] Cerrar catálogo/clientes/matriz y FKs compuestas antes de sus tablas definitivas.
- [ ] Cerrar recurso global/versiones, P-02 físico y P-06 capacidades/cifrado antes de
      agenda, reservas y gestión pública; no aprobar EXCLUDE por omisión.
- [ ] Acordar entorno de fixtures y pruebas de dos conexiones sin usar cuenta real/MFA.
- [ ] Revisar migración adicional, grants y plan de fallo antes de cualquier aplicación.

El paquete A puede comenzar antes con menor riesgo. Este plan no inicia ninguna
unidad: se entrega para aprobación y se detiene aquí.
