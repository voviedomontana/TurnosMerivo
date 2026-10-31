# 01 — Visión del producto

> Estado: v1.0 (borrador de arquitectura para validación). Idioma de producto: es-AR. Moneda inicial: ARS.

## 1. Resumen ejecutivo

Se construirá una **plataforma de turnos independiente** (nombre de trabajo: *Turnos*) para barberías. Es un **monolito modular** en Next.js desplegado en Vercel, con PostgreSQL en Supabase como única fuente de verdad transaccional. Nace **multi-tenant** (una fila `businesses` por barbería, `business_id` en toda tabla de negocio, RLS como segunda línea de defensa) pero opera inicialmente con una sola barbería.

Puntos centrales:

1. **La consistencia de reservas la garantiza PostgreSQL**, no el frontend ni Apps Script: restricción de exclusión (`EXCLUDE USING gist`) sobre rangos de tiempo por profesional, más funciones SQL transaccionales que validan horarios, bloqueos y políticas.
2. **La app de Google Apps Script (GAS) no se migra.** Consume una **API REST versionada** con credenciales revocables y de alcance limitado. El modelo recomendado es **híbrido**: agendas bajo demanda + sincronización incremental de reportes hacia una hoja de lectura.
3. **Clientes**: el teléfono normalizado (E.164) es el identificador principal dentro de un negocio. Instagram es un atributo opcional y un *vínculo* (tabla `external_id_mappings`), nunca clave universal.
4. **Notificaciones** mediante patrón *outbox* transaccional con reintentos e idempotencia.
5. **Sin sobreingeniería**: sin microservicios, colas externas ni Kubernetes. Un cron + `FOR UPDATE SKIP LOCKED` alcanza para el volumen esperado.

Veredicto sobre el stack propuesto (Next.js + Supabase + Vercel + Tailwind/shadcn): **apropiado, con ajustes menores** (ver `03` y `13`).

## 2. Decisiones arquitectónicas críticas (resumen)

| # | Decisión | Detalle |
|---|----------|---------|
| D1 | Monolito modular Next.js | ADR-001 |
| D2 | Tenancy: BD compartida + `business_id` + RLS + FKs compuestas | ADR-002 |
| D3 | Doble reserva evitada con `EXCLUDE USING gist` + función SQL transaccional | ADR-003 |
| D4 | Inserciones/actualizaciones de `appointments` sólo vía funciones SQL (no INSERT directo) | ADR-004 |
| D5 | Clientes: unicidad por (negocio, teléfono E.164); Instagram como atributo + mapeo | ADR-005 |
| D6 | Reprogramar = actualizar la misma reserva (atómico) + evento | ADR-006 |
| D7 | Integración GAS híbrida; credenciales por usuario cuando sea posible | ADR-007/008 |
| D8 | Notificaciones por outbox en Postgres | ADR-009 |
| D9 | API única con tres modos de autenticación (sesión, pública, integración) | ADR-010 |
| D10 | Una reserva = un servicio en el MVP (multi-servicio diferido) | ADR-011 |

## 3. Actores

| Actor | Autenticación | Descripción |
|-------|---------------|-------------|
| Superadmin de plataforma | Supabase Auth + tabla `platform_admins` | Soporte y administración global (post-MVP salvo acceso de soporte). |
| Admin/Owner de barbería | Supabase Auth + `business_members` | Gestiona negocio, equipo, servicios, agenda. |
| Barbero | Supabase Auth + `business_members` + `staff_members` | Agenda propia, asistencia, finalización. |
| Cliente | **Sin cuenta**: token de gestión por reserva | Reserva, consulta y gestiona por enlace seguro. |
| Integración (GAS) | Token de integración (servicio o por usuario) | Acceso programático con scopes. |
| Sistema | Jobs internos | Expiración, recordatorios, outbox. |

## 4. Alcance

### 4.1 Dentro del MVP
Negocio + configuración; profesionales; servicios; horarios, descansos, excepciones, bloqueos; motor de disponibilidad; reservas públicas sin cuenta; gestión de estados; clientes con deduplicación; notificaciones por **email** (confirmación, cancelación, reprogramación, recordatorio); panel admin (agenda diaria/semanal, alta manual, bloqueos, clientes, estadísticas básicas); panel del barbero; API de integración; integración con GAS (lectura de agenda, acciones de estado, vínculo con Registro de Servicios); auditoría; PWA instalable.

### 4.2 Fuera del MVP (diferido, con puntos de extensión definidos)
Facturación recurrente del SaaS; registro autónomo de barberías (onboarding self-service); Mercado Pago/señas (el modelo ya contempla `pending` con `expires_at`); WhatsApp (canal ya modelado en `notifications.channel`); Google Calendar; múltiples sucursales; dominios personalizados; reportes avanzados; multi-servicio por turno; lista de espera; OTP para clientes.

## 5. Supuestos (no confirmados — validar)

| ID | Supuesto | Impacto si es falso |
|----|----------|---------------------|
| S1 | Una sola sede, zona `America/Argentina/Buenos_Aires` (sin horario de verano). | Bajo; el diseño ya soporta DST. |
| S2 | Canal de notificación del MVP: email. WhatsApp se agrega luego (requiere WhatsApp Business API/plantillas aprobadas). | Medio en sprint de notificaciones. |
| S3 | El Registro de Servicios de Sheets **no** tiene un ID de fila estable confirmado. Se propone agregar una columna `ID` (UUID) y `ID Turno`. | Alto para el vínculo turno↔servicio; ver doc 07. |
| S4 | No está confirmado cómo se autentican hoy los usuarios de la app GAS ni si se despliega como "ejecutar como el usuario que accede" o "como yo". | Alto para identidad individual; el doc 07 define dos modos. |
| S5 | Volumen: ≤ 10 usuarios internos simultáneos, ≤ ~100 reservas/día. | Bajo. |
| S6 | Los clientes aceptan reservar sin verificar teléfono (sin OTP) con mitigaciones anti‑abuso. | Medio; OTP queda como extensión. |
| S7 | La cuenta de Google que aloja GAS puede ser Workspace o personal (afecta cuotas y `Session.getActiveUser`). | Medio. |

## 6. Preguntas realmente bloqueantes

**Ninguna bloquea el inicio del Sprint 0–5.** Las siguientes deben resolverse **antes del Sprint 11** (integración GAS), con el supuesto por defecto indicado:

1. ¿Cómo se identifica hoy cada barbero en la app GAS (login propio, cuenta Google)? *Por defecto*: Modo B (clave de servicio + actor asertado) hasta confirmar.
2. ¿Se puede agregar una columna de ID estable en Registro de Servicios? *Por defecto*: sí.

## 7. Riesgos principales

| Riesgo | Prob. | Impacto | Mitigación |
|--------|-------|---------|------------|
| Doble reserva por concurrencia | Media | Alto | Exclusion constraint + función transaccional + tests de concurrencia |
| Fuga entre tenants | Baja | Crítico | RLS + FKs compuestas + tests pgTAP de aislamiento + API con `businessId` validado |
| Suplantación de barbero desde GAS | Media | Alto | Tokens por usuario; scopes mínimos; auditoría |
| Abuso del endpoint público | Alta | Medio | Rate limiting, Turnstile, límites por teléfono/IP |
| Duplicados de clientes | Alta | Medio | Normalización E.164, cola de revisión, función de fusión |
| Cuotas de Apps Script (UrlFetch, 6 min de ejecución) | Media | Medio | Caché corto, sincronización incremental, lotes |
| Cumplimiento Ley 25.326 | Media | Alto | Controles técnicos + validación legal (doc 08) |
| Sobrealcance en implementación con Codex | Alta | Medio | Guía de implementación y definición de terminado por sprint |

## 8. Métricas de éxito del MVP

- 0 dobles reservas en producción (verificable por constraint + tests).
- ≥ 90 % de reservas creadas sin intervención del admin tras 60 días.
- Tiempo de respuesta p95 de `GET availability` < 600 ms.
- Registro de servicios precargado desde turnos en ≥ 80 % de los turnos completados.
- Tasa de ausencias medible por barbero y semana.
