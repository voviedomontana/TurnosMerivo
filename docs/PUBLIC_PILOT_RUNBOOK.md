# Preparación del piloto público — Vercel + Supabase

Fecha: 2026-11-02. Infraestructura confirmada por el usuario: Vercel + Supabase
alojado. Preparación autorizada; no es autorización de despliegue, migración remota,
activación en la instancia del propietario ni captación de datos reales.

Actualización de destinos: el usuario creó Supabase staging kuqtskhtsvpluhalxiav
(us-east-1), verificado Healthy y sin migraciones. Vercel merivo-group sigue sin
proyecto. El remoto GitHub público contiene sólo docs; requiere publicar el código
antes de una integración útil. Ver STAGING_PROVISIONING_REPORT.md,
GITHUB_PUBLICATION_REVIEW.md y STAGING_TARGET_PENDING.json. El destino anterior
aadrzawmzrstpyuluxqk queda expresamente excluido de la preparación.

## Estado y criterio de apertura

**NO-GO para reservas reales.** El circuito PB-01…05 está validado en descartable,
pero publicConfig sólo acepta discardable o staging Preview con Vercel/proyecto
pinados, y PostgreSQL exige su gate privado. Producción permanece rechazada.
El adaptador y gate de staging están implementados con pruebas locales; falta
validar la confianza del ingreso y el proveedor en infraestructura real.
No usar túneles, cambiar Host, aceptar forwarded headers arbitrarios o poner el
marcador descartable en una base real para eludir estas protecciones.

El trabajo se divide en cuatro etapas, con evidencia por release:

1. Preparación local y herramientas de custodia: esta entrega.
2. Adaptador de antiabuso/red y gate de staging: implementados con fixtures
   descartables; ver PUBLIC_PILOT_ANTIABUSE_REPORT.md. No certifican hosting real.
3. Staging separado con datos sintéticos: requiere provisionar proyectos y autorizar
   despliegue/migración sobre sus identificadores concretos.
4. Piloto con participantes reales: sólo tras cerrar todos los gates y aprobar el
   lote, responsables y procedimiento de atención. No implica cerrar todo el MVP.

## Separación de entornos y destino

Usar un proyecto Supabase de staging independiente de la instancia local y de la
futura producción. Sin copia de datos/clientes ni cuentas/MFA del propietario.
Datos y operadores de prueba sintéticos; el alta de esos operadores pertenece al
entorno nuevo y deberá ejecutarse únicamente cuando ese destino esté autorizado.

Usar un proyecto Vercel de staging separado y protegido, con un origen HTTPS estable
para el circuito completo; no derivar confianza del Host que mande el visitante.
Las previews de ramas no deben heredar secretos o permisos de producción. Vercel
permite separar variables por entorno y proteger despliegues; comprobar la cobertura
de aliases y acceso de testers en el plan concreto, sin asumir prestaciones pagas.
[Variables](https://vercel.com/docs/environment-variables) y
[protección](https://vercel.com/docs/deployment-protection).

La protección de staging restringe visitantes; no reemplaza Auth, MFA, RLS ni el
desafío de la escritura pública. No guardar bypass de protección en URLs o código.

Antes de cualquier escritura remota, registrar sin secretos:

| Dato                                                        | Estado actual                                              |
| ----------------------------------------------------------- | ---------------------------------------------------------- |
| Responsable de infraestructura y custodio de recuperación   | Pendientes de asignación                                   |
| Proyecto Vercel / proyecto Supabase / región                | Supabase kuqtskhtsvpluhalxiav, us-east-1; Vercel pendiente |
| Origen HTTPS de staging y origen futuro del piloto          | Pendientes                                                 |
| Snapshot del código y SHA-256 de cada migración             | Generar para el lote a publicar                            |
| Evidencia de que el destino no es la base del propietario   | Obligatoria antes de migrar                                |
| Aprobación de despliegue y migraciones del destino concreto | No otorgada en esta preparación                            |

## Configuración y credenciales

Configurar en el secret store del entorno, nunca en Git, chat o un manifest público:

| Configuración                                    | Ubicación / restricción                                           |
| ------------------------------------------------ | ----------------------------------------------------------------- |
| NEXT_PUBLIC_SUPABASE_URL y publishable key       | Sólo del proyecto de staging; claves públicas, nunca service_role |
| DATABASE_URL_APP_SERVER                          | Secreto backend, rol app_server sin acceso directo a tablas       |
| SUPABASE_AUTH_ADMIN_KEY                          | Sólo Auth Admin, si se necesita para equipo; no para reservas     |
| PUBLIC_BOOKING_ENCRYPTION_KEYS                   | Keyring exclusivo del entorno, secreto backend                    |
| Clave de recuperación de backup                  | Custodia separada; NO instalar en Vercel ni PostgreSQL            |
| Secreto del proveedor antiabuso                  | Backend Turnstile integrado; falta provisionar secreto real       |
| Origen canónico y configuración de red confiable | Variables staging implementadas; valores/dominio pendientes       |

Las variables PUBLIC_BOOKING_TEST_* y el desafío HMAC actual son sólo del harness.
No copiarlas a staging/producción como solución de antiabuso. Mantener secretos de
desarrollo, staging y piloto independientes. No ejecutar `vercel env pull` hacia un
archivo versionable ni copiar la salida completa de Supabase status.

Para la conexión serverless, verificar el modo de pooler con el rol app_server y
TLS del proveedor. El código usa parámetros/transactions; comprobar que request_id
y claims locales no escapen a la siguiente transacción. La documentación de
[Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres)
distingue conexión directa para administración y pooler para tráfico; en modo
transaction no se admiten prepared statements. Validar los clientes reales antes
de cambiar configuración, no sustituir app_server por postgres para hacerlos pasar.

## Custodia: comandos disponibles ahora

La herramienta nueva usa el mismo AES-GCM del portal; no conecta a Supabase, no
carga .env.local y no genera claves del propietario. Node 24 requerido.

```sh
# Simulacro sintético de archivo cifrado, rotación retenida y recuperación:
npm run pilot:keys -- drill

# Sólo en una sesión privada de operador, inyectar desde su gestor de secretos:
# PUBLIC_BOOKING_ENCRYPTION_KEYS y PUBLIC_BOOKING_RECOVERY_KEY.
# Usar rutas ABSOLUTAS fuera del repositorio y una carpeta privada preexistente.
npm run pilot:keys -- backup --output "<ruta-absoluta-privada>/keyring.encrypted.json"
npm run pilot:keys -- verify --input "<ruta-absoluta-privada>/keyring.encrypted.json"
```

Los dos últimos comandos son instrucciones futuras, no ejecutados con claves reales.
No pasar secretos como argumentos. El backup no incluye la clave de recuperación.
`verify` abre en memoria y compara con el keyring configurado; no exporta texto plano.
Rechaza otra clave, ciphertext alterado y keyring diferente. `backup` usa creación
exclusiva, no sobrescribe y exige destino fuera del repositorio, incluso resolviendo
el directorio padre. No publica ruta ni key IDs en stdout. Los fallos son genéricos.

En POSIX crea con modo 0600; **en Windows hay que verificar ACL de la carpeta**.
La herramienta no configura permisos de un secret manager ni garantiza borrado
seguro de memoria/disco. Custodiar backup y recuperación en ubicaciones distintas,
con acceso mínimo y recuperación fuera de la cuenta única del hosting. No retener
una exportación sin cifrar del keyring. El tamaño admitido del backup es 64 KiB.

El drill persiste sólo el sobre cifrado en una carpeta temporal de nombre aleatorio, conserva
v1 al activar v2, restaura desde disco y abre un token sintético cifrado con v1.
También rechaza una clave de recuperación equivocada. Borra sólo su archivo y
carpeta al terminar. No demuestra que el secret store alojado esté operativo.

Para el simulacro operacional posterior: custodio recupera backup y clave desde
sus ubicaciones independientes; un proceso aislado reconstruye el keyring en
memoria usando restoreKeyring; verifica un sobre canario del mismo entorno; luego
reinstala los secretos mediante el mecanismo privado del proveedor y comprueba un
replay autorizado. No existe todavía un importador automático al secret store.
Registrar sólo fecha, release, custodio, resultado y tiempos medidos, sin valores.
No retirar claves antiguas por cumplirse 48 h: existen reservas futuras y backups.
Ver [contrato criptográfico](PUBLIC_BOOKING_KEY_CUSTODY.md).

## Contrato de antiabuso: validación alojada pendiente

El adaptador Turnstile está implementado; falta provisionar proveedor/dominio y
verificarlo en staging. Estos criterios deben conservarse antes de activar el gate:

- Desafío real validado server-side: resultado, expiración, hostname exacto y
  acción/recurso esperados. Fallo, timeout o respuesta inválida deben denegar.
- Verificación externa antes de adquirir locks PostgreSQL; nunca llamada HTTP desde
  una transacción que retenga la raíz del negocio.
- Mantener nonce de un solo consumo, cuotas persistentes/compartidas y replay
  autorizado por capacidad original. El desafío no autoriza un turno por sí solo.
- Extraer la identidad de red sólo del ingreso confiable documentado para Vercel;
  probar que un cliente no puede elegirla con X-Forwarded-For u otro header.
  No degradar silenciosamente a una identidad global o a un header sin validar.
- No almacenar IP en claro ni tokens del desafío en logs/auditoría. Una huella de
  red sigue siendo dato a considerar en privacidad; definir retención y secreto
  independiente. No afirmar límite verificable por persona.
- No considerar una lista de invitados al piloto como sustituto del antiabuso.
- La migración 18 añade gate staging privado cerrado y temporal, con auditoría.
  No activar disposable sobre staging, no editar migraciones ni ampliar acceso a
  tablas. Probar el cierre alojado además de las carreras locales ya aprobadas.

## Secuencia de staging (todavía no ejecutada)

1. Congelar lote: checks, inventario/hash, nuevas fuentes intactas y revisión SQL.
2. Registrar destino autorizado. Provisionar roles/grants mínimos y aplicar desde
   cero las dieciocho migraciones al proyecto nuevo; no resetear ni usar --linked
   contra el propietario. No copiar usuarios reales para sembrar fixtures.
3. Publicar una release protegida con reservas deshabilitadas por defecto. Fijar
   origen/redirects Auth exactos, HTTPS, cookies Secure, límites y secretos separados.
4. Configurar el adaptador implementado y gate staging de la migración 18 con
   autorización del destino; validar el desafío real. El modo staging rechaza las
   claves dummy conocidas; las pruebas simuladas no sustituyen claves reales.
5. Probar por HTTP y navegador contra la URL HTTPS: login/MFA de operador sintético,
   catálogo, disponibilidad, reserva, respuesta perdida/replay, enlace, mover/cancelar,
   expiración/revocación, CSRF/origen, cookies y otro tenant. No fixture real.
6. Repetir competencia cliente/cliente y cliente/admin con conexiones independientes;
   fallos parciales, revalidación tras espera y aislamiento del pooler. Conservar
   resultados de staging separados de los 570/59/23 de la última suite descartable.
7. Medir capacidad y latencia en el plan/región elegidos; fijar presupuesto y umbrales
   antes de abrir. Instrumentar sólo IDs de correlación, latencia y errores saneados;
   nunca URL completa con fragmento, cookies, contactos o payloads de reserva.
8. Simular restauración de base y claves, cierre de escritura y recuperación. No
   confundir backup de base con backup del keyring; ambos son necesarios.
9. Cerrar checklist y revisión de privacidad. La confirmación por email y recordatorios
   siguen pendientes S9; no anunciar su envío. Para un piloto que los requiera hay
   que implementarlos o aprobar explícitamente una operación manual acotada.
10. Solicitar aprobación del piloto concreto con evidencia y riesgos; no activar
    automáticamente porque build o despliegue estén verdes.

## Operación y detención

Asignar responsable de atención del piloto y contacto alternativo, horario de
soporte, participantes, límites de uso y canal manual. Las cantidades no se fijan
como requisitos inventados: debe definirlas el propietario antes de abrir.

Ante solape, exposición, pérdida de autoridad o replay indebido: detener nuevas
escrituras públicas, preservar evidencia saneada y atender desde la agenda interna.
El cierre actual deshabilita también la autogestión; avisar a participantes del
canal alternativo. No cancelar automáticamente turnos existentes ni borrar ledgers.
La separación entre cerrar altas y mantener gestión requiere diseño futuro.

Rollback del frontend no revierte datos ni schema. Conservar migraciones aplicadas;
preferir roll-forward compatible. No reset, downgrade ni restauración encima de
una base con reservas nuevas sin plan de reconciliación y autorización de incidente.
Tras recuperación, comparar turnos, ocupación, auditoría, eventos y outbox; reabrir
sólo con pruebas de integridad y autoridad. Probar este procedimiento en staging.

## Checklist de habilitación

| Gate                          | Evidencia requerida                                             | Estado de esta entrega                                                |
| ----------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------- |
| G01 infraestructura elegida   | Decisión de hosting                                             | Vercel + Supabase confirmados; Supabase staging creado por el usuario |
| G02 staging aislado/protegido | IDs de proyectos, origen, testers y permisos                    | Supabase separado creado; Vercel/protección pendientes                |
| G03 lote y migraciones        | Hashes, historial, destino y aprobación                         | 18 fuentes locales; no aplicadas remotamente                          |
| G04 antiabuso y red           | Adaptador real, pruebas de spoofing/timeout/cuotas              | Implementado local; falta prueba de ingreso/proveedor alojados        |
| G05 gates y cierre            | Cambio revisado, fail-closed y simulacro de cierre              | Gate staging cerrado, auditado y temporal; sin activar                |
| G06 custodia                  | Backup separado, custodios y restore operacional                | CLI/drill sintético; infraestructura pendiente                        |
| G07 privacidad                | Aviso, finalidades, retención, derechos y proveedores revisados | Pendiente; no revisión legal en esta entrega                          |
| G08 regresión HTTPS           | SQL/HTTP/E2E/roles/concurrencia en staging                      | Pendiente; no sustituir con resultados locales                        |
| G09 recuperación              | Restore base + keyring + reconciliación medidos                 | Pendiente en hosting                                                  |
| G10 observabilidad/capacidad  | Logs saneados, alertas con responsables y mediciones            | Pendiente                                                             |
| G11 atención y comunicaciones | Responsable, soporte, aviso honesto y decisión sobre emails     | Pendiente                                                             |
| G12 apertura                  | Aceptación de riesgos y autorización de release/participantes   | No otorgada                                                           |

**Ningún gate pendiente queda aprobado por la creación de este documento.** El
siguiente bloque es provisionar staging aislado y validar G04/G05 con proveedor e
ingreso reales antes de abrir participantes. No desarrollar notificaciones,
any-staff, estados terminales ni GAS por extensión de esta preparación.
