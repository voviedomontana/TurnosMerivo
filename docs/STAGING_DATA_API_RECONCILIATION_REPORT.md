# Reconciliación de Data API previa al staging

Fecha: 2026-11-03. Base publicada: codex/staging-readiness,
9d7d7dcb219bba89bcbb10249407d551fbefed8a. Pedido: continuar con el siguiente pendiente.
Trabajo realizado: contrato local y pruebas, sin operaciones alojadas.

## Decisión aplicada

El contrato de exposición es **public y api**, como ya implementa la aplicación.
`api` contiene RPC de sesión; no es el esquema privado `app` ni `app_internal`.
Estos dos últimos nunca se exponen por Data API. Exponer un schema no concede
SELECT/EXECUTE: se conservan grants mínimos, identidad, MFA, autorización y RLS.

La instrucción posterior de exponer sólo public habría roto RPC autenticadas.
Se corrigió el runbook y se agregó una errata explícita al informe de provisión,
sin alterar sus observaciones históricas. No se reescribe arquitectura-v1.1.
El contrato completo y la secuencia cuando api aún no existe están en
[STAGING_DATA_API_CONTRACT.md](STAGING_DATA_API_CONTRACT.md).

## Evidencia y cambios

- src/modules/auth/service.ts selecciona api de forma explícita para RPC; mantiene
  validación previa de identidad y reautorización SQL. No fue modificado.
- supabase/config.toml ya expone public+api y deshabilita auto-exposición de tablas.
  Se verificó intacto contra el commit publicado; no fue modificado.
- El portal usa app_internal por conexión PostgreSQL backend, no por Data API.
- tests/unit/data-api-contract.test.ts añade dos pruebas de configuración.
- scripts/lib/data-api-contract.mjs añade dieciséis comprobaciones HTTP sobre los
  servicios creados por el harness, con guardas de prefijo/loopback y usuarios sintéticos.
- scripts/test-s2-security-isolated.mjs ejecuta ese contrato dentro de su regresión.
- AGENTS.md y docs/CHANGELOG.md registran el contrato y la corrección explícita.
- docs/PUBLIC_PILOT_RUNBOOK.md actualiza la publicación ya realizada y el contrato.
- docs/STAGING_PROVISIONING_REPORT.md conserva su historia y antepone la errata.
- Los dos documentos nuevos de contrato/informe entregan procedimiento y evidencia.

Total: cinco archivos existentes modificados y cuatro nuevos. No se modifican
runtime, UI, paquetes/lockfile, dieciocho migraciones, roles, grants o defaults SQL.
No se crearon commits, push, PR, merge o despliegues en esta reconciliación.

## Validaciones nuevas

| Validación                                      | Resultado real                                                                                                                                                        |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run lint                                    | PASS                                                                                                                                                                  |
| npm run format:check                            | PASS global                                                                                                                                                           |
| npm run typecheck                               | PASS                                                                                                                                                                  |
| npm run test                                    | PASS: 265 tests / 27 archivos; dos nuevos                                                                                                                             |
| npm run build                                   | PASS                                                                                                                                                                  |
| node scripts/test-s2-security-isolated.mjs --ui | PASS, exit 0; 570 pgTAP, 59 escenarios independientes, 23 escenarios HTTP públicos y regresión E2E                                                                    |
| Contrato Data API HTTP nuevo                    | PASS: 16 comprobaciones reales, detalladas abajo                                                                                                                      |
| Integridad de fuentes                           | PASS: dieciocho migraciones idénticas byte por byte al commit publicado y config.toml sin cambios, salvo equivalencia CRLF/LF de Git para el archivo de configuración |

Los dieciséis controles usan PostgREST real, no un mock:

1. GET/Accept-Profile y POST/Content-Profile contra app, app_internal, auth, storage,
   extensions y graphql_public: doce rechazos 406/PGRST106 antes de ejecutar RPC.
2. api.me con sesión válida: 200 y membresía esperada del fixture.
3. api.me sin sesión: 401; la exposición no concede acceso anónimo.
4. Lectura directa de business_settings bajo public con sesión: 403, preservando A-08.
5. public_staging_ready bajo public: 404/PGRST202; la capacidad backend no tiene alias público.

Se conservó la regresión de login/MFA sintéticos, roles/invitaciones, tenants,
último propietario, idempotencia/trazas/paginación/purgas, catálogo, clientes, HS,
agenda y portal público, incluyendo rollback y carreras. El harness retiró sus
contenedores, volúmenes y red. No se ejecutó test:e2e con variables del propietario.

HEAD permanece 9d7d7dcb219bba89bcbb10249407d551fbefed8a y main conserva
7cd26bf8cd1c6e5be8842a9c0c1e210d23a58ec3. Los cambios están locales, sin stagear.
No se afirma que el entorno remoto ya tenga esos schemas/configuración/pruebas.

## Próximo bloque para aprobación específica

La autorización anterior excluía conectar Vercel, desplegar y migrar remotamente.
Esta reconciliación no renueva esos permisos por implicación.

El lote propuesto para una autorización posterior es:

- Publicar esta corrección revisada sólo en codex/staging-readiness, sin main o PR.
- Preparar merivo-turnos-staging en Vercel merivo-group con protección y entorno
  Preview, sin contratar planes pagos ni habilitar producción.
- Aplicar las dieciocho migraciones existentes únicamente en el nuevo proyecto
  Supabase kuqtskhtsvpluhalxiav, si se aprueba su procedimiento y acceso privado;
  después configurar public+api con auto-exposición desactivada.
- Usar operadores/fixtures ficticios separados, secretos fuera de Git/chat y gate
  de reservas cerrado hasta validación del hosting/proveedor. No copiar datos ni
  cuentas/MFA del propietario; aadrzawmzrstpyuluxqk permanece excluido.
- Registrar resultados alojados reales, soporte/rollback y pendientes legales/
  operativos. Cualquier permiso, coste o incompatibilidad no cubiertos bloquean
  sólo la acción afectada; no autorizar por defecto integraciones amplias.

La creación de este plan no ejecuta esas acciones. Sin cambios remotos, consultas
a tablas del propietario, GAS, emails, reservas reales o nuevos módulos funcionales.
