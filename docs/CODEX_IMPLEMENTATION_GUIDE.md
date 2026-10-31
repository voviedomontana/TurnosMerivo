# CODEX_IMPLEMENTATION_GUIDE

Guía para ejecutar el desarrollo por etapas con OpenAI Codex sin que reinterprete requisitos ni agregue funcionalidades fuera de alcance.

## 1. Reglas de oro

1. **Fuente de verdad**: los documentos de `/docs` (01–13). Si el código y un documento difieren, **gana el documento**; si el documento es ambiguo o erróneo, **detenerse y proponer un cambio al documento** (no improvisar).
2. **Un sprint por vez**. Sólo se implementa lo listado en el sprint actual de `10_IMPLEMENTATION_ROADMAP.md`.
3. **TDD en áreas críticas** (`scheduling`, funciones SQL de reservas, `can()`, normalización de teléfonos): primero tests, luego implementación.
4. **Sin código de otro sprint**, sin "adelantos" ni abstracciones especulativas.
5. **Seguridad por defecto**: toda tabla con `business_id` + RLS + FKs compuestas; nunca usar el service role fuera de los tres módulos permitidos.
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
- Escrituras de `appointments` SOLO vía funciones SQL (docs/06). Prohibido INSERT/UPDATE directo.
- Service role SOLO en src/modules/{public-booking,integrations,workers}. Prohibido en otros módulos.
- Nunca confiar en business_id del body; resolverlo según docs/03 §4.2.
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

| Sprint | Documentos obligatorios | Secciones clave |
|---|---|---|
| S0 | 03, 12, 11 | Stack, estructura, CI/CD, entornos |
| S1 | 03, 04, 08 | Tenancy, tablas `businesses/settings`, RLS patrón |
| S2 | 02 §6, 04 §3.3–3.5, 05 §1–2.7, 08 §2–3 | Roles, membresías, escalamiento |
| S3 | 04 completo, 11 §4 | Esquema, constraints, privilegios |
| S4 | 02 §4.B–C, 05 §2.2–2.3, 04 §3.6–3.8 | CRUD catálogo |
| S5 | 02 §4.D, 04 §3.9–3.11, 06 §2–3, 11 §3 | Algoritmo de slots, DST |
| S6 | 06 completo, 04 §3.12–3.14, 02 §3 y §5, 05 §2.5–2.6 | Motor y estados |
| S7 | 09 §3, 05 §2.1/2.4/2.5, 08 §5 | Portal público, anti‑abuso |
| S8 | 09 §4–6, 05, 02 §4.I–J | Paneles |
| S9 | 04 §3.15, 03 §4.3, 02 §4.H | Outbox, jobs |
| S10 | 05 §2.7 y §4, 04 §3.17–3.18, 07 §2 | Credenciales y feed |
| S11 | 07 completo, 05 | Librería GAS y flujos |
| S12 | 08, 11 | Seguridad y carga |
| S13 | 12, 08 §10 | Despliegue y piloto |

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

| Tema | Convención |
|---|---|
| Nombres | Tablas y columnas `snake_case` plural/singular como doc 04; TS `camelCase`; tipos `PascalCase`; archivos `kebab-case` |
| Errores | Clase `AppError(code, status, detail)` → serializada a problem+json; códigos del doc 05 |
| Validación | Zod en `modules/*/schemas.ts`; `.strict()` |
| Acceso a datos | `modules/*/repository.ts` (SQL/Kysely) y `service.ts` (reglas); handlers sólo orquestan |
| Contexto | `RequestContext {requestId, actor, businessId}` creado en un único middleware |
| Autorización | `can(actor, action, resource)`; sin comprobaciones de rol dispersas |
| Tests | `*.test.ts` junto al código; pgTAP en `supabase/tests`; e2e en `/e2e` |
| Commits | Conventional Commits; PR referencia `RF-*`/ADR |
| Migraciones | `YYYYMMDDHHMM_descripcion.sql`; *expand → migrate → contract* |
| Config | Variables validadas con Zod al inicio |
| Idioma | Código y comentarios en inglés; textos de UI/emails en es‑AR |

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

## 9. Estrategia para las áreas más riesgosas con Codex

- **Motor de reservas (S5–S6)**: pedir primero **sólo los tests** (B‑01…B‑30) y pgTAP; revisarlos manualmente; luego pedir la implementación. Prohibir que Codex modifique los tests para que pasen sin explicación.
- **RLS y funciones SQL (S3, S6)**: generar por tabla siguiendo la plantilla de doc 04 §4; verificar con el test generador de cobertura RLS (doc 11 §4).
- **Integración GAS (S11)**: implementar en un repo/carpeta `gas/` con `clasp`; lógica pura testeable; nunca guardar tokens en hojas.
- **Seguridad (S12)**: ejecutar la suite de aislamiento y revisar manualmente cada hallazgo; no aceptar "fixes" que desactiven RLS o amplíen privilegios.

## 10. Definición de terminado por sprint
Ver `10_IMPLEMENTATION_ROADMAP.md` §2 (DoD global) y criterios de aceptación de cada sprint. Un sprint **no** se cierra si hay tests omitidos en áreas críticas o hallazgos de seguridad críticos/altos abiertos.

## 11. Gestión de cambios en la especificación
Todo cambio a un contrato, modelo o regla: (1) abrir PR de documentación, (2) actualizar ADR si cambia una decisión, (3) actualizar tests, (4) recién entonces modificar código. Mantener un `docs/CHANGELOG.md` con fecha, motivo y documentos afectados.
