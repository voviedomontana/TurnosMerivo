# Matriz de aprobación — paquetes A y B

Fecha: 2026-11-01. Estado de todas las filas nuevas: **pendiente**, salvo invariantes
ya autorizadas que se identifican expresamente. Este documento no es un acta de
aprobación. Autorizar propuestas no autoriza implementación, migraciones ni S3-B.

Contratos: [Paquete A](S2_COMPATIBILITY_FIX_PLAN.md),
[Paquete B](S3_A_DECISION_PROPOSAL.md),
[secuencia técnica](S3_B_MIGRATION_PLAN.md).

## Paquete A — autorización granular de correcciones S2

| ID   | Qué se propone aprobar                                                              | Cambio observable / límite aceptado                                                                        | Criterio de aceptación                                                                              | Gate                                                                                 |
| ---- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| A-08 | Revocar SELECT directo de businesses/settings; RPC privado fijo owner/admin aal2    | Table API deja de permitir filas completas incluso a owner/admin; api.me/público no cambian                | Todas las pruebas A-08; cero campos privados accesibles por barbero, sin bypass por otra vista/RPC  | Implementación de C-08 independiente, urgente; nueva migración                       |
| A-07 | Guard SQL de envío Auth por destinatario/rol actual, independiente del listado      | Admin sólo barber; se acepta que un correo ya autorizado pueda llegar tras revocación, sin conceder acceso | A-07 con acción forjada y proveedor demorado; aceptación revisa estado actual; no locks durante red | C-02 y guard nuevo antes de ampliar envíos; aprobar límite externo explícitamente    |
| A-05 | PT409/LAST_OWNER sólo desde guard específico; 23514 ajeno→500 seguro                | LAST_OWNER sigue 409; cambia SQLSTATE de su trigger y clasificación errónea de otros CHECK                 | A-05 sobre guard y tres errores ajenos, rollback y ausencia de detalle SQL                          | Unidad de menor complejidad; nueva migración y TS                                    |
| A-01 | Identidad/ámbito/techo de rol antes de precondición de estado; replay por intención | Cambia prioridad de errores; transporte/CSRF puede rechazar antes                                          | Tabla A-01: 401/404/403/428/412 y key distinta→409; replay exacto autorizado                        | Implementar con A-02 para mantener coherencia SQL/HTTP                               |
| A-02 | Preflight no bloqueante, raíz exclusiva, reautorización fresca y orden consistente  | Rechazo temprano sin lock para actores no autorizados; revocación gana al escritor que esperaba            | A-02 con conexiones separadas; guard último owner y aceptación sin regresión                        | Revisar snapshot/aislamiento y mantenimiento; nunca replay INSERT antes de raíz      |
| A-03 | request_id UUID por intento propagado al RPC/audit; origen de replay nullable       | Header válido se conserva; auditoría antigua no se reescribe; key deja de ser traza                        | A-03 correlación A/B, acciones, header inválido y aislamiento entre requests                        | Aplicar a todos los cuerpos SQL de A-01/A-02/A-07 ya consolidados                    |
| A-04 | RPC y query opt-in paginados, 50/200, keyset; legado completo deprecado             | Ninguna truncación silenciosa; límite del legado permanece hasta aprobar su retiro                         | A-04, miembro fuera de página, cursor ajeno, rol revocado, proyección/version de cada miembro       | Desacoplar C-07 del listado primero; retiro legado es otra aprobación                |
| A-06 | Replay 48 h desde created_at, expiración lógica, purga privada en lotes 500         | Tras TTL deja de garantizarse replay; no se instala scheduler ni se borra auditoría                        | A-06 frontera temporal/concurrencia/purga fallida; ninguna operación duplica efectos                | Aprobar retención y comportamiento fuera de ventana; nuevos lectores y mantenimiento |

Cada fila acepta únicamente su excepción de compatibilidad. No habilita refactor
general de Auth, recuperación MFA, nuevas cuentas, catálogo o cambio de roles.
Una implementación futura debe registrar aprobación, alcance, pruebas y resultado
por fila; un check de formato no cierra ninguno de estos hallazgos.

## Paquete B — decisiones técnicas y de producto

| ID           | Contrato recomendado                                                                                     | Qué falta aceptar explícitamente                                                                              | Evidencia de cierre requerida                                                              | Dependientes bloqueados                                      |
| ------------ | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| B-02A / P-02 | Mantener opción A: completed/no_show conservan ocupación; cancel/expire liberan por transición explícita | Confirmar semántica de resultados, no auto-release por no_show/reloj                                          | Casos B-02 y tabla de transiciones aceptados por producto/seguridad                        | Escritores de estado y DDL de ocupación                      |
| B-02R        | Liberar sólo tramo futuro con razón; preservar prefijo histórico                                         | Elegir geometría recomendada frente a liberar intervalo entero; operación sin tramo futuro→409                | Ejemplos de finalización anticipada, ausencia y buffer; restauración conflictiva atómica   | Modelo físico y EXCLUDE, motor de liberación                 |
| B-02C        | Corrección administrativa atómica, causal y sin avisos espurios                                          | Ventana propuesta admin 30 días/owner posterior, o alternativa sólo owner; vínculos externos y bloqueo previo | Ejemplos con liberación anterior, vínculo contable y replay; dos eventos/una versión final | Corrección/reversión; no bloquea catálogo base               |
| B-02D        | Ausencia desde inicio+tolerancia; complete no futuro; cutoffs por contexto                               | Valores/defaults, finalización antes del fin previsto, override con razón y límites                           | Tabla de límites temporales y autorización por contexto aprobada                           | Defaults de settings y transiciones del motor                |
| B-03 / P-03  | Raíz SHARE local / UPDATE global antes de idempotencia, orden único, sin upgrades                        | Aprobar protocolo, modo por operación, aislamiento y política de reintentos/timeout                           | B-03 con dos conexiones, FK implícitas, S2 y mantenimiento incluidos                       | Todos los nuevos escritores que afecten agenda/elegibilidad  |
| B-06V / P-06 | Versiones por recurso y control global independiente; hijos con versión padre                            | Vector compuesto, una versión por comando nuevo, no-op nuevo; S2 no-op queda vigente                          | B-06 versiones y replay, contratos 428/412/409 sin renombrar S2                            | Escrituras catálogo/horarios, recursos de control            |
| B-06I        | Scope tenant+autoridad+operación+key, hash canónico versionado, replay reautorizado                      | Canonización por comando y relación exacta con ventana A-06                                                   | Replay tras revocación, intención distinta, crash y concurrencia                           | Nuevos comandos con idempotencia                             |
| B-06T        | Token 32 bytes, reutilizable/revocable, hash, generación; TTL inicio+24 h propuesto                      | TTL y política de rotación/reschedule, terminales y recuperación por canal verificado                         | B-06 token vencido/revocado no resucita, varias reprogramaciones válidas                   | API pública de gestión y creación con secreto                |
| B-06E        | Sobre AES-GCM privado, AAD por tenant/reserva/generación, keyring externo                                | Propietario/custodia/rotación/backup de claves y TTL de sobres vs replay                                      | Decrypt autorizado, AAD alterado, rotación/restauración; no secretos planos                | Replay de manage_token y avisos con enlace de gestión        |
| B-06A        | Capacidad anónima por intento, cookie HttpOnly, hash persistido, origen/CSRF                             | Emisión/múltiples pestañas, 30 min creación/48 h replay propuestos, pérdida de cookie, antiabuso              | Conocer key+teléfono no recupera secreto; misma autoridad sí; test navegación/cookie       | Replay público secreto; no exige cuenta ni email obligatorio |
| B-CAT        | Staff sin Auth obligatorio; servicio/overrides con tenant y snapshots                                    | Unicidad de nombre, rangos 5–480/0–120, moneda/defaults y vínculo único staff/membresía                       | B-CAT integridad, límites, estado y proyección                                             | Migración catálogo y CRUD, no depende de aprobar EXCLUDE     |
| B-CAT-S      | Suspender login no desactiva agenda; baja catálogo no cancela reservas                                   | Confirmar comportamiento operativo de bajas y aviso de afectados                                              | Reservas futuras intactas; no acceso de miembro suspendido                                 | Baja/suspensión de catálogo y coordinación con S2            |
| B-CLI        | Cliente por tenant sin Auth, E.164 único vivo no fusionado, email opcional                               | Normalización AR, consentimiento, notas privadas, alta contextual mínima por barbero                          | B-CLI con dos tenants y teléfonos equivalentes; directorio denegado a barbero              | Modelo cliente y escritores; no merge                        |
| B-PERM       | Fuente canónica finita JSON→SQL/TS; guards tipados, default deny                                         | Matriz exacta y paridad con S2; ubicación final del artefacto en estructura existente                         | B-PERM por rol/acción/tenant/estado/aal; ninguna acción futura concedida                   | Seed de permisos y todos los nuevos endpoints                |
| B-REL        | FKs compuestas negocio/id, soft delete sin borrar historia                                               | Confirmar cada relación del contrato; merge/mapeos no quedan aprobados                                        | Intentos de FK cross-tenant fallan además de RLS                                           | DDL de catálogo/clientes y futuras reservas                  |

### Gates que siguen expresamente abiertos

- **EXCLUDE/modelo físico de ocupación:** no aprobado por ninguna fila anterior.
  Requiere propuesta física, predicado, matriz de estados/intervalos y concurrencia
  después de resolver B-02R. No hay SQL autorizado en esta entrega.
- **Fusión/mapeos P-04:** diseño de alias, destino desconocido, ciclos y reconciliación
  pendiente. Puede avanzar cliente base sin operación merge ni tablas de integración.
- **P-05/P-08:** no se reabre feed ni se autorizan escrituras GAS; barridos completos
  y modo R/B se preservan. Identity spike y scopes siguen gates de su sprint.
- **S3-B:** requiere autorización posterior de un conjunto exacto de migraciones y
  pruebas. Aprobar S3-A no equivale a permitir crear archivos SQL o aplicar cambios.

## Invariantes preservadas, no sometidas a nueva aprobación

P-01/P-07: estructura actual, monolito modular, npm/lockfile, identidad Merivo y
separación app_server/service_role. Mantener sesiones/MFA existentes, cinco migraciones
inmutables, IDs UUID y contratos S1/S2 excepto excepciones A explícitas. No modificar
GAS, requerimientos funcionales, alcance MVP ni documentos originales en esta fase.

## Criterios de aceptación de los paquetes

**Paquete A implementado, sólo después de autorizarlo:** todas las pruebas A-01…A-08
del plan aprobadas o con exclusión expresamente aceptada, sin acceso privado ni
Auth Admin fuera de matriz, regresión S1/S2 y todas las mutaciones atómicas. Ejecutar
checks de aplicación y SQL en entorno de prueba aislado autorizado; concurrencia
con conexiones independientes y barreras, no sólo mocks. No usar cuenta del propietario
ni reset de su entorno como fixture. Cada limitación se reporta con resultado real.

**Paquete B como diseño:** producto/arquitectura/seguridad aceptan o rechazan cada
fila; no quedan contradicciones entre autorización, recurso versionado y modo de
lock. Para aprobar una migración dependiente se exige un contrato físico/test de esa
fila; el diseño no se considera implementado por haber escrito el documento.
Se puede aprobar catálogo base manteniendo ocupación/EXCLUDE bloqueados.

## Registro de entrega y validación documental

Cambios de esta fase: únicamente cuatro documentos nuevos en `docs/s3-a-proposal/`.
No se actualiza CHANGELOG original por la restricción expresa; este apartado registra
la creación de propuestas, clasificación por gates y ajuste raíz→idempotencia frente
al orden sugerido en el informe previo, que se conserva intacto.

Validación ejecutada en esta entrega:

| Check                                     | Resultado real                                                                                                              |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| npm run lint                              | Correcto                                                                                                                    |
| npm run typecheck                         | Correcto                                                                                                                    |
| npm run test                              | 8 archivos, 62 tests unitarios correctos; configuración limitada a tests/unit, sin DB                                       |
| npm run build                             | Correcto; Next.js 16.4.3, rutas con acceso a datos dinámicas                                                                |
| npm run format:check                      | Falla por formato en los 15 Markdown preexistentes de docs/arquitectura-v1.1; no se modificaron por restricción del usuario |
| Prettier acotado a los cuatro entregables | Correcto                                                                                                                    |
| Destinos de enlaces locales               | 19 destinos de archivo comprobados, ninguno inexistente                                                                     |
| SHA-256 de archivos previos               | 141 archivos sin cambios, incluidas las cinco migraciones; únicos agregados: estos cuatro Markdown                          |

La comparación excluye archivos ignorados/secretos; no lee su contenido. Los cinco
hashes de migraciones están en el [plan técnico](S3_B_MIGRATION_PLAN.md#base-inmutable).
Estos checks verifican preservación y calidad de la entrega, no las correcciones
propuestas A ni el comportamiento futuro del modelo B.

No se ejecutan pruebas que conecten o modifiquen DB, E2E de cuentas/MFA, migraciones,
CLI Supabase ni aprovisionamiento. La fase no verifica comportamiento runtime nuevo,
pues no crea código. Las cifras históricas de S2 no se presentan como pruebas nuevas.

## Recomendación para la siguiente autorización

Implementar primero **Paquete A**. C-05 tiene menor complejidad y superficie; C-08 es
la mayor urgencia y puede revisarse como unidad independiente sin esperar S3-A.
Después, unidad de autorización C-01/C-02/C-07; trazas, paginación y retención siguen
sus dependencias. No retrasar el cierre de exposición por completar todo S3.

Pedir aprobación explícita del alcance A y sus excepciones, especialmente restricción
Table API, semántica de envío externo A-07 y TTL A-06. Para B se requiere elección de
geometría/correcciones/defaults P-02, protocolo P-03, versiones/autoridad/cifrado/TTL
P-06, catálogo, clientes y matriz. Luego solicitar autorización separada para S3-B.
Esta entrega se detiene en las propuestas y no ejecuta ninguno de esos pasos.
