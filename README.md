# TurnosMerivo

Base de una plataforma SaaS de gestión de turnos para barberías. Comienza con una
barbería y una organización modular preparada para evolucionar a múltiples negocios
independientes. **Estado: acceso y permisos del Sprint 2 implementados localmente.**
Negocios/settings con RLS, login, MFA TOTP y gestión de miembros por negocio.

La landing está en español argentino, es responsive y funciona sin Supabase.
La aplicación tiene ingreso, selector de negocio, seguridad y equipo; la agenda,
los servicios y las reservas pertenecen a las próximas etapas.

## Stack y requisitos

Next.js 16 (App Router), React 19, TypeScript strict, Tailwind CSS 4, componentes
shadcn/ui locales, ESLint, Prettier, Vitest y Playwright. Preparación de Supabase
con `@supabase/supabase-js`, conexión privada restringida mediante Postgres.js y validación con Zod. Las versiones exactas se conservan
en `package.json` y `package-lock.json`.

- Node.js **24 LTS** y npm (probado con npm 11).
- Git.
- Para E2E: Chromium de Playwright (`npx playwright install chromium`).
- La landing no requiere cuenta Supabase, Docker ni credenciales.
- Para la base local opcional: Docker Desktop con contenedores Linux y WSL 2 en Windows.
  Supabase CLI se instala automáticamente con `npm ci` como dependencia de desarrollo.

## Instalación y ejecución local

```sh
npm ci
npm run dev
```

Abrir [localhost:3000](http://localhost:3000).

Para probar el build de producción:

```sh
npm run build
npm run start
```

## Base del Sprint 1

Para usar la aplicación real, seguí [la guía de acceso local S2](docs/SPRINT_2_REPORT.md).
Después de iniciar Supabase y aplicar migraciones:

```sh
npm run auth:configure-local
npm run auth:bootstrap-local
npm run dev
```

Bootstrap pregunta el negocio y el primer email; no genera contraseñas en logs.
Abrí Mailpit en http://127.0.0.1:54324, confirmá el código en `/auth/alta`,
definí tu contraseña y configurá MFA. No envía email a Internet.
Si ya existe un propietario no lo reemplaza; no ejecutar bootstrap para invitar al equipo.

La variante P-01/P-07 fue aprobada explícitamente: users/business_members mínimos
para probar aislamiento sin login, app_server restringido y carpetas actuales.
Ver [entrega y validaciones S1](docs/SPRINT_1_REPORT.md),
[diseño aprobado](docs/SPRINT_1_DESIGN.md) y
[catálogo de funciones](supabase/function-catalog.md).

```sh
npm run db:start
npm run db:migrate
npm run db:test
npm run db:provision-local
npm run dev
```

`db:provision-local` genera una contraseña aleatoria para app_server y configura
únicamente `.env.local`, ignorado por Git, sin imprimir credenciales. No reemplaza
las demás variables del archivo. Reutiliza la configuración local existente tras
un reset; rechaza conexiones ajenas a la instancia local o roles con privilegios
inesperados. Requiere Docker, Git y las migraciones aplicadas. Sin ese paso, la
landing funciona y el endpoint público responde 503 si falta conexión.

`GET /api/v1/public/{slug}` devuelve exclusivamente campos públicos de un negocio
activo/no eliminado con reserva pública habilitada. Los slugs inválidos, reservados,
inexistentes o no publicados reciben el mismo 404. Es una lectura de datos base:
no incluye catálogo, calendario ni operaciones de reserva de otros sprints.

Las pruebas usan fixtures sintéticos en rollback o fixtures HTTP con UUID propios
que se limpian al terminar; no se cargó una barbería ficticia permanente. Por eso una
base vacía devuelve 404 para cualquier slug válido. El bootstrap de negocios/settings
es una función de mantenimiento documentada; no existe endpoint de registro público.

## Variables de entorno

Siguen siendo opcionales. Para la futura conexión, copiar `.env.example` como
`.env.local` y completar **ambas** variables con la configuración de un proyecto
de desarrollo:

| Variable                               | Descripción                                                  |
| -------------------------------------- | ------------------------------------------------------------ |
| `NEXT_PUBLIC_SUPABASE_URL`             | URL HTTPS del proyecto; HTTP sólo para loopback local.       |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Clave pública `sb_publishable_...`; nunca una clave secreta. |

Sin ambas variables, las fábricas retornan `null`. Una configuración parcial o
inválida produce un error sin mostrar sus valores; también se valida al renderizar
el layout. Las variables `NEXT_PUBLIC_*` quedan incluidas en el bundle al compilar.
Los clientes sólo se crean al invocar las fábricas; la landing no las invoca.
No se implementan persistencia de sesión, cookies de autenticación ni permisos.
Las claves JWT legacy `anon` no están habilitadas por este contrato inicial.

La conexión privada `DATABASE_URL_APP_SERVER` es opcional para la landing y necesaria
sólo para el endpoint de lectura pública. El backend acepta únicamente usuario
app_server, rechaza postgres/service_role y parámetros de conexión que cambien el
contrato. Se configura al invocar la lectura, no al importar módulos. Las conexiones
remotas requieren TLS verificado; en este sprint sólo se probó loopback local.
No configurar esta variable con prefijo NEXT_PUBLIC ni copiar su valor al README.

## Comandos

La base local se administra por separado de Next.js:

```sh
npm run db:start
npm run db:status
npm run db:stop
```

El arranque requiere Docker disponible. No requiere `supabase login` ni vincular
un proyecto remoto. Consultar [desarrollo local y migraciones](docs/12_DEPLOYMENT_OPERATIONS.md#12-desarrollo-local-existente-y-migraciones-futuras)
antes de configurar variables, aplicar migraciones o usar `npm run db:reset`.
Este último comando elimina los datos de la base local.

| Comando                | Acción                                                      |
| ---------------------- | ----------------------------------------------------------- |
| `npm run dev`          | Servidor de desarrollo.                                     |
| `npm run build`        | Compilación de producción.                                  |
| `npm run start`        | Servir el build de producción.                              |
| `npm run lint`         | ESLint, sin warnings.                                       |
| `npm run typecheck`    | Generar tipos Next y verificar TypeScript.                  |
| `npm run format`       | Formatear archivos propios con Prettier.                    |
| `npm run format:check` | Verificar formato.                                          |
| `npm run test`         | Tests unitarios con Vitest.                                 |
| `npm run test:watch`   | Tests en modo watch.                                        |
| `npm run test:e2e`     | Build + servidor aislado + smoke desktop/móvil en Chromium. |

Antes del primer E2E ejecutar `npx playwright install chromium`. En Linux CI se
puede usar `npx playwright install --with-deps chromium`. El puerto 3000 debe estar
libre: el test inicia su propio servidor y lo cierra al terminar.

CI ejecuta instalación limpia, lint, formato, tipos, tests unitarios y build.
El job adicional de BD inicia Supabase local, aplica migraciones y ejecuta lint SQL,
pgTAP y HTTP con rol restringido. No hay despliegues ni conexión a bases remotas.
El workflow se preparó pero su ejecución remota no se ha verificado.

## Estructura

```text
.github/workflows/ci.yml
docs/                         # Arquitectura, sprints y guía de base local
src/
  app/                        # Layout, landing y estilos
  components/ui/              # Button de shadcn/ui
  lib/
    supabase/                 # Configuración y fábricas browser/server
    utils.ts                  # Composición de clases Tailwind
  modules/
    auth/ businesses/ staff/ services/ availability/
    appointments/ customers/ notifications/ analytics/
  types/
supabase/
  config.toml                 # Configuración de servicios locales
  migrations/                 # Tres migraciones SQL S1 versionadas
  tests/                      # pgTAP de aislamiento y privilegios
  function-catalog.md         # Superficies y permisos de funciones
tests/
  unit/                       # Configuración, slug, contexto y HTTP público
  integration/                # HTTP real con app_server y landing sin conexión
  e2e/                        # Landing en desktop y móvil
AGENTS.md
components.json              # Configuración de shadcn/ui
```

Las carpetas vacías se preservan con `.gitkeep`. Los componentes shadcn son código
local editable; no se agrega una biblioteca de componentes completa.

## Documentación y próximos pasos

Documentación 01–14 consolidada antes del Sprint 1. Consultar el
[informe y checklist](docs/CONSOLIDATION_REPORT.md) y el
[registro de cambios](docs/CHANGELOG.md). Las reglas obligatorias de seguridad ya
están incorporadas; las propuestas P-xx requieren decisión antes de su código.

La base multi-tenant y sus pruebas locales ya están implementadas. P-01/P-07 fueron
aprobadas en ADR-022. Login y gestión funcional de miembros esperan S2. El roadmap
conserva los gates P-02…P-06/P-08 de sus sprints futuros.
Los comandos locales y la estrategia de migraciones están en doc 12; no se ejecutan
migraciones por consolidar Markdown. No se realizaron commits, push ni despliegues.

Comandos de calidad de BD: `npm run db:lint`, `npm run db:test`.
Pruebas HTTP reales: `npm run test:integration` (incluye build; necesita Docker,
migraciones y db:provision-local). `npm run test` permanece independiente de BD.
Después de `db:reset` (destructivo, sólo local descartable), ejecutar de nuevo
`db:provision-local` y reiniciar Next.js: el rol vuelve a NOLOGIN hasta aprovisionarlo.
No editar migraciones aplicadas; los dos ajustes de permisos se entregaron como
migraciones nuevas. No se implementan escrituras de usuario hasta el sprint autorizado.
