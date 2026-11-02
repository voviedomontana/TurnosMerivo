# Clientes — aceptación y pruebas futuras

Fecha: 2026-11-01. Estado: **plan propuesto, no suite implementada ni ejecutada**.
Decisiones E-01…E-06 establecidas en [diseño](CUSTOMER_MODULE_DESIGN.md); casos de
campos, contratos y capacidades CD-xx sujetos a [aprobación](CUSTOMER_DECISIONS_PENDING.md).
Matriz esperada: [permisos](CUSTOMER_PERMISSION_MATRIX.md). Lotes: [migración](CUSTOMER_MIGRATION_PROPOSAL.md).

## 1. Entorno y protocolo de evidencia

Sólo tras autorizar implementación: extender el harness aislado existente, con
PostgreSQL/Auth/PostgREST propios y una copia Next sin .env del propietario. Las
doce migraciones históricas se verifican por hash y se reproducen sin modificaciones.
Fixtures con dos negocios, owner/admin/barber activos e invitados/suspendidos; usuarios
multi-negocio; perfil staff con/sin cuenta; pares de clientes con contactos compartidos.
Nunca copiar dumps, cuentas, sesiones ni factores MFA del propietario como fixtures.

Cada pgTAP con BEGIN/ROLLBACK; conexiones concurrentes reales independientes con
barreras observadas, statement/lock timeout y limpieza sólo del prefijo de ese run.
No sleep como única prueba de espera: verificar pg_stat_activity/locks antes de
liberar al competidor. Registrar assertion ID, versión/hash, resultado y limitación;
no serializar tokens, filas de personas, búsquedas ni evidence_summary en errores.
Separa PASS SQL, HTTP real, navegador y unitarios; skips no cuentan como aprobación.

## 2. Unitarios / propiedades — CU

| ID    | Caso                                                                | Oráculo                                                                                                                                |
| ----- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| CU-01 | Validación Zod estricta de ficha                                    | Campos/rangos CD-01; rechaza actor/business_id/phone_e164/marketing/estadísticas/version en body.                                      |
| CU-02 | Teléfonos con +54, +549 y otros países; 0/15/00 ambiguos            | Matriz exacta del diseño; no inferir área/móvil/propietario.                                                                           |
| CU-03 | Nulos, vacíos, separadores, límites 8/15, >15, Unicode, extensiones | NULL coherente, international sintáctico o needs_review según contrato; entrada inválida no se trunca.                                 |
| CU-04 | Idempotencia del normalizador                                       | Mismo raw→mismo resultado; procesar una salida internacional no cambia dígitos; normalizar nunca agrega 9/54 ni fusiona fichas.        |
| CU-05 | Zod vs SQL                                                          | Misma batería de contactos/nombres y aceptaciones; no divergencia de longitud Unicode, NFC o NULL/vacío.                               |
| CU-06 | can() acciones finitas                                              | Matriz completa rol/aal/tenant/activo; acción desconocida false; S2/catálogo conservan comportamiento.                                 |
| CU-07 | If-Match y cursores                                                 | Entero positivo seguro entre comillas, límite 200, UTC finito, UUID v4, base64url y tamaño máximo; sin parser que acepte NaN/Infinity. |
| CU-08 | DTO y logs                                                          | Listado no contiene notas/marketing; resumen no contiene evidencia; errores seguros y redacción de body/cursor.                        |

TDD de normalización y permisos conforme a la guía; casos hipotéticos sintéticos,
no números copiados de clientes. Los ejemplos de formato no deben generar mensajes.

## 3. SQL / pgTAP — CS

| ID    | Caso                                                                 | Resultado exigido                                                                                                                   |
| ----- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| CS-01 | Dos clientes del mismo negocio comparten teléfono, email e Instagram | Ambos INSERT por RPC autorizada exitosos; IDs distintos; ningún 23505 de contacto.                                                  |
| CS-02 | Mismo contacto en dos tenants                                        | Sin relación automática, hint ni fuga entre negocios.                                                                               |
| CS-03 | Cliente sin Auth ni contactos; nombre duplicado                      | Permitido según CD-01; cero nuevas filas Auth/usuarios/membresías.                                                                  |
| CS-04 | Tipos/límites/normalización por RPC directa                          | SQL rechaza inválidos aunque se omita Zod; sólo normalizador escribe derivados.                                                     |
| CS-05 | Inmutabilidad ID/tenant/created_at, version/marketing_revision       | Trigger conserva identidad; una versión perfil por update; notas/nombre no invalidan marketing, contacto/archivo sí.                |
| CS-06 | FKs compuestas de eventos/avisos/miembro                             | Negocio A no referencia cliente, aviso o miembro B ni con DML de mantenimiento. Un grant no usa aviso operations.                   |
| CS-07 | RLS y superficie                                                     | Cuatro tablas ENABLE/FORCE; ningún grant directo a roles app; cores/purge privados; sólo firmas RPC aprobadas; search_path vacío.   |
| CS-08 | Todos los roles, membresías y MFA                                    | Owner/admin aal2 permitidos; aal1→403, barber→403, otros/inactivos→404, anon sin EXECUTE/401 HTTP.                                  |
| CS-09 | Lecturas/listas de archivados por barber y RPC directa               | Denegadas; estado/IDs ni notas no se revelan antes de autorizar.                                                                    |
| CS-10 | Historial privado: admin pide evidencia                              | 403 aun si registró el evento; owner propio puede leer sólo proyección aprobada.                                                    |
| CS-11 | Crear ficha, guardar notas y editar contactos                        | Sin eventos granted, consentimientos implícitos ni copias de PII en audit/replay.                                                   |
| CS-12 | not_recorded virtual                                                 | consent_version=1 sin filas de eventos; no bandera opt_in alternativa.                                                              |
| CS-13 | Grant correcto / inválido                                            | Evento con versión+1, aviso marketing actual, actor/tiempo/contexto derivados; sin email/evidencia/ficha actual falla con rollback. |
| CS-14 | Revoke sin grant, sin email o archivado                              | Permitido con autoridad/precondiciones; no obliga evidencia positiva ni aviso nuevo.                                                |
| CS-15 | Cambio de contacto/archivo/restauración                              | Grant anterior inaplicable; volver al contacto previo/restaurar no revive contexto; evidencia permanece.                            |
| CS-16 | Dos fichas con contacto igual, grant/revoke en una                   | La otra no cambia ni hereda consentimiento; nunca aparece autorización para enviar campañas.                                        |
| CS-17 | Eventos/avisos inmutables                                            | UPDATE/DELETE/TRUNCATE por roles app denegados; guard detecta mutación en prueba; nueva versión de aviso no reescribe historia.     |
| CS-18 | Versiones de perfil y consentimiento independientes                  | Grant no aumenta customer.version; editar notas no incrementa consent_version; ambos locks sí coordinan.                            |
| CS-19 | Keyset con >450 registros y created_at iguales                       | Páginas 50/200, orden (created_at,id), sin saltos/repetidos con conjunto estable; sin OFFSET ni corte silencioso.                   |
| CS-20 | Cursor inválido, ajeno, filtro cambiado, recurso/canal cambiado      | 400 tras autorizar; no reutilizar cursor de miembros/catálogo/historia.                                                             |
| CS-21 | Búsqueda %, _, backslash y SQL-like                                  | Literales escapados; tenant primero, campo whitelist, query acotada; contacto igual puede devolver varios resultados.               |
| CS-22 | Replay idéntico <48 h y tras versión nueva                           | Mismos metadatos originales, sin nueva mutación/auditoría/evento; permiso actual comprobado.                                        |
| CS-23 | Misma key, otra intención/expected/event_id                          | 409 dentro del scope; ninguna escritura parcial. Actor/tenant/operación diferentes no comparten respuesta.                          |
| CS-24 | Expiración exactamente 48 h / purga                                  | No reconocer replay; UUID de alta estable no duplica; versión vieja de perfil/consentimiento falla 412, jamás reotorga marketing.   |
| CS-25 | Retención acotada                                                    | Purga 1…500, NULL/0/501 rechazados; no toca fichas, eventos, avisos, auditoría, invitaciones ni ledgers ajenos.                     |
| CS-26 | Fallo en evidencia/auditoría/replay después de mutar                 | Rollback completo: perfil, versión/contexto, evento y ledger sin cambios parciales. Probes sólo en fixture.                         |
| CS-27 | CHECK ajeno 23514 y LAST_OWNER existente                             | CHECK→error interno seguro, nunca LAST_OWNER; último owner conserva 409 y protección.                                               |
| CS-28 | Históricos S2 y catálogo                                             | Sus IDs, resultados y datos conservados, sin backfill de clientes ni consentimientos.                                               |

## 4. Integración HTTP real — CH

- CH-01: Auth sintético, MFA aal2, crear/leer/PUT/archivo/restauración; 201/200 y ETag
  correcto, X-Request-Id propagado a RPC/auditoría/origin del replay.
- CH-02: HTTP y RPC directa con todas las combinaciones de la matriz; headers/rol
  falsificados no autorizan. Separar 401/403/404 de 428/412/409 con resource IDs existentes.
- CH-03: Listas sin notas/evidencia/marketing, detalle administrativo con notas;
  no whole-row JSON, mensajes de PostgreSQL ni filas en response de error.
- CH-04: Teléfonos/emails/Instagram iguales permiten dos altas y dos fichas, hints
  paginados sin impedir guardar. No endpoint anónimo de búsqueda/resolución.
- CH-05: Falta If-Match/customer_version→428 sólo para autorizado; obsoleto→412;
  UUID duplicado/key distinta intención/transición imposible→409. Payload/path
  malformado→400 sin filtrar existencia; 23514 desconocido→500 seguro; caída→503.
- CH-06: GET keyset y POST search con cursores/filtros, timestamps empatados y >200;
  comprobar consulta parametrizada y no descarga completa del directorio.
- CH-07: Cookie-CSRF mismo origen para mutaciones y POST search; Bearer verificado;
  respuestas no-store, ninguna query de contacto en URL/logs/referrer/cursor decodificado.
- CH-08: Grant/revoke con versión de perfil+consentimiento, evidencia y aviso; admin
  puede registrar/resumir pero no listar evidencia. Revoke sin aviso disponible funciona.
- CH-09: Replay de grant después de revoke/archivo/contacto cambiado: devuelve sólo
  metadatos históricos, GET muestra no aplicable/revocado; no nuevo evento ni reactivación.
- CH-10: Replay reautorizado después de downgrade/suspensión/MFA insuficiente;
  resultado y su key jamás acreditan permiso.
- CH-11: Límite body, JSON inválido, claves extra, Unicode, límites, cursor gigante
  y búsqueda maliciosa fallan sin datos sensibles ni cambios.
- CH-12: Aviso de otro negocio, propósito operations o versión no vigente en grant
  no se aceptan; no se inventa aviso de respaldo ni se bloquea revoke.

## 5. Concurrencia con conexiones independientes — CC

Cada caso comprueba estado final completo, sin contar 40P01 como rechazo correcto.

| ID    | Carrera / barrera                                                 | Resultado                                                                                                                               |
| ----- | ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| CC-01 | Writer preautorizado espera raíz; owner suspende/demueve al actor | Reautoriza y deniega sin mutación. Lectura/invitaciones S2 mantienen su contrato.                                                       |
| CC-02 | Writer toma raíz primero; revocación espera                       | Writer autorizado confirma antes; revocación confirma después; próximo comando denegado.                                                |
| CC-03 | Dos PUT con misma versión y keys distintas                        | Uno 200, otro 412; una versión y un audit de perfil.                                                                                    |
| CC-04 | Dos creates con mismo UUID/key y luego keys distintas             | Replay exacto un efecto; otra key mismo UUID 409. UUID diferentes con contacto compartido: ambos éxito.                                 |
| CC-05 | Grant y revoke con misma versión de consentimiento                | Uno confirma, otro 412; reintento consciente con versión nueva; orden auditable, sin overwrites silenciosos.                            |
| CC-06 | Grant contra edición de contacto/archivo                          | Raíz decide orden. Si perfil cambia antes: 412 por customer_version; si grant primero: luego revisión contexto invalida, no manda nada. |
| CC-07 | Dos eventos iguales key/event_id; replay después de revoke        | Un evento/audit; lectura actual mantiene revocación, respuesta replay no gobierna estado.                                               |
| CC-08 | Publicación de aviso y grant concurrentes                         | Misma raíz; el grant usa aviso vigente al serializar o rechaza versión anterior sin side effects.                                       |
| CC-09 | Purga vs replay/escritura cerca de 48 h                           | Reloj al lock, SKIP LOCKED, expiración no duplica perfil/evento; ninguna inversión raíz↔ledger.                                         |
| CC-10 | Dos purgadores; uno falla; escritura simultánea                   | Lotes disjuntos ≤500; fallo revierte sólo su lote, no bloquea raíz ni pierde evidencia/auditoría.                                       |
| CC-11 | Escrituras clientes mezcladas con S2/catálogo en mismo tenant     | Orden común sin deadlock; último owner, permisos y versiones preservados. Otro tenant progresa sin esa raíz.                            |
| CC-12 | Paginación mientras cambian filas/permisos                        | Reautoriza cada página; documenta ausencia de snapshot; ninguna fuga al revocar antes de próxima petición.                              |

## 6. E2E administrativo — CE

En navegador contra copia temporal y Auth de fixture; desktop 1280 y móvil 390:

1. Owner/admin con MFA llegan al directorio; barber no ve enlace ni puede entrar
   directamente/llamar API. No enrolar/desenrolar MFA del propietario para probarlo.
2. Alta sólo nombre y alta con contacto compartido; aviso no bloqueante y ambas
   fichas persistidas. Nunca «ese teléfono ya pertenece a otro cliente».
3. Buscar nombre/teléfono/email/Instagram, navegar siguiente/primera página, cambiar
   filtro reinicia cursor; consulta no aparece en URL ni memoria persistente.
4. Editar ficha/notas, conflicto entre pestañas con 412 y recarga explícita; no
   perder borrador sin aviso ni reintentar actualización obsoleta automáticamente.
5. Archivar/restaurar y verificar conservación/estado correcto. Sin estadísticas,
   visitas, reservas o etiquetas de verificación inventadas.
6. Formulario de marketing separado, nunca preseleccionado; registro/revocación
   explícitos; notas no se mandan junto con evidencia; no bloqueo por rechazarlo.
7. Owner ve historia/evidencia; admin sólo resumen y su formulario de registro;
   cambio de contacto/archivo informa grant no aplicable y restore no lo revive.
8. Accesibilidad de teclado, foco visible, labels, estados de carga/error, 44 px,
   contraste Merivo y cero overflow/pageerror. Logo original sin modificar.

## 7. Regresión, salida y limitaciones

Reejecutar suite aislada S1/S2/catálogo: login/MFA, selector, permisos, configuración
privada, roles/invitaciones, último propietario, paginación miembros, request_id,
48 h/purga y CRUD catálogo. Nuevas RPC no amplían superficie privilegiada histórica.

Checks de código futuros: npm run lint, format:check, typecheck, test y build; E2E
sólo mediante harness descartable. Si sigue el fallo documental preexistente de 15
Markdown, registrarlo sin formatear archivos históricos por fuera del alcance.
Revisar hashes de doce migraciones, dependencias, assets y archivos no relacionados.

Gate CM: cada escenario aplicable ejecutado y resultado real documentado. Un lote
marketing bloqueado no se marca completado por pasar perfil. El plan no afirma
rendimiento probado, cumplimiento legal, seguridad de futuras reservas, envío de
campañas o acceso contextual de barber. La revisión documental actual no ejecuta
pgTAP, HTTP autenticado, conexiones DB ni E2E y no es evidencia de esas pruebas.
