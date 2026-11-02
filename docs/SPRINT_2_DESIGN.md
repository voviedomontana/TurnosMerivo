# Sprint 2 — acceso y permisos reales

Autorizado por el usuario el 2026-10-31. Continúa S1 sin editar migraciones aplicadas.
No incluye catálogo, agenda, reservas, integración GAS ni despliegues.

## Implementación

- Adaptador oficial `@supabase/ssr`, cookies HttpOnly, SameSite=Lax y Secure fuera
  de desarrollo. Toda autenticación ocurre en servidor; no hay sesión en localStorage.
  Proxy refresca cookies; las operaciones verifican `getUser`, nunca confían en
  `getSession` como autorización. Mutaciones UI mediante Server Actions con control
  Origin/Host de Next; API de sesión exige Origin para cookies o Bearer explícito.
- Auth local con contraseña mínima 10 caracteres, email confirmado, JWT de una hora,
  refresh rotatorio, sin registro público. MFA TOTP obligatorio para owner/admin y
  plataforma. Sin factor se permite configurar MFA y ver únicamente el selector propio.
- `api` se expone en PostgREST sólo con funciones autorizadas. `app` y
  `app_internal` siguen privados. app_server conserva exclusivamente lectura pública.
- `api.me` devuelve perfil propio y negocios/membresías activos. No es un panel de
  datos privados: sirve para elegir contexto y configurar MFA. Las funciones de
  miembros revalidan negocio activo, perfil, membresía y aal2. La pertenencia se
  consulta en BD en cada llamada. Plataforma no hereda acceso a negocios.
- `app.manage_member` es núcleo privado; las entradas de sesión viven en `api`.
  DML de tablas denegado. Owner gestiona otros miembros; admin sólo barberos;
  nadie cambia su propio rol/estado. Lock de negocio antes de miembros; último
  owner protegido. If-Match/versionado, auditoría e idempotencia transaccionales.
- Invitación de negocio: token aleatorio de 256 bits, hash SHA-256 en tabla privada,
  siete días, un uso y email verificado coincidente. El emisor conserva el enlace
  mostrado una vez para compartirlo: el token viaja en fragmento y se envía por POST.
  El secreto se genera antes de la solicitud y no forma parte de la respuesta
  persistida de idempotencia. Replays se reautorizan y comparan intención/precondición.
- Crear acceso Auth es separado de pertenecer a un negocio. El administrador puede
  enviar el email de alta de Supabase a una invitación vigente; service_role se usa
  sólo para Auth Admin y nunca para tablas/RPC de negocio. Quien ya tiene cuenta
  usa su acceso habitual. El enlace de membresía sigue siendo necesario y no se
  acepta sólo por conocer un email. El email Auth tiene su propio vencimiento.
- Perfil global sincronizado desde auth.users; metadata del usuario no asigna roles.
  Bootstrap inicial de owner/plataforma sólo por mantenimiento local explícito,
  nunca por registro, metadata, URL o una API pública.

## Matriz adicional

| Objeto                                           | authenticated                                    | anon / app_server / service_role |
| ------------------------------------------------ | ------------------------------------------------ | -------------------------------- |
| platform_admins, audit_logs                      | Sin DML; lectura de auditoría no se expone en S2 | Sin acceso                       |
| app.member_invitations, app.member_requests      | Sin acceso directo                               | Sin acceso                       |
| api.me                                           | EXECUTE, proyección propia                       | Sin EXECUTE                      |
| api.list_members / invite_member / update_member | EXECUTE, validación interna de tenant/rol/MFA    | Sin EXECUTE                      |
| api.accept_invitation                            | EXECUTE, email verificado y capacidad de un uso  | Sin EXECUTE                      |
| app.manage_member y helpers internos             | Sin EXECUTE                                      | Sin EXECUTE                      |

Se conserva SELECT de S1 con RLS; al pasar a S2 se añade el requisito MFA a lecturas
privadas de owner/admin. El selector propio se obtiene por proyección específica.
El soporte temporal permanece fuera de esta entrega: no se habilita acceso global.

## Validación y límites

TDD del evaluador `can`, pgTAP con identidades y aal1/aal2, pruebas HTTP/Auth local,
Playwright para UI, más los checks habituales. No se presentan cuentas ficticias
como datos del negocio. No usar reset sobre datos existentes; sólo migration up local.
SMTP remoto, recuperación asistida de MFA y revisión humana de SQL/seguridad deben
completarse antes de datos reales. P-02…P-06/P-08 mantienen sus gates futuros.

Referencias: [SSR](https://supabase.com/docs/guides/auth/server-side/advanced-guide),
[TOTP](https://supabase.com/docs/guides/auth/auth-mfa/totp),
[Auth Admin](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail).
