# Portal público — antiabuso y gate de staging

Fecha: 2026-11-02. Continuación autorizada por «avanza con lo siguiente» después de
la preparación operativa y elección de Vercel + Supabase. Alcance: implementar y
probar localmente los adaptadores y gates para preparar staging; no provisionar,
desplegar, activar datos reales ni modificar la instancia del propietario.

## Resultado

Implementación de staging entregada y validada en descartable. **No certifica un
ingreso Vercel ni un desafío real: falta la validación alojada.** Producción continúa
rechazada. No se usa el marcador disposable para autorizar el modo staging.

La migración 18 añade un gate privado cerrado por defecto, vinculado al origen y
con vencimiento máximo de 24 horas. El backend no puede abrirlo. No se ejecutó sobre
el propietario ni un proyecto remoto; sus diecisiete fuentes previas están intactas.
El historial activo del propietario no se consultó en esta tarea.

## Archivos

Creados:

- src/modules/public-booking/antiabuse.ts: verificación Turnstile y pseudónimo de red.
- src/modules/public-booking/human-client.ts: carga bajo demanda y diálogo de desafío.
- supabase/migrations/20261102000500_public_staging_gate.sql: gate privado y auditoría.
- supabase/tests/public_staging.test.sql: dieciséis aserciones con rollback.
- tests/unit/public-booking-antiabuse.test.ts: doce casos del adaptador/configuración.
- scripts/test-public-human-ui.mjs: cuatro contratos en Chromium móvil sin servidores
  ni proveedor externo; transpila el módulo real y simula sólo la API del proveedor.
- docs/PUBLIC_PILOT_ANTIABUSE_REPORT.md: este informe.

Modificados:

- config.ts, http.ts y client.ts de public-booking: modo staging, gate específico,
  identidad compartida y verificación humana antes de escribir.
- src/app/b/[slug]/page.tsx: elige el gate de lectura apropiado para montar el flujo.
- tests/unit/public-booking-http.test.ts: tres casos HTTP adicionales con repositorio
  y proveedor simulados; secuencia de validación y rechazos seguros.
- scripts/lib/public-booking-concurrency.mjs: dos carreras de cierre/vencimiento de
  staging durante la espera por la raíz, con conexiones PostgreSQL independientes.
- scripts/test-s2-security-isolated.mjs: congela también el hash de la migración 17.
- supabase/tests/tenancy.test.sql: inventario de definers de 41 a 42.
- .env.example: nombres nuevos vacíos; no valores/secretos ni activación.
- AGENTS.md, CHANGELOG.md y PUBLIC_PILOT_RUNBOOK.md: alcance y estado actualizados.

Sin cambios de stack, dependencias/lockfile, logo, motor de negocio, cuentas/MFA,
Google Apps Script o migraciones anteriores. No se modifica el informe histórico
de la preparación previa: sus resultados pertenecen a esa entrega.

## Contratos y aislamiento

**Configuración:** PUBLIC_BOOKING_ENVIRONMENT=staging exige HTTPS canónico,
PUBLIC_BOOKING_NETWORK_MODE=vercel-direct, VERCEL=1, VERCEL_ENV=preview y coincidencia
entre VERCEL_PROJECT_ID y PUBLIC_BOOKING_VERCEL_PROJECT_ID configurado. Requiere
keyring, claves de red/firma independientes y credenciales Turnstile. Rechaza claves
dummy conocidas. Las variables VERCEL_* son del entorno confiable del proveedor,
no headers ni atestación criptográfica de una petición individual. Un proceso
autohospedado con variables falsificadas no es un ingreso Vercel validado.

**Red:** sólo x-vercel-forwarded-for bajo el contrato de ingreso Vercel directo.
Rechaza ausencia, listas, valores malformados y zone IDs. No usa X-Forwarded-For,
X-Real-IP o valores del body como fallback. Canoniza IPv6 y direcciones IPv4
mapeadas. HMAC-SHA256 con dominio y negocio: SQL recibe el pseudónimo, nunca IP
plana; PostgreSQL aplica sus cuotas compartidas existentes (100 lecturas, 10
capacidades, 20 escrituras/minuto). No hay nuevo contador en memoria. No es límite
por persona ni protección contra todas las redes botnet/rotación de IPv6.

La protección contra spoofing en el proveedor sigue pendiente de comprobar en
staging. Una prueba local no puede demostrar que Vercel reescribe una cabecera.
No soporta proxy propio/Trusted Proxy delante de Vercel. No añadir otro header o
permitir acceso directo al origen sin revisar de nuevo este contrato.

**Desafío:** /challenge conserva la prueba HMAC ligada a slug/acción/recurso/nonce,
y añade site_key/acción/cdata públicos en staging. El navegador carga el script
fijo de Turnstile sólo al confirmar, abre un dialog rotulado y permite cancelar.
No guarda respuestas en localStorage. Usa superficies/tokens Merivo existentes.
Cancelar, expirar o fallar script/widget no envía la mutación. Mantiene el cuerpo
y la key de la intención para los reintentos existentes.

El servidor verifica la respuesta en el endpoint fijo HTTPS Siteverify (sin URL
configurable, sin redirects, sin caché y con timeout de 5 s). Exige success,
hostname exacto, action, cdata igual al nonce y timestamp menor de 5 minutos; tolera
hasta 30 s de desfase futuro. No reintenta el mismo token del proveedor; el cliente
solicita desafío nuevo para cada intento, conservando la intención de negocio.
El nonce SQL es de un solo consumo y el proveedor también controla su token.

Fallo de autoridad → 403 seguro. Indisponibilidad, transporte o respuesta
malformada → 503 seguro; sin detalles del proveedor. No se imprimen tokens/claves.
La solicitud a Siteverify envía sólo secreto y token; no envía IP, contacto, UUID
de reserva o Idempotency-Key. El widget de tercero sí implica tratamiento de datos
por el proveedor: debe figurar en la revisión de privacidad, no afirmar anonimato.

**Orden HTTP/SQL:** gate/origen/negocio → identidad/cuota de lectura → validación
de input/capacidad presente y prueba HMAC → Siteverify → cuota/nonce de escritura
→ comando transaccional existente. La autoridad definitiva sigue comprobándose en
SQL y se revalida tras el lock raíz. No hay llamadas externas mientras se mantienen
locks; las llamadas publicQuery anteriores ya finalizaron sus transacciones.
El modo discardable conserva su prueba sintética y no contacta al proveedor.

## Migración 18 y cierre

Añade staging_enabled=false, staging_origin y staging_until a la tabla privada
existente. Un CHECK exige configuración completa si se habilita. No hay seed de
activación ni función de administración concedida al backend. RLS/FORCE y ACL de
tabla permanecen. anon/authenticated/app_server/service_role no reciben DML.

Nueva app_internal.public_staging_ready(text): SECURITY DEFINER propiedad del rol
de migraciones postgres, search_path vacío, EXECUTE sólo app_server. Exige origen
exacto, disposable=false y vencimiento futuro dentro de 24 h. El modo descartable
continúa usando public_runtime_ready() original. No se altera esa firma ni se
permite un modo production. Inventario acumulado: 42 definers.

app.require_disposable_public conserva su firma histórica por compatibilidad, pero
acepta también staging vigente. Ahora es VOLATILE para refrescar el estado en
READ COMMITTED después de esperar por el lock. Sus permisos continúan privados.
Los comandos existentes la invocan antes y después de adquirir la raíz; las pruebas
demuestran rechazo PT503 y cero turno creado si staging vence o se cierra en medio.

Un trigger invoker privado audita cambios de configuración con actor system,
session_user real, flags/origen/vencimiento y request_id; sin identidades ficticias
o secretos. Caducar por reloj no genera una mutación/auditoría nueva automáticamente.
Cerrar afecta también la autogestión; no cancela reservas ni borra historial.
Las operaciones que ya superaron su revalidación pueden terminar: no se presenta
el cierre como una cancelación de transacciones ya autorizadas.

## Validaciones reales

| Check                                           | Resultado                                                                                                                                                                                              |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| node scripts/test-s2-security-isolated.mjs --ui | PASS, exit 0; 570 pgTAP, 59 escenarios de conexiones independientes, 23 escenarios HTTP públicos reales y regresión E2E acumulada                                                                      |
| SQL staging nuevo                               | PASS: 16 aserciones; cerrado por defecto, permisos, origen, expiración, plazo máximo, compatibilidad disposable y auditoría                                                                            |
| Concurrencia pública                            | PASS: 11 escenarios; nueve anteriores más cierre y vencimiento mientras el comando espera raíz; PT503 y cero turno parcial                                                                             |
| npm run test                                    | PASS: 248 tests / 25 archivos; 15 casos nuevos respecto de la preparación previa                                                                                                                       |
| HTTP staging simulado                           | PASS: proveedor antes de quota(write)/create; prueba fallida sin mutación/consumo del nonce; identidad ausente sin fallback ni llamada externa                                                         |
| node scripts/test-public-human-ui.mjs           | PASS: cuatro contratos de navegador móvil, éxito/cancelación/expiración/script bloqueado, metadatos y cleanup. Primer intento sandbox sin Chromium; reintento con acceso al navegador instalado aprobó |
| npm run lint / typecheck / build                | PASS; build local y copia Next aislada compilados                                                                                                                                                      |
| npm run format:check                            | FAIL conocido: sólo quince Markdown históricos de arquitectura-v1.1, sin modificar                                                                                                                     |
| Integridad de fuentes SQL                       | PASS: harness verifica hashes de las diecisiete migraciones anteriores antes de probar la nueva                                                                                                        |

La regresión incluye login, MFA aal2 sintético, roles, invitaciones, tenants,
LAST_OWNER, paginación/trazas/replays/purgas S2, catálogo, clientes, HS, agenda interna
y portal público (respuesta perdida antes/después del commit, token y rollbacks).
No se ejecutó test:e2e contra la configuración del propietario. Los recursos Docker
del run se retiraron mediante el cleanup del harness.

Los errores esperados del proveedor fueron simulados; no se provisionó ni contactó
Siteverify con claves reales. Los headers Vercel de los tests también son fixtures.
No confundir estos resultados con validación end-to-end en el hosting.

## Operación pendiente y siguiente paso

G04/G05 tienen implementación y pruebas locales; **siguen abiertos para hosting**.
El próximo trabajo es crear staging independiente/protegido, registrar sus IDs y
dominio estable, provisionar Turnstile con hostname restringido y verificar con
peticiones reales que el cliente no controla x-vercel-forwarded-for. Hasta entonces
no activar el gate ni afirmar que existe protección productiva demostrada.

No hay recursos ni credenciales reales en este repositorio. El despliegue y las
migraciones del destino concreto requieren autorización previa; este trabajo no
los ejecuta. No aplicar la 18 sobre la base del propietario para probar staging.

Antes de habilitar datos reales: custodia/restore operacional, DB backups,
regresión HTTPS, observabilidad, capacidad, CSP/revisión de cabeceras, privacidad,
soporte y decisión sobre comunicaciones siguen pendientes G06…G12. Sin emails,
any-staff, ausencias/finalizaciones, GAS, commit, push o lanzamiento.

Las claves HMAC de red/firma deben ser iguales en todas las instancias de una
release. Rotarlas con cierre planificado y despliegue coordinado: cambiar la de
red reinicia buckets, y cambiar la de firma invalida desafíos pendientes. No
reutilizar claves AES ni imprimir pseudónimos en logs; retención de buckets se
limita mediante la purga privada existente, aún sin scheduler instalado.

## Fuentes técnicas consultadas

- [Vercel: request headers](https://vercel.com/docs/headers/request-headers): contrato
  de cabeceras del ingreso; la confianza requiere verificar el despliegue real.
- [Turnstile: validación server-side](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/):
  Siteverify, uso único, expiración y metadatos de autoridad.
- [Turnstile: widget](https://developers.cloudflare.com/turnstile/get-started/client-side-rendering/):
  renderizado explícito usado por el diálogo bajo demanda.

La implementación aplica controles conservadores adicionales; las fuentes no
certifican este sistema ni reemplazan las pruebas de su instalación concreta.
