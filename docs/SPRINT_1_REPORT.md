# Sprint 1 — entrega de base multi-tenant

Fecha: 2026-10-31. Variante recomendada aprobada expresamente por el usuario:
P-01/P-07, ADR-022 y [diseño](SPRINT_1_DESIGN.md). Validación local; no despliegue.

## Alcance implementado

- Negocios y settings del doc 04, perfiles globales y membresías mínimos.
- RLS ENABLE/FORCE, SELECT propio/por membresía activa, sin DML para roles de app.
- app_server sin acceso directo a tablas, sin BYPASSRLS/roles privilegiados; lectura
  pública sólo mediante operación interna con proyección fija y slug validado en BD.
- Dos funciones definer catalogadas, search_path vacío y EXECUTE mínimo; trigger de
  identidad/versionado, validación de zona y guardia del último owner para mantenimiento.
- Bootstrap idempotente de negocio/settings accesible sólo por mantenimiento, sin
  registro público ni concesión de membresías desde la API.
- Contexto público derivado del negocio resuelto, handler fino y errores RFC 9457
  seguros. Sin caché de datos públicos que conserve exposición tras deshabilitarlos.
- Connection factory server-only, lazy y opcional; sólo login app_server. Postgres.js
  es la única dependencia nueva y no cambia el stack. Prepared statements desactivados
  para compatibilidad con pooler futuro; pool pequeño y TLS verificado fuera de loopback.

No hay Auth/login, invitaciones, gestión de roles, MFA, reservas, catálogo,
disponibilidad, GAS, notificaciones, pagos o APIs de escritura. Auth local sigue
deshabilitado. El esquema auth de infraestructura existe, pero sólo se usa en fixtures
de prueba rollback: no se crean cuentas reales ni se emiten JWT.

## Migraciones y permisos

1. `20261031231242_init_tenancy.sql`: base aprobada, RLS, helpers y proyección pública.
2. `20261031231400_allow_maintenance_server_role.sql`: mantenimiento postgres puede
   SET ROLE app_server; app_server no puede asumir postgres ni authenticated.
3. `20261031232111_restrict_future_function_execute.sql`: revocación global del
   default EXECUTE PUBLIC para funciones futuras de postgres. Las funciones actuales
   ya tenían ACL explícita cerrada; el test de objetos futuros detectó el ajuste.

No se editó ninguna migración después de aplicarla. El detalle de cada función,
propietario y rol está en [function-catalog.md](../supabase/function-catalog.md).
No se exponen app/app_internal en PostgREST ni se crean RPC de escritura vacías.

La herramienta `db:provision-local` separa LOGIN/contraseña del SQL versionado.
Sólo opera sobre supabase_db_turnosmerivo local, comprueba privilegios y Git ignore,
usa contraseña aleatoria por stdin (no argumentos/logs) y guarda configuración en
.env.local ignorado, preservando las demás variables. Tras reset reutiliza el secreto
local y vuelve a habilitar LOGIN. No configura una conexión postgres en Next.js.

## Archivos principales

```text
supabase/migrations/        # Tres migraciones nuevas
supabase/tests/tenancy.test.sql
supabase/function-catalog.md
src/lib/database/           # Configuración privada y pool server-only
src/lib/http/problem.ts
src/modules/businesses/     # Esquemas, tipos, servicio, repositorio y frontera HTTP
src/app/api/v1/public/[slug]/route.ts
scripts/provision-local-database.mjs
tests/unit/                # Slug/contexto/HTTP y conexión restringida
tests/integration/public-business.test.mjs
.github/workflows/ci.yml    # Job BD/HTTP local adicional, sin despliegues
```

Se actualizan package.json/lockfile, .env.example, README, AGENTS, ADR/roadmap y
registros de decisión. Las carpetas restantes y archivos de UI de S0 se conservan.

## Ejecución local y recuperación

```sh
npm ci
npm run db:start
npm run db:migrate
npm run db:test
npm run db:provision-local
npm run dev
```

GET `/api/v1/public/{slug}` devuelve datos base, no servicios o disponibilidad de
sprints futuros. Una base vacía devuelve 404 para slugs válidos; los fixtures no son
datos de demo persistentes. Sin conexión configurada, la landing carga y la lectura
de un slug válido responde 503. Slug inválido/reservado/inexistente/no publicado: 404.

Probar HTTP real: `npm run test:integration` (build + dos servidores propios:
configurado y sin conexión). Usa fixtures con UUID aleatorios, borra sólo sus filas
al terminar y falla si no hay configuración local. pgTAP termina en rollback.

Reconstrucción: `db:reset` sólo sobre local descartable, elimina datos y recrea
contenedor/roles. Antes se verificó que las tablas y auth.users estaban vacías.
Volver a aprovisionar login tras reset y reiniciar Next.js. En presencia de datos
no usar reset como rollback: mantener backup, cambios compatibles y roll-forward.
No hay rollback/despliegue remoto ejecutado. P-02…P-06/P-08 siguen para sus sprints.

## Validaciones

La suite SQL incluye llamadas como authenticated/anon/app_server, miembros A/B y multinegocio,
suspendidos/sin identidad, DML denegado, referencia compuesta, grants/owner/search_path,
defaults de objetos futuros y bootstrap. Las afirmaciones de aislamiento **no** se
ejecutan únicamente como postgres. El rol de mantenimiento sólo prepara fixtures.

Limitaciones: no hay JWT/login real ni CI remoto verificado; no corresponde afirmar
seguridad de sprints aún no implementados. Las 17 advertencias moderadas de dependencias
de herramientas existentes no se corrigieron forzando cambios ajenos a S1. No hay
commits, push, despliegue ni modificación de la aplicación Google Apps Script.

Resultados reales de la entrega local:

| Comprobación                            | Resultado                                                                                                               |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| npm run lint / format:check / typecheck | Aprobados.                                                                                                              |
| npm run test                            | 37 tests unitarios aprobados.                                                                                           |
| npm run db:test                         | 69 comprobaciones pgTAP aprobadas después de reconstruir.                                                               |
| npm run db:lint                         | Sin errores en public/app/api/app_internal.                                                                             |
| npm run build                           | Aprobado; landing estática y endpoint dinámico.                                                                         |
| npm run test:integration                | 3 pruebas HTTP aprobadas con conexión real y servidor sin conexión.                                                     |
| Reconstrucción local                    | Las tres migraciones reaplicadas desde cero; se verificó cero datos antes del reset.                                    |
| Permisos futuros                        | Función/tabla nuevas en rollback: EXECUTE PUBLIC y grants de datos denegados según contrato.                            |
| Preservación S0                         | 8 archivos originales de UI/preparación Supabase/E2E comparados por SHA-256, sin cambios.                               |
| Credenciales                            | .env.local ignorado y no versionado; secreto concreto ausente en archivos no ignorados y chunks cliente inspeccionados. |

E2E de navegador no se repitió: no cambió UI y su prueba se conservó intacta;
la integración HTTP comprueba además que la landing carga sin configuración de BD.
El workflow remoto de GitHub queda pendiente hasta que el usuario decida versionar
y subir el trabajo. Aprovisionar una barbería real o continuar S2 requiere otra tarea.
