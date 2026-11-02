# TurnosMerivo — contexto para revisión y continuidad del MVP

Corte de estado: 2026-11-01. Mensaje para el agente de planificación/arquitectura.
Este contexto describe el repositorio local; no autoriza comenzar otro sprint,
aprobar decisiones pendientes ni publicar. No contiene credenciales ni datos del propietario.

## Pedido al agente

Hicimos una revisión de los documentos y necesitamos reconciliar la planificación
con lo que ya implementamos. Actuá como arquitecto senior especializado en Next.js,
PostgreSQL, Supabase y seguridad multi-tenant.

Leé las especificaciones revisadas junto con este contexto, identificá sus diferencias
con el estado real y proponé cómo continuar sin rehacer ni perder el trabajo anterior.
Si recibís una revisión más reciente que los archivos de este repositorio, comparala
expresamente: no supongas que ya se incorporó o que sus propuestas están aprobadas.
Tu primera entrega debe ser una revisión y un plan; no implementar ni migrar todavía.

## 1. Producto y alcance del MVP

TurnosMerivo es una plataforma SaaS de turnos para barberías. Comienza con Merivo,
pero se diseña multi-tenant desde el inicio. El idioma de UI es es-AR y la moneda
inicial es ARS. PostgreSQL debe garantizar la integridad de las reservas.

El MVP previsto incluye catálogo de profesionales/servicios, horarios/disponibilidad,
reservas públicas sin cuenta obligatoria del cliente, gestión mediante token por
reserva, agenda administrativa y de barbero, clientes, notificaciones por email e
integración controlada con la aplicación existente de Google Apps Script/Sheets.

Google Apps Script no se migra ni se modifica fuera de su sprint. PostgreSQL será
la fuente de verdad de turnos. No se agrega una transacción distribuida con Sheets.

Fuera del MVP: pagos, WhatsApp, Google Calendar, multi-sucursal, múltiples servicios
por turno, onboarding self-service, suscripciones/planes comerciales, dominios propios,
lista de espera, reportes avanzados, push y modo offline.

## 2. Arquitectura y herramientas preservadas

- Monolito modular, dependencias `app → modules → lib`; handlers finos y reglas de
  negocio en `src/modules/*`. Componentes compartidos en `src/components`.
- Next.js 16.4.3 App Router, React 19.3.1, TypeScript strict, Tailwind CSS 4 y shadcn/ui.
- Supabase PostgreSQL 17 local con Docker; CLI 2.122.0 fijada en devDependencies.
- Supabase JS 2.118.0 y adaptador SSR 0.12.7; conexión pública interna restringida
  mediante Postgres.js. Zod para validación, npm y package-lock.json.
- Vitest, Playwright y pgTAP. Workflows de CI definidos; no afirmar ejecución remota.
- Vercel/Supabase alojado son el destino previsto; no hay despliegue realizado.
- Las carpetas de dominio existentes fueron aceptadas en P-07. No reorganizar por
  estética, cambiar stack, agregar microservicios o incorporar abstracciones futuras.

## 3. Estado real implementado

La entrega es local. No equivale al cierre formal de los sprints según la DoD global
que exige PR revisado, CI remoto y staging. Tampoco representa un MVP operativo.

| Etapa          | Entregado localmente                                                                                                               |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| S0             | Proyecto, herramientas de calidad, landing responsive y estructura base                                                            |
| S1             | Negocios/settings, identidad/membresía mínima, RLS, resolución y proyección pública restringida, fixtures y pruebas de aislamiento |
| S2             | Login real, sesiones SSR, MFA TOTP, selector de negocio, roles, invitaciones y gestión de equipo                                   |
| S3 en adelante | No implementado                                                                                                                    |

La landing funciona sin una conexión DB activa. El endpoint público S1 sólo devuelve
la proyección base disponible; no entrega servicios, profesionales o disponibilidad.

S0 no entregó todos los elementos de su alcance inicial: health endpoint, logger,
Sentry y preview remoto siguen como trabajo operativo pendiente antes del piloto,
según la aclaración del roadmap. No certificarlos retrospectivamente.

Todavía no se pueden gestionar turnos reales: no hay catálogo, horarios, slots,
motor transaccional de reservas, portal de reserva, agenda operativa, gestión de
clientes, notificaciones de turnos o integración GAS funcionando.

### Acceso S2 disponible

- `/login`, `/auth/alta`, `/seguridad`, `/app`, `/app/{businessId}`,
  `/app/{businessId}/miembros` y `/invitaciones`.
- Auth con email confirmado y contraseña mínima de 10 caracteres; registro público
  deshabilitado. Cookies HttpOnly, SameSite=Lax, Secure en producción; sin sesión en
  localStorage. JWT de hasta una hora y refresh rotatorio.
- MFA obligatorio para owner/admin/plataforma, con enforcement en BD para las
  operaciones privilegiadas. El selector propio y el setup MFA tienen acceso acotado.
- Roles por negocio owner/admin/barber: admin sólo gestiona barberos; nadie cambia
  su propio rol/estado. Se protege al último propietario activo.
- Alta de cuenta Auth y pertenencia al negocio son pasos separados. Invitación de
  negocio de un uso/7 días, email verificado coincidente, token de 256 bits sólo
  hasheado en BD, enlace con fragmento y presentación por POST; admite renovar/revocar.
- Versionado, locks e idempotencia de membresías con auditoría transaccional.
- El primer propietario local ya se aprovisionó. No recrear su cuenta, cambiar su
  contraseña ni eliminar/reconfigurar sus factores para hacer pruebas.
- Mailpit captura los correos locales; no hay SMTP productivo conectado.

### Base aplicada: reutilizar, no recrear

Hay cinco migraciones locales:

1. `20261031231242_init_tenancy.sql`.
2. `20261031231400_allow_maintenance_server_role.sql`.
3. `20261031232111_restrict_future_function_execute.sql`.
4. `20261101000100_auth_memberships.sql`.
5. `20261101000200_invitation_lifecycle.sql`.

Incluyen businesses, business_settings, users, business_members, platform_admins,
audit_logs base y tablas privadas de invitación/replay. Ver el catálogo real de
funciones, propietarios, grants y excepciones RLS. No editar migraciones aplicadas.

## 4. Revisión documental ya incorporada

Las correcciones A–G de `14_CORRECCIONES_CRITICAS.md` se consolidaron en los docs
originales 01–13, roadmap, guía y AGENTS. El informe de consolidación conserva la
trazabilidad. El historial también contiene estados anteriores a S1/S2: leer sus
actualizaciones posteriores, no tratar todo párrafo histórico como estado actual.

Garantías que deben conservarse:

1. Identidad de sesión desde `auth.uid()`; verificar membresía activa, tenant y
   permiso en BD. Un business_id de cliente es selector, nunca autoridad. Roles
   vigentes desde BD; no confiar en metadata/JWT para asignar permisos del negocio.
2. SECURITY DEFINER con search_path vacío, objetos calificados, EXECUTE PUBLIC y
   defaults revocados, grants mínimos y catálogo de helpers antirrecursión. FORCE
   RLS no evita que un propietario BYPASSRLS saltee políticas: validar dentro del cuerpo.
3. `app_server` sin acceso directo a tablas y limitado a operaciones internas
   aprobadas. `service_role` sólo Auth Admin/Storage; no acceso rutinario de negocio.
   PostgREST expone public/api; app y app_internal permanecen privados.
4. Mutaciones futuras de agenda con protocolo común de locks, revalidación bajo lock,
   versiones, evento/outbox/idempotencia atómicos. No SAVEPOINT dentro de PL/pgSQL.
5. Los intervalos derivados deben cumplir igualdades exactas, no sólo orden; snapshots
   históricos no se actualizan automáticamente cuando cambia el catálogo.
6. Modo B de GAS es sólo lectura, incluidos links/mappings/importaciones. Modo A
   requiere identidad real y aislamiento demostrado; UserProperties no es prueba suficiente.
7. MVP de sincronización mediante barridos completos y reconciliación. No prometer
   completitud por updated_at, secuencias o una ventana fija. Feed changes reservado.
8. No existe una FK polimórfica nativa a múltiples tablas: resolver referencias y
   tenant transaccionalmente o adoptar relaciones tipadas aprobadas.
9. If-Match ausente: 428; versión obsoleta: 412; conflicto de negocio: 409.
   Reautorizar replays y rechazar claves reutilizadas con intención distinta.

La consolidación no convirtió todas las recomendaciones en decisiones aprobadas.
P-01 y P-07 sí fueron aprobadas explícitamente para S1; S2 fue autorizado después.
ADR-022 y ADR-023 documentan esas entregas y decisiones técnicas.

## 5. Decisiones pendientes

| ID   | Estado / tema                                                                         | Antes de                                        |
| ---- | ------------------------------------------------------------------------------------- | ----------------------------------------------- |
| P-01 | Cerrada para la base S1: roles/grants, mínima identidad/membresía y aislamiento       | S1 entregado                                    |
| P-07 | Cerrada: conservar carpetas y responsabilidades actuales                              | S1 entregado                                    |
| P-02 | Política histórica de completed/no_show y corrección/liberación explícita sin solapes | S3/S6                                           |
| P-03 | Protocolo común de locks, operaciones globales y orden determinista                   | S5/S6                                           |
| P-04 | Referencias externas polimórficas/tipadas, tenant y unicidad compatible con fusión    | S10; revisar dependencias físicas al planear S3 |
| P-05 | Alcance/paginación/bajas y reconciliación; feed sólo con protocolo probado            | S10/S11                                         |
| P-06 | Versiones de recursos globales y replay seguro con token de gestión de reserva        | S5/S6                                           |
| P-08 | Validación real de identidad/almacenamiento de credenciales GAS con dos cuentas       | Escritura GAS                                   |

Para P-02 hay una recomendación de conservar la ocupación histórica de completed
y no_show, con corrección explícita y revalidación. No se aprobó el predicado final
ni su mecanismo de liberación. Presentar opciones, efectos y pruebas; no decidir
silenciosamente ni liberar slots históricos por marcar ausencia.

Otros pendientes: recuperación asistida ante pérdida de TOTP, soporte temporal,
SMTP externo, purga de replay de membresías, observabilidad, backups/restauración,
seguridad operativa y validación legal antes de datos reales. La auditoría base S2
usa UUID y before_data/after_data, una elección física documentada respecto del
modelo lógico inicial: revisar esa diferencia expresamente en la nueva revisión.

## 6. Roadmap restante

| Sprint | Próxima entrega prevista                                         |
| ------ | ---------------------------------------------------------------- |
| S3     | Modelo completo, constraints, referencias del mismo tenant y RLS |
| S4     | CRUD de profesionales, servicios y servicios habilitados         |
| S5     | Horarios, excepciones, bloqueos y cálculo de disponibilidad      |
| S6     | Motor transaccional de reservas, estados y endpoints             |
| S7     | Portal público y gestión por token                               |
| S8     | Paneles, agenda y clientes                                       |
| S9     | Notificaciones por email y workers                               |
| S10    | API de integración segura y reconciliación                       |
| S11    | Integración GAS en su sprint autorizado                          |
| S12    | Seguridad, concurrencia, carga y recuperación                    |
| S13    | Despliegue productivo y piloto                                   |

No interpretar el número de sprint como porcentaje de avance: el motor de reservas
y la operación del negocio siguen pendientes. Las estimaciones del roadmap son
supuestos iniciales; no una fecha de entrega comprometida ni un cronograma actualizado.

## 7. Correcciones recientes y evidencia disponible

- QR MFA: normalización de SVG data URL para evitar rechazo de next/image en desarrollo.
  Tests sintéticos reproducen el fallo; E2E comprueba carga real de imagen y verificación.
- Invitaciones en desarrollo: resuelto el rechazo de HMR para 127.0.0.1 mediante
  allowedDevOrigins limitado a ese origen local. Handshake 101 para loopback y
  rechazo de origen externo. La incidencia ya no está pendiente.
- Últimas validaciones registradas: lint, formato, typecheck y build aprobados;
  62 unitarios; cuatro E2E completos de desarrollo y cuatro de producción.
- Última ejecución registrada de BD: 114 checks pgTAP y db:lint sin errores;
  integración HTTP S1: tres pruebas aprobadas. No se repitieron en los fixes de UI/config.
- No afirmar que estas comprobaciones se ejecutaron de nuevo por preparar este contexto.
- CI configurado incluye modo dev/producción, pero CI remoto no ejecutado. No hay
  despliegue, revisión humana de PR ni piloto productivo acreditados.
- Se registraron 17 advertencias moderadas de dependencias; su estado actual requiere
  una comprobación específica. No se forzaron actualizaciones fuera de alcance.

## 8. Repositorio, entorno y límites

El workspace se llama MERIVO-TURNOS. Hay modificaciones y archivos sin seguimiento
que contienen trabajo de varias etapas. No restaurar HEAD, limpiar el árbol, borrar
archivos sin seguimiento ni asumir que lo no commiteado es descartable.
No se realizaron commits ni push en estas entregas.

`.env.local` está ignorado y contiene configuración privada. No leer/imprimir secretos,
copiarlos al traspaso ni adjuntar ese archivo. La última comprobación registrada no
encontró las claves privadas/conexión en archivos no ignorados o chunks cliente.

Comandos existentes:

```sh
npm ci
npm run dev
npm run db:start
npm run db:migrate
npm run db:provision-local
npm run auth:configure-local
npm run lint
npm run format:check
npm run typecheck
npm run test
npm run db:test
npm run db:lint
npm run test:integration
npm run test:e2e
```

No ejecutar todos automáticamente para una revisión de documentos. db:migrate sólo
con migraciones aprobadas y destino local verificado. db:reset elimina datos: no
usarlo sobre la instancia del propietario para probar una reconstrucción. CLI
start/status puede imprimir claves; no guardar su salida completa. Mantener npm,
lockfile, configuración funcional y datos/sesiones del propietario.

## 9. Documentos para contrastar

1. AGENTS.md y README.md.
2. docs/01_PRODUCT_VISION.md a docs/14_CORRECCIONES_CRITICAS.md.
3. docs/CONSOLIDATION_REPORT.md y docs/CHANGELOG.md.
4. docs/SPRINT_1_DESIGN.md y docs/SPRINT_1_REPORT.md.
5. docs/SPRINT_2_DESIGN.md y docs/SPRINT_2_REPORT.md, incluidos sus apartados finales.
6. docs/CODEX_IMPLEMENTATION_GUIDE.md, docs/BRAND_GUIDE.md y supabase/function-catalog.md.
7. Migraciones y código efectivo si tenés acceso al repositorio; las especificaciones
   futuras por sí solas no acreditan una implementación.

La UX debe conservar el logo original Merivo y su identidad negro/carbón, rubí,
blanco/gris y dorado. No volver a la paleta verde/clara inicial.

## 10. Entrega solicitada al agente revisor

Devolvé una matriz que separe implementado/verificado localmente, sólo especificado,
propuesto, aprobado y pendiente. Incluí:

1. Diferencias entre la nueva revisión, los ADR y el código/migraciones existentes.
2. Contradicciones concretas, con archivo/sección y efecto en seguridad o alcance.
3. Cambios que son correcciones documentales y cambios que requieren una decisión
   de producto o arquitectura; no presentarlos como aprobados automáticamente.
4. Opciones y recomendación para P-02, con criterios de aceptación y pruebas.
5. Riesgos de compatibilidad con S1/S2 y estrategia de migración futura, sin editar
   SQL aplicado, perder datos o debilitar permisos para adaptar el código al documento.
6. Plan acotado para S3, revisando qué objetos de su alcance dependen de P-04/P-06
   u otras decisiones todavía abiertas. No inventar contratos para completar una lista.
7. Checklist de entrada/salida y validación para el siguiente sprint.

No implementar reservas, disponibilidad, integraciones, migraciones o funcionalidades
nuevas a partir de este mensaje. No modificar GAS, publicar, desplegar, hacer commit
o push. Una vez reconciliado el plan, el usuario autorizará el trabajo correspondiente.
