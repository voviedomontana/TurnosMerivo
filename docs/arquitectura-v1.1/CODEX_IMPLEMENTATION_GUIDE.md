# CODEX_IMPLEMENTATION_GUIDE

Guía para ejecutar el desarrollo por etapas con OpenAI Codex sin que reinterprete requisitos ni agregue funcionalidades fuera de alcance.

## 1. Reglas de oro

1. **Fuente de verdad**: los documentos de `/docs` (01–13, `CHANGELOG.md` v1.1). Si el código y un documento difieren, **gana el documento**; si el documento es ambiguo o erróneo, **detenerse y proponer un cambio al documento** (no improvisar).
2. **Un sprint por vez**. Sólo se implementa lo listado en el sprint actual de `10_IMPLEMENTATION_ROADMAP.md`.
3. **TDD en áreas críticas** (`scheduling`, funciones SQL de reservas, `can()`, normalización de teléfonos): primero tests, luego implementación.
4. **Sin código de otro sprint**, sin "adelantos" ni abstracciones especulativas.
5. **Seguridad por defecto**: toda tabla con `business_id` + RLS + FKs compuestas; los contextos sin sesión acceden a datos **sólo** vía el rol `app_server` y funciones `app_internal.*`; nunca usar `service_role` de Supabase para datos de negocio.
6. **PRs pequeños** (≤ ~400 líneas de diff cuando sea posible), cada uno con tests y descripción de qué requisito (`RF-*`, `RN-*`, ADR) cubre.

## 2. Archivo `AGENTS.md` (colocar en la raíz del repositorio)

```markdown
# AGENTS.md

## Contexto

Plataforma de turnos multi-tenant para barberías. Fuente de verdad: /docs/*.md. Sprint actual: ver docs/10_IMPLEMENTATION_ROADMAP.md.

## Comandos

- pnpm dev | pnpm lint | pnpm typecheck | pnpm test | pnpm test:db | pnpm test:e2e
- supabase start | supabase db reset | supabase test db

## Reglas

- Implementar SOLO el sprint indicado en la tarea. No agregar funcionalidades no listadas.
- Si falta información o hay contradicción en los docs: NO inventar; documentar la duda en el PR y proponer opciones.
- TypeScript estricto; sin `any`; validar toda entrada con Zod.
- Lógica de negocio en src/modules/*; los route handlers son finos (auth → validar → servicio → respuesta).
- SQL: migraciones nuevas en supabase/migrations (nunca editar las aplicadas). Todo objeto nuevo con RLS y tests pgTAP.

### Funciones privilegiadas e identidad (docs/04 §4.1, docs/08 §3.1)

- Escrituras de `appointments` SOLO vía funciones SQL. Prohibido INSERT/UPDATE directo.
- PROHIBIDO que una función SECURITY DEFINER reciba `actor_id`, `user_id`, `member_id`, `role` o `created_by` como parámetro. La identidad se DERIVA dentro de la función: `auth.uid()` (esquema `api`), slug/hash de token de gestión (público), hash de credencial (integración), fila reclamada (worker).
- `p_business_id` sólo como selector validado contra el contexto; el tenant efectivo es `ctx.business_id`.
- Toda función definer: `SET search_path = ''`, objetos calificados, `REVOKE ALL … FROM PUBLIC` y `GRANT EXECUTE` a UN rol (`authenticated` en `api`; `app_server` en `app_internal`; ninguno en `app.*_core`). Registrarla en `supabase/function-catalog.md`.
- El servidor accede a datos sin sesión sólo con el rol `app_server` (sin acceso a tablas) llamando a `app_internal.*`. NO usar `service_role` de Supabase para datos de negocio.
- Nunca confiar en business_id del body; resolverlo según docs/03 §4.2.

### PL/pgSQL y concurrencia (docs/06 §4)

- PROHIBIDO `SAVEPOINT`, `ROLLBACK TO` y `COMMIT` dentro de funciones. Para reversión parcial usar `BEGIN … EXCEPTION WHEN exclusion_violation THEN … END` con sólo la sentencia que puede fallar dentro del bloque; reasignar variables a mano (no se revierten).
- Orden de locks: filas de `staff_members` por id ascendente → fila de `appointments`. Bloquear todos los candidatos ANTES del bucle.
- Errores con SQLSTATE `TS001…TS012` (docs/06 §4.0); no inventar códigos nuevos sin actualizar docs/05 y docs/06.
- Idempotencia dentro de la misma transacción que la operación.

### Integridad temporal y resultado (docs/04 §3.13, docs/06 §4.5)

- `ends_at` y `blocked_until` los DERIVA el trigger a partir de `starts_at` + snapshots; el código nunca los calcula ni los envía como fuente. Snapshots inmutables salvo `adjust_appointment`.
- `completed`/`no_show` con guardas temporales; `revert` sólo admin/owner con motivo; contadores del cliente se RECALCULAN (nunca ++/--).

### Concurrencia optimista (docs/05 §1.8)

- Toda modificación de staff/integración exige `If-Match` (428 si falta, 412 si no coincide). La versión la gestiona el trigger; ignorar `version` del body. Comparar la versión DESPUÉS de autorizar y bajo lock. Sin reintentos automáticos ante 412.

### Integración y sincronización (docs/05 §4, docs/07)

- `service_key` es SOLO LECTURA (CHECK + `ctx_integration` + funciones). Toda escritura de integración exige `user_token`. NO implementar `X-Actor-Asserted` ni "modos intermedios" con identidad declarada.
- Feed de cambios por `change_log` (`tx_id xid8` + horizonte `pg_snapshot_xmin`); PROHIBIDO usar `updated_at` + solapamiento como cursor. Reconciliación por `count/checksum` diario.
- `external_id_mappings` sólo con FKs tipadas (`customer_id`, `staff_member_id`, `service_id`, `appointment_id`); sin `internal_id` polimórfico. Escritura sólo por funciones con identidad verificada.

### General

- No loguear PII ni secretos. Errores con RFC 9457 (docs/05).
- Fechas: instantes en UTC; zonas con Luxon; nunca sumar 24h para "día siguiente".
- Dinero en centavos (enteros).
- Cada PR: tests nuevos + docs actualizados si cambia un contrato.

## Fuera de alcance del MVP (NO implementar)

Pagos/Mercado Pago, WhatsApp, Google Calendar, multi-sucursal, multi-servicio por turno, onboarding self-service, planes/suscripciones, dominios propios, lista de espera, reportes avanzados, push, modo offline.
```

## 3. Estructura sugerida del repositorio de documentación

```
/docs
  01_PRODUCT_VISION.md … 13_ARCHITECTURAL_DECISIONS.md
  CODEX_IMPLEMENTATION_GUIDE.md
/AGENTS.md
```

## 4. Qué documentos consultar por sprint

| Sprint | Documentos obligatorios                                                                         | Secciones clave                                                             |
| ------ | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| S0     | 03, 12, 11                                                                                      | Stack, estructura, CI/CD, entornos                                          |
| S1     | 03, 04, 08                                                                                      | Tenancy, tablas `businesses/settings`, RLS patrón                           |
| S2     | 02 §6, 04 §3.3–3.5 y §4.1, 05 §1–2.7, 08 §2–3.2, 07 §2.3                                        | Roles, membresías, identidad por contexto, catálogo de funciones, spike GAS |
| S3     | 04 completo (§3.13, §3.18, §3.20–3.22, §4.1), 11 §4, §16, §17                                   | Esquema, integridad temporal, mapeos, `change_log`, versionado, privilegios |
| S4     | 02 §4.B–C, 05 §2.2–2.3, 04 §3.6–3.8                                                             | CRUD catálogo                                                               |
| S5     | 02 §4.D, 04 §3.9–3.11, 06 §2–3, 11 §3                                                           | Algoritmo de slots, DST                                                     |
| S6     | 06 completo (§4.0–4.7), 04 §3.12–3.14 y §3.21, 02 §3 y §5, 05 §1.8 y §2.5–2.6, 11 §13, §15, §17 | Motor, estados, versionado, rollback sin SAVEPOINT                          |
| S7     | 09 §3, 05 §2.1/2.4/2.5, 08 §5                                                                   | Portal público, anti‑abuso                                                  |
| S8     | 09 §4–7, 05, 02 §4.F–J                                                                          | Paneles, vinculaciones, manejo de 412                                       |
| S9     | 04 §3.15, 03 §4.3, 02 §4.H                                                                      | Outbox, jobs                                                                |
| S10    | 05 §2.7 y §4, 04 §3.17–3.18 y §3.20, 07 §2 y §6, 08 §3.1, 11 §12, §14                           | Credenciales, feed sin pérdidas, reconciliación                             |
| S11    | 07 completo, 05 §2.7 y §4, 11 §6                                                                | Librería GAS, Modo R/A, flujos                                              |
| S12    | 08, 11 completo                                                                                 | Seguridad, identidad, concurrencia y carga                                  |
| S13    | 12, 08 §10                                                                                      | Despliegue y piloto                                                         |

## 5. Plantilla de prompt por sprint

```text
Contexto: leé AGENTS.md y los documentos listados abajo. Son la fuente de verdad.
Tarea: implementar el Sprint {N} — {nombre} de docs/10_IMPLEMENTATION_ROADMAP.md.
Documentos a leer: {lista de la tabla §4}.
Alcance exacto: {copiar "Alcance" y "Tareas" del sprint}.
Fuera de alcance: todo lo no listado, y lo indicado en AGENTS.md.
Método:
 1) Proponé un plan de PRs (máx. 5) con archivos a crear/modificar. Esperá confirmación.
 2) Para cada PR: escribí primero los tests, después la implementación.
 3) Ejecutá lint, typecheck, tests y pgTAP; mostrá los resultados.
Criterios de aceptación: {copiar del sprint}.
Si encontrás ambigüedad o contradicción: detenete y listá las opciones con tu recomendación; no inventes.
```

## 6. Convenciones

| Tema           | Convención                                                                                                            |
| -------------- | --------------------------------------------------------------------------------------------------------------------- |
| Nombres        | Tablas y columnas `snake_case` plural/singular como doc 04; TS `camelCase`; tipos `PascalCase`; archivos `kebab-case` |
| Errores        | Clase `AppError(code, status, detail)` → serializada a problem+json; códigos del doc 05                               |
| Validación     | Zod en `modules/*/schemas.ts`; `.strict()`                                                                            |
| Acceso a datos | `modules/*/repository.ts` (SQL/Kysely) y `service.ts` (reglas); handlers sólo orquestan                               |
| Contexto       | `RequestContext {requestId, actor, businessId}` creado en un único middleware                                         |
| Autorización   | `can(actor, action, resource)`; sin comprobaciones de rol dispersas                                                   |
| Tests          | `*.test.ts` junto al código; pgTAP en `supabase/tests`; e2e en `/e2e`                                                 |
| Commits        | Conventional Commits; PR referencia `RF-*`/ADR                                                                        |
| Migraciones    | `YYYYMMDDHHMM_descripcion.sql`; _expand → migrate → contract_                                                         |
| Config         | Variables validadas con Zod al inicio                                                                                 |
| Idioma         | Código y comentarios en inglés; textos de UI/emails en es‑AR                                                          |

## 7. Cómo evitar el sobrealcance (anti‑scope‑creep)

1. Cada tarea a Codex incluye **"Alcance exacto" y "Fuera de alcance"**.
2. Revisar en cada PR la lista de archivos: cualquier tabla, endpoint o dependencia no listada en el sprint se rechaza.
3. Dependencias nuevas requieren justificación en el PR (y ADR si es estructural).
4. Prohibido en el MVP: crear abstracciones "para el futuro" distintas de los puntos de extensión del doc 03 §7.
5. Ante una "mejora" sugerida por Codex: registrarla en `docs/BACKLOG.md`, no implementarla.
6. Revisión humana obligatoria de: funciones SQL, políticas RLS, `scheduling`, `can()`, manejo de tokens, plantillas de email.
7. Check de CI "scope guard" (opcional): script que falla si aparecen `mercadopago`, `whatsapp`, `locations` u otras palabras clave de funcionalidades diferidas fuera de comentarios/documentos.

## 8. Validación humana de lo generado (checklist de PR)

- [ ] ¿Cubre sólo el alcance del sprint y cita requisitos?
- [ ] ¿Tests nuevos relevantes y pasando (unit/pgTAP/integración)?
- [ ] ¿Toda tabla nueva tiene `business_id`, RLS y pruebas de aislamiento?
- [ ] ¿Los handlers derivan el tenant de fuente confiable?
- [ ] ¿Hay SQL dinámico concatenado? (debe ser cero)
- [ ] ¿Se loguea PII/secretos? (debe ser cero)
- [ ] ¿Las funciones `SECURITY DEFINER` fijan `search_path=''` y verifican actor?
- [ ] ¿Las fechas usan UTC/Luxon y están probadas con DST?
- [ ] ¿Contratos de API coinciden con doc 05 (códigos de error, paginación, idempotencia)?
- [ ] ¿Migración compatible hacia atrás y probada con `supabase db reset`?

## 8 bis. Checklist adicional de PR (v1.1)

- [ ] ¿Alguna función `SECURITY DEFINER` nueva o modificada recibe parámetros de identidad/rol? (debe ser **no**) ¿Pasa el test de catálogo (doc 11 §12)?
- [ ] ¿Se usó `SAVEPOINT`/`ROLLBACK TO`/`COMMIT` en una función? (debe ser **no**) ¿El bloque `EXCEPTION` envuelve sólo la sentencia que puede fallar?
- [ ] ¿Se respeta el orden de locks (staff asc → appointment) y se bloquean todos los candidatos antes del bucle?
- [ ] ¿Los derivados temporales (`ends_at`, `blocked_until`) los calcula la BD y existen tests B‑42…B‑45?
- [ ] ¿La modificación exige `If-Match` y hay tests V‑01…V‑05 del recurso?
- [ ] ¿Una escritura de integración exige `user_token`? ¿Hay test de que `service_key` recibe `INSUFFICIENT_SCOPE`/`TS012`?
- [ ] ¿El feed/consumo evita `updated_at` como cursor y es idempotente por `id`+`version`?
- [ ] ¿Los mapeos usan columnas tipadas y las restricciones M1–M11 tienen test (doc 11 §16)?
- [ ] ¿El código de la UI trata `412` con recarga explícita y no con reintento ciego?

## 9. Estrategia para las áreas más riesgosas con Codex

- **Motor de reservas (S5–S6)**: pedir primero **sólo los tests** (B‑01…B‑56, doc 06 §7 y §7.1) y pgTAP; revisarlos manualmente; luego pedir la implementación. Prohibir que Codex modifique los tests para que pasen sin explicación.
- **RLS y funciones SQL (S3, S6)**: generar por tabla siguiendo la plantilla de doc 04 §4; verificar con el test generador de cobertura RLS (doc 11 §4).
- **Integración GAS (S11)**: implementar en un repo/carpeta `gas/` con `clasp`; lógica pura testeable; nunca guardar tokens en hojas.
- **Seguridad (S12)**: ejecutar la suite de aislamiento y revisar manualmente cada hallazgo; no aceptar "fixes" que desactiven RLS o amplíen privilegios.

- **Identidad en funciones privilegiadas (S2, S6, S10)**: generar primero el _test de catálogo_ (doc 11 §12) y la matriz de pruebas por contexto; luego los wrappers. Rechazar cualquier PR que agregue un parámetro de actor/rol o conceda `EXECUTE` a `PUBLIC`/`anon`.
- **Feed y reconciliación (S10)**: escribir antes los casos F‑01…F‑10 y R‑01…R‑05 (doc 11 §14) con transacciones realmente concurrentes; no aceptar implementaciones basadas en `updated_at`.
- **Integridad temporal y mapeos (S3)**: pgTAP de `appt_*` y de M‑01…M‑14 antes de las funciones.
- **Concurrencia optimista (S6)**: V‑01…V‑14 (doc 11 §15) antes de los endpoints; el `412` se evalúa tras autorizar.

## 10. Definición de terminado por sprint

Ver `10_IMPLEMENTATION_ROADMAP.md` §2 (DoD global) y criterios de aceptación de cada sprint. Un sprint **no** se cierra si hay tests omitidos en áreas críticas o hallazgos de seguridad críticos/altos abiertos.

## 11. Gestión de cambios en la especificación

Todo cambio a un contrato, modelo o regla: (1) abrir PR de documentación, (2) actualizar ADR si cambia una decisión, (3) actualizar tests, (4) recién entonces modificar código. Mantener un `docs/CHANGELOG.md` con fecha, motivo y documentos afectados.
