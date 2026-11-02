# Informe de consolidación arquitectónica

Fecha: **2026-10-31**. Alcance exclusivo: Markdown; no implementación del Sprint 1.

## 1. Inventario y criterio

Se leyeron los 17 Markdown presentes al inicio: AGENTS, README, docs 01–14 y guía
Codex. Ya existían modificaciones locales en 03–08, 10, 11 y guía: se trabajó sobre
ellas sin restaurar HEAD ni descartar trabajo del usuario. Doc 14 se conserva íntegro.

No estaban en este checkout SPRINT_0.md, LOCAL_DATABASE.md ni
SPRINT_1_PREPARATION.md, aunque README/AGENTS los referenciaban. No se inventó su
contenido histórico; se repararon referencias a este informe y a operaciones 12.

El título de 14 dice «aprobadas» y su estado «propuesta para revisión». Se incorporan
las prohibiciones y garantías técnicas explícitas por pedido del usuario; las
recomendaciones/opciones se conservan como **P-xx pendientes**. Esta edición no
fabrica aprobación de producto, revisión de PR ni autorización para desplegar.

## 2. Trazabilidad A–G

| Fuente 14 | Regla incorporada                                                                                                                     | Documentos afectados                                                   | Gate futuro                                                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| A         | Identidad dentro de BD, membresía/tenant/permiso, grants mínimos, soporte temporal. Sin actor/header como autoridad.                  | 03, 04 §4, 05, 08 §3.1, 12, ADR-019, guía/AGENTS                       | P-01; tests directos y catálogo de definer.                                   |
| B         | EXCEPTION en vez de SAVEPOINT, locks comunes para toda mutación, orden determinista y revalidación. Historia/reversiones sin solapes. | 02, 03, 04, 06 §2/§4, 10, 11, ADR-003                                  | P-02/P-03; conexiones distintas, cambios globales/reprogramación cruzada.     |
| C         | Tiempos derivados y verificados por igualdad/orden, snapshots no siguen catálogo.                                                     | 04 §3.13, 06, 11, ADR-021                                              | Pruebas de derivados manipulados, DST y ajustes históricos.                   |
| D         | Sin garantía por timestamp/id, secuencia ni ventana fija; barridos/reconciliación MVP. Feed reservado hasta publicador probado.       | 01, 04 §3.20, 05 §4, 07, 10, 11, ADR-007/017                           | P-05; commits tardíos, abortos, crashes, tombstones y recuperación histórica. |
| E         | Modo B no escribe ni vincula/mappea/importa. UserProperties no prueba operador. Gestión individual preservada en TurnosMerivo.        | 01, 02 matriz, 05 catálogo, 07 flujo/diagrama, 08, 09, 10, 11, ADR-008 | P-08; denegación service_key en API y BD.                                     |
| F         | Sin FK polimórfica ficticia; validación transaccional de referencia/tenant, unicidad 1:1 donde corresponde, revisión separada.        | 04 §3.18, 07, 08, 11, ADR-021                                          | P-04; baja/fusión concurrente y duplicados.                                   |
| G         | ETag fuerte/If-Match, 428/412/409, update condicional e idempotencia/eventos/outbox atómicos. Replay reautorizado.                    | 04 §3.19/§3.20, 05 §1.6, 06, 07, 08, 09, 10, 11, ADR-020               | P-06; reintentos, payload/precondición diferentes y fallos tras commit.       |

## 3. Inconsistencias resueltas y alcance funcional

- Matriz y diagrama permitían completar/confirmar/ausente/vincular con credencial
  compartida mientras 07 lo prohibía. Se retira esa autorización y se **conservan**
  acciones/vínculos mediante sesión individual o Modo A validado; no hay transacción
  distribuida Sheets/PostgreSQL. Un trigger de lectura detecta, pero no escribe links.
- ADR-017 garantizaba completitud por cursor temporal mientras 05 lo descartaba.
  Se reemplaza esa garantía; los reportes siguen en el MVP mediante alternativa 14.D.
- Revocación «inmediata» con caché de 30 s se cambia a verificación por solicitud,
  distinguiendo caché de lectura del punto de autorización transaccional.
- Se retiran firmas con actor arbitrario como autoridad y la confusión JWT/postgres.
  El ejemplo RLS incompleto se sustituye por contrato revisable, no migración lista.
  Helpers antirrecursión y tablas de identidad global tienen excepciones explícitas.
- Se retira 409 VERSION_CONFLICT, se añaden ejemplos de If-Match/key y se distingue
  efecto idempotente de PUT del replay de creación con su precondición original.
- CHECKs de orden no probaban duración/buffer: se añaden igualdades ilustrativas y
  derivación por trigger. No se crean archivos SQL ni se ejecuta ese diseño.
- Se separa preferencia de candidatos de orden de locks. Operaciones globales,
  expiraciones, cambios de catálogo y reversiones también participan del protocolo.
- El cálculo conceptual verifica buffer contra el rango completo de bloqueos, RN-04.
- Token de gestión de «un solo uso» contradecía gestión repetida; se alinea al token
  por reserva hasta vencimiento/revocación ya definido en 08 §2.
- Undo genérico de barbero no puede revertir una transición confirmada sin permiso;
  se conserva confirmación/envío diferido y reversión real sólo autorizada.
- Se preservan npm, stack, monolito y carpetas físicas S0; no se renombra aplicación
  ni se afirma que exista despliegue remoto, pruebas de BD o seguridad implementada.

## 4. Decisiones propuestas y riesgos pendientes

Las soluciones de esta tabla **no están aprobadas** por figurar aquí. No implementar
el trabajo dependiente hasta registrar la decisión y su aceptación técnica/producto.

| ID / gate                     | Ambigüedad                                                                                                           | Propuesta y cierre requerido                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-01 — antes de S1            | Rol/grants/propietarios no fijados por 14. RLS de businesses requiere membresías previstas para S2.                  | Aprobar app_server sin tablas, superficies de 04 §4 y escrituras de configuración por operaciones revisadas. Aprobar adelantar sólo base mínima de identidad/membresía y fixtures SQL, sin login/invitaciones/MFA/UI. Alternativa: deny-all S1 y aislamiento por usuario S2, cambiando aceptación explícitamente. Entregar matriz por tabla/función y tests antirrecursión antes de SQL. |
| P-02 — antes de S3/S6         | 14.B recomienda ocupar históricamente no_show; falta corrección de ausencias/atenciones erróneas.                    | Aprobar predicado histórico con no_show y mecanismo explícito de corrección/liberación. No implementar liberación automática ni reutilización histórica arbitraria; reversión nunca causa solapes. El ejemplo de 04 es propuesto.                                                                                                                                                        |
| P-03 — antes de S5/S6         | Locks individuales no cubren operaciones globales ni otros órdenes de recursos.                                      | Revisar propuesta 06 §4.0 de coordinación compartida/exclusiva por negocio y staff ordenado. Conjunto estable, locks fuera del bloque que revierte y orden con clientes/idempotencia/colas. Probar deadlocks y carreras; otro protocolo debe demostrar las mismas invariantes.                                                                                                           |
| P-04 — antes de S10           | internal_id polimórfico no tiene FK multitarget; unicidad inversa global choca con fusión de clientes.               | Aprobar validación transaccional tipo/tenant con locks de baja/fusión o referencias tipadas/FKs compuestas. Unicidad 1:1 sólo donde aplica y needs_review separado. No añadir tablas ahora.                                                                                                                                                                                              |
| P-05 — antes de S10/S11       | Falta alcance histórico/paginación/bajas de reportes; feed sin publicador/watermark probado.                         | Barridos completos y convergencia eventual del alcance aprobado, versiones/tombstones y recuperación de corridas parciales. No borrar por ausencia en páginas. Feed reservado hasta probar algoritmo bajo commits fuera de orden, publicadores y crashes; no incorporar CDC por defecto.                                                                                                 |
| P-06 — antes de S5/S6         | Falta recurso de control para versiones globales y protección de respuesta idempotente con token secreto de gestión. | Aprobar versiones de bloques/excepciones globales, colecciones y links. Para replay, almacenamiento cifrado/seguro y TTL o protocolo alternativo que no pierda gestión tras timeout. Sin plaintext en response_body; reautorizar replay y comparar intención/precondición.                                                                                                               |
| P-07 — antes de lógica S1     | Nombres físicos S0 difieren de dominios lógicos de 03.                                                               | Conservar carpetas actuales y aprobar responsabilidades/dirección de dependencias. Sin renombrar por estética ni crear módulos adicionales vacíos.                                                                                                                                                                                                                                       |
| P-08 — antes de escritura GAS | Despliegue y aislamiento real de tokens no confirmados.                                                              | Modo B sólo lectura. Spike con dos cuentas, permisos, almacenamiento y revocación; demostrar que el operador no selecciona credenciales ajenas antes de Modo A. Mientras tanto, panel autenticado.                                                                                                                                                                                       |

Otros riesgos conservados: IDs estables de Sheets, cuotas, edición manual de hojas,
restauración/backups, abuso público y validación legal de privacidad/transferencias/
retención. Se resuelven en sus sprints. No se verificaron normativa, precios ni cuotas
vigentes en esta tarea; no se presenta consejo legal ni nuevas obligaciones.

## 5. Checklist exacto para comenzar S1

- [ ] Revisar consolidación y cerrar/aprobar P-01/P-07, incluida dependencia mínima
      de membresías y aceptación de aislamiento S1. Registrar decisión en ADR.
- [ ] Aprobar primera migración y matriz de tablas/funciones: tenants, identidad
      global, grants mínimos, propietarios y helpers RLS sin recursión.
- [ ] Confirmar PostgreSQL/extensiones y exposición de esquemas. public/app/api/
      app_internal son diseño propuesto, no configuración aplicada por esta tarea.
- [ ] Comprobar Docker/Supabase local con db:start/status, sin vínculos remotos;
      conservar landing sin conexión. Esta tarea no reinicia servicios.
- [ ] Diseñar primero fixtures de dos negocios y actores y tests de lectura/escritura/
      RPC cross-tenant, membresía inactiva y slug; implementarlos con esquema autorizado.
      No afirmar aislamiento probando sólo como postgres/BYPASSRLS.
- [ ] Documentar migración, reconstrucción local descartable y recuperación/
      roll-forward según 12 §2/§12. No editar migraciones aplicadas.
- [ ] Recibir tarea expresa de implementación S1. Crear entonces migración y pgTAP,
      aplicar primero local, demostrar aceptación y obtener revisión técnica del PR.
- [ ] Mantener gates P-02…P-06/P-08 en sus sprints; antes de datos reales ejecutar
      pruebas relevantes y revisión de seguridad. Consolidar no equivale a aprobarlas.

## 6. Validación y límites

Cambios detallados en [CHANGELOG.md](CHANGELOG.md). Se comprobarán referencias,
invariantes documentales y hashes de archivos no Markdown, junto a checks de
aplicación aplicables. Los resultados reales se registran al cerrar la tarea.
No se crean ni ejecutan suites de RLS, concurrencia, feed o funciones de negocio.

Fuentes primarias consultadas:
[PL/pgSQL](https://www.postgresql.org/docs/17/plpgsql-transactions.html),
[locks](https://www.postgresql.org/docs/17/explicit-locking.html),
[RLS](https://www.postgresql.org/docs/17/ddl-rowsecurity.html) y
[funciones](https://www.postgresql.org/docs/17/sql-createfunction.html).

### Resultados reales de esta consolidación

- 19 Markdown inspeccionados al cierre; referencias locales existentes, fences
  equilibrados, UTF-8 válido, decisiones P-xx referenciadas y búsqueda de reglas
  incompatibles revisadas sin hallazgos en las comprobaciones ejecutadas.
- Hashes SHA-256 de todos los archivos no Markdown versionados/nuevos no ignorados
  iguales al inventario inicial: aplicación, configuración, dependencias, tests y
  carpeta de migraciones preservados. Doc 14 no fue editado.
- `git diff --check`: aprobado, sin whitespace errors.
- `npm run lint`: aprobado.
- `npm run format:check`: aprobado tras formatear README, AGENTS e informes nuevos.
  Los documentos técnicos originales están excluidos por la configuración existente
  de Prettier; se revisaron por las comprobaciones documentales indicadas arriba.
- `npm run typecheck`: aprobado.
- `npm run test`: 8 tests aprobados, exit 0; Vitest emitió advertencia de cierre
  tardío de dos servidores Vite. No se modificó runtime/configuración para resolverla
  en una tarea exclusivamente documental; registrar en mantenimiento de herramientas.
- `npm run build`: aprobado (Webpack, fuera del sandbox).
- E2E no repetido: no cambió UI ni código. No se ejecutaron migraciones, pgTAP,
  pruebas de concurrencia, autenticación, feed ni comandos de despliegue.

Se modificaron docs 01–13, guía, AGENTS y README; se crearon este informe y CHANGELOG.
No se crearon commits ni se hizo push. La consolidación finaliza aquí; no inicia S1.

## Decisión posterior — inicio de Sprint 1 (2026-10-31)

El usuario aprobó explícitamente la variante recomendada de SPRINT_1_DESIGN.md:
P-01 y P-07 quedan cerradas para la base S1 allí detallada. Se adelantan únicamente
users/business_members mínimos y fixtures, sin login/gestión de roles de S2.
Se mantienen las carpetas físicas y app_server restringido. Las tablas de propuestas
anteriores son registro de la consolidación previa; este apartado actualiza su estado.
P-02…P-06/P-08 conservan gates futuros. No se autorizaron commits, push o despliegues.
