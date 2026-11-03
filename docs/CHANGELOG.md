# Registro de cambios de especificación

## 2026-11-03 — Reconciliación de exposición de Data API

Corrección explícita del runbook y errata en STAGING_PROVISIONING_REPORT.md: el
cliente de sesión necesita api además de public, como ya configura el CLI. Nuevo
STAGING_DATA_API_CONTRACT.md distingue exposición, grants y RLS; app/app_internal
no se exponen. Dos tests de configuración y dieciséis comprobaciones HTTP reales
en entorno descartable protegen ese contrato. Sin cambios al runtime, roles,
migraciones, main, servicios alojados o datos del propietario. Resultados en
STAGING_DATA_API_RECONCILIATION_REPORT.md. No se reinterpretan los quince documentos
históricos formateados ni se renueva automáticamente el permiso de commit/push.

## 2026-11-02 — Publicación inicial del código en rama de staging

Autorización explícita de commit/push exclusivamente a codex/staging-readiness,
sin PR, merge, main, deploy o migraciones remotas. Quince Markdown históricos de
arquitectura-v1.1 reciben sólo Prettier; se compara su estructura Markdown y
ejemplos canónicos contra la copia previa. Se publica el código acumulado existente,
con inventario explícito, detección de patrones/alta entropía y revisión de valores
sintéticos, configuración y artefactos privados. No hay cambios funcionales.
El informe local de publicación conserva el SHA real y la verificación remota,
fuera del commit que identifica: test-results/publication-audit/PUBLICATION_REPORT.md.

## 2026-11-02 — Destinos de staging, pooler y revisión GitHub

Usuario creó Supabase merivo-turnos-staging kuqtskhtsvpluhalxiav; se verificaron
estado Healthy, ausencia de migraciones y exposición automática desactivada.
Ecosistema Merivo aadrzawmzrstpyuluxqk permanece intacto/excluido. Vercel sin proyecto;
GitHub público sólo docs, inspeccionado con autorización posterior de sólo lectura.
Validador backend acepta app_server.PROJECT_REF únicamente con referencia pinada y
host/puerto de pooler admitidos. Preflight offline detecta proyectos cruzados y
mantiene readyForBookings=false. Nuevos manifest/revisión de publicación/informe;
.vercel ignorado. Sin SQL nuevo, cambios de dependencias, commit, push o despliegue.
Ver STAGING_PROVISIONING_REPORT.md y GITHUB_PUBLICATION_REVIEW.md.

## 2026-11-02 — Antiabuso y gate de staging del portal público

Continuación pedida tras elegir Vercel + Supabase. Adaptador server-side Turnstile,
desafío ligado a nonce/acción y widget accesible. Identidad de red desde Vercel
directo pinado, HMAC por negocio y cuotas PostgreSQL existentes. Modo staging
Preview con origen/proyecto y claves independientes; producción rechazada.
Migración 18, sin editar las diecisiete anteriores: gate privado cerrado, máximo
24 h, auditoría y revalidación tras lock; aplicada sólo a pruebas descartables.
Sin despliegue, secretos reales, cambios de cuentas/MFA/instancia del propietario,
emails, GAS, commit o push. Evidencia en PUBLIC_PILOT_ANTIABUSE_REPORT.md.

## 2026-11-02 — Preparación operativa del piloto público

Pedido de preparar piloto seguro; hosting Vercel + Supabase confirmado por el
usuario. Nuevo PUBLIC_PILOT_RUNBOOK.md con etapas, separación de entornos, gates,
pruebas HTTPS, recuperación y cierre. Herramienta npm run pilot:keys para backup
cifrado fuera del repositorio, verificación sin exportar claves y drill sintético
en disco; reutiliza el módulo criptográfico existente. Nuevas pruebas de CLI.
Sin cambios de schema, grants, gates públicos, UI o dependencias; sin despliegue,
provisión remota ni operaciones sobre la base/cuentas/MFA del propietario.
No se considera cerrado el antiabuso productivo ni habilitado el piloto. Resultados
de esta preparación en PUBLIC_PILOT_PREPARATION_REPORT.md.

## 2026-11-02 — PB-02/03/04/05 aprobados para entorno descartable

El usuario aprobó expresamente PB-D02…D10 con condiciones adicionales de custodia,
recuperación, antiabuso, actor público y pruebas concurrentes. Nueva migración 17
sin alterar las dieciséis fuentes anteriores; motor de escritura y snapshot HS
extraídos a helpers privados compartidos. Capacidad anónima por intención, replay
cifrado, autogestión por token y cuotas persistentes. La escritura está bloqueada
fuera de configuración y marcador privado de entorno descartable. No se habilitan
reservas reales ni se aplica a la instancia del propietario. AGENTS registra la
aprobación posterior; las propuestas históricas no se reescriben. Contratos,
evidencia y riesgos en PUBLIC_BOOKING_IMPLEMENTATION_REPORT.md; custodia en
PUBLIC_BOOKING_KEY_CUSTODY.md.

## 2026-11-02 — PB-01, primer tramo del portal público

Tras «avanza con el resto» se desarrolla el catálogo público comercial, independiente
de crear reservas anónimas. Nueva proyección app_internal.get_public_catalog sólo
para app_server, nueva API de lectura y pantalla /b/{slug}. Respeta el modo público
del negocio, elegibilidad online y precios/duraciones efectivos; sin clientes,
agenda, notas o configuración privada. Sin nueva activación local, envíos o hosting.
Las decisiones pendientes de identidad/capacidad anónima y P-06 se concretan en
PUBLIC_BOOKING_MVP_PROPOSAL.md para aprobación, sin convertirlas en código aprobado.
Informe: [PUBLIC_CATALOG_IMPLEMENTATION_REPORT.md](PUBLIC_CATALOG_IMPLEMENTATION_REPORT.md).

## 2026-11-02 — Activación local de clientes, horarios y turnos

El usuario indicó «avanza con el siguiente paso» tras la propuesta concreta de
respaldar y aplicar los tres módulos pendientes a su entorno local. Se ejecutó
scripts/activate-local-booking.mjs --apply-local con respaldo pg_dump custom
verificado, comprobación de destino, hashes SQL y preservación de filas. Historial
de 12 a 15; las 39 tablas previas sin cambios y las 13 nuevas vacías. No se cargaron
fixtures ni se modificaron cuentas/MFA. Se agrega el script operativo y el informe
[LOCAL_BOOKING_ACTIVATION_REPORT.md](LOCAL_BOOKING_ACTIVATION_REPORT.md); AGENTS
registra esta autorización posterior sin reescribir los informes históricos.

## 2026-11-02 — Turnos internos IN-01/02/03 autorizados

El usuario aprobó explícitamente IN-D01…IN-D10 y la representación/predicado de
ocupación de la sección 3 de INTERNAL_BOOKING_MVP_PROPOSAL.md. La implementación
limitada permite agenda owner/admin con MFA y crear, reprogramar o cancelar turnos
futuros. Nueva migración 15; las catorce anteriores se conservan. Ocupación separada
con EXCLUDE sobre asignaciones no liberadas, snapshots y evento/audit/outbox/replay
atómicos. HS descuenta ocupación real y rechaza cambios que invaliden turnos futuros;
la proyección acotada de conflictos se valida antes de devolverla por HTTP.
AGENTS registra esta aprobación, sin reescribir las propuestas históricas. Sólo
pruebas descartables: no se activa en el propietario ni se implementan portal,
estados de atención, notificaciones o integración GAS. Resultados y contratos en
[INTERNAL_BOOKING_IMPLEMENTATION_REPORT.md](INTERNAL_BOOKING_IMPLEMENTATION_REPORT.md).

## 2026-11-02 — Horarios HS-01/02/03 autorizados

El usuario aprobó HS-D01…HS-D10 del diseño y su implementación sólo en descartable.
Se agregan planes semanales versionados por staff, excepciones, bloqueos y control
global independiente, con vista previa informativa y reglas DST. Cierre global
prevalece sobre apertura individual. Se conserva raíz exclusiva S2; no se implementa
el protocolo de reservas SHARE/UPDATE ni EXCLUDE. AGENTS registra el alcance aprobado;
las propuestas históricas se preservan. Sin aplicación a la instancia del propietario.
Detalle en [SCHEDULING_IMPLEMENTATION_REPORT.md](SCHEDULING_IMPLEMENTATION_REPORT.md).

## 2026-11-02 — Clientes: CM-01/CM-02 y UI CM-05 autorizados

El usuario aceptó explícitamente CD-01…CD-06 y autorizó implementar/probar el mínimo
administrativo de clientes sólo en entorno descartable. Nueva migración posterior
a las doce existentes; directorio, búsquedas keyset, notas privadas, bajas lógicas,
versiones, auditoría e idempotencia. Contactos compartidos permitidos, sin Auth para
clientes. Se actualiza AGENTS para registrar este alcance; las propuestas originales
no se reescriben. Sin marketing, barber, reservas ni aplicación al propietario.
Resultados y límites en [CUSTOMER_IMPLEMENTATION_REPORT.md](CUSTOMER_IMPLEMENTATION_REPORT.md).

## 2026-11-01 — Activación local del catálogo autorizada

El usuario autorizó expresamente aplicar las migraciones pendientes en su entorno
local, con respaldo previo y sin reset ni cambios de cuentas/MFA. Se aplicaron
20261101000500…20261101000900 mediante CLI --local; historial final de doce versiones.
Comparación de huellas de catorce tablas protegidas sin cambios. No se cargaron
fixtures ni se realizaron pruebas de escritura en esta instancia. AGENTS y el
informe de catálogo registran la activación posterior; no cambian SQL ni aplicación.
Detalle en [LOCAL_CATALOG_ACTIVATION_REPORT.md](LOCAL_CATALOG_ACTIVATION_REPORT.md).

## 2026-11-01 — Catálogo de profesionales y servicios autorizado

El usuario aprobó expresamente el bloque de catálogo: ARS, duración 5–480 minutos,
buffer 0–120, gestión owner/admin con MFA, consulta de barberos, perfiles con/sin
cuenta y bajas lógicas que conservan vínculos. Se incorpora una migración nueva,
RPC con proyecciones explícitas, API, pantallas Merivo y pruebas descartables.
AGENTS.md se actualiza para registrar esta excepción al alcance S2 anterior.
No se aprueban reservas, EXCLUDE ni el resto de decisiones S3-A. Las propuestas
originales permanecen intactas. Contratos y resultados en
[CATALOG_IMPLEMENTATION_REPORT.md](CATALOG_IMPLEMENTATION_REPORT.md).

## 2026-11-01 — A-M06 autorizado: C-06

Reconocimiento de replay por 48 horas desde created_at, expiración lógica independiente
de purga, limpieza privada por lotes 1…500 y SKIP LOCKED. Conserva guardas/versiones
S2, auditoría, invitaciones y trazabilidad. Migración nueva; diez anteriores intactas.
Validación SQL/concurrencia/HTTP sólo descartable, sin scheduler ni DB del propietario.
Detalle en [S2_AM06_REPORT.md](S2_AM06_REPORT.md). Sin S3, GAS, commit, push o despliegue.

## 2026-11-01 — A-M04/A-M05 autorizados: C-03 y C-04

Correlación UUID por intento HTTP/acción, origin_request_id nullable sin reescritura
histórica y paginación keyset opt-in con RPC nueva. Equipo navega páginas de 50 sin
cambiar la identidad visual; legado completo e invitaciones por guard específico.
Dos migraciones nuevas; ocho anteriores intactas. Validación SQL, concurrencia,
HTTP y navegador exclusivamente descartables; nada aplicado al propietario.
Detalle en [S2_AM04_AM05_REPORT.md](S2_AM04_AM05_REPORT.md). C-06 y S3 fuera de alcance.

## 2026-11-01 — A-M03 autorizado: C-01, C-02 y C-07

Nueva migración de preautorización/revalidación de membresías e invitaciones, orden
raíz→replay→miembro→invitación, precondiciones después de autorización y guard
específico para envío Auth. Pruebas descartables con conexiones independientes.
Las siete migraciones previas se preservan; ninguna operación DB sobre el propietario.
Archivos, evidencia y límites en [S2_AM03_REPORT.md](S2_AM03_REPORT.md).
Sin C-03/C-04/C-06, S3, despliegue, commit ni push.

## 2026-11-01 — Correcciones S2 A-08 y A-05 autorizadas

Únicamente proyección privada con MFA/revocación de SELECT amplio y clasificación
específica de LAST_OWNER. Dos migraciones adicionales; las cinco históricas intactas.
Pruebas y compatibilidad en [S2_SECURITY_FIX_REPORT.md](S2_SECURITY_FIX_REPORT.md);
catálogo de funciones actualizado. No se implementa el resto del paquete A ni S3.

Aplicación local posterior autorizada: ambas migraciones aplicadas mediante
`db:migrate` tras respaldo cifrado DPAPI excluido de Git. Trece checks SQL de solo
lectura y smoke HTTP correctos; metadatos de cuentas/MFA/negocio sin cambios.
Detalle y límites de respaldo en el informe. Sin reset, cuentas nuevas ni cambios remotos.

## 2026-10-31 — Consolidación previa al Sprint 1

Motivo: incorporar 14.A–G y retirar instrucciones incompatibles. Sólo Markdown;
se preservaron cambios locales previos y doc 14 íntegro. Sin migraciones ni código.

| Archivos                                                                 | Cambios                                                                                                                    |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| 01_PRODUCT_VISION, 02_FUNCTIONAL_REQUIREMENTS                            | Modo B sólo lectura, gestión individual preservada, reconciliación MVP, token de gestión y propuesta histórica explícita.  |
| 03_SYSTEM_ARCHITECTURE, 04_DATABASE_DESIGN                               | Autoridad en BD, propuesta de privilegios/RLS/helpers, igualdades temporales, mapeos/versiones y protocolo común de locks. |
| 05_API_SPECIFICATION, 06_BOOKING_ENGINE                                  | 428/412/409, ETag/If-Match, replay atómico, contexto interno, locks/reintentos, snapshots y feed reservado.                |
| 07_GOOGLE_APPS_SCRIPT_INTEGRATION, 08_SECURITY, 09_UX_UI_SPECIFICATION   | Sin escritura compartida; Modo A validado, flujo autenticado/conciliación, actor real, revocación y conflictos/undo.       |
| 10_IMPLEMENTATION_ROADMAP, 11_TESTING_STRATEGY, 12_DEPLOYMENT_OPERATIONS | Gates por sprint, dependencia S1/S2, plan de pruebas A–G, barridos, variables y recuperación/migraciones.                  |
| 13_ARCHITECTURAL_DECISIONS                                               | Revisiones ADR-003/007/008/013/017; nuevos ADR-019/020/021, propuestas no aprobadas identificadas.                         |
| CODEX_IMPLEMENTATION_GUIDE, AGENTS.md, README.md                         | Precedencia, npm/estructura real, referencias reparadas, límites y reglas consolidadas.                                    |
| CONSOLIDATION_REPORT.md (nuevo)                                          | Trazabilidad A–G, inconsistencias, riesgos/propuestas P-01…P-08 y checklist S1.                                            |

Cambios funcionales justificados: acciones y vínculos se conservan con identidad
individual en lugar de credencial compartida; reportes se conservan con fallback
de 14.D en lugar de prometer un feed incompleto. La recomendación de no_show no se
aprueba por esta edición. No se eliminan servicios ni se amplía el MVP.

Pendientes y aceptación: ver informe. No se considera implementado S1, aprobado un
PR, verificada seguridad de BD ni realizada revisión legal por consolidar documentos.

## 2026-10-31 — Sprint 1, variante recomendada aprobada

El usuario aprobó P-01/P-07 expresamente: se adelantan sólo identidad/membresía base
para pruebas de aislamiento, sin login. ADR-022 y SPRINT_1_DESIGN.md registran la
matriz y responsabilidades. Se implementan tres migraciones locales inmutables,
catálogo de funciones, RLS, lectura pública con Postgres.js y app_server restringido,
provisionamiento local sin secretos en Git, pgTAP/HTTP/unit y job CI de BD.
El segundo SQL habilita SET ROLE app_server para mantenimiento (no la dirección
inversa). El tercero corrige el default global EXECUTE PUBLIC demostrado por tests.
No se incorporaron reservas, disponibilidad, Auth funcional, integraciones o despliegues.
Resultados y límites: SPRINT_1_REPORT.md. No se modificó la landing ni se hizo commit/push.

## 2026-10-31 — Identidad visual Merivo

Pedido explícito del usuario: llevar el logo y la paleta de sus publicaciones a la
UX/frontend de TurnosMerivo. Se conserva el PNG original en public/brand, se agrega
BrandLogo reutilizable y favicon, y se reemplaza la paleta verde/clara por tokens
negro/carbón, rubí, blanco/gris y dorado. Button y landing adoptan los tokens.
BRAND_GUIDE.md documenta la paleta de implementación derivada de referencias; 09 y
AGENTS fijan la misma identidad para las pantallas futuras. Se extiende E2E para
verificar carga del logo. No se crean pantallas funcionales ni cambios de backend/BD.

## 2026-10-31 — Sprint 2 autorizado: acceso y permisos reales

- Usuario eligió Sprint 2. Auth SSR oficial con @supabase/ssr, cookies HttpOnly,
  MFA TOTP, selector y pantallas de equipo con identidad Merivo.
- Dos nuevas migraciones locales: identidad Auth, platform_admins/audit base,
  operaciones de membresía con locks/versionado/idempotencia/auditoría, invitaciones
  hasheadas de un uso/7 días, rotación/revocación. Sin editar migraciones S1.
- api expuesto con EXECUTE mínimo; app/app_internal privados, app_server intacto,
  service_role sólo Auth Admin. Proveedor email activo y registro público bloqueado.
- Herramientas locales de configuración/bootstrap sin imprimir secretos; plantilla
  de correo OTP capturada por Mailpit. Sin modificar GAS ni iniciar catálogo/reservas.
- Se actualizan AGENTS, README, docs 04/05/08/10/12/13 y guía; se agregan diseño e
  informe S2 y catálogo de funciones. Cambios de especificación indicados expresamente:
  nombres físicos de snapshots y UUID en auditoría base, separación alta/invitación.
- can() probado por matriz; pgTAP con identidades/MFA, E2E reales en escritorio/móvil.
  Se añade job E2E a CI local de BD; CI remoto no ejecutado. Resultados finales en informe.
- next.config deshabilita generación automática de reglas para preservar AGENTS.
  Sin commit, push o despliegue.

## 2026-11-01 — Corrección del QR de MFA en desarrollo

- Supabase devuelve un data URL SVG con XML sin codificar y saltos de línea.
  next/image lo rechazaba en desarrollo; las pruebas previas sólo usaban producción.
- Se normaliza el payload SVG mediante codificación URI, preservando SVG ya codificado
  o base64, sin modificar el QR ni la clave de setup. No se imprime contenido MFA.
- Regresión unitaria reproduce el rechazo de Next en desarrollo con XML sintético;
  E2E comprueba complete/naturalWidth del QR y ausencia de errores de página.
- Playwright permite modo desarrollo y un puerto de producción alternativo; se
  conserva el servidor del usuario y las pruebas usan cuentas temporales locales.
- La suite completa de desarrollo supera ingreso/QR/verificación MFA, pero falla
  después al usar el fragmento de invitación. No se declara resuelta esa incidencia
  ni se cambia su flujo en esta corrección. En producción pasan los cuatro E2E.
- Archivos: src/modules/auth/qr-code.ts, src/components/auth/forms.tsx,
  tests/unit/mfa-qr.test.ts, tests/e2e/auth.spec.ts, playwright.config.ts y estos registros.
- No se modifican factores ni credenciales de la cuenta del usuario, SQL o permisos.
- Validaciones: 62 unitarios, lint, formato y tipos aprobados; build y cuatro E2E
  de producción aprobados. Regresión Next en modo desarrollo reproducida con SVG
  sintético y corregida; la suite completa dev conserva el fallo posterior indicado.

## 2026-11-01 — Invitaciones en desarrollo: origen loopback

- Se identificó la causa del fallo pendiente: Next dev aceptaba el WebSocket de
  hidratación/HMR desde localhost, pero rechazaba su Origin desde 127.0.0.1.
  Las páginas SSR y acciones progresivas respondían, pero el botón de fragmento no
  tenía hidratación disponible. No era un fallo de permisos ni de la invitación SQL.
- next.config.ts autoriza exclusivamente 127.0.0.1 mediante allowedDevOrigins.
  Sin comodines, sin cambiar Origin/Host de APIs, cookies, roles, RLS o credenciales.
- Prueba de handshake local sin sesión: origen loopback pasa a 101; origen externo
  sigue Unauthorized. Los cuatro E2E completos pasan en desarrollo, escritorio/móvil.
- CI incorpora la misma suite en modo desarrollo; Playwright inicia next dev con
  su hostname habitual para cubrir el caso original, usando la URL loopback.
- Archivos: next.config.ts, playwright.config.ts, .github/workflows/ci.yml,
  CHANGELOG y SPRINT_2_REPORT. Se conserva el servidor y la cuenta del usuario.
- Sin SQL nuevo, migraciones, reset, commit, push ni despliegue.
- Validación final: lint/formato/tipos y 62 unitarios aprobados; build y cuatro E2E
  de producción en puerto 3107 aprobados, además de cuatro E2E de desarrollo.
