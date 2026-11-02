# Reconciliación de arquitectura — propuesta independiente

Fecha: 2026-11-01. Alcance: análisis estático y planificación. No se sobrescribió
ningún documento anterior ni se aprobó implementación. Lectura conjunta con
[precedencia](DOCUMENTATION_PRECEDENCE.md), [estado](CURRENT_IMPLEMENTATION_STATUS.md)
y [decisiones](DECISION_REGISTER.md).

## 1. Inventario de la nueva documentación

Se encontraron **15 Markdown** en `docs/arquitectura-v1.1/`. V11 = esa carpeta;
H = documentación histórica en docs. Todos los archivos pedidos de AGENTS, README,
consolidación, CHANGELOG, diseños/informes S1/S2, guía, marca y catálogo existen.
No hay doc 14 dentro de V11: existe como histórico `docs/14_CORRECCIONES_CRITICAS.md`.

| Archivo V11                          | Contenido inspeccionado                                               | Relación con lo actual / continuidad                                                                       |
| ------------------------------------ | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 01_PRODUCT_VISION.md                 | SaaS, alcance MVP, supuestos, actores, métricas                       | Mantiene monolito y fuente PostgreSQL; declara feed y ausencia de bloqueos S0–S5 que requieren excepciones |
| 02_FUNCTIONAL_REQUIREMENTS.md        | RN/RF, estados, políticas, matriz por actor                           | Añade RN13–17, guardas/revert; token de un uso, no_show y matriz canónica necesitan reconciliación         |
| 03_SYSTEM_ARCHITECTURE.md            | Acceso sesión/app_server, módulos, jobs, proveedores                  | Separación de privilegios compatible; nomenclatura, feed y diagramas no son código implementado            |
| 04_DATABASE_DESIGN.md                | Entidades, FKs, derivados, EXCLUDE, mapeos, replay/feed/permisos, RLS | Principal entrada S3; tiene decisiones bloqueadas y ejemplos que no deben aplicarse literalmente           |
| 05_API_SPECIFICATION.md              | REST v1, headers/errores, scopes, endpoints y feed                    | Contrastar PT/TS, 412, If-Match, request_id, replays y paginación de S2                                    |
| 06_BOOKING_ENGINE.md                 | Slots, DST, wrappers/core, locks, estados, B01–B56                    | Motor no implementado; falta coordinación global y cerrar P-02/P-03/P-06                                   |
| 07_GOOGLE_APPS_SCRIPT_INTEGRATION.md | Modos A/R, fuentes, mapeos, registro de servicio y sincronización     | Sólo diseño futuro; diferencias de scopes, links en R y alcances de reconciliación                         |
| 08_SECURITY.md                       | Identidad, grants, RLS, ataques, secretos, backups/legal              | Preservar seguridad existente; corregir excepciones de helpers, caché y regex de parámetros                |
| 09_UX_UI_SPECIFICATION.md            | Navegación, portal, paneles, componentes, PWA                         | Tema claro contradice identidad aprobada; undo barbero no puede eludir permiso de revert                   |
| 10_IMPLEMENTATION_ROADMAP.md         | S0–S13, DoD, esfuerzos y dependencias                                 | No acredita desarrollo ni cierre; adelanta integración/feed a S3 y depende circularmente de S10 en S8      |
| 11_TESTING_STRATEGY.md               | Unit/SQL/API/E2E, catálogo, concurrencia, feed y mapeos               | Catálogo futuro, no suites ejecutadas; adaptar no_show y barridos, excepciones deny-all e identidad real   |
| 12_DEPLOYMENT_OPERATIONS.md          | Ambientes, CI/CD, variables, jobs, backup y runbooks                  | No reemplazar configuración local; mantenimiento no equivale a public_booking_enabled=false                |
| 13_ARCHITECTURAL_DECISIONS.md        | ADR001–022 propuestos y revisiones                                    | Colisión de ADR022 y ausencia de ADR023 histórico; ADR013 mantiene caché de autorización                   |
| CHANGELOG.md                         | Siete hallazgos, cambios y supuestos de la revisión                   | Dice decisiones adoptadas, pero ADR siguen propuestas; no es acta de aprobación                            |
| CODEX_IMPLEMENTATION_GUIDE.md        | Plantilla AGENTS, TDD, sprints y gates                                | No copiar plantilla pnpm/rutas antiguas ni interpretar documentos como permiso de reset/implementación     |

También se contrastaron originales 01–14, guía, informes/diseños y catálogo, las cinco
migraciones, módulos reales de businesses/auth, configuración, handlers, scripts y
tests. Referencias faltantes relevantes de V11: `supabase/permissions.json`, tipos
generados de negocio, `docs/BACKLOG.md` y `/api/v1/openapi.json` no existen como
implementación actual. No se inventa su contenido.

## 2. Matriz de reconciliación

Arquitectura e implementación se clasifican por separado. IVL = implementado y
verificado localmente **en reportes históricos**; IPV = implementado pendiente de
verificar el requisito completo; EA = especificado/aprobado; PP = propuesto pendiente;
NI = no implementado; BD = bloqueado por decisión. Riesgo A/M/B = alto/medio/bajo;
no representa una evaluación de explotación ejecutada.

Las rutas de evidencia son relativas a la raíz del proyecto; los identificadores
C-xx remiten al informe de estado. La columna pruebas indica lo existente o lo que
debe diseñarse, nunca una ejecución nueva.

| Componente/requisito       | Referencia                 | Estado arquitectónico                                      | Implementación             | Evidencia real                             | Pruebas disponibles                           | Diferencia                                                                      | Riesgo | Acción recomendada                                                                  | Sprint                  |
| -------------------------- | -------------------------- | ---------------------------------------------------------- | -------------------------- | ------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------- | ----------------------- |
| Stack/monolito             | V11/03, AGENTS             | EA conservar                                               | IVL                        | package.json, src/app/modules/lib          | unit/E2E históricos                           | Plantilla cambia npm/directorios                                                | M      | Conservar estructura y lockfile                                                     | Todos                   |
| Identidad visual           | V11/09 §1.5, BRAND_GUIDE   | EA marca oscura                                            | IVL                        | globals.css, brand-logo.tsx, public/brand  | landing E2E                                   | V11 tema claro                                                                  | M      | Excepción explícita de marca; no recolorear                                         | S4–S8                   |
| Multi-tenancy base         | V11/04 §3.1–5, H-ADR022    | EA base                                                    | IVL                        | init_tenancy + auth_memberships            | tenancy/auth pgTAP                            | V11 plan S1 no conoce adelanto de identidad                                     | A      | Reutilizar tablas/FKs/RLS; sólo expansiones                                         | S3                      |
| Privilegios app_server     | V11/04 §4.1                | EA sin tablas                                              | IVL                        | primera y tercera migración, catalog       | ACL y objetos futuros en pgTAP                | Ejemplo V11 sólo revoca defaults por schema                                     | A      | Conservar revocación global y grants explícitos                                     | S3                      |
| Contexto sesión/MFA        | V11/08 §2–3                | EA seguridad; PP nuevos tipos                              | IVL base / NI ctx genérico | auth.require_member, server.ts             | Auth real E2E y SQL                           | V11 dice MFA S3 y S2; no app.ctx actual                                         | A      | Mantener MFA S2; diseñar adaptación sin rehacer login                               | S3-A                    |
| Membresías                 | V11/04 §3.5, 05 §2.7       | EA funcional                                               | IVL                        | api.invite/update/accept/manage_invitation | auth.test.sql, auth.spec.ts                   | api.manage_member genérico no existe                                            | M      | Mantener wrappers públicos y core privado                                           | S3                      |
| Regla de parámetros        | V11/08 §3.2, 11 §12        | PP regla de catálogo                                       | IPV respecto a V11         | p_role/p_member_id en RPC y core           | catálogo actual y tests de escalamiento       | Regex prohíbe también rol deseado y miembro destinatario                        | A      | Prohibir autoridad falsificada; catalogar argumentos de recurso legítimos           | S3-A                    |
| RLS/helpers                | V11/04 §4, 08 §4           | EA aislamiento; PP DML alternativo                         | IVL base                   | is_active_member, grants SELECT            | tenancy.test.sql                              | Helpers ilustrativos omiten controles; V11 admite DML configuración             | A      | Helpers acotados con MFA/negocio vigente; writes por RPC                            | S3–S5                   |
| Lectura privada de negocio | V11/02 §6, 05 §2.1         | EA límite por rol en diseño; adopción compatible pendiente | IPV para nuevo alcance     | Policies/grants S1 y helper S2             | falta prueba de columnas privadas por barbero | C-08: SELECT de fila completa a miembros, incluido barbero                      | A      | Proyección mínima y operación privada por rol; no confiar sólo en ocultar UI        | S3-A/B                  |
| Matriz canónica            | V11/02 §6, 04 §3.22        | PP adopción técnica                                        | NI / can manual IVL        | auth/permissions.ts                        | authorization.test.ts                         | No JSON/SQL/generador o equivalencia                                            | A      | Proponer fuente única y transición compatible                                       | S3-A/B                  |
| Soporte plataforma         | V11/04 §3.4, 10/S2         | PP flujo futuro                                            | NI salvo tabla             | platform_admins, api.me                    | no soporte E2E                                | support_grants no existe; nuevo alcance retroactivo                             | A      | Deny-all mientras no se apruebe soporte temporal                                    | Antes de soporte/piloto |
| Orden HTTP                 | V11/05 §1.8                | EA identidad primero                                       | IPV                        | auth/http.ts:67, service.ts                | falta caso combinado auth/If-Match            | C-01: puede clasificar 428 antes de autenticar                                  | M      | Diseñar pruebas y corrección compatible                                             | Paquete S2/S3-A         |
| Locks S2                   | V11/08 identidad, 06 locks | EA autorización                                            | IPV para pre-lock          | auth migration:142–143; lifecycle          | SQL funcional, no abuso de contención         | C-02: lock antes de validar actor                                               | M      | Prevalidar y revalidar tras coordinación; medir                                     | Paquete S2/S3-A         |
| Errores/ETag               | V11/05 §1.2–3              | EA 428/412/409; PP nuevo contrato                          | IVL parcial / IPV          | auth/http.ts, service.ts                   | E2E carrera 200/412                           | PRECONDITION_FAILED/PTxxx vs VERSION_CONFLICT/TSxxx; ETags parciales; comillas  | M      | Adaptador/compatibilidad explícitos; no reescribir SQL aplicado                     | S3–S6                   |
| Trazabilidad               | V11/05 §1.7                | EA propósito                                               | IPV                        | http requestId aleatorio, audit p_key      | no prueba de correlación                      | C-03: request_id distinto entre HTTP/SQL                                        | M      | Separar requestId de key y probar propagación                                       | Paquete S2/S3-A         |
| Paginación                 | V11/05 §1.4                | EA objetivo                                                | IPV                        | list_members, http next_cursor=null        | tests de listado base                         | Sin paginación real de miembros                                                 | M      | Contrato de cursor/limit para nuevos listados y adaptación                          | S3–S4                   |
| Auditoría                  | V11/04 §3.16               | EA append-only; PP formato                                 | IVL base                   | audit_logs UUID/before_data/after_data     | inmutabilidad pgTAP                           | bigint/before/after/request_id text en V11                                      | M      | Mapear semántica; expansión compatible, no conversión destructiva                   | S3-A/B                  |
| Idempotencia               | V11/04 §3.19, 05 §1.7      | EA atomicidad; BD secretos                                 | IVL miembros / NI reservas | app.member_requests                        | replay/mismatch SQL                           | V11 PK sin actor, hash body insuficiente, TTL ausente actual                    | A      | Clave por autoridad+operación+intención+precondición; TTL y replay autorizado       | S3/S6                   |
| Token de reserva           | V11/02 RN11, 08 §2         | PP/BD ciclo de vida                                        | NI                         | sólo token de invitación distinto          | tests futuros                                 | RN11 un uso contradice cancel/reprogramar repetido                              | A      | Elegir token reutilizable revocable o rotación completa aprobada                    | S3-A/S6/S7              |
| Settings de atención       | V11/02 §2, 04 §3.2         | PP nuevos defaults                                         | NI                         | settings S1 sin columnas nuevas            | futuros SQL/políticas                         | Nuevas guardas/ventanas no aprobadas como producto                              | M      | Acordar semántica/defaults, agregar sólo columnas aprobadas                         | S3/S6                   |
| Ocupación P-02             | V11/04 §3.13, 06 §2/4.5    | Provisional A; BD SQL                                      | NI/BD                      | No appointments en migraciones             | B49 etc son especificación                    | V11 libera no_show, pedido conserva historia                                    | A      | Detener predicado/DDL dependiente y cerrar decisiones                               | S3-A/B/S6               |
| Integridad temporal        | V11/04 §3.13               | PP detalles, EA invariantes                                | NI                         | Sin appointments/trigger                   | B42–45 futuros                                | Triggers/checks y permiso de ajuste deben diseñarse; GUC no acredita actor      | A      | Derivados exactos, snapshots protegidos y pruebas multi-zona                        | S3/S6                   |
| Slots/buffer               | V11/06 §3, RN04            | EA regla; PP algoritmo                                     | NI                         | availability vacío                         | B04–07 futuros                                | Pseudocódigo resta bloqueos pero no compara buffer contra ellos                 | A      | Test: servicio termina al inicio de bloqueo, buffer invade; debe denegar            | S5                      |
| Protocolo P-03             | V11/06 §4.3–6              | BD cierre                                                  | NI                         | Ningún escritor de agenda                  | B31–41 futuros                                | Staff→reserva no cubre globals; transición describe reserva antes de staff      | A      | Orden completo y coordinación global; ver registro                                  | S3-A/S5/S6              |
| Mapeos P-04                | V11/04 §3.18, 07 §4        | PP columnas tipadas                                        | NI/BD                      | Sin mapeos                                 | M01–14 futuros                                | M5 inmutable vs M9 merge; needs_review exige destino                            | A      | Diseñar excepciones verificadas/staging; decidir fase física                        | S3-A/S10                |
| Barridos P-05              | V11/04 §3.20, 05 §4, 07 §6 | EA estrategia MVP por pedido; PP feed                      | NI                         | Sin log/feed/reconcile                     | Fxx/Rxx sólo diseñados                        | V11 exige xid8/feed y dos ventanas incompatibles                                | A      | Fallback completo; feed retirado del camino crítico hasta prueba/aprobación         | S10/S11                 |
| Privacidad/authz vigente   | V11/08 §3, ADR013          | EA sin caché de autoridad                                  | IVL S2                     | SQL consulta membresía actual              | suspensión E2E                                | ADR013 nuevo mantiene caché corto                                               | A      | Sin caché de permiso/credencial en operaciones                                      | S3–S11                  |
| GAS identidad P-08         | V11/07 §2.3                | EA lectura; BD escritura                                   | NI                         | No GAS en repo                             | spike no ejecutado                            | UserProperties declarado seguro sin demostración; falta evidencia de despliegue | A      | Modo R/B lectura como entrega base, spike dos cuentas antes de A                    | S10/S11                 |
| GAS mapeos/links           | V11/07 §2.3/5.2 vs 05 §2.7 | PP/BD permiso y flujo                                      | NI                         | Sin contratos implementados                | futuros API/GAS                               | 07 prohíbe mappings a integración, 05 permite; R omite link PG                  | A      | Panel autenticado/import/conciliación; no perder requisito de vínculos sin decisión | S8/S10/S11              |
| UX undo                    | V11/09 §5 vs 02 §3         | PP solución                                                | NI                         | Sin operaciones de turno                   | E2E futuros por rol                           | Barbero undo 5s no puede ejecutar revert admin                                  | A      | Demorar envío/confirmar antes de commit, o cambio de producto explícito             | S8                      |
| Variables/arranque         | V11/12 §3, guía            | EA preservar contrato actual                               | IVL actual                 | supabase/config.ts, auth-admin.ts          | supabase-config unit                          | ANON/SERVICE_ROLE nombres nuevos y fail-fast global                             | M      | Capacidad lazy y nombres actuales; alias sólo si se aprueba                         | S3–S13                  |
| CI/seguridad release       | V11/11/12, 10 DoD          | EA gates como objetivo                                     | NI/parcial                 | .github/workflows/ci.yml                   | sólo pipeline local definido                  | Sin CI remoto/coverage/WebKit/ZAP/restore acreditados                           | A      | Incorporar progresivamente y certificar antes del piloto                            | S3–S13                  |
| S8 depende de S10          | V11/10 S8/S10              | PP reordenamiento                                          | NI                         | Ninguna pantalla de integración            | futuros E2E                                   | S8 no puede operar credenciales/import antes de API S10                         | M      | S8 core; integración S8-I tras S10 o adelanto expresamente aprobado                 | S8/S10                  |
| Restauración               | V11/12 §6                  | PP runbook                                                 | NI                         | Sin modo mantenimiento global              | restore futuro                                | public_booking_enabled=false no congela staff/integración/workers               | A      | Mantenimiento real por todas las fronteras; rehearsal aislado                       | S12/S13                 |

## 3. Hallazgos transversales adicionales

1. **Reconciliación de contenido**: V11/05 §4.2 usa checksum `id:version`; V11/11
   R-02 promete detectar una edición manual del estado local. Si ID y versión no
   cambian, ese checksum no la detecta. Definir proyección canónica/hash de contenido
   o reparar mediante barrido completo; no prometer más de lo que compara.
2. **Ventanas históricas**: V11/05 propone hoy−30/+60 y V11/07 hoy−7/+30. Ninguna
   asegura KPIs históricos ni reprogramaciones que salgan del rango. Aprobar alcance
   y barridos históricos/tombstones, no borrar por ausencia en páginas parciales.
3. **Retención/replica**: cambiar expiración, replay o versionado requiere criterio
   de purga y bootstrap con snapshot/límites estables. Un TTL por sí solo no prueba
   recuperación tras crash, commit tardío o pérdida de cursor.
4. **Ausencia de bloqueos**: V11/01 §6 dice que nada bloquea S0–S5; no aplica a
   P-02/P-03/P-06 de esta tarea. Los tests B49 y el predicado deben cambiarse para A.
5. **Temporalidad del catálogo**: vigencias futuras de horarios y reservas históricas
   deben conservar referencias/snapshots; crear turno en el pasado, liberar una
   ocupación y corregir un resultado son capacidades diferentes, no override genérico.
6. **Nuevo soporte no heredado**: V11 ubica support_grants en S2; no se declara
   incumplimiento del alcance S2 previamente autorizado ni se crea soporte ahora.
7. **MFA de tokens de integración**: cerrar cómo se mantiene el nivel exigido para
   acciones privilegiadas al emitir/rotar/usar user_token. Un token largo no prueba
   que un operador actual superó MFA ni que GAS aisló las credenciales.
8. **Módulos y documentación**: plantilla nueva ubica ui/test/e2e distinto del repo,
   usa pnpm y propone AGENTS de cero. Preservar P-07, npm y tests actuales.

## 4. Prioridad y ruta de adopción

**Antes de cualquier DDL S3 dependiente:** P-02, token de gestión, permisos/contratos
de versión, recurso de control global P-06, protocolo P-03 y límites S3/S10. ADR
deben identificar versión; no aprobar V11-ADR022 por citar el H-ADR022 existente.

**Paquete S2 compatible a proponer:** C01–C07, trazabilidad, paginación/ETags,
canónico de permisos, eventual soporte con aprobación propia. Mantener endpoints,
roles y datos; nuevas migraciones únicamente si el usuario autoriza implementarlo.

**S3 dividido:** S3-A aprobación de diseño y matriz; S3-B esquema autorizado por
lotes. Sin feed ni GAS anticipados. Mapeos tipados, credenciales y UI de integración
se preparan conceptualmente y se implementan según la fase aprobada del roadmap.

No existe aprobación automática de ninguna acción recomendada de esta matriz.
La siguiente entrega autorizable se delimita en SPRINT_3_DESIGN_PROPOSAL.md.

## 5. Fundamento técnico y límites

La revocación por schema no quita un permiso concedido globalmente: conservar la
migración tercera y su prueba de objetos futuros. [PostgreSQL 17 — defaults](https://www.postgresql.org/docs/17/sql-alterdefaultprivileges.html).
El orden completo de recursos y evitar adquirir locks después de otros de orden
inferior son requisitos del protocolo propuesto; su ausencia puede producir ciclos.
[PostgreSQL 17 — locks](https://www.postgresql.org/docs/17/explicit-locking.html).
Las funciones de snapshot explican xmin/xid, pero no acreditan por sí solas la
garantía end-to-end del feed de V11. [PostgreSQL 17 — snapshots](https://www.postgresql.org/docs/17/functions-info.html#FUNCTIONS-PG-SNAPSHOT).

Los contraejemplos funcionales y recomendaciones anteriores son análisis de las
especificaciones/código, no ejecuciones experimentales ni certificación de concurrencia.
Precios, cuotas, proveedores y normativa citados por V11 no fueron verificados aquí;
requieren revisión operativa/legal antes de contratar o publicar.
