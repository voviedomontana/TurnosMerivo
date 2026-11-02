> **Actualización de seguridad:** consultar `14_CORRECCIONES_CRITICAS.md` antes de implementar. Si existe contradicción, prevalecen esas correcciones.

# CODEX_IMPLEMENTATION_GUIDE

Guía para ejecutar el desarrollo por etapas con OpenAI Codex sin que reinterprete requisitos ni agregue funcionalidades fuera de alcance.

## 1. Reglas de oro

1. **Fuente de verdad**: los documentos consolidados de `/docs` (01–14), ADR y CONSOLIDATION_REPORT.md. Si el código y un documento difieren, **gana el documento**; si hay una decisión P-xx abierta, documentar opciones y detener sólo la implementación dependiente. No convertir una propuesta en requisito aprobado. La consolidación terminó; S1 está autorizado según SPRINT_1_DESIGN.md (P-01/P-07 aprobadas).
2. **Un sprint por vez**. Sólo se implementa lo listado en el sprint actual de `10_IMPLEMENTATION_ROADMAP.md`.
3. **TDD en áreas críticas** (`scheduling`, funciones SQL de reservas, `can()`, normalización de teléfonos): primero tests, luego implementación.
4. **Sin código de otro sprint**, sin "adelantos" ni abstracciones especulativas.
5. **Seguridad por defecto**: tablas de negocio con tenant + RLS + referencias del mismo negocio; identidad global y tenant raíz tienen políticas propias. No usar service_role como acceso rutinario de negocio; rol técnico/grants según P-01, doc 04 §4.
6. **PRs pequeños** (≤ ~400 líneas de diff cuando sea posible), cada uno con tests y descripción de qué requisito (`RF-*`, `RN-*`, ADR) cubre.

## 2. Instrucciones de agentes

El archivo real [AGENTS.md](../AGENTS.md) es la única copia de instrucciones del
repositorio; no generar otro desde una plantilla antigua. Mantener npm y lockfile,
TypeScript strict, dependencias app → modules → lib, y los límites del sprint.
La estructura física existente se conserva hasta resolver P-07.

Comandos existentes: npm run lint, format:check, typecheck, test y build; E2E sólo
cuando corresponda a cambios de UI. Para infraestructura, db:start/status/stop;
db:migrate y db:reset --local sólo con esquema autorizado y destino verificado.
pgTAP se incorpora con las migraciones reales, no se afirma una suite ficticia.


## 3. Estructura sugerida del repositorio de documentación
```
/docs
  01_PRODUCT_VISION.md … 14_CORRECCIONES_CRITICAS.md
  CONSOLIDATION_REPORT.md
  CHANGELOG.md
  CODEX_IMPLEMENTATION_GUIDE.md
/AGENTS.md
```

## 4. Qué documentos consultar por sprint

| Sprint | Documentos obligatorios | Secciones clave |
|---|---|---|
| S0 | 03, 12, 11 | Stack, estructura, CI/CD, entornos |
| S1 | 03, 04, 08, 10, 11, 12, 14 e informe | Cerrar P-01/P-07, fixtures/membresías, privilegios y checklist antes de SQL |
| S2 | 02 §6, 04 §3.3–3.5, 05 §1–2.7, 08 §2–3 | Roles, membresías, escalamiento |
| S3 | 04 completo, 11 §4 | Esquema, constraints, privilegios |
| S4 | 02 §4.B–C, 05 §2.2–2.3, 04 §3.6–3.8 | CRUD catálogo |
| S5 | 02 §4.D, 04 §3.9–3.11, 06 §2–3, 11 §3 | Algoritmo de slots, DST |
| S6 | 06 completo, 04 §3.12–3.14, 02 §3 y §5, 05 §2.5–2.6 | Motor y estados |
| S7 | 09 §3, 05 §2.1/2.4/2.5, 08 §5 | Portal público, anti‑abuso |
| S8 | 09 §4–6, 05, 02 §4.I–J | Paneles |
| S9 | 04 §3.15, 03 §4.3, 02 §4.H | Outbox, jobs |
| S10 | 05 §2.7/§4, 04 §3.17–3.20, 07 §2/§6, 14.D–G | Lectura compartida, barridos, mapeos; feed condicionado P-05 |
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
 1) Detallá cambios y gates pendientes. Si el usuario ya autorizó el alcance, ejecutalo; no inventes una nueva aprobación para tareas reversibles. Las decisiones ambiguas bloquean sólo su implementación dependiente.
 2) Para cada PR: escribí primero los tests, después la implementación.
 3) Ejecutá los checks aplicables y declaralos con resultados reales; pgTAP sólo con esquema/suite autorizados. No avanzar de sprint automáticamente.
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
| Tests | unit en `tests/unit`; pgTAP futuro en `supabase/tests`; e2e en `tests/e2e` |
| Commits | Conventional Commits; PR referencia `RF-*`/ADR |
| Migraciones | timestamp generado por Supabase CLI + descripción; *expand → migrate → contract*; nunca editar aplicadas |
| Config | Variables validadas con Zod por capacidad; landing sin Supabase válida, sin secretos obligatorios de sprints futuros |
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
- [ ] ¿Los definer derivan identidad verificada, validan membresía/tenant/permiso, fijan search_path vacío y revocan EXECUTE PUBLIC con excepciones de helpers catalogadas?
- [ ] ¿Las fechas usan UTC/Luxon y están probadas con DST?
- [ ] ¿Contratos de API coinciden con doc 05 (códigos de error, paginación, idempotencia)?
- [ ] ¿Migración compatible hacia atrás y probada con `supabase db reset`?

## 9. Estrategia para las áreas más riesgosas con Codex

- **Motor de reservas (S5–S6)**: pedir primero **sólo los tests** (B‑01…B‑30) y pgTAP; revisarlos manualmente; luego pedir la implementación. Prohibir que Codex modifique los tests para que pasen sin explicación.
- **RLS y funciones SQL (S3, S6)**: generar por tabla siguiendo la plantilla de doc 04 §4; verificar con el test generador de cobertura RLS (doc 11 §4).
- **Integración GAS (S11)**: implementar en un repo/carpeta `gas/` con `clasp`; lógica pura testeable; nunca guardar tokens en hojas.
- **Seguridad (S12)**: ejecutar la suite de aislamiento y revisar manualmente cada hallazgo; no aceptar "fixes" que desactiven RLS o amplíen privilegios.

## 9.1 Reglas técnicas que no deben reaparecer en código generado

- No firmas públicas con actor/rol aportado como autoridad; no invocar núcleo privado
  desde roles API ni simular autoridad con un setter de GUC accesible al llamador.
- No SAVEPOINT/ROLLBACK TO dentro de funciones PL/pgSQL ni COMMIT entre efectos;
  usar bloques EXCEPTION y locks fuera del bloque que revierte (doc 06 §4.0).
- No escritura Modo B, incluida creación de vínculos/import/mappings; UserProperties
  no acredita por sí sola al operador. No afirmar sincronización garantizada por
  updated_at, secuencias o ventanas fijas; feed reservado hasta pruebas.
- No CHECK de orden como sustituto de igualdad temporal ni FKs polimórficas ficticias.
- No 409 para versión obsoleta: 428/412/409 según doc 05; key distinta intención no
  reutiliza resultado. Locks, versión, evento, outbox e idempotencia son atómicos.
- P-xx abierta: presentar propuesta y criterio de aceptación; no implementarla sin
  decisión. Conservar requisitos funcionales y justificar cambios de flujo por seguridad.

## 10. Definición de terminado por sprint
Estado posterior: el usuario autorizó Sprint 2 (acceso y permisos reales).
Consultar SPRINT_2_DESIGN.md y SPRINT_2_REPORT.md; Auth local ya no debe permanecer
deshabilitado. Los límites anteriores de S1 sin login describen esa entrega histórica.
No comenzar S3 ni cerrar P-02 automáticamente.

Ver `10_IMPLEMENTATION_ROADMAP.md` §2 (DoD global) y criterios de aceptación de cada sprint. Un sprint **no** se cierra si hay tests omitidos en áreas críticas o hallazgos de seguridad críticos/altos abiertos.

## 11. Gestión de cambios en la especificación
Todo cambio a un contrato, modelo o regla: (1) abrir PR de documentación, (2) actualizar ADR si cambia una decisión, (3) actualizar tests, (4) recién entonces modificar código. Mantener un `docs/CHANGELOG.md` con fecha, motivo y documentos afectados.
