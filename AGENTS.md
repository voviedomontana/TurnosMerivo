# TurnosMerivo — instrucciones de desarrollo

## Contexto y alcance

Plataforma SaaS de gestión de turnos para barberías. Implementado localmente: **Sprint 0, base Sprint 1 y acceso Sprint 2**.
Base multi-tenant, Auth SSR, MFA TOTP y gestión de membresías; ver docs/SPRINT_2_REPORT.md.
Consolidación y decisiones P-xx: `docs/CONSOLIDATION_REPORT.md`; operaciones locales
en `docs/12_DEPLOYMENT_OPERATIONS.md`. Sprint activo autorizado: 2, acceso y permisos reales aprobado por el usuario; diseño en docs/SPRINT_2_DESIGN.md.
Antes de implementar, leer `docs/CODEX_IMPLEMENTATION_GUIDE.md`, los documentos
aplicables según su tabla de sprints, el doc 14 y el informe de consolidación.
Las recomendaciones P-xx no quedan aprobadas automáticamente por esta edición. La instrucción explícita del usuario prevalece sobre
el roadmap; registrar diferencias sin sobrescribir documentación técnica aprobada.

## Arquitectura

- Monolito modular: dependencias `app → modules → lib`.
- UI compartida en `src/components`, primitivas shadcn en `src/components/ui`.
- Identidad UX autorizada: docs/BRAND_GUIDE.md. Tema Merivo oscuro, rojo rubí,
  blanco/gris y dorado; usar tokens globales y BrandLogo original en pantallas nuevas.
- Lógica de negocio únicamente en `src/modules/*`; handlers finos.
- Los directorios de dominio están vacíos deliberadamente. Confirmar la nomenclatura
  del dominio sólo si se solicita reorganización; P-07 ya aprobó las carpetas actuales.
- Mantener el aislamiento multi-tenant. Cuando se apruebe el esquema, toda tabla de
  negocio debe tener tenant validado, RLS y relaciones que impidan cruces de negocios.
  Nunca confiar en un `business_id` enviado por el cliente.
- Identidad de sesión desde auth.uid(); verificar membresía activa, tenant y permiso
  en cada operación de BD. Ningún actor/rol del body, header o setter público autoriza.
- Definer: search_path vacío, objetos calificados, EXECUTE PUBLIC/defaults revocados,
  roles mínimos y helpers RLS catalogados/antirrecursión. FORCE no elimina BYPASSRLS.
- P-01/P-07 aprobadas: app_server sin tablas y operaciones internas; service_role sólo
  Auth Admin/Storage cuando corresponda, nunca negocio rutinario ni cliente/HTML/GAS.
  Matriz y base de membresías aprobadas en docs/SPRINT_1_DESIGN.md.
- Modo B/service_key sólo lectura, incluidos links/mappings/import. Modo A requiere
  operador y tokens validados; UserProperties no basta como prueba de identidad.
- No prometer feed por timestamp, secuencia o ventana fija: MVP con barridos completos
  y reconciliación; changes reservado hasta diseño y pruebas P-05.
- Agenda: todas las mutaciones con locks comunes, revalidación, versión, evento y
  outbox atómicos; no SAVEPOINT en funciones PL/pgSQL. Cerrar P-02/P-03/P-06 antes de código.
- If-Match: 428 ausente, 412 obsoleto, 409 negocio. Key con distinta intención no
  reutiliza resultado; reautorizar replay. Soporte temporal y actor real auditado.

## Calidad

- Usar npm y conservar `package-lock.json`; instalación reproducible con `npm ci`.
- Supabase CLI local está fijada como dependencia dev. Usar `npm run db:start`,
  `npm run db:status`, `npm run db:stop`; las migraciones requieren aprobación del modelo.
- `npm run db:reset` elimina datos locales: no ejecutarlo sin necesidad y sin verificar
  el destino. Los scripts de migración/reset tienen `--local`; no cambiar a `--linked`.
- TypeScript strict, sin `any`; código y comentarios en inglés, UI en es-AR.
- Incorporar pruebas relevantes a las funcionalidades nuevas.
- Ejecutar `npm run lint`, `npm run format:check`, `npm run typecheck`,
  `npm run test` y `npm run build`. Para UI, también `npm run test:e2e`.
- No afirmar resultados de checks que no se ejecutaron correctamente.
- No almacenar secretos, credenciales ni datos personales en repositorio o logs.
- No editar migraciones aplicadas. Crear una nueva cuando corresponda.

## Límites

- Implementar únicamente el sprint y las funcionalidades autorizadas.
- Evitar cambios innecesarios fuera del alcance solicitado.
- No modificar documentos aprobados sin indicarlo expresamente; registrar motivo
  y archivos en docs/CHANGELOG.md. Las correcciones de 14 ya están incorporadas.
- La consolidación documental terminó. S1 permite la migración de negocios/settings
  y base mínima de users/business_members, RLS, helpers y lectura pública aprobados.
  P-02…P-06/P-08 siguen pendientes para sus sprints. S2 incorpora login, MFA e invitaciones sin reservas.
- La restricción de preparación sin SQL fue reemplazada por la aprobación S1.
  La aprobación posterior de S2 permite Auth y operaciones de membresía revisadas.
  Aprobación posterior del usuario: implementar únicamente catálogo de profesionales
  y servicios (ARS, duración 5–480, buffer 0–120, owner/admin con MFA, barberos lectura,
  perfiles con/sin cuenta, bajas lógicas, versiones por recurso y locks compatibles S2).
  Ver docs/CATALOG_IMPLEMENTATION_REPORT.md. Esta autorización parcial no aprueba
  el modelo completo S3-A: reservas, EXCLUDE, disponibilidad y conexiones remotas
  permanecen fuera de alcance. La activación local posterior fue autorizada y está
  registrada en docs/LOCAL_CATALOG_ACTIVATION_REPORT.md. No aplicar nuevas migraciones
  a la instancia del propietario sin autorización expresa; no resetearla ni usarla
  como entorno de pruebas.
- No implementar autenticación, roles, RLS, tablas, reservas, disponibilidad,
  APIs de negocio, notificaciones, pagos o suscripciones durante Sprint 0.
- No desarrollar integraciones con Apps Script hasta el sprint correspondiente.
- Autorización explícita 2026-11-02: CM-01/CM-02 y UI administrativa CM-05 de clientes,
  aceptando CD-01…CD-06. Directorio owner/admin con MFA, contactos compartidos,
  búsqueda keyset, notas privadas, archivo/restauración, versiones/auditoría/replay.
  Validar sólo en descartable; no aplicar a la instancia del propietario. Marketing
  (CM-03/04), acceso barber, reservas y horarios siguen fuera de alcance. Registro
  vigente en docs/CUSTOMER_IMPLEMENTATION_REPORT.md; las propuestas de diseño se
  conservan como historia y no son autorización de otros lotes.
- No modificar la aplicación existente de Google Apps Script.
- Autorización explícita 2026-11-02: HS-D01…HS-D10 y HS-01/02/03, horarios,
  excepciones, bloqueos y vista previa interna. Owner/admin con MFA gestionan;
  barber consulta únicamente staff ligado a su membresía, sin motivos privados.
  Cierre global prevalece; raíz exclusiva S2 y versiones staff/control global.
  Sólo pruebas descartables. No reservas, EXCLUDE, tokens, notificaciones ni aplicación
  al propietario. Ver docs/SCHEDULING_IMPLEMENTATION_REPORT.md. La prohibición previa
  de horarios queda reemplazada sólo por este alcance; P-02/motor siguen pendientes.
- No publicar, desplegar, crear commits ni hacer push sin solicitud expresa.
- Autorización explícita 2026-11-02: IN-D01…IN-D10, representación de ocupación y
  predicado EXCLUDE de docs/INTERNAL_BOOKING_MVP_PROPOSAL.md; IN-01/02/03 sólo en
  descartable. Agenda owner/admin con MFA, creación, reprogramación y cancelación
  de turnos futuros; snapshots originales, ocupación histórica privada y raíz
  exclusiva S2. Esta aprobación reemplaza las exclusiones previas de reservas y
  EXCLUDE únicamente para ese alcance. Sin portal público, tokens de gestión,
  ausencias/finalizaciones, notificaciones ni aplicación al propietario. Informe
  vigente: docs/INTERNAL_BOOKING_IMPLEMENTATION_REPORT.md. No aprobar por extensión
  el motor S6 completo ni el resto de P-02/P-03/P-06.
- Activación local autorizada posteriormente el 2026-11-02: el usuario indicó
  «avanza con el siguiente paso» tras la propuesta explícita de respaldar y activar
  clientes/HS/turnos internos. Aplicadas sólo las tres fuentes pendientes, historial
  local de 12 a 15, sin reset, fixtures ni cambios de cuentas/MFA. Evidencia en
  docs/LOCAL_BOOKING_ACTIVATION_REPORT.md. Esta autorización de activación no permite
  pruebas de escritura automatizadas sobre el propietario ni desarrollar otro bloque.
- Continuación pedida el 2026-11-02: PB-01, catálogo público de sólo lectura,
  desarrollado como tramo independiente del portal. Una nueva capacidad comercial
  de lectura app_internal para app_server, sin grants de tablas ni comandos públicos.
  Propuesta y gates PB-D02…D10 en docs/PUBLIC_BOOKING_MVP_PROPOSAL.md: creación,
  autogestión, tokens/replay y antiabuso requieren cierre de esas decisiones antes
  de su código dependiente. No aplicar la migración 16 al propietario por este
  pedido de desarrollo. Evidencia en docs/PUBLIC_CATALOG_IMPLEMENTATION_REPORT.md.
- Aprobación posterior explícita: PB-D02…PB-D10 y PB-02/03/04/05 únicamente en
  descartable, con profesional explícito, cliente nuevo sin vincular por contacto,
  actor público real, motor compartido, capacidades, replay AES-GCM y autogestión
  con políticas/If-Match. Custodia/rotación/recuperación de claves y cuotas persistentes
  deben probarse. Desafío sintético sólo en fixture y escritura fail-closed fuera de
  ese entorno; no afirmar identidad por persona. No activar migraciones en el
  propietario, usar datos reales, tocar cuentas/MFA/GAS, implementar email/estados
  terminales/any-staff, publicar o avanzar de bloque. Evidencia vigente en
  docs/PUBLIC_BOOKING_IMPLEMENTATION_REPORT.md y PUBLIC_BOOKING_KEY_CUSTODY.md.
- Continuación autorizada: preparar el circuito público para piloto seguro;
  infraestructura confirmada Vercel + Supabase. Herramienta offline de custodia y
  runbook en docs/PUBLIC_PILOT_RUNBOOK.md. No habilita despliegue, datos reales,
  aplicación de migraciones al propietario ni eludir gates descartables. El
  adaptador productivo de antiabuso/red y evolución del gate siguen pendientes.
- Continuación posterior: adaptador Turnstile y red Vercel directa implementados
  para staging Preview, con pruebas simuladas/descartables. Nueva migración 18,
  gate privado cerrado por defecto y máximo 24 horas, sin producción. No aplicar
  al propietario, desplegar ni habilitar datos reales. La validación con Vercel y
  Turnstile reales sigue pendiente; ver PUBLIC_PILOT_ANTIABUSE_REPORT.md.
- Preparación posterior: pooler compartido admite sólo app_server.PROJECT_REF
  pinado; preflight offline sin conexión ni autorización de apertura. El usuario
  creó Supabase staging kuqtskhtsvpluhalxiav; aadrzawmzrstpyuluxqk queda protegido
  y excluido. GitHub voviedomontana/TurnosMerivo autorizado sólo lectura, sin commit
  o push; Vercel merivo-group aún sin proyecto. Ver STAGING_PROVISIONING_REPORT.md
  y GITHUB_PUBLICATION_REVIEW.md antes de publicar, desplegar o migrar remotamente.
- Autorización posterior de publicación: exclusivamente formato mecánico de los
  quince Markdown de arquitectura-v1.1 y commit/push del código acumulado a
  codex/staging-readiness en voviedomontana/TurnosMerivo. Sin merge, PR, force push,
  cambios de main, despliegue, integración Vercel o migración remota. Revisar todos
  los candidatos, secretos/alta entropía y privacidad antes de publicar; ejecutar
  checks nuevos y conservar las migraciones históricas intactas. No implica
  autorización de continuar el piloto ni modificar funcionalidades.
