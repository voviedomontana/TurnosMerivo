# S2 — Implementación autorizada de A-08 y A-05

Fecha: 2026-11-01. Alcance exclusivo: privacidad de configuración y clasificación
23514/LAST_OWNER. No cambia C-01/C-02/C-03/C-04/C-06/C-07 ni inicia S3.

## Cambios

| Archivo                                                                | Cambio                                                                                                   |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| supabase/migrations/20261101000300_restrict_private_business_reads.sql | Nueva: revoca SELECT authenticated en businesses/settings y crea lectura privada de proyección explícita |
| supabase/migrations/20261101000400_identify_last_owner_error.sql       | Nueva: reemplaza sólo el cuerpo del guard último owner; PT409/LAST_OWNER                                 |
| src/modules/auth/service.ts                                            | 23514→500/INTERNAL_ERROR seguro; resto de contratos de error preservado                                  |
| tests/unit/auth-sql-errors.test.ts                                     | Traducción SQL→servicio→HTTP y ausencia de detalles SQL                                                  |
| supabase/tests/s2_security_fixes.test.sql                              | Roles, MFA, tenants, proyección exacta, grants/vistas/RPC, último owner y rollback                       |
| supabase/tests/tenancy.test.sql                                        | Ajusta expectativas de SELECT y SQLSTATE autorizadamente cambiados; conserva cobertura S1                |
| supabase/tests/auth.test.sql                                           | Ajusta SELECT privado de owner aal1 de conjunto vacío a permiso denegado                                 |
| scripts/test-s2-security-isolated.mjs                                  | Harness reproducible con PostgreSQL/Auth/PostgREST descartables y credenciales sintéticas en memoria     |
| supabase/function-catalog.md                                           | Documenta nueva capacidad y semántica de errores                                                         |
| docs/CHANGELOG.md y este informe                                       | Registro de alcance, pruebas y limitaciones                                                              |

## A-08 — Permisos y proyección

`authenticated` ya no tiene SELECT de tabla ni columnas sobre businesses/settings.
RLS y las relaciones existentes permanecen; no se cambia identidad ni membresía.
El nuevo `api.read_business_private(p_business_id uuid)` exige el guard vigente
`app.require_member(...,true)`: usuario confirmado/no eliminado, miembro activo,
negocio activo/no eliminado, owner/admin actual y aal2. Barberos, aun con aal2,
quedan denegados. Tenant ajeno devuelve NOT_FOUND sin datos. Anon, app_server y
service_role no reciben EXECUTE ni grants adicionales.

Respuesta fija `business` y `settings`, columnas enumeradas en la migración y
comprobadas exactamente en pgTAP. No contiene timestamps internos/deleted_at ni
columnas añadidas automáticamente en el futuro. Legal/tax/billing y políticas se
devuelven sólo por esta entrada privilegiada. No hay SELECT * ni to_jsonb de filas
en la nueva función. Definer con owner postgres, search_path vacío, objetos
calificados, PUBLIC/roles técnicos revocados y grant específico a authenticated.

### Inventario de consumidores y superficies alternativas

- `src/modules/businesses/repository.ts`: sólo app_internal.get_public_business,
  proyección pública fija; no lectura de tablas. No requiere cambio.
- `src/modules/auth/service.ts`, páginas y acciones: api.me, list_members y RPCs de
  membresías. api.me sólo devuelve perfil/selector; list_members sólo equipo.
  Mutaciones devuelven IDs, rol/estado/versión, no configuración privada.
- Helpers app.require_member/is_active_member y guards consultan tablas internamente;
  require_member no es ejecutable por authenticated y el helper público sólo devuelve
  boolean. No se amplían accesos por esos helpers.
- app.create_business es invoker de mantenimiento sin grant API. Scripts de bootstrap/
  provisioning son mantenimiento y no se ejecutaron sobre el entorno del propietario.
- Se inspeccionaron las cinco migraciones y todas sus funciones/grants. No existen
  vistas/materializadas de aplicación alternativas; prueba de catálogo detectará su
  aparición. Allowlist de funciones API ejecutables, pruebas de contenido de selector,
  equipo y lectura pública completan el inventario; no se afirma que un test por sí
  solo demuestre seguridad de código futuro.
- Tests SQL/integración/E2E contienen fixtures administrativos. Se adaptaron sólo las
  expectativas SQL afectadas. E2E original está ligado al contenedor del propietario
  y **no se ejecutó**. El harness nuevo verifica Auth real sin esa dependencia.

Compatibilidad intencional: los clientes Table API/SQL, incluso owner/admin, deben
usar el RPC privado en lugar de SELECT. No se crea pantalla ni endpoint Next nuevo.
Selector disponible en aal1 permite completar MFA; perfil propio, invitaciones y
proyección pública siguen operativos.

## A-05 — Errores

Se conserva firma, modo invoker, trigger, condición y orden de locks de
app.protect_last_owner. Sólo su excepción pasa de 23514 genérico a PT409 con mensaje
estable LAST_OWNER; se mantiene HTTP 409. No se compara texto inglés del error.

23514 de otros CHECK/triggers produce 500 INTERNAL_ERROR en el servicio y el
envelope HTTP seguro existente, sin message/details/hint de PostgreSQL. 23505,
PT400/401/403/404/409/412/428 y fallback 503 mantienen contratos anteriores. Los
consumidores SQL del guard deben esperar PT409; errores de identidad, timezone y
auditoría inmutable siguen siendo 23514. Ningún cambio de locks C-02 fue incluido.

## Entorno de pruebas independiente

Comando: `node scripts/test-s2-security-isolated.mjs` desde el repositorio, con Docker
disponible y las imágenes fijadas ya presentes. No carga .env ni requiere credenciales
del propietario. El harness verifica primero los cinco SHA-256 históricos contra el
registro de la propuesta; si difieren aborta antes de Docker.

Crea una red propia y tres contenedores `merivo-s2-check-<UUID>-{db,auth,rest}`.
No conecta a red/volumen/contenedor preexistente. PostgreSQL no publica puerto;
Auth/PostgREST publican puertos efímeros sólo en 127.0.0.1. No envía correo real:
signup de cuentas sintéticas example.test con autoconfirm sólo en ese Auth descartable.
Passwords/JWT/TOTP de fixtures se generan/procesan en memoria, no se imprimen ni se
guardan en Git. No se leen archivos de secretos existentes.

La imagen PostgreSQL inicializa su plataforma; el harness prepara roles/helpers de
su instancia nueva y ejecuta las migraciones oficiales de GoTrue antes de las siete
migraciones del repositorio, ejecutadas como postgres. No es una copia ni dump del
entorno del propietario. Versiones: PostgreSQL Supabase 17.11.0.006, GoTrue v2.197.0,
PostgREST v16.5. Bootstrap de plataforma usa supabase_admin **sólo en esa instancia**;
objetos de aplicación conservan postgres como owner.

pgTAP corre cada archivo en transacción con rollback. Después, fixtures HTTP reales
prueban contraseña válida/inválida, MFA TOTP enroll/challenge/verify, aal1 denegado,
aal2 permitido, rol barber denegado, tenant ajeno, SELECT de Table API, selector,
listado, techo admin e invitación/aceptación. Dos probes de escritura exclusivos del
harness verifican LAST_OWNER/HTTP409, CHECK23514 y rollback vía PostgREST; no existen
en las migraciones ni se publican en la aplicación. Finalmente elimina únicamente
sus tres contenedores/volúmenes y red, incluso ante fallo.

## Validación

| Prueba/comando                                           | Resultado real                                                                                                                                                                                              |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| node scripts/test-s2-security-isolated.mjs               | Correcto, salida final PASS; las primeras ejecuciones detectaron problemas del bootstrap/harness que fueron corregidos antes de la corrida final                                                            |
| auth.test.sql                                            | 45 aserciones correctas, rollback                                                                                                                                                                           |
| tenancy.test.sql                                         | 69 aserciones correctas, rollback                                                                                                                                                                           |
| s2_security_fixes.test.sql                               | 42 aserciones correctas, rollback                                                                                                                                                                           |
| Auth/PostgREST reales del harness                        | Correctos: contraseña válida/inválida, TOTP aal2 owner/admin, aal1/barber denegados, tenants, Table API, selector, equipo, invitación/aceptación, techo admin, LAST_OWNER HTTP409 y CHECK23514 con rollback |
| npm run test                                             | 9 archivos, 72 tests correctos; incluye 10 casos nuevos de clasificación HTTP                                                                                                                               |
| npm run lint                                             | Correcto                                                                                                                                                                                                    |
| npm run typecheck                                        | Correcto                                                                                                                                                                                                    |
| npm run build                                            | Correcto; primer intento dentro del sandbox falló por EPERM en .next, el mismo comando fuera del sandbox terminó con código 0                                                                               |
| npm run format:check                                     | Falla sólo por los 15 Markdown preexistentes de docs/arquitectura-v1.1; se conservaron intactos                                                                                                             |
| Formato de archivos modificados compatibles con Prettier | Correcto                                                                                                                                                                                                    |
| Preservación                                             | Cinco migraciones históricas con SHA-256 intacto; comparación de guard confirma que sólo cambió identidad de su error                                                                                       |
| Limpieza Docker                                          | Sin contenedores ni redes merivo-s2-check restantes al finalizar                                                                                                                                            |

Total SQL: **156 aserciones**. Los 114 checks S1/S2 se conservaron, ajustando sólo
las expectativas expresamente cambiadas por A-08/A-05. La verificación del árbol
detectó únicamente los cinco archivos existentes modificados y seis nuevos listados
arriba; los demás archivos anteriores, propuestas y dependencias permanecen intactos.

**Estado A-08 y A-05: implementadas, validadas en entorno descartable y aplicadas
posteriormente al entorno local con autorización explícita.** La aplicación local
se registra abajo; no autoriza despliegue remoto ni el siguiente paquete.

## Aplicación local autorizada — 2026-11-01

Autorización posterior del usuario: avanzar con la aplicación local de estas dos
migraciones y verificar, preservando cuentas/MFA y el resto del alcance.

Preflight: contenedor supabase_db_turnosmerivo, PostgreSQL Supabase 17.11.0.006,
puerto local 54322 y project_id turnosmerivo. Las cinco versiones históricas estaban
aplicadas; sus archivos conservaron los cinco SHA-256 registrados. La CLI local
confirmó únicamente 20261101000300 y 20261101000400 pendientes.

Respaldo previo: `supabase/backups/before-a08-a05-20261101T195628Z.dump.dpapi`.
Archivo lógico custom de pg_dump, cifrado con Windows DPAPI CurrentUser y excluido
de Git, junto con metadata de verificación sin datos personales. Se verificó el
índice de pg_restore y el roundtrip de cifrado/descifrado en memoria. No se imprimió
contenido ni se guardó dump plano. Para recuperarlo se necesita el mismo perfil
Windows; no se ejecutó una restauración completa de ese respaldo.

Comando ejecutado: `npm run db:migrate` → `supabase migration up --local`, código 0.
Aplicó exclusivamente las dos migraciones autorizadas y dejó siete versiones en el
historial. No reset, seeds, reparación de historial ni conexión remota. Los grants
de configuración privada y el guard específico LAST_OWNER ya están activos localmente.

Verificación posterior:

- **13 checks SQL de solo lectura**: privilegios de tabla/columna, grants de RPC,
  identidad del error del guard, selector aal1, perfil propio, rechazo MFA_REQUIRED
  en aal1, proyección privada aal2, tenant ajeno rechazado, SELECT directo de ambas
  tablas rechazado, equipo y proyección pública. Se usó una identidad existente como
  contexto SQL de mantenimiento; no se inició sesión ni se modificó su factor MFA.
- HTTP de la aplicación en 127.0.0.1:3000: landing **200**, me sin sesión **401** y
  proyección pública de negocio habilitado **200**, sin campos privados.
- Hashes agregados de IDs/updated_at de usuarios, identidades y factores MFA, y de
  IDs/version/updated_at de negocio/settings/membresías: iguales antes y después.
  No se imprimieron identidades, valores privados, contraseñas ni secretos de factores.
- No se crearon fixtures ni ejecutaron intentos de escritura fallida en la base del
  propietario. Las pruebas DML de guard/rollback y de Auth/TOTP permanecen en el
  entorno descartable de la validación anterior.

No se repitieron build/unitarios/E2E en esta aplicación: el código probado no cambió;
se verificó el cambio de esquema y su integración local. Los resultados de la tabla
anterior corresponden a la implementación previa, no a ejecuciones nuevas en esta fase.

## Riesgos y límites

- Migraciones aplicadas al entorno local después de las pruebas descartables y con
  autorización posterior. No se modificaron cuentas, contraseñas ni factores MFA;
  no se aplicó ningún cambio remoto.
- La regresión real cubre Auth/API/SQL, no navegación SSR/E2E completa. No hubo
  cambios de UI; no se ejecutó el E2E original porque usa la base del propietario.
- C-01/C-02/C-03/C-04/C-06/C-07 permanecen pendientes, incluidas carreras de envíos,
  preautorización y retención. No se corrigen lateralmente en estas migraciones.
- Despliegue futuro debe mantener juntas las versiones compatibles del guard y del
  servicio: el TS nuevo contra DB vieja responde 500 seguro a ese antiguo 23514,
  sin perder la restricción de último owner, pero no el diagnóstico LAST_OWNER.
  Aplicar primero migraciones aditivas revisadas y después el servicio compatible;
  no restituir SELECT amplio como rollback de una falla de consumidor.
- Cambios futuros de proyección requieren revisión explícita; nuevas columnas no se
  exponen por defecto. El definer owner hace bypass de RLS: su guard es obligatorio.
- No commit, push, despliegue, cambios de dependencias/stack/identidad visual o GAS.
  La siguiente unidad requiere autorización distinta.
