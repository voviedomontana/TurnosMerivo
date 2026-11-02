> Consolidación 2026-10-31: doc 14 incorporado. Propuestas P-xx y gates en
> [informe de consolidación](CONSOLIDATION_REPORT.md); esta edición no autoriza implementación.

> **Actualización de seguridad:** consultar `14_CORRECCIONES_CRITICAS.md` antes de implementar. Si existe contradicción, prevalecen esas correcciones.

# 11 — Estrategia de pruebas

## 1. Principios
1. Las reglas críticas (disponibilidad, doble reserva, aislamiento) se prueban **donde viven**: en PostgreSQL (pgTAP) y en el módulo puro `scheduling` (Vitest).
2. **TDD obligatorio** en: `scheduling`, funciones SQL de reservas, `can()` y normalización de teléfonos.
3. Todo código generado por Codex requiere tests; sin tests no se aprueba el PR.
4. Pruebas deterministas: reloj inyectable (`now`), semillas fijas en property‑based, datos de prueba por *factories*.

## 2. Pirámide y herramientas

| Nivel | Qué cubre | Herramienta | Cuándo corre |
|---|---|---|---|
| Unit | Utilidades, `computeSlots`, políticas, `can()`, normalización | Vitest + fast‑check | Cada commit |
| Base de datos | Constraints, EXCLUDE, FKs compuestas, RLS, funciones, privilegios, triggers | pgTAP (`supabase test db`) | Cada PR |
| Integración API | Route Handlers con BD real (Supabase local), auth real | Vitest + supertest‑like fetch | Cada PR |
| Contrato | Respuestas contra OpenAPI; compatibilidad hacia atrás | Schemathesis/`openapi-diff` | Cada PR |
| E2E | Flujos completos (público móvil, panel por rol) | Playwright (Chromium + WebKit móvil) | PR a main + nightly |
| Concurrencia/carga | Doble reserva, ráfagas, disponibilidad | k6 + script SQL | Nightly/previo a release |
| Seguridad | Aislamiento tenants, abuso, dependencias, secretos | pgTAP + e2e + OWASP ZAP baseline, gitleaks, `npm audit` | PR / nightly |
| Accesibilidad/rendimiento | axe, Lighthouse CI | Playwright + LHCI | PR a main |

## 3. Pruebas del motor (resumen; casos B‑01…B‑30 en doc 06 §7)
- **Unit/Property** (`scheduling`): para cualquier conjunto aleatorio de horarios, excepciones, bloqueos y reservas, los slots devueltos: (1) están dentro de jornada, (2) no solapan bloqueos ni reservas (con buffer), (3) respetan grilla, notice y ventana. Idempotencia: mismo input → mismo output. Casos DST con zonas de prueba.
- **pgTAP**: `EXCLUDE` rechaza solape y acepta contigüidad; `status` fuera del predicado libera el slot; CHECKs de igualdad de tiempos/duración/buffer, orden y estado. Probar campos derivados manipulados, snapshots históricos y P-02 aprobado; no basta blocked_until >= ends_at.
- **Concurrencia real**:
  - Test 1: 50 conexiones simultáneas llaman `create_appointment` por el mismo slot → exactamente 1 éxito.
  - Test 2: 200 solicitudes a 20 slots con "cualquier profesional" y 4 profesionales → ningún solape, asignación balanceada, ningún error 500.
  - Test 3: reprogramaciones cruzadas simultáneas (A→slot de B y B→slot de A) → sin deadlock persistente (orden consistente de locks; reintento en `40P01`).
  - Test 4: creación de bloqueo sin force concurrente con reserva en el mismo rango → conflicto controlado según orden de locks; con force autorizado se reportan afectados y se audita, nunca cancelación silenciosa.
  - Test 5: expiración de `pending` simultánea con nueva reserva.
- **Deadlocks**: las funciones toman locks en orden determinista (por `(business_id,staff_member_id)` ascendente después del lock de coordinación del negocio propuesto P-03); manejo de `40001/40P01` con reintento acotado.

## 4. Pruebas de aislamiento multi‑tenant (obligatorias en CI)
Fixture: negocios A y B; usuarios `ownerA`, `barberA`, `ownerB`, usuario multi‑negocio `ownerA+barberB`, token de integración A y B, token de reserva.
Para **cada tabla** con `business_id`: con cada actor, `SELECT/INSERT/UPDATE/DELETE` sobre filas del otro negocio ⇒ 0 filas/denegado. Más los casos X-01…X-19 (doc 08). Test generador: recorre `information_schema` y **falla** si una tabla con `business_id` carece de ENABLE/FORCE o grants/políticas acordados. Tablas deliberadamente sin políticas de acceso deniegan por defecto y deben figurar explícitamente en la matriz; no exigir una política permisiva sólo para satisfacer el test. businesses raíz e identidad global se prueban por sus políticas específicas.

## 5. Pruebas de autorización
Tabla de verdad generada desde la matriz (doc 02 §6): (actor × acción × recurso propio/ajeno) → esperado. Se ejecuta en unit (`can()`) y se verifica en API con 3–4 casos representativos por endpoint. Casos de escalamiento: auto‑promoción, creación de `owner` por `admin`, token con scope extra, creación de token ajeno.

## 6. Pruebas de integración con GAS
- Entorno *staging* de API + hoja y script de pruebas (clon).
- Casos: lectura Modo B; toda escritura (incluidos complete/no-show/confirm/link/mappings/import) denegada. Flujo individual desde TurnosMerivo; Modo A sólo tras validar cuentas y almacenamiento. Doble clic bajo LockService no duplica fila; fallo append/link queda pendiente y concilia un usuario autorizado, nunca el trigger de lectura. Barrido interrumpido reanuda sin borrar/duplicar; 429 y token revocado; feed/410 sólo si el protocolo se habilita.
- Pruebas unitarias de lógica GAS extraída a funciones puras (con `clasp` + Jest) cuando sea posible.

## 7. Pruebas de notificaciones
Proveedor simulado con modos (OK, 5xx, timeout, 4xx permanente). Verificar: backoff, `dead` tras 5 intentos, dedupe (ejecutar el worker 2× en paralelo), cancelación de recordatorios al cancelar/reprogramar, contenido correcto por tipo, zona horaria en el texto.

## 8. E2E principales
1. Reserva pública en móvil (servicio→profesional→hora→datos→confirmación→email).
2. Conflicto: dos navegadores eligen el mismo slot; el segundo recibe alternativas.
3. Gestión por token: cancelar dentro/fuera de política; reprogramar.
4. Admin: crear reserva manual con `override`, bloquear vacaciones, ver conflictos.
5. Barbero: ve sólo lo propio; completa turno.
6. Invitación de miembro, MFA, cambio de negocio.

## 9. Datos de prueba y entornos
Factories (TypeScript) + semillas SQL: 2 negocios, 3 profesionales, 5 servicios, horarios con descanso, feriado, DST (negocio auxiliar `America/New_York`). Nunca datos reales en dev/staging; copia anonimizada de producción sólo con scripts de anonimización aprobados.

## 10. Criterios de calidad / gates de CI
- Cobertura: ≥ 90 % líneas en `scheduling` y `auth`; ≥ 80 % en `booking`; funciones SQL críticas con 100 % de ramas probadas (pgTAP).
- Cero tests marcados `skip` en áreas críticas.
- Gate de PR: lint + typecheck + unit + pgTAP + integración + aislamiento. Gate de release: + e2e + k6 + ZAP baseline + Lighthouse.
- Flaky tests: se arreglan o se eliminan en < 1 semana.

## 11. Pruebas de carga (objetivos)
| Prueba | Carga | Objetivo |
|---|---|---|
| Disponibilidad | 50 req/s durante 5 min | p95 < 600 ms, 0 errores |
| Reservas | 20 req/s sobre 200 slots | 0 solapes, p95 < 800 ms |
| Feed futuro, sólo si P-05 se aprueba | 10 req/s con 100 k eventos | p95 < 400 ms y completitud demostrada, no sólo rendimiento |
| Worker notificaciones | 1 000 pendientes | procesadas < 3 min sin duplicados |

## 12. Pruebas críticas de las correcciones A–G (plan, no suite implementada)

- **A**: llamada directa SQL/PostgREST con authenticated/anon/rol técnico, usuario
  de A contra B, miembro inactivo y soporte vencido. Actor/header falsos no cambian
  autoridad. Catálogo de definer: propietario, search_path, EXECUTE PUBLIC/defaults,
  USAGE, núcleo privado y excepciones mínimas de helpers. No probar RLS como postgres.
- **B**: conexiones PostgreSQL distintas con barreras de sincronización: reserva
  vs horario/excepción/bloqueo individual y global, reprogramación cruzada, cambio
  de candidatos, expiración/worker y catálogo. Comprobar locks en orden P-03, rollback
  completo ante error, efectos del candidato fallido y retry acotado 40P01/40001.
- **C**: duración cero/negativa, buffer negativo, derivados falsificados, igualdad
  exacta de segundos, DST, cambio de catálogo, ajuste autorizado con conflicto,
  reversión y política histórica P-02. No duplicar contador ni auditoría al repetir.
- **D**: feed futuro con transacción A que obtiene ID primero y confirma última,
  B que confirma antes, abortos, publicadores paralelos, crash antes/después de
  publicar/checkpoint, tombstone y cursor fuera de retención. Ningún watermark puede
  omitir A. En fallback, corregir dato histórico fuera de 7 días, mover fecha entre
  rangos y fallar a mitad de barrido: recuperar todo el alcance sin borrar por ausencia.
- **E**: service_key falla en todas las escrituras aun llamando operación interna;
  user_token ajeno/expirado/revocado no escribe. Dos cuentas GAS no comparten ni
  seleccionan credenciales ajenas; el despliegue real valida P-08 antes de escritura.
- **F**: destino de otro tenant/tipo inexistente, baja/fusión concurrente, dos registros
  para la misma reserva, dos reservas para el mismo registro, cliente fusionado con
  varios IDs y needs_review que no se utiliza como vínculo efectivo.
- **G**: 428 sin If-Match, 412 obsoleto, 409 de negocio; dos updates con misma versión
  producen uno solo. Key repetida/hash igual reejecuta cero efectos; body o If-Match
  distinto retorna 409; key de otro actor no revela respuesta; replay tras revocación
  denegado. Caída tras commit antes de respuesta devuelve resultado sin nueva mutación.

Antes de S1: aprobar P-01/P-07 y diseñar fixtures cross-tenant. Las pruebas reales
se escriben y ejecutan junto al esquema autorizado; esta consolidación no crea SQL,
no ejecuta pgTAP ni declara que exista aislamiento implementado. Gates de S0 siguen
limitados a las herramientas ya configuradas; ampliar CI cuando se añada cada suite.
