# Correcciones críticas aprobadas para implementación (v1)

Estado: propuesta de corrección técnica para revisión en PR; prevalece sobre afirmaciones incompatibles en docs 01–13 hasta su consolidación. No es autorización para desplegar sin pruebas.

## A. Identidad y SECURITY DEFINER
- Las funciones expuestas a `authenticated` derivan el usuario de `auth.uid()`; nunca autorizan con `p_actor_id`, cabeceras o `business_id` aportado por el cliente.
- Verificar membresía activa en `(business_id,user_id)` y permiso en cada escritura. Revocar `EXECUTE` de `PUBLIC` y conceder exclusivamente a roles necesarios; fijar `search_path=''`, calificar objetos por esquema y evitar SQL dinámico.
- Operaciones de integración y worker se ejecutan mediante backend autenticado y funciones administrativas específicas con privilegios mínimos; las credenciales `service_role` nunca llegan al cliente, HTML de Apps Script o navegador. Registrar `actor_type` real y `integration_credential_id`; no fabricar un usuario humano.
- Tratar soporte/superadministrador como flujo explícito, auditado, temporal y con verificaciones de expiración.

## B. Reserva concurrente
- PostgreSQL PL/pgSQL no admite `SAVEPOINT` / `ROLLBACK TO` directamente dentro de una función: usar bloques `BEGIN ... EXCEPTION ... END` para reintentos de candidato, o una única transacción coordinada desde backend.
- Aplicar en **todas** las escrituras sobre reservas, horarios, excepciones y bloqueos el mismo protocolo de lock por `(business_id,staff_id)`; fijar orden de bloqueo determinista en operaciones que afectan varios profesionales.
- Conservar `EXCLUDE USING gist` para rangos ocupados de reservas activas. El bloqueo de fila del profesional protege consistencia con `time_blocks` y horarios porque no están cubiertos por ese EXCLUDE.
- Validar después de adquirir lock, no confiar en disponibilidad mostrada al usuario. Probar concurrencia real con conexiones distintas y casos de reprogramación cruzada.
- `completed` y `no_show`: definir una política de ocupación histórica coherente, prohibiendo reversiones que provoquen superposición; no reutilizar arbitrariamente slots históricos. Recomendación: conservar rango ocupado de reservas terminadas y ausencia, salvo cancelación/liberación explícita antes de atención; distinguir ocupación histórica de disponibilidad futura.

## C. Duración y rangos
- Validar `duration_minutes_snapshot > 0`, `buffer_minutes_snapshot >= 0`, `ends_at > starts_at`, `blocked_until >= ends_at`.
- Un CHECK de `blocked_until >= ends_at` **no garantiza igualdad** con `ends_at + buffer`; establecer trigger o función de escritura única que calcule y valide los cuatro campos, sin UPDATE directo desde roles de usuario o integraciones. Agregar pruebas para modificaciones y precios/duración históricos.

## D. Sincronización confiable con Apps Script
- `updated_at,id` y un solapamiento fijo de cinco minutos **no** garantizan completitud ante commits tardíos.
- Diseñar un outbox durable escrito en la misma transacción que el dato. Una secuencia creciente de IDs **tampoco equivale al orden de confirmación**. Para garantizar un feed incremental, usar un publicador que observe solo registros confirmados, asigne orden seguro de publicación y no adelante el watermark pasando eventos todavía no publicados; evaluar CDC/logical decoding si aumenta la complejidad.
- MVP alternativo seguro: lectura bajo demanda para agenda y resync paginado completo/reconciliación periódica para KPIs. No habilitar `/integrations/changes` como sincronización garantizada hasta que el algoritmo sea probado con commits fuera de orden.
- Persistir cursor únicamente después de aplicar lote, operaciones idempotentes `(business_id,entity_id,version)`, tombstones y recuperación tras fallos parciales.

## E. Modo B Apps Script
- Credencial compartida del propietario: **solo lectura**. `X-Actor-Asserted` es metadato no confiable, nunca autorización.
- `confirm`, `complete`, `no_show`, creación, cancelación, reprogramación y links de servicio se realizan en TurnosMerivo con identidad individual real. Modo A con credenciales personales solo si el despliegue y almacenamiento de tokens fue validado; `UserProperties` por sí solo no demuestra la identidad del operador en todos los modelos de despliegue.
- Integración de registro de servicios: durante MVP se vincula desde un flujo autenticado del sistema o se concilia posteriormente; no permitir que una credencial de lectura genere vínculos.

## F. Mapeos externos
- `external_id_mappings` polimórfico no puede tener FK nativa única sobre `internal_id` a cinco tablas distintas. Validar referencia y pertenencia al negocio en operaciones transaccionales autorizadas; considerar tablas de mapeos específicas si crece el alcance.
- Únicos compuestos por `(business_id,external_system,entity_type,external_id)` y, donde aplique relación 1:1, por `(business_id,external_system,entity_type,internal_id)`; distinguir mapeos pendientes de revisión de confirmados.

## G. Concurrencia optimista de la API
- Para PATCH/transiciones de recursos existentes exigir `If-Match` sobre la versión conocida. Sin cabecera → HTTP 428; versión desactualizada → HTTP 412; conflicto de negocio (slot ocupado) → 409.
- Actualizar de forma atómica con `WHERE version = expected_version`, incrementar `version` y crear evento de auditoría en la misma transacción. `Idempotency-Key` en creaciones/transiciones; no devolver un resultado viejo ante payload diferente con la misma clave.

## Puerta de calidad antes de Sprint 1
1. Unificar 03, 04, 05, 06, 07, 08, 10, 11 y `CODEX_IMPLEMENTATION_GUIDE.md` con esta adenda (el repositorio no debe conservar contradicciones operativas).
2. Escribir tests de autorización cross-tenant, invocación directa a funciones SQL, cambios concurrentes y RLS.
3. Documentar estrategia de migraciones y rollback; ejecutar todo primero en Supabase local.
4. Revisar amenazas y aprobación técnica del PR antes de datos reales.
