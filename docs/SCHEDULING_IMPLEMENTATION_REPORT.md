# Horarios — HS-01/HS-02/HS-03

Fecha: 2026-11-02. Estado: implementación autorizada y validación descartable.

## Autorización y alcance

El usuario aprobó expresamente HS-D01…HS-D10 e implementar horarios y vista previa
sólo en entorno descartable. Contrato: [SCHEDULING_DESIGN_PROPOSAL.md](SCHEDULING_DESIGN_PROPOSAL.md).
Esta aprobación reemplaza la prohibición previa de horarios únicamente para HS-01/02/03.
Las propuestas anteriores permanecen como historia; AGENTS y CHANGELOG registran la
aprobación posterior. No se cierra P-02 ni el diseño completo P-03/P-06 de reservas.

Se implementan semana/vigencias, excepciones, bloqueos, consulta por rol y vista previa.
**No hay reservas, EXCLUDE, agenda de citas, disponibilidad confirmada, any-staff,
tokens, notificaciones, marketing, GAS, deploy, commit ni push.** No se aplicó SQL
a la instancia del propietario ni se modificaron sus cuentas, MFA o datos.

## Archivos

Nueva migración: `supabase/migrations/20261102000100_create_scheduling.sql`.
Se conservan las trece fuentes SQL anteriores; según el último informe local hay
doce aplicadas al propietario. Clientes y horarios siguen pendientes de activación
allí. No se consultó esa instancia para volver a certificar su historial.

Nuevos:

- `src/modules/availability/{compute,schemas,service,http}.ts`.
- `src/components/availability/manager.tsx`.
- `src/app/app/[businessId]/horarios/page.tsx`.
- Rutas bajo `src/app/api/v1/businesses/[businessId]/`: `calendar-control`,
  `schedule-preview`, `schedule-exceptions`, `time-blocks` y `staff/[staffId]/`
  con `schedule`, `working-hours`, `schedule-exceptions`, `time-blocks`.
- `tests/unit/{availability,scheduling-http}.test.ts`, `supabase/tests/scheduling.test.sql`.
- `scripts/lib/schedule-{concurrency,browser}.mjs` y este informe.

Modificados:

- Dashboard del negocio y globals.css: entrada Horarios, registros y grilla visual Merivo.
- Harness `scripts/test-s2-security-isolated.mjs` y `scripts/lib/am0405-browser.mjs`.
- Inventario de definers/RPC en `supabase/tests/{tenancy,s2_security_fixes}.test.sql`.
- AGENTS.md, docs/CHANGELOG.md y supabase/function-catalog.md.

No se cambian dependencias, stack, lockfile, logo, módulos existentes de negocio,
Apps Script ni migraciones anteriores. No se requiere el módulo de clientes para
operar horarios: el normalizador de motivos es privado de scheduling.

## Comportamiento implementado

**Semana:** días ISO 1…7, hasta catorce intervalos en el payload semanal, minutos
locales y fin 24:00 permitido. Contiguos se unen; solapados se rechazan. Semana vacía
cierra desde la fecha elegida. Sin plan no se inventa jornada.

**Vigencias:** planes ordenados por effective_from; siguiente plan determina el fin
exclusivo del anterior. Revisión en misma fecha supersede el encabezado anterior,
conservando sus intervalos. No elimina otros planes futuros. Guard de filas impide
UPDATE/DELETE de intervalos publicados y solapes dentro del plan; referencias compuestas
impiden cruzar tenants. Fechas pasadas no se editan. La auditoría conserva cambios
intradía; no se promete reconstrucción minuto a minuto de configuración histórica.

**Excepciones:** una por scope/fecha viva, closed o custom_hours, con array tipado de
intervalos y motivo privado. Precedencia: cierre global → excepción individual →
excepción global de apertura → semana. Retirar hace baja lógica; no borra planes.

**Bloqueos:** rangos UTC finitos [inicio,fin), individuales/globales; pueden solaparse.
Altas y cambios exigen inicio futuro; un bloqueo ya comenzado no puede reescribirse.
Retiro lógico conserva rango y trazabilidad. Motivo sólo owner/admin. UI ingresa fecha
y hora del negocio; SQL deriva UTC, no usa timezone del navegador como autoridad.

**DST:** conversión inversa SQL con roundtrip: busca instantes de la hora local,
rechaza huecos y elige el primero en repetición. Extremo inexistente omite ese intervalo
con advertencia, sin desplazarlo silenciosamente. Candidatos repetidos se deduplican
por reloj local; duración y buffer son minutos reales UTC. Se probaron New York,
Lord Howe, Kathmandu y día inexistente de Apia. El barrido conservador por minuto
es acotado por un staff y siete fechas; su coste requiere medición antes de escalar.

**Vista previa:** lectura de fuentes en un snapshot SQL; computeSlots puro sin I/O
ni reloj global recibe jornadas UTC/candidatos, bloqueos, override, buffer, notice y
now de servidor. Respeta grilla local desde medianoche, min_notice y max_advance
vigentes. Servicio dentro de un solo intervalo; buffer puede exceder cierre/descanso,
pero no chocar con bloqueos. Devuelve alternativas, no ocupa tiempo ni confirma citas.

Siempre mode=schedule_preview, can_book=false, occupancy_checked=false. Se comunica
expresamente que aún no se comprueban reservas. Antes de incorporar appointments
será obligatorio ampliar el snapshot y escritores para ocupación/conflictos; no se
habilita un motor contra esta vista previa como si ya fuera disponibilidad completa.

## Seguridad y coordinación

Seis tablas nuevas con ENABLE/FORCE RLS y sin grants directos ni políticas permisivas
para PUBLIC/anon/authenticated/app_server/service_role. Definers postgres con
search_path vacío y proyecciones explícitas. Sólo cinco RPC api concedidas a
authenticated; helper require_schedule_staff privado. Ningún setter de identidad.

Owner/admin activos con aal2 gestionan; barber sólo consulta staff cuya member_id
corresponde a su membresía activa del mismo negocio. No elige staff por nombre/email.
Su proyección no incluye motivos; no puede escribir, aun con setting histórico de
edición de disponibilidad. Sin staff ligado, la pantalla informa esa situación.

Root UPDATE S2 en todas las escrituras, sin alterar su coordinador: preflight → raíz
→ reautorización READ COMMITTED → replay → padre → hijos. Individuales incrementan
staff.version una vez, globals calendar_controls.version una vez. Sin control global,
lectura virtual versión 1; primer comando autorizado crea versión 2 bajo raíz. No
incrementa business.version ni todos los staff. No SHARE/upgrades ni I/O bajo locks.

Ledger separado schedule_requests, scope negocio/actor/operación/key, hash canónico
versión 1 y resultado sólo de metadatos. 48 h por reloj servidor al tomar el replay;
reautorizar antes de devolver. Expiración no evita comprobar UUID/versión vigente.
Purga invoker privada 1…500, SKIP LOCKED, sin raíz posterior/scheduler y sin tocar
auditoría, planes, clientes, catálogo o invitaciones. Hash privado no es anonimización.
request_id por intento atraviesa HTTP/RPC/audit/origin; nunca se confunde con key.

## API y UX

| Ruta bajo /api/v1/businesses/{id}                              | Contrato                                                                          |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| GET staff/{staffId}/schedule                                   | Configuración propia autorizada; ETag staff, versión global en body.              |
| PUT staff/{staffId}/working-hours                              | Plan semanal, key e If-Match staff.                                               |
| POST staff/{staffId}/schedule-exceptions o schedule-exceptions | Excepción individual/global, key y versión del padre correspondiente.             |
| POST staff/{staffId}/time-blocks o time-blocks                 | Bloqueo individual/global, mismo control de versión.                              |
| GET calendar-control                                           | Versión global; sólo owner/admin, no hace INSERT.                                 |
| GET schedule-preview                                           | staff_id/service_id/from/days (1…7); cálculo sólo informativo con permiso actual. |

Mutaciones usan envelope `{id,action,data}`: action save (predeterminado) o archive.
Update/retiro identifican ID en body en esas mismas rutas; no DELETE físico ni rutas
de restauración inventadas. Plan save siempre publica una revisión nueva con UUID
estable. Para bloques, data usa fechas/minutos locales; SQL convierte a UTC según
zona del negocio. Así no se agrega un endpoint de conversión ni librería horaria.

Validación strict SQL/Zod, body acotado, origen/CSRF de cookie y Bearer verificado;
respuestas no-store/X-Request-Id. 401/403/404, 428 sin versión, 412 obsoleta, 409
conflicto; errores SQL sin clasificar seguros, sin filtrar detalles o motivos. La
forma puede rechazarse antes del estado; autorización SQL precede versiones/replay.

UI `/app/{businessId}/horarios`: selector permitido, editor semanal, planes programados,
excepciones, bloqueos y vista previa. Horas HH:mm, descansos visibles, vigencia explícita,
cierre global informado, advertencias DST. 412 conserva borrador y pide recarga; no
reintento automático. Motivos sólo en UI administrativa. Tema/logo/tokens Merivo.
Entorno sin migración muestra estado no disponible; no intenta crear tablas al abrir.

## Validaciones

| Check final                          | Resultado real                                                                                                                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run lint / typecheck / build     | PASS.                                                                                                                                                                                 |
| npm run test                         | PASS: 180 tests / 17 archivos; 15 tests nuevos, incluido barrido de 1000 fixtures deterministas de invariantes.                                                                       |
| SQL/pgTAP descartable                | PASS: 406 aserciones, 47 de scheduling; pruebas con rollback.                                                                                                                         |
| Conexiones PostgreSQL independientes | PASS: 38 escenarios totales, siete nuevos HS; barreras de locks observadas.                                                                                                           |
| HTTP/Playwright descartable          | PASS: editor semanal, grilla, override, excepciones/bloqueos, cierre global, replay/trace, 428/412 con borrador y barber propio sin motivos. Desktop/móvil sin overflow ni pageerror. |
| Regresión S1/S2/catálogo/clientes    | PASS en el mismo harness; login/MFA, roles/invitaciones, último owner, lecturas privadas/públicas, cursores, replay y retención.                                                      |
| npm run format:check                 | FAIL conocido por quince Markdown preexistentes de arquitectura-v1.1; permanecen intactos. Archivos de esta entrega formateados.                                                      |
| git diff --check                     | PASS.                                                                                                                                                                                 |

Comando: `node scripts/test-s2-security-isolated.mjs --ui`. PostgreSQL/Auth/PostgREST
propios, usuarios/MFA de fixture y copia temporal de Next sin .env del propietario.
No se ejecuta npm run test:e2e con su configuración local porque apuntaría a esa
instancia; Playwright corre desde el harness aislado. Todos los containers, volúmenes
y red creados por la ejecución final fueron retirados. No se detectaron regresiones
en los recorridos ejecutados. Se corrigieron sincronización del test al elegir staff
y composición JSX detectada por lint antes de la ejecución final satisfactoria.

Las pruebas nuevas comprueban DST de una hora/media hora/día inexistente, intervalos
publicados inmutables, FKs/solapes, versión staff/control virtual, precedencia global,
planes futuros/revisiones conservados, bloques retirados, rollback de audit y purga.
Carreras HS: dos editores, revocación durante espera, catálogo vs horario, doble
inicialización global, replay idéntico, purga frente a escritura y rollback de purga.
No se presenta un deadlock como resultado correcto. No se prueban reservas inexistentes.

Capturas sintéticas test-results/scheduling-desktop.png y scheduling-mobile.png
inspeccionadas visualmente; ignoradas por Git. Sin secretos ni datos del propietario.
Comparación SHA-256 del bloque: 210 archivos previos, 201 intactos, nueve cambios
acotados listados arriba, 21 nuevos y ninguno eliminado. Las trece migraciones
anteriores, propuesta aprobada, dependencias, assets y código de clientes/catálogo
se conservan. SHA-256 de la nueva migración:
`0c869e2919370d42a0d8f44b59db6699acb4139f8f8550344296edb963515de6`.

## Límites y estado operativo

- No se aplicó ninguna migración al propietario; sus cuentas/MFA/sesiones/invitaciones
  no se usaron como fixtures. Todas las escrituras de prueba son descartables.
- No se activa clientes ni horarios localmente en esta entrega. Aplicación posterior
  necesita autorización del conjunto pendiente, respaldo y comprobación de destino.
- Sin reservas, EXCLUDE, tokens, agenda, cancelaciones, emails, integración o despliegue.
  No hay affected_appointments ficticios: todavía no existe tal fuente de datos.
- Rendimiento de siete días/catorce intervalos tiene límites de entrada; no se afirma
  benchmark ni objetivo p95 alcanzado. No hay caché de permisos ni librería nueva.
- Cambiar timezone/políticas del negocio no tiene escritor nuevo en este bloque.
  El futuro motor debe coordinar esos cambios y validar ocupación real antes de operar.
- P-02, liberaciones, snapshots de reservas, tokens/replay público y revisión legal
  de clientes continúan pendientes. No se avanza automáticamente al siguiente bloque.

Estado final: **HS-01/02/03 implementados y validados en descartable**. No activados
en la instancia del propietario; no es todavía un MVP operativo de reservas.
