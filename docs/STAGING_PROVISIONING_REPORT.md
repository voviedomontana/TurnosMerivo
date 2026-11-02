# Staging: inspección de destinos y compatibilidad del pooler

Fecha: 2026-11-02. Continuación del piloto público. No habilita reservas reales.

## Destinos observados

El usuario proporcionó Supabase aadrzawmzrstpyuluxqk y equipo Vercel merivo-group.
Tras iniciar sesión personalmente, se inspeccionaron los paneles en sólo lectura,
sin abrir/copiar claves, credenciales o datos de tablas.

- Supabase anterior: Ecosistema Merivo, pausado, main marcada PRODUCTION. No se
  presupone que esté vacío; se protege como destino excluido. No se reanudó,
  migró, borró o modificó. La etiqueta del proveedor sola no prueba uso real.
- El usuario creó un proyecto separado merivo-turnos-staging, referencia
  kuqtskhtsvpluhalxiav, organización Merivo FREE. Estado Healthy; región us-east-1.
  El agente sólo dejó preparado el nombre en el formulario; el usuario ingresó
  la credencial y completó la creación. No se leyó esa contraseña.
- Overview del nuevo proyecto: sin migraciones, sin backups, sin GitHub conectado.
  Data API habilitada y Automatically expose new tables desactivado, verificados.
- Data API muestra dos schemas expuestos, public y graphql_public. Antes de migrar
  corresponde dejar sólo public, conforme al contrato local. Se inspeccionó el
  selector; no se cambió ni guardó seguridad. Los futuros app/api/app_internal
  nunca deben exponerse en PostgREST.
- Vercel merivo-group: ningún proyecto; no hay ID u origen de staging todavía.
- GitHub, inspección autorizada posteriormente: remoto público
  voviedomontana/TurnosMerivo, main, un commit, sólo docs visible. Catorce archivos
  versionados localmente; la aplicación permanece sin publicar. No se hizo push.

La revisión automática bloqueó inicialmente GitHub porque la pregunta sobre
conectarlo no autorizaba leer un posible repositorio privado. Se pidió permiso
específico y el usuario autorizó sólo lectura; entonces se verificó la página.
No se intentó otra ruta para eludir ese bloqueo.

## Cambio funcional mínimo

Se detectó que parseAppServerDatabaseUrl rechazaba el login documentado del pooler
compartido: app_server.PROJECT_REF. Antes de corregirlo se agregó el caso positivo y
se reprodujo un fallo real del test. Ahora admite ese login sólo si:

- La referencia SUPABASE_PROJECT_REF es válida y coincide con el sufijo del usuario.
- Host con un único prefijo de pooler bajo pooler.supabase.com, puerto 5432 o 6543,
  base postgres, sin querystring ni fragmento.
- El rol sigue siendo app_server. postgres/service_role, otros proyectos, hosts
  locales/ajenos y opciones de conexión arbitrarias son rechazados.

Las conexiones directas anteriores app_server conservan su contrato. El getter
backend pasa la referencia privada configurada al validador. No cambia TLS:
verificación de certificado para hosts remotos; prepare:false y pool pequeño
existentes. Validación de formato no equivale a probar una conexión Supavisor real.

## Preflight offline

Nuevo comando:

```sh
npm run pilot:preflight -- --target docs/STAGING_TARGET_PENDING.json
```

No carga .env.local, no conecta servicios, no escribe DB, no crea recursos y no
abre el gate. Lee únicamente metadata declarada y el entorno del proceso. Resultado
BLOCKED si faltan origen/IDs, confirmación de aislamiento, credenciales declaradas,
si hay referencias cruzadas de Auth/DB/host/proyecto, producción o clave de
recuperación instalada junto con la aplicación. Rechaza metadata con campos extra.

El manifest identifica el nuevo Supabase y prohíbe expresamente el anterior. Tiene
isolationConfirmed=true por creación independiente confirmada por el usuario y
verificada en el panel; el proyecto Vercel y origen quedan vacíos. Esa confirmación
documental no inspecciona ni garantiza el contenido de una base en el futuro.

Un resultado CONFIGURATION_MATCHES significa sólo consistencia declarada y presencia
de credenciales, no validez criptográfica, conexión, permisos reales o producción
apta. Siempre devuelve readyForBookings=false y contactedServices=false. El runtime
sigue validando sus claves; las pruebas de proveedor/TLS/SQL deben hacerse aparte.
Nunca imprime las URLs privadas, passwords, tokens, keyring o excepciones de parseo.

La ejecución local sin variables alojadas quedó BLOCKED como corresponde. No se
completaron variables con datos del propietario para hacer pasar el check.

## Archivos

Creados: scripts/public-staging-preflight.mjs, tests/unit/staging-preflight.test.ts,
docs/STAGING_TARGET_PENDING.json, docs/STAGING_PROVISIONING_REPORT.md y
docs/GITHUB_PUBLICATION_REVIEW.md.

Modificados: src/lib/database/config.ts, src/lib/database/server.ts,
tests/unit/database-config.test.ts, .env.example, .gitignore, package.json,
AGENTS.md, docs/CHANGELOG.md y docs/PUBLIC_PILOT_RUNBOOK.md. Sin dependencias,
lockfile o SQL nuevo. Las dieciocho migraciones permanecen intactas.

## Validaciones de esta entrega

| Check                                           | Resultado real                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Prueba previa del pooler                        | FAIL positivo reproducido antes de corregir; resto de rechazos conservados                           |
| npm run test                                    | PASS: 263 tests / 26 archivos; diez casos adicionales de pooler y cinco del preflight                |
| npm run lint                                    | PASS                                                                                                 |
| npm run typecheck                               | PASS tras corregir una anotación del test; fallo inicial TS2345 documentado, no defecto de runtime   |
| npm run build                                   | PASS                                                                                                 |
| node scripts/test-s2-security-isolated.mjs --ui | PASS: 570 pgTAP, 59 escenarios independientes, 23 escenarios HTTP públicos y regresión E2E completa  |
| npm run format:check                            | FAIL conocido en quince Markdown históricos de arquitectura-v1.1; no se reformatean sin autorización |
| Exclusiones Git                                 | PASS: .env locales/producción, .vercel, resultados y backups ignorados                               |
| Patrones acotados de credenciales en candidatos | Sin coincidencias en fuentes inspeccionadas; no certificación exhaustiva                             |

El harness retiró sus recursos descartables. No se usó test:e2e contra el propietario.
El pooler alojado, la publicación en GitHub y Vercel siguen sin ejecutar; no atribuir
las pruebas descartables al nuevo proyecto remoto.

## Próximo tramo concreto

1. Autorizar/revisar primera publicación del código acumulado y resolver formato
   histórico de CI. Plan preciso en GITHUB_PUBLICATION_REVIEW.md; no hay commit/push.
2. Preparar Vercel staging protegido y sus permisos GitHub limitados; sin despliegue
   implícito durante una importación. Completar ID/origen reales del manifest.
3. Dejar sólo public expuesto en Data API y autorizar/provisionar los permisos y
   migraciones del nuevo Supabase, nunca del proyecto protegido.
4. Configurar secretos privados sin chat/Git y comprobar TLS/pooler, proveedor real,
   roles/MFA sintéticos, gate cerrado y regresión HTTPS con datos ficticios.

No se cambiaron cuentas/MFA/invitaciones locales, seguridad remota, GAS o datos del
propietario. Sin despliegue, commit, push, aplicación remota de SQL ni reservas reales.

Fuente del contrato de conexión:
[Supabase: conectar PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres).
La documentación exige ROLE.PROJECT_REF para roles personalizados en el pooler
compartido; el cambio mantiene el rol restringido existente.
