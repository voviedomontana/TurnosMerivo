# Registro de decisiones — estado y propuestas de continuidad

Fecha: 2026-11-01. No es un acta de aprobación de implementación.
Fuente primaria de autorización: pedido actual del usuario y decisiones históricas
aceptadas. V11 es referencia de diseño; sus ADR se declaran propuestas.

## 1. Decisiones P-01 a P-08

| ID   | Estado real                                                    | Decisión aplicable / propuesta                                                                             | Evidencia / aprobación necesaria                                         | Gate                                                                 |
| ---- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| P-01 | Aprobada para S1; implementada localmente                      | app_server sin tablas; service_role limitado; base mínima de users/memberships; helpers/grants específicos | H-ADR022, SPRINT_1_DESIGN/REPORT, cinco migraciones                      | No reabrir para recrear S1; nuevas superficies sí requieren revisión |
| P-02 | Opción A adoptada provisionalmente; **sin aprobación SQL**     | completed y no_show conservan historia ocupada; liberación explícita, autorizada, atómica y auditada       | Pedido actual; falta cerrar §2 y registrar aceptación técnica/producto   | Esquema dependiente S3-B y motor S6                                  |
| P-03 | Propuesta pendiente                                            | Protocolo común de coordinación global, staff, clientes, reservas y efectos; §3                            | Aprobar orden/protocolo y pruebas; ejemplo staff→reserva no basta        | Diseñar en S3-A; antes de escritores catálogo/agenda relacionados    |
| P-04 | Propuesta pendiente                                            | Preferir referencias tipadas y FKs compuestas de V11 con excepciones de fusión/needs_review definidas      | V11/04 §3.18, V11-ADR022; no equivale a H-ADR022 aprobado                | Diseño S3-A, DDL sólo al aprobar fase S3/S10                         |
| P-05 | Estrategia MVP explícita; detalles pendientes                  | Barridos completos por alcance + reconciliación; feed no requerido para MVP                                | Pedido actual prevalece sobre V11/04 §3.20, 05 §4, 07 §6 y ADR017        | S10/S11; fuera de DDL S3 propuesto                                   |
| P-06 | Semántica HTTP conservada; diseño de recursos/replay pendiente | 428/412/409; versiones de recursos globales y replay sin exponer manage_token                              | S2 prueba membresías; no acredita reservas. Cerrar §4                    | Recursos de control en S3-A; S5/S6 dependen                          |
| P-07 | Aprobada y preservada                                          | Carpetas actuales, npm, dependencias app→modules→lib                                                       | H-ADR022, AGENTS y diseño S1                                             | Todos los sprints                                                    |
| P-08 | Lectura segura como base; escritura pendiente                  | Modo R de V11 equivale a Modo B histórico: lectura. A sólo con evidencia real de identidad                 | Spike GAS pendiente; UserProperties no demuestra aislamiento por sí solo | Antes de habilitar cualquier escritura GAS; no modificar GAS ahora   |

La decisión de permitir análisis/diseño no autoriza migraciones ni S3-B. El MVP
de barridos puede especificarse sin aprobar un feed; no introducirlo como dependencia
oculta bajo el nombre change_log/outbox de integración.

## 2. Cierre requerido para P-02 — ocupación histórica A

### Lo definido provisionalmente

- El resultado administrativo completed/no_show no libera automáticamente el rango.
- Una corrección no puede producir solapes ni borrar la historia de atención/ausencia.
- Liberar requiere actor autorizado, motivo, transacción y auditoría; no se invoca
  implícitamente al marcar ausencia, al expirar un token ni desde GAS compartido.

### Decisiones concretas que faltan

| Decisión                     | Pregunta para producto/arquitectura                                      | Recomendación a revisar                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Separación estado/ocupación  | ¿Una reserva puede seguir completed/no_show con ocupación liberada?      | Sí conceptualmente, si se registra causa y responsable; falta elegir representación                                                                        |
| Modelo de restricción        | ¿Marca de ocupación independiente o asignaciones de ocupación separadas? | Marca separada simplifica MVP; una entidad separada facilita historial, pero añade complejidad. No elegir esquema físico aún                               |
| Predicado EXCLUDE            | ¿Cómo incluye resultados históricos y excluye liberaciones aprobadas?    | Debe depender del control de ocupación elegido, no sólo del status actual. pending/confirmed ocupan, completed/no_show conservan hasta operación explícita |
| Cancelación                  | ¿Puede cancelarse una atención concluida para liberar un intervalo?      | Mantener cancel sólo pending/confirmed; corrección histórica distinta, con motivo. No volver cancelled a un completed para ocultar historia                |
| Expiración                   | ¿Qué libera un pending vencido y cómo se registra?                       | Sólo expiración válida revalidada con locks comunes; fila/evento/outbox atómicos                                                                           |
| Reprogramación               | ¿Se permiten cambios de hora/profesional tras resultado histórico?       | MVP sólo pending/confirmed. Ajuste histórico, si se autoriza, operación específica sin perder rango/eventos previos                                        |
| Liberación y reutilización   | ¿Quién libera, en qué ventana y se permite nueva reserva en el pasado?   | Owner/admin con política aprobada; liberar no habilita por sí solo reserva retroactiva ni bypass de límites                                                |
| Corrección de resultado      | ¿Revertir y volver a marcar exige dos pasos o una corrección compuesta?  | Preservar eventos; si son dos pasos, contemplar carrera intermedia. No conceder revert a barbero por un undo de UI                                         |
| Recuperar ocupación liberada | ¿Qué ocurre si otro turno ocupó ese intervalo?                           | Fallar de forma controlada y conservar estado original; nunca desplazar reserva ajena silenciosamente                                                      |
| Vínculo externo              | ¿Puede liberarse/corregirse un completed registrado en Sheets?           | Flujo autorizado de desvinculación/conciliación previo; no borrar el registro contable desde Turnos                                                        |
| Reversiones tardías          | ¿Ventana 30 días y excepción owner de V11?                               | Son defaults nuevos propuestos, no aprobación actual. Definirlos junto con guardas de atención                                                             |
| Métricas                     | ¿Las correcciones cambian contadores y KPIs históricos?                  | Recalcular/reconciliar según evento/resultado autorizado; distinguir ocupación física de atención efectiva                                                 |

### Pruebas que permitirán aceptar el diseño

1. Dos filas ocupantes no se solapan, incluidos completed/no_show y rangos contiguos [).
2. Marcar no_show no cambia ocupación; intentar ocupar su intervalo falla hasta
   liberación válida. Reescribir B49 y otros tests V11 que asumían liberación automática.
3. Liberación sin permiso/motivo/precondición, de otro tenant o con credencial compartida
   no produce efectos. Con versión vieja: 412; sin requerida: 428.
4. Liberación exacta repetida es idempotente; misma key con otra intención falla.
5. Recuperación de ocupación o cambio de duración ante conflicto conserva fila,
   snapshots, eventos, versión, replay y notificaciones previos.
6. Liberación concurrente con nueva reserva, revert, ajuste y bloqueo global:
   un resultado serializable por el protocolo, sin estado parcial ni doble ocupación.
7. Fallos inyectados tras modificar ocupación revierten evento/audit/outbox/replay.
8. Correcciones/links y resultado administrativo tienen trazabilidad sin secretos;
   las métricas no cuentan dos atenciones por una corrección.

No se entrega DDL, campo definitivo, trigger o predicado SQL de P-02 en esta propuesta.

## 3. P-03 — protocolo transaccional propuesto

**Estado: diseño a aprobar, no garantía demostrada.** PostgreSQL proporciona locks;
la corrección depende de que todos los escritores, mantenimiento y workers respeten
el mismo orden y revaliden el conjunto real de recursos.

### Orden único propuesto

0. Validar credencial/capacidad y autorización inicial. Validación de formato puede
   preceder, pero no revelar estado/versión de un recurso antes de autorizarlo.
1. Reservar clave de idempotencia de esa autoridad/operación, en la misma transacción.
   Reautorizar un replay antes de devolverlo. Hash incluye intención y precondición.
2. Coordinación por negocio: lock compartido para mutaciones locales; exclusivo
   para cambios globales o del conjunto de profesionales/candidatos. Opción a evaluar:
   lock de fila raíz del negocio con modos compartido/exclusivo. Compatible con el
   lock exclusivo raíz de membresías S2; alternativa advisory transaccional necesita
   mapa de claves sin colisiones y cobertura equivalente. Elegir una, no mezclar.
3. Descubrir/revalidar candidatos bajo coordinación y bloquear **todos** los staff
   necesarios en orden estable por UUID, incluidos origen/destino y candidatos de any.
4. Bloquear clientes afectados en orden UUID. Alta/normalización y límites por cliente
   se resuelven aquí, con unicidad de teléfono y política de reintento definida.
5. Bloquear reservas afectadas en orden UUID; releer asignación, versión y estado.
   Si cambiaron recursos respecto del conjunto bloqueado, abortar/reintentar la
   transacción completa; no adquirir un staff nuevo fuera de orden.
6. Bloquear mapeos/recursos de control secundarios cuando correspondan, en orden
   estable acordado; nunca tomar después un lock de una fase anterior.
7. Mutación, versión, eventos, auditoría, outbox y resultado de replay atómicos.
   Inserciones de eventos no implican llamar a un proveedor ni tocar Sheets.

El orden de locks compartidos/exclusivos no puede usar upgrade compartido→exclusivo
en mitad de la operación: calcular el modo al comienzo o abortar/reintentar desde cero.
Los locks de coordinación/staff deben adquirirse fuera del bloque EXCEPTION que
revierte un candidato. Reintentos 40P01/40001 acotados, con key/intención originales,
sin reintentar a ciegas un 412 o un conflicto de negocio.

### Cobertura por operación

| Operación                                                      | Coordinación / recursos                                                                                | Revalidación específica                                                                                      |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Crear, confirmar, cancelar, complete, no_show, liberar, revert | Compartida + staff + cliente + reserva, según existan                                                  | Identidad/permiso actuales, estado, versión, intervalo y política A                                          |
| Reprogramar/reasignar                                          | Compartida + staff origen/destino ordenados + cliente + reserva                                        | Conjunto y versión vigentes; destino válido; conservar origen ante fallo                                     |
| Any staff                                                      | Compartida + todos los candidatos ordenados antes del bucle                                            | Catálogo/asociación/activo vigentes bajo coordinación; ordenar asignación por carga aparte del orden de lock |
| Horario/excepción/bloqueo de un staff                          | Compartida + staff + control padre y reservas consultadas                                              | Versión padre; reportar conflictos; no cancelar automáticamente                                              |
| Cierre/excepción/bloqueo de negocio                            | Exclusiva + conjunto estable de staff afectados                                                        | Incluir reservas de staff inactivos si son afectadas; versión global; lista de conflictos estable            |
| Alta/baja staff, cambios de elegibilidad o servicio compartido | Exclusiva conservadora + staff afectados ordenados                                                     | No dejar cambiar candidatos entre descubrimiento y locks; snapshots existentes intactos                      |
| Fusionar clientes / corregir vínculos                          | Exclusiva conservadora + staff afectados + clientes + reservas + mapeos                                | Referencias/fusión no son una excepción informal al orden; definir granularidad al aprobar P-04              |
| Expirar pending                                                | Identificar candidatos sin lock; compartida→staff→reservas, revalidar y SKIP LOCKED cuando corresponda | Nada de reclamar reservas primero y luego esperar staff; no pelear con confirmación sobre snapshot viejo     |
| Cambiar membresía/configuración privilegiada                   | Reutilizar raíz exclusiva y revalidar autoridad bajo lock                                              | Analizar carreras con preautorización, desactivación y helper estable S2                                     |
| Enviar email                                                   | Lease corto de outbox, envío fuera de transacción, ack por lease vigente                               | Sin locks de agenda retenidos durante I/O; efecto externo no es exactly-once por SQL                         |

Riesgos a resolver antes de aprobación: compatibilidad de locks FK/índices únicos,
cliente nuevo concurrente, fusión con órdenes opuestos, mantenimiento del último
owner (trigger toma raíz tras fila si el escritor no respetó el protocolo), worker
de expiración, updates masivos, desactivación de cuenta global, contención raíz y
locks automáticos de triggers. La coordinación propuesta es conservadora para el
volumen inicial y puede reducir concurrencia; se mide, no se promete rendimiento.

Pruebas: conexiones distintas con barreras de sincronización, reprogramación cruzada,
any solapado, alta/baja concurrente, cambios globales vs crear, expiración vs confirmar,
fusión y liberación histórica. Medir deadlocks/reintentos y validar estado completo
tras fallo. Una transacción SQL de pgTAP o mocks no prueba esas carreras por sí sola.

## 4. P-06 — versiones y replays seguros

- Conservar 428/412/409. Resolver el nombre del code 412 sin romper PRECONDITION_FAILED
  S2: proponer normalización interna o compatibilidad documentada antes de exponer
  VERSION_CONFLICT. No cambiar sólo los tests para aceptar otra respuesta.
- Elegir recurso de control versionado del negocio para excepciones/bloqueos globales;
  profesional padre para horarios/servicios locales. Identificar qué versión cambia
  al editar un servicio usado por varios staff. Evitar escribir un hijo sin control.
- Identidad y permiso dentro de la operación, replay autorizado, comparación de
  intención y precondición, luego versión nueva y reglas. Distinguir malformación
  del header de comparación de una versión de un recurso ajeno.
- Unicidad de replay por tenant + autoridad/capacidad verificada + operación + key;
  el hash incluye body canónico y versión esperada. No adoptar la PK genérica de
  V11 que omite actor ni confiar en p_request_hash del cliente sin recalcularlo.
- Definir ciclo de vida del token de gestión: recomendación de MVP, **pendiente**,
  reutilizable/revocable hasta expiración y sujeto a políticas. Un solo uso exige
  rotación y recuperación y contradice reprogramaciones repetidas si no se diseña.
- Reserva creada pero respuesta perdida: decidir replay cifrado con TTL/rotación
  de clave o protocolo alternativo que recupere gestión sin texto plano en response_body.
  No reutilizar el patrón de invitación como si resolviera esta respuesta secreta.
- Purga TTL 48 h, limpieza de claves antiguas y pruebas de crash/reintento deben
  respetar transacciones en vuelo. Separar request_id de key para auditoría/soporte.

## 5. P-04/P-05/P-08 — diseño de integración a aprobar

**P-04:** las FKs tipadas de V11 son recomendación razonable, no DDL autorizado.
Resolver inmutabilidad vs merge, destino desconocido en needs_review, import_batch
reversible sin borrar clientes preexistentes y referencia a filas con baja lógica.
Preferir candidatos en staging separados antes de confirmar vínculo. S3 prepara
claves compuestas de entidades; mapeos/credenciales pueden diferirse a S10, sujeto
a aprobación del recorte. Si se adelantan, deny-all sin endpoints ni secretos.

**P-05:** aprobar alcance histórico y proyecciones por entidad, catálogo de versiones,
metadata de corrida y bootstrap. Cada corrida recorre completamente un alcance;
upsert por ID/versión, marca de pertenencia a corrida y finalización inequívoca.
No borrar ausentes hasta completar todas las páginas y resolver cambios concurrentes.
Un movimiento de fecha necesita reconciliar origen y destino/histórico. Checksum
id:version no detecta contenido local editado con esa misma versión: hash de proyección
o reparación completa. Diseñar repetición convergente sin prometer snapshot global.
Feed xid8 sólo como alternativa futura con demostración de commit fuera de orden,
paginación/collapse, alta de consumidor, purga, permisos/scopes, crash y restauración.

**P-08:** Modo R/B es base para MVP. Modo A requiere spike reproducible con dos
cuentas y revisión de despliegue, datos de identidad, token ajeno, revocación, scopes
y MFA. No usar headers asertados. Las escrituras y links se hacen en el panel con
sesión o conciliación autorizada; no eliminarlos del requisito porque GAS sólo lee.
El modo de ejecución Google y cuotas se verifican en ese sprint, no por esta lectura.

## 6. Decisiones adicionales sometidas a revisión

| ID de propuesta | Recomendación                                                                                                                       | Responsable de aceptación / momento                                    |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| D-01            | Namespaces H/V11 para ADR en colisión; proponer nuevo identificador estable para mapeos sin borrar H-ADR022/023                     | Tech lead, S3-A                                                        |
| D-02            | Preservar tema Merivo oscuro, npm y carpetas; tratar plantilla V11 como referencia histórica incompatible en esos puntos            | Ya ordenado por usuario; registrar al autorizar actualización de guías |
| D-03            | Permisos canónicos JSON→SQL/TS con tests de equivalencia y excepciones explícitas; no regex indiscriminada de nombres de parámetros | Arquitectura/seguridad, S3-A                                           |
| D-04            | Toda escritura mutable de negocio por operación revisada para no eludir locks/versionado; DML directo denegado por defecto          | Seguridad/tech lead, S3-A                                              |
| D-05            | Mantener audit UUID y columnas actuales; agregar datos de integración cuando se aprueben, con compatibilidad                        | Arquitectura, S3-A; no conversión destructiva a bigint                 |
| D-06            | S8 core antes de S10; vinculaciones/credenciales S8-I después de APIs S10, mismo alcance MVP                                        | Producto/tech lead al aprobar roadmap                                  |
| D-07            | Undo UI de barbero como espera antes de enviar o confirmación explícita; no permiso encubierto de revert                            | Producto/UX, S8                                                        |
| D-08            | Correcciones C01–C07 en paquete autorizado separado de la adopción documental                                                       | Producto/seguridad antes de expandir handlers                          |
| D-09            | Defaults de atención, ventana de reversión y comportamiento ante email opcional para gestión/avisos                                 | Producto, S3-A/S6/S7                                                   |
| D-10            | Recuperación MFA y soporte temporal requieren diseño con verificación/auditoría; no bypass público ni acceso global implícito       | Seguridad antes de piloto; adelantar sólo con autorización             |
| D-11            | Mantenimiento real bloquea público/staff/integraciones/workers, no sólo el flag de reservas públicas                                | Operaciones, S12/S13                                                   |
| D-12            | Ejecutar S9 antes de cerrar S7 para entregar confirmación por email real, sin usar el correo Auth como sustituto                    | Producto/tech lead al aprobar roadmap                                  |

**Próxima decisión solicitada, no asumida:** aprobar S3-A como fase documental de
cierre de estas decisiones y la matriz de migraciones, incluyendo o separando el
paquete S2 compatible. S3-B necesita aprobación distinta con objetos y pruebas exactos.
