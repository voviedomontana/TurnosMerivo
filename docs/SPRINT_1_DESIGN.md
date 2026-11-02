# Sprint 1 — propuesta concreta de implementación

Estado: **P-01 y P-07 aprobadas por el usuario el 2026-10-31** mediante selección
explícita de la variante recomendada: base mínima de usuarios/membresías para probar
el aislamiento sin login, app_server restringido y carpetas actuales. Esta aprobación
no incluye P-02…P-06/P-08 ni autoriza Sprint 2, despliegues, commits o push.

## Variante aprobada

Adelantar únicamente la base de `users` y `business_members` necesaria para probar
aislamiento de `businesses` y `business_settings` con identidades sintéticas. Conservar
login, invitaciones, gestión de roles, MFA y UI de usuarios en Sprint 2. Mantener Auth
local deshabilitado: los fixtures SQL de prueba no constituyen un login funcional.

La alternativa es crear negocios/settings denegados por defecto y posponer membresías
y aislamiento por usuario a S2. Esa alternativa cambia la aceptación de S1; no permite
declarar probado el aislamiento entre usuarios de distintos negocios en este sprint.

## Matriz aprobada para la primera entrega

| Objeto                                              | authenticated                                            | anon        | app_server                          | Mantenimiento                                                                                    |
| --------------------------------------------------- | -------------------------------------------------------- | ----------- | ----------------------------------- | ------------------------------------------------------------------------------------------------ |
| businesses                                          | SELECT sólo con membresía activa, RLS                    | Sin acceso  | Sin acceso directo                  | Alta/cambios mediante operación de plataforma revisada, sin endpoint público de escritura        |
| business_settings                                   | SELECT sólo con membresía activa, RLS                    | Sin acceso  | Sin acceso directo                  | Igual criterio de mantenimiento                                                                  |
| users (base de identidad global)                    | SELECT sólo perfil propio                                | Sin acceso  | Sin acceso                          | Fixtures sintéticos y mantenimiento privilegiado                                                 |
| business_members (base)                             | SELECT sólo membresías propias; sin modificar rol/estado | Sin acceso  | Sin acceso                          | Fixtures y alta inicial controlada; sin gestión de miembros hasta S2                             |
| Helper booleano de membresía en app                 | EXECUTE exclusivamente sobre ese helper                  | Sin acceso  | Sin acceso                          | Propietario postgres; search_path vacío y consulta limitada a auth.uid()/tenant/membresía activa |
| Lectura pública de negocio por slug en app_internal | Sin EXECUTE                                              | Sin EXECUTE | EXECUTE únicamente en esa operación | Devuelve campos públicos permitidos de negocio activo y reservas públicas habilitadas            |

Todas las tablas de negocio llevan ENABLE/FORCE RLS, referencias del mismo tenant y
versionado básico; la identidad global usa política propia. No existe DML directo
para roles de aplicación en S1. La escritura de configuración para usuarios sigue
cerrada hasta las operaciones de los sprints correspondientes.

Se conserva postgres como propietario de las operaciones privilegiadas
locales, con EXECUTE PUBLIC/defaults revocado. Ese propietario puede saltar RLS:
cada función debe verificar su capacidad y filtrar tenant explícitamente. No conceder
roles propietarios a authenticated/app_server ni exponer setters de contexto.

app_server será rol técnico sin BYPASSRLS ni privilegios sobre tablas, con acceso sólo
a su operación interna. El aprovisionamiento de login/conexión se separa de SQL
versionado: no incluir contraseñas ni conectarse como postgres desde Next.js.
service_role no se utiliza para datos de negocio ni para este endpoint.

La separación de esquemas se mantiene: public (tablas), app (núcleo/helpers privados),
api (superficie futura de sesiones) y app_internal (operaciones internas no expuestas
por PostgREST). En S1 no se agregan RPC de escritura de sesión vacías o especulativas.

## Responsabilidades físicas aprobadas — P-07

- `src/modules/businesses`: tipos de negocio/contexto de tenant, validación de slug,
  resolución pública y repositorio de lectura de negocio/settings.
- `src/lib`: conexión técnica exclusivamente de servidor y errores HTTP compartidos.
- `src/app`: handler fino `GET /api/v1/public/[slug]` y landing existente.
- `src/modules/auth`: sin login ni autorización funcional de UI en S1. La pertenencia
  que habilita lecturas se verifica en BD mediante las políticas/helper anteriores.
- Conservar las carpetas restantes del Sprint 0; no renombrar ni crear módulos
  paralelos tenancy/catalog/booking para satisfacer el árbol lógico de referencia.

## Pruebas y secuencia revisables

1. Registrar la variante elegida en ADR/informe/roadmap y ajustar AGENTS al sprint.
2. Escribir pruebas pgTAP de dos negocios y actores sintéticos, membresía inactiva,
   lectura propia/ajena, DML denegado, grants/defaults, helpers y ausencia de recursión.
3. Crear migración nueva de la base aprobada; ningún catálogo de servicios ni reservas.
4. Aplicar sólo local, sin reset de datos existentes por defecto. Ejecutar fixtures
   dentro de pruebas transaccionales para no dejar usuarios o negocios falsos fuera.
5. Implementar lectura pública con campos permitidos y contexto derivado del slug;
   probar 404 uniforme para inexistente/suspendido/deshabilitado y slug inválido.
6. Ejecutar pgTAP y checks de aplicación, manteniendo la landing sin conexión activa.
   Registrar resultados reales y cualquier limitación; no avanzar a Sprint 2.

Las decisiones P-02…P-06/P-08 conservan sus gates futuros. Esta propuesta no incorpora
motor de reservas, disponibilidad, GAS, pagos, notificaciones ni despliegues.

## Preflight local realizado

Docker 29.9.2 con motor Linux operativo; Supabase PostgreSQL 17.11 y sus servicios
habilitados siguen corriendo. La consulta de tablas base de public no encontró
tablas existentes. La carpeta de migraciones contiene únicamente .gitkeep. No se
ejecutaron reset, migraciones, seeds ni cambios de roles/grants. Formato configurado
y git diff --check aprobados tras preparar este diseño.
