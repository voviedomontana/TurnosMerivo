# PB-01 — Catálogo público de sólo lectura

Fecha: 2026-11-02. Continuidad tras la activación de quince migraciones y el pedido
«avanza con el resto». Estado: **PB-01 implementado y validado en descartable**;
no activado en la instancia del propietario.

## Entrega y contratos

Pantalla /b/{slug} accesible sin cuenta ni sesión; marca Merivo, tarjetas de
profesionales y servicios, dirección/contacto comercial, precios ARS y duración
efectiva por profesional. No permite ni simula confirmar un turno. La creación y
autogestión públicas tienen decisiones pendientes documentadas en
[PUBLIC_BOOKING_MVP_PROPOSAL.md](PUBLIC_BOOKING_MVP_PROPOSAL.md).

GET /api/v1/public/{slug}/catalog devuelve business (la proyección pública S1 sin
cambios) y professionals: id/display_name/bio/services. Cada servicio contiene
id/name/description/category/price_cents/currency/duration_minutes. Sólo staff
activo/no archivado con accepts_online y al menos un servicio activo asociado.
Servicios activos/no archivados del mismo tenant; overrides tienen prioridad.
Orden determinista de catálogo por sort_order/nombre/id, sin exponer sort_order.

Sólo negocio activo/no archivado con public_booking_enabled. Slug inválido,
desconocido o modo público deshabilitado: 404 uniforme. Backend no disponible o
proyección inesperada: 503 seguro por API; la página presenta un mensaje de
indisponibilidad sin detalles internos. Sin cache de contenido ni necesidad de
cookies Auth. X-Request-Id por intento, Referrer-Policy no-referrer, sin query de
datos personales. La página se mantiene noindex mientras el portal esté incompleto.

## Migración, funciones y archivos

Nueva 20261102000300_public_catalog.sql, **no aplicada al propietario**. No crea ni
altera tablas, datos, cuentas, RLS o funciones previas. Agrega una función STABLE
SECURITY DEFINER propiedad postgres, search_path vacío:

app_internal.get_public_catalog(text), EXECUTE sólo app_server; revocado para
PUBLIC/anon/authenticated/service_role. La función valida elegibilidad del negocio
mediante get_public_business y resuelve todas las relaciones por su tenant dentro
de PostgreSQL. No admite business_id o actor declarados por un navegador.

Sin permisos SELECT/DML de tablas nuevos. Sin RPC administrativa convertida en
pública. Sin proyección de membership/user/version, buffer privado, datos fiscales,
facturación, clientes, notas, contactos de clientes, intervalos ocupados o motivos
de cierres. Las descripciones son texto escapado por React, sin HTML del catálogo.
get_public_business y su endpoint existentes permanecen compatibles. Inventario
acumulado de definers: 34; capacidades previas conservadas.

Nuevos archivos:

- supabase/migrations/20261102000300_public_catalog.sql.
- supabase/tests/public_catalog.test.sql.
- src/modules/businesses/public-catalog.ts, public-catalog-repository.ts,
  public-catalog-http.ts.
- src/app/api/v1/public/[slug]/catalog/route.ts y src/app/b/[slug]/page.tsx.
- tests/unit/public-catalog.test.ts y scripts/lib/public-catalog-browser.mjs.
- docs/PUBLIC_BOOKING_MVP_PROPOSAL.md y este informe.

Modificados: CSS compartido sólo para tarjetas de servicios; inventario en
supabase/tests/tenancy.test.sql; scripts/test-s2-security-isolated.mjs y
scripts/lib/{am0405-integration,am0405-browser}.mjs para pruebas públicas reales;
AGENTS.md y docs/CHANGELOG.md para alcance y trazabilidad. Sin dependencias nuevas.

El harness publica el puerto PostgreSQL de su contenedor UUID sólo en loopback
aleatorio y habilita LOGIN de app_server exclusivamente en ese fixture con secreto
aleatorio en memoria. Next temporal recibe esa URL sintética; no lee .env ni cambia
el rol del propietario. Nunca se imprimen credenciales o respuestas privadas. El
resto del harness usa sus Auth/PostgREST/cuentas/MFA descartables habituales.

## Pruebas y límites

| Check                                           | Resultado real                                                                                                                                                                                                                   |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| node scripts/test-s2-security-isolated.mjs --ui | PASS, exit 0. 505 aserciones pgTAP, incluidas 19 nuevas de catálogo público.                                                                                                                                                     |
| Conexiones independientes                       | PASS, 48 escenarios acumulados S2/catálogo/clientes/HS/IN; sin relajar rechazos o aceptar deadlocks como éxito. PB-01 no tiene escrituras que agreguen una carrera de reserva.                                                   |
| HTTP/Playwright público descartable             | PASS, navegador sin sesión, precio/duración efectivos, exclusión de privado/offline, 404 al deshabilitar catálogo o no existir, sin botón de falsa confirmación ni cookie Auth. Desktop 1280 y móvil 390 sin overflow/pageerror. |
| Regresión acumulada                             | PASS, login/MFA reales de fixture, selector, roles/invitaciones, tenants, lecturas pública/privada, cursores, replays/purgas, clientes/HS y agenda crear/mover/cancelar.                                                         |
| npm run test                                    | PASS, 207 tests / 20 archivos; nueve casos nuevos.                                                                                                                                                                               |
| npm run lint / typecheck / build                | PASS. El harness también compila y sirve Next en copia temporal con configuración sintética.                                                                                                                                     |
| npm run format:check                            | FAIL preexistente, sólo quince Markdown de arquitectura-v1.1; no se modifican.                                                                                                                                                   |
| git diff --check                                | PASS.                                                                                                                                                                                                                            |

La primera ejecución detectó que la suite nueva necesitaba USAGE de extensions
para ejecutar pgTAP como app_server; se otorgó sólo dentro de la transacción de
pruebas, revertida al finalizar. La ejecución completa posterior pasó. No se
concedió ese permiso nuevo al propietario como consecuencia del test.

Se inspeccionó visualmente la captura pública móvil, y se guardaron capturas
sintéticas desktop/móvil en test-results, ignorado por Git. Los containers,
volúmenes y red de la suite se retiraron al terminar. No se ejecutó test:e2e con
configuración del propietario; Playwright corrió sólo desde el harness aislado.
Las quince migraciones previas pasaron su comprobación SHA-256 antes de reconstruir
la base. No se editaron SQL aplicados, dependencias, logo o configuración de entorno.

Hash SHA-256 de la migración 16:
56833037cddb439e1de543371542215ad90d77a824a9d92da1e82c5c8ed0a4d6.

No se aplicó la migración 16 a la base local activada; no se modificaron datos,
cuentas, MFA, jornadas o reservas del propietario. Para ver allí el catálogo nuevo
hará falta activar su función con autorización específica. Mientras falte, la
pantalla informa indisponibilidad; no usa datos ficticios como sustituto.

PB-01 no cierra S7 ni el MVP completo. No disponibilidad pública, escrituras,
tokens, cuotas/desafíos, cookies de gestión, emails, worker, marketing, GAS o hosting.
Preservar max_active_bookings_per_customer como requisito pendiente de identidad
verificable; una ficha nueva o una cuota de teléfono no prueba persona ni propiedad.
No se publicará el portal con datos reales antes de resolver privacidad y antiabuso.

Gate de implementación dependiente: CODEX_IMPLEMENTATION_GUIDE regla 1 exige
documentar opciones y detener sólo el código de decisiones P-xx abiertas; P-06
mantiene pendiente replay de secretos/capacidad anónima. El nuevo contrato concreta
esas decisiones y solicita aprobación PB-D02…D10. PB-01 no depende de ese replay ni
las aprueba por extensión. No avanzar automáticamente a esos comandos.
