# Sprint 2 — acceso y permisos

Autorizado por el usuario: acceso real con email/contraseña, roles por negocio,
invitaciones, MFA y selector. Se conserva la marca Merivo y la base S1.

## Qué se puede usar

- `/login`: inicio de sesión real con Supabase Auth; no existe registro público.
- `/auth/alta`: confirmar el código recibido en el email de alta de cuenta.
- `/seguridad`: establecer/cambiar contraseña, configurar/verificar TOTP y cerrar
  sesión en todos los dispositivos. Owner/admin/plataforma deben verificar MFA.
- `/app`: negocios activos del usuario; elegir uno vuelve a verificar pertenencia.
- `/app/{businessId}`: entrada al negocio con acceso a seguridad y, si corresponde,
  equipo. No muestra estadísticas, agenda o datos simulados como funcionalidades reales.
- `/app/{businessId}/miembros`: invitar, editar roles/estado de otras personas,
  renovar/revocar invitaciones. Owner gestiona otros roles; admin sólo barberos;
  no se modifica el propio rol/estado y no se puede quitar el último owner.
- `/invitaciones`: consumir un enlace de negocio con email verificado coincidente.
  El fragmento no se envía al servidor; la capacidad se presenta por POST.

Las invitaciones tienen dos pasos explícitos. Una persona nueva recibe un email
de alta Auth, confirma OTP y define contraseña; luego abre el enlace de negocio que
el emisor comparte de forma privada. Quien ya tiene cuenta usa su login habitual.
El enlace de membresía vence en 7 días, admite un uso y puede renovarse/revocarse.
La renovación invalida el enlace anterior. No basta conocer el email para aceptar.

## Inicio local

```sh
npm ci
npm run db:start
npm run db:migrate
npm run db:provision-local
npm run auth:configure-local
npm run dev
```

`auth:configure-local` comprueba proyecto/URL local y Git ignore, conserva otras
variables y rechaza reemplazar valores no vacíos diferentes. Lee claves desde CLI
sin imprimirlas y escribe sólo `.env.local` ignorado. Nunca copiar la salida completa
de CLI a Git o logs. La landing continúa funcionando sin variables de Supabase;
los accesos protegidos muestran indisponibilidad o exigen sesión.

Para la primera cuenta de un negocio local sin owner:

```sh
npm run auth:bootstrap-local
```

Herramienta interactiva de mantenimiento: pide slug, nombre y email, verifica
loopback, envía el alta Auth sólo al correo local y crea el primer owner bajo lock.
Rechaza un negocio que ya tenga owner. No se ejecuta como onboarding público.
Un fallo puede dejar una cuenta Auth invitada sin membresía; no reemplaza propietarios
existentes ni borra cuentas para recuperarse. Revisar mantenimiento antes de reintentar.

Abrí [Mailpit local](http://127.0.0.1:54324), copiá el código en
`http://127.0.0.1:3000/auth/alta`, definí contraseña de al menos 10 caracteres y
configurá MFA con tu aplicación de autenticación. No se guardan códigos TOTP,
contraseñas, claves de setup ni datos del propietario en archivos del proyecto.
Si abriste una invitación sin sesión, ingresá y volvé a abrir el enlace original.

Auth conserva JWT de hasta una hora y refresh rotatorio; logout revoca refresh.
Tokens JWT ya emitidos pueden seguir vigentes hasta expirar. Suspender una membresía
sí bloquea las operaciones del negocio inmediatamente por consulta de BD.
Cookies Secure en build de producción; para producción real se requiere HTTPS.

## API y base de datos

- `GET /api/v1/me` y `GET /api/v1/businesses/{businessId}/members`.
- `POST /api/v1/businesses/{businessId}/members/invite` con
  `{email,role,token}`: token aleatorio base64url de 32 bytes generado antes de enviar.
- `PATCH /api/v1/businesses/{businessId}/members/{memberId}` con `{role,status}`.
- `POST /api/v1/invitations/accept` con `{token}`.
- Idempotency-Key UUID en mutaciones; If-Match fuerte en PATCH; 428/412/409.
  Cookies requieren Origin coincidente; Bearer se valida mediante Auth.
  Respuestas privadas no-store; entradas strict y body acotado a 100 KB.
- Renovación/revocación usan la misma capa de servicios y la RPC autorizada
  `api.manage_invitation`; no hay DML directo habilitado por la UI.

Dos migraciones nuevas, sin editar las tres de S1: `20261101000100_auth_memberships`
y `20261101000200_invitation_lifecycle`. Tablas platform_admins/audit_logs y privadas
de invitación/replay con RLS; trigger de perfil Auth y ocho definers adicionales más
la RPC de ciclo de invitación. Catálogo completo en ../supabase/function-catalog.md.
La base de auditoría S2 usa UUID y snapshots `before_data/after_data`; esos nombres
físicos especializan la descripción lógica del doc 04, sin cambiar su carácter
append-only ni exponer secretos. `request_id` correlaciona con la clave de operación.

La prueba S1 conserva sus garantías y ahora prepara claims aal2 para lecturas
privilegiadas y tolera perfiles creados por el trigger Auth. El inventario de definers
incluye las capacidades S2; no se relajaron grants ni aislamiento para pasar tests.
No hubo reset ni borrado de datos previos. Los fixtures E2E usan IDs aleatorios y
eliminan sólo sus propias filas; el rollback de pgTAP no deja identidades ni membresías.

## Riesgos y pendientes antes de producción

- Sin despliegue ni CI remoto ejecutado; SMTP externo y dominios no configurados.
- Recuperación asistida tras perder TOTP requiere procedimiento de plataforma
  revisado; no se entrega un bypass público. Soporte temporal no implementado.
- Revisión humana de SQL/definers/permisos y controles operativos de S12/S13.
- No se ejecutó el spike de GAS con dos cuentas reales; P-08 sigue pendiente y
  ninguna integración de escritura queda habilitada.
- P-02 debe resolverse antes del modelo completo S3; P-03/P-06 antes del motor.
- Idempotencia de membresías conserva registros hasta definir purga de mantenimiento;
  no contiene respuestas con secretos. El token de gestión de reservas P-06 sigue fuera.
- Las 17 advertencias moderadas de dependencias existentes no se corrigen forzando
  cambios ajenos al sprint. No se afirma seguridad global de funcionalidades futuras.

## Archivos de esta entrega

- Nuevos: `src/modules/auth/*`, `src/components/auth/*`, rutas `app`, `login`,
  `seguridad`, `auth/alta`, `invitaciones` y handlers de miembros/me/aceptación;
  `src/proxy.ts`, utilidades HTTP de body/origin, dos migraciones, pgTAP de Auth,
  E2E de Auth, tests unitarios de permisos/body/origin y scripts locales de Auth.
- Modificados: cliente Supabase servidor y comentario del cliente browser, BrandLogo,
  landing (enlace Ingresar), CSS, config Supabase, plantilla de email, scripts npm/lock,
  next.config, Playwright/CI, fixtures S1 y catálogo de funciones.
- Documentación: AGENTS, README, docs 04/05/08/10/12/13, guía de implementación,
  CHANGELOG y los dos documentos S2. Se conserva el trabajo previo del repositorio.

## Resultados reales

| Check                           | Resultado                                                                                                                                     |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| lint / format:check / typecheck | Aprobados                                                                                                                                     |
| test                            | 57 tests unitarios aprobados                                                                                                                  |
| db:test                         | 114 comprobaciones aprobadas, también después del bootstrap local                                                                             |
| db:lint                         | Sin errores en public/app/api/app_internal                                                                                                    |
| build                           | Aprobado, también como parte de E2E e integración                                                                                             |
| test:e2e                        | 4 casos aprobados en escritorio y móvil                                                                                                       |
| test:integration                | 3 pruebas HTTP S1 aprobadas; landing sin conexión DB preservada                                                                               |
| Concurrencia de membresía       | Dos PATCH con versión 2: uno 200 y otro 412; sin versión, 428                                                                                 |
| Secretos                        | 118 archivos no ignorados y 39 chunks cliente revisados: cero coincidencias con claves privadas/conexión; .env.local ignorado y no versionado |
| git diff --check                | Aprobado                                                                                                                                      |

E2E usa Auth/JWT reales locales: login, MFA, cookies HttpOnly/SameSite, ausencia de
sesión en localStorage, cambio entre dos negocios, alta por correo capturado en
Mailpit, contraseña, aceptación de invitación, suspensión y límites de barbero,
cross-tenant por Next y PostgREST, DML directo denegado y registro público rechazado.
Se revisaron capturas de escritorio y móvil. Los fixtures se eliminan por sus IDs.
El bootstrap del primer propietario solicitado quedó realizado en la BD local, con
activación pendiente del usuario por el correo de Mailpit; sin contraseña ni MFA
elegidos por el agente. Los datos del propietario no se incorporan a Git.

Limitaciones observadas: build y Docker requirieron permisos de ejecución fuera del
sandbox de Windows. La primera prueba detectó el proveedor email deshabilitado y
otra detectó la normalización del hostname interno de Next; se corrigieron y se
volvió a ejecutar la suite completa con éxito. CI remoto no ejecutado.
No se hizo reset, commit, push ni despliegue; no comienza Sprint 3.

## Corrección posterior — 2026-11-01

El QR de Supabase contenía XML y saltos de línea sin codificar en su data URL.
next/image lo rechazaba únicamente con validaciones de desarrollo. Se normaliza
el SVG sin cambiar su contenido ni guardar secretos. Cinco tests nuevos reproducen
el error original y validan los formatos; E2E ahora comprueba la carga real del QR.
62 unitarios, lint, formato, tipos, build y cuatro E2E de producción aprobados.

La ejecución completa contra el servidor de desarrollo supera el QR y la verificación
MFA en escritorio/móvil, pero falla posteriormente al cargar la capacidad del
fragmento de invitación. Esa incidencia queda pendiente y no se presenta la suite
dev como aprobada. No se alteraron las credenciales ni factores del propietario.

## Resolución posterior — hidratación en desarrollo

La incidencia de invitación del apartado anterior quedó resuelta el 2026-11-01.
Next dev bloqueaba Origin http://127.0.0.1:3000 en su WebSocket HMR mientras
aceptaba localhost. Se verificó directamente sin cookies ni identidad. Se agrega
allowedDevOrigins: ["127.0.0.1"] exclusivamente para desarrollo; no se amplía
la política Origin/Host de APIs ni ningún permiso de usuario o tenant.

Después del cambio el handshake loopback devuelve 101 Switching Protocols y un
Origin externo continúa rechazado. Los cuatro E2E de desarrollo pasan completos
en escritorio y móvil, incluidos QR/MFA y aceptación de invitación. CI incorpora
esta ejecución además del modo producción; no se ejecutó CI remoto en esta tarea.
La cuenta y los factores del propietario permanecen intactos.

Validación de esta resolución: lint, formato, typecheck y 62 tests unitarios
aprobados; build y cuatro E2E de producción aprobados en puerto 3107, además de
los cuatro E2E de desarrollo en puerto 3000. No se ejecutaron migraciones ni se
reinició Supabase. Se conserva la sesión del propietario; los tests eliminan sólo
sus cuentas/negocios temporales. Sin commit, push o despliegue.
