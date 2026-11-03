# Contrato de exposición de Data API para staging

Fecha: 2026-11-03. Corrige las instrucciones posteriores de preparación que indicaban
exponer únicamente public y consideraban api interno. **No cambia el modelo ni los
permisos implementados.** No autoriza ni ejecuta ajustes remotos, SQL o despliegues.

## Contrato canónico

El conjunto final de Exposed schemas es **public, api**. El orden no sustituye la
selección explícita del perfil por el cliente. Automatic table exposure: **false**.
Extra search path actual: public, extensions; no equivale a Exposed schemas.

| Esquema        | Data API | Uso y autorización                                                                                                                                      |
| -------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| public         | Sí       | Entidades con ACL/RLS y proyecciones autorizadas. La exposición no concede SELECT ni escritura: A-08 sigue negando SELECT directo a businesses/settings |
| api            | Sí       | RPC de sesión. EXECUTE individual, identidad auth.uid(), tenant/membresía/rol y MFA según operación. No concede autoridad por un argumento del body     |
| app            | No       | Tablas y helpers privados, ledger, capacidades, mantenimiento y coordinación                                                                            |
| app_internal   | No       | Capacidades backend mediante conexión PostgreSQL privada app_server y EXECUTE individual; no PostgREST                                                  |
| auth           | No       | Supabase Auth usa su servicio HTTP propio; excluir este schema de PostgREST no deshabilita login/MFA                                                    |
| storage        | No       | Sin consumidor Data API en este alcance; no altera otros servicios del proveedor                                                                        |
| extensions     | No       | Dependencias SQL y search path ya aprobado; no expone funciones por agregarlo al search path                                                            |
| graphql_public | No       | Sin consumidor GraphQL autorizado; retirarlo de exposición no implica DROP del schema o extensión                                                       |

No agregar GRANT ALL, default grants a tablas, nuevas funciones públicas ni roles
para hacer funcionar un perfil. Mantener las dieciocho migraciones intactas y sus
grants existentes; service_role no se convierte en cliente rutinario de negocio.

## Evidencia del código real

- supabase/config.toml [api]: schemas=[public,api] y auto_expose_new_tables=false.
- src/modules/auth/service.ts, función rpc: client.schema("api").rpc(...).
  El cliente de sesión primero verifica al usuario con Auth; SQL reautoriza.
- Las operaciones de catálogo, clientes, HS y agenda reutilizan esas RPC de sesión.
- scripts/test-s2-security-isolated.mjs arranca PostgREST con api,public y roles
  sintéticos; scripts/lib/data-api-contract.mjs prueba ambos headers de perfil.
- src/modules/public-booking/repository.ts usa PostgreSQL app_server para llamar
  a app_internal. El visitante nunca recibe la conexión privada ni ese rol.
- Las migraciones y pgTAP mantienen EXECUTE/SELECT mínimos, RLS, aislamiento, MFA
  y denegación A-08. No basta con que un schema sea seleccionable por HTTP.

Quitar api causa PGRST106 antes de que sus funciones puedan ejecutarse: fallarían
selector, equipo y llamadas de negocio autenticadas. Añadir app/app_internal como
remedio expondría una superficie distinta y está fuera del contrato.

## Secuencia futura del destino nuevo

Destino permitido para la futura solicitud: kuqtskhtsvpluhalxiav. El proyecto
aadrzawmzrstpyuluxqk y la instancia del propietario quedan excluidos.

1. Mantener escritura pública cerrada y datos reales fuera de staging. Verificar
   de nuevo el destino y autorizar expresamente el lote de migraciones antes de usarlo.
2. En la base nueva sin migraciones, api todavía no existe: no exigir seleccionarlo
   en un selector que aún no lo ofrece ni simularlo con grants o wrappers alternativos.
3. Aplicar el lote compatible sólo mediante el procedimiento remoto que se apruebe;
   este documento no lo ejecuta. Las migraciones existentes crean el schema api.
4. Una vez disponible, configurar exactamente public y api; retirar graphql_public
   del selector. Conservar exposición automática de tablas desactivada. Nunca
   incluir app, app_internal, auth, storage o extensions.
5. Verificar por HTTP Accept-Profile para lectura y Content-Profile para POST.
   api.me debe responder a una sesión válida; sin sesión no debe autorizarlo.
6. Comprobar rechazo PGRST106/406 de cada schema privado/plataforma por ambos
   headers; SELECT directo a settings sigue denegado, y la RPC de gate interna
   no aparece como un alias en public.
7. Repetir en el hosting la matriz de roles/tenant/MFA y la regresión de sesiones,
   invitaciones, catálogo, clientes, horarios y agenda. Mantener el gate cerrado
   hasta las pruebas específicas del portal/proveedor y aprobación de apertura.

No hay migración nueva requerida para esta reconciliación. Los ajustes de schema
expuesto son configuración del servicio; no son prueba de que los grants estén bien
ni permiso para aplicar migraciones automáticamente desde GitHub.

## Pruebas locales añadidas

Dos tests verifican el contrato de schemas del CLI y la exposición automática
desactivada. La suite HTTP descartable añade dieciséis comprobaciones reales:
doce rechazos de seis schemas por dos headers, api de sesión válida, api anónimo
denegado, SELECT de settings denegado y ausencia de RPC privada en public.

Resultados de la ejecución actual y archivos modificados:
[informe de reconciliación](STAGING_DATA_API_RECONCILIATION_REPORT.md).
Estas pruebas locales no certifican la configuración del proyecto alojado.

## Referencias

- [Supabase: custom schemas](https://supabase.com/docs/guides/api/using-custom-schemas).
- [PostgREST: perfiles de esquema](https://docs.postgrest.org/en/latest/references/api/schemas.html).

Las guías explican la selección de schemas; no se copian sus ejemplos de grants
amplios. El permiso de cada objeto sigue siendo el revisado en este repositorio.
