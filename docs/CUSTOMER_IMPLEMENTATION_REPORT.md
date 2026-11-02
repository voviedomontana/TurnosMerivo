# Clientes — CM-01/CM-02 y UI administrativa CM-05

Fecha: 2026-11-02. Alcance: directorio administrativo de clientes, exclusivamente
implementado y probado en infraestructura descartable. No aplicado al propietario.

## Autorización y precedencia

El usuario autorizó explícitamente «ese alcance de clientes y sus pruebas
descartables», aceptando CD-01…CD-06 y CM-01/CM-02 + UI administrativa CM-05.
Incluye altas, edición, búsqueda keyset, notas privadas y archivo/restauración.
Sustituye la restricción documental sólo para este mínimo; no autoriza CM-03/04,
marketing, acceso barber, reservas, horarios, importaciones ni aplicar migraciones
a la instancia del propietario. Las cinco propuestas CUSTOMER_* se conservan como
historia; este informe y AGENTS registran la aprobación posterior.

Contratos base: [diseño](CUSTOMER_MODULE_DESIGN.md), [matriz](CUSTOMER_PERMISSION_MATRIX.md),
[lotes](CUSTOMER_MIGRATION_PROPOSAL.md), [plan de pruebas](CUSTOMER_TEST_PLAN.md).
No se consideran implementados los casos de marketing de esos documentos.

## Archivos y migración

Nueva: `supabase/migrations/20261101001000_create_customer_directory.sql`.
Las doce anteriores no se editan; el harness verifica ahora también el hash del
catálogo anterior antes de aplicar únicamente en su contenedor nuevo.

Nuevos archivos:

- `src/modules/customers/{schemas,service,http}.ts`.
- `src/components/customers/directory.tsx`.
- `src/app/app/[businessId]/clientes/page.tsx`.
- `src/app/api/v1/businesses/[businessId]/customers/route.ts`.
- `src/app/api/v1/businesses/[businessId]/customers/search/route.ts`.
- `src/app/api/v1/businesses/[businessId]/customers/[resourceId]/route.ts`.
- `src/app/api/v1/businesses/[businessId]/customers/[resourceId]/[action]/route.ts`.
- `tests/unit/{customers,customer-http}.test.ts`.
- `supabase/tests/customers.test.sql`.
- `scripts/lib/customer-{concurrency,browser}.mjs`.
- Este informe.

Modificados:

- `src/modules/auth/permissions.ts`: customers:read/write finitos para owner/admin
  con aal2; default deny y reglas S2/catálogo preservadas.
- `src/app/app/[businessId]/page.tsx`: acceso Clientes sólo administradores.
- `src/app/globals.css`: espaciado y ajuste de contactos largos, mismos tokens Merivo.
- `scripts/test-s2-security-isolated.mjs`, `scripts/lib/am0405-browser.mjs`: integran
  pruebas de clientes en el harness ya aislado, sin usar .env del propietario.
- `supabase/tests/{tenancy,s2_security_fixes}.test.sql`: inventario de tres nuevas RPC.
- `supabase/function-catalog.md`, `AGENTS.md`, `docs/CHANGELOG.md`: alcance y registro.

Sin cambios de dependencias, lockfile, stack, logo, estructura existente, SQL
histórico, propuestas de diseño ni Google Apps Script.

## Datos, seguridad y diferencias acotadas del diseño

customers admite nombre obligatorio y contactos opcionales/repetidos, incluso nombre
idéntico en un negocio. No Auth para clientes, upsert por contacto, asignación ficticia
de barbero, estadísticas ni identidad verificada. Teléfono raw conservado; + explícito
se normaliza sólo sintácticamente; nacionales ambiguos quedan needs_review sin agregar
54/9 ni retirar 0/15. SQL y Zod validan la misma política NFC/bounds/subconjunto ASCII
de email y handle Instagram. Longitudes de ficha por puntos de código, no UTF-16.
Trim de persistencia compatible con btrim PostgreSQL: espacios ASCII exteriores.

El trigger deriva los campos de contacto y marketing_revision. Este contador sólo
reserva la invalidación de contexto prevista en CD-01/05: no existe consentimiento,
aviso, evidencia ni permiso comercial. Archivo aumenta ese epoch, restauración no
lo reinicia; contactos cambiados también lo incrementan. No se exponen estos campos
internos ni se crean eventos de consentimiento implícitos.

La UI usa REST autenticado para todas las operaciones, sin Server Actions nuevas:
source es admin_api fijo de servidor tanto para UI como para HTTP, sin permitir
afirmar admin_panel desde el body. Los campos/tipos restantes siguen el diseño.
El escritor se expone como una única RPC api.write_customer con enum de operaciones
finito; no crea cuatro wrappers iguales ni un core definer redundante. Toda autoridad
permanece dentro de SQL, con la misma matriz aprobada, no en el handler.

customers y customer_requests fuerzan RLS sin políticas ni grants de tablas para
roles de aplicación. Tres definers postgres con search_path vacío: write_customer,
read_customer y list_customers_page, EXECUTE sólo authenticated. Helpers/trigger/
purger privados invoker sin elevación. No capacidad nueva para anon, service_role,
app_server o platform_admin sin membresía válida. Barber no tiene acceso a listado,
búsqueda, ficha ni notas, ni aun mediante RPC directa; no existe read_own.

Lista explícita sin notas; detalle explícito con notas sólo owner/admin aal2. Las
notas no viajan en listado, auditoría, replay ni mensajes de error. No whole-row JSON
en lecturas. El body strict rechaza business_id, actor, source, phone_e164, derivados,
version y campos de marketing/estadísticas. Los UUID de alta son v4 estables.

## Transacciones y contratos

Se conserva el coordinador S2 sin modificar: preautorización no bloqueante → raíz
exclusiva UPDATE y reautorización READ COMMITTED → replay → customer → comprobación
de versión/estado → mutación, audit y replay en la misma transacción. No I/O externo
bajo locks ni nuevos locks de staff/miembro después de customer. Un fallo de auditoría
revierte perfil, versión y ledger. No se toca último propietario ni invitaciones.

Ledger privado customer_requests independiente, scope negocio/actor/operación/key,
canon_version=1, hash SQL canónico y result de metadatos. Reconocimiento 48 h desde
created_at, decidido por clock_timestamp después del lock. Replay exacto autorizado
no repite efectos; intención distinta→409; expirado/purgado revalida UUID/versión y
no duplica una alta. Purga postgres invoker privada 1…500, SKIP LOCKED, sin scheduler,
sin raíz posterior y sin borrar clientes, auditoría o ledgers S2/catálogo.

UUID request_id por intento HTTP, independiente de key, propagado a PostgreSQL,
auditoría y origin_request_id. Sin logs de cuerpos, contactos, notas, cookies o tokens.

Base `/api/v1/businesses/{businessId}/customers`:

| Entrada                       | Contrato implementado                                                                                     |
| ----------------------------- | --------------------------------------------------------------------------------------------------------- |
| GET base                      | Listado current/archived, limit predeterminado 50 y rango 1…200, cursor; no búsqueda por contacto en URL. |
| POST /search                  | field/mode/value/state/limit/cursor en JSON; sólo lectura, sin key.                                       |
| POST base                     | id UUID v4 + data; key UUID obligatoria, 201 y ETag.                                                      |
| GET /{id}                     | Detalle administrativo, incluido archivado; ETag.                                                         |
| PUT /{id}                     | Reemplazo completo, key e If-Match; 200 metadatos.                                                        |
| POST /{id}/archive o /restore | {}, key e If-Match; 200 metadatos.                                                                        |

Límite body y CSRF/origen cookie como S2, Bearer verificado con Auth. Respuestas
private/no-store y X-Request-Id. 401/403/404, 428 ausente, 412 obsoleto, 409 conflicto;
23514 desconocido conserva 500 interno seguro, no LAST_OWNER. Forma inválida→400,
sin consultar estado sensible; la autorización SQL precede versiones y cursores.

Keyset (created_at,id) inmutables, limit+1, cursor base64url validado en SQL y ligado
al negocio y filtro normalizado. Sin OFFSET ni truncamiento silencioso. Búsqueda de
prefijos escapa %, _ y backslash; exacta devuelve varias fichas con contacto compartido.
Cursor no firmado no concede autoridad; no snapshot ni feed incremental garantizado.

## UI

Página `/app/{businessId}/clientes` con identidad Merivo, directorio inicial de 50,
búsqueda por campo/estado, siguiente/primera página, alta y ficha con notas privadas.
Contactos compartidos no bloquean ni unen personas. Búsquedas sólo en memoria/POST,
sin query sensible en URL ni localStorage. Archivo/restauración conservan datos;
conflicto 412 conserva borrador y requiere recargar conscientemente.

Una instancia sin la RPC/migración muestra «El directorio todavía no está disponible»
con regreso al negocio; no obliga reset ni crea tablas al navegar. No hay marketing,
historial de visitas o estadísticas ficticias. Sin entradas del directorio para barber.

## Validación

Comando reproducible: `node scripts/test-s2-security-isolated.mjs --ui`. No carga
.env ni usa containers existentes: PostgreSQL/Auth/PostgREST con prefijo aleatorio,
usuarios/MFA sintéticos y copia Next compilada con configuración de fixture. Limpieza
acotada a sus propios recursos. No se usa npm run test:e2e en su configuración local,
porque apuntaría al propietario; Playwright se ejecuta desde el harness aislado.

La ejecución final completa pasó 359 aserciones pgTAP (42 de clientes) y 31 escenarios
con conexiones independientes (cinco de clientes), además de HTTP/Playwright,
incluidos los últimos ajustes de presentación. Resultados de checks de código:
lint, typecheck y build PASS; 165 tests / 15 archivos PASS (26 nuevos).
format:check conserva su FAIL preexistente por 15 Markdown de arquitectura-v1.1;
no se modifican esos documentos. Archivos de la entrega formateados con Prettier.

Los escenarios clientes verifican:

- RPC y UI permiten nombres/contactos compartidos, sin crear cuentas Auth.
- Barber denegado, MFA owner/admin, otros tenants 404 y raw tables sin grants.
- Listados sin notas, detalle autorizado con notas; result/audit sin valores PII y
  hash de intención privado, nunca expuesto como dato anónimo.
- 428/412/409, replay exacto, TTL/purga y alta con UUID estable sin duplicados.
- Rollback del perfil/versión/replay al fallar auditoría mediante probe sólo de fixture.
- Conexiones independientes con barreras PostgreSQL observadas: dos editores, revocación
  tras preflight, creación repetida, purge vs write y rollback de purga sin tomar raíz.
- HTTP real de Next: 201/ETag, propagación de request_id, replay, rechazo de otra
  intención, permisos, filtros y cursores. Paginación completa de 154 fixtures sin
  IDs duplicados; pgTAP también verifica 50/200 sobre >450 filas con timestamps empatados.
- UI: alta, edición, archivo/restauración, búsqueda de contacto compartido, borrador
  preservado ante 412, recarga explícita y veto de acceso directo para barber.
- Regresión S1/S2/catálogo: identidad, MFA, selector, roles, invitaciones, lectura
  privada/pública, último propietario, trazabilidad, keyset miembros y retención.

No se detectaron regresiones en los recorridos ejecutados. Se corrigió una etiqueta
accesible de filtro detectada por Playwright y se repitió la suite. Los números no
acreditan casos de marketing/agenda diferidos. Capturas sintéticas desktop/mobile
en test-results/customers-*.png, ignoradas por Git, sin tokens ni datos del propietario.
Se inspeccionaron visualmente ambas capturas. La ejecución final retiró sus
contenedores, volúmenes y red descartables; no se dejaron fixtures en el propietario.

Preservación frente al inicio del bloque: 193 archivos previos registrados por hash;
183 intactos, diez modificaciones acotadas listadas arriba, ningún eliminado y
dieciséis nuevos. Las doce migraciones previas, propuestas CUSTOMER_*, dependencias,
logo e integración existente permanecen intactos. Nueva migración SHA-256:
`562c13f80ebb22c3386524795e056a2019ca56f56f96c5c6454c7a04a48d7107`.

## Estado operativo y pendientes

- **No se aplicó la migración a la instancia del propietario.** La aprobación actual
  excluye hacerlo; para usar el directorio allí se requiere autorización separada,
  respaldo y verificación de destino. No repetir fixtures/E2E sobre esa instancia.
- No se modificaron cuentas, sesiones, factores MFA, contraseñas, usuarios ni invitaciones
  del propietario; todos los datos mutados son fixtures del harness descartable.
- CD-07/08/09 y CM-03/04 siguen pendientes. Antes de cargar datos reales hay que cerrar
  aviso operativo, derechos y retención; este bloque no afirma cumplimiento legal.
- Sin anonimización/supresión legal, exportación masiva, merge, GAS, marketing, reservas,
  disponibilidad, horarios, EXCLUDE, despliegue, commits ni push.
- Próximo trabajo de agenda/motor necesita sus decisiones y autorización; no se inicia
  automáticamente al terminar clientes.

Estado final: **CM-01/CM-02 y UI administrativa CM-05 implementados y validados en
descartable**. Activación local no realizada ni autorizada en este bloque.
