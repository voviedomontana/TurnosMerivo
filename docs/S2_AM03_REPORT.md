# S2 — A-M03: C-01, C-02 y C-07

Fecha: 2026-11-01. **Implementado y validado exclusivamente en entorno descartable.**
No aplicado a la instancia del propietario. La autorización actual prohíbe usar esa
base; el siguiente paquete o aplicación local requieren autorización distinta.

## Precondiciones y preservación

Se leyeron AGENTS, guía de implementación, compatibilidad S2 y el informe de A-08/A-05.
Antes de modificar partes dependientes, se volvió a ejecutar el harness existente:
**156 aserciones SQL correctas**, Auth/contraseña/TOTP reales, grants privados,
LAST_OWNER HTTP409 y rollback correctos. No apareció bloqueo crítico.

Se capturaron hashes de los 151 archivos anteriores no ignorados y no secretos.
Las cinco migraciones históricas y las dos A-08/A-05 se conservaron byte a byte;
el harness ahora comprueba los siete hashes antes de crear recursos. El informe
anterior registra que A-08/A-05 ya estaban aplicadas localmente; esta fase no intenta
reconsultar la base del propietario. No se leen .env, claves o secretos existentes.

Comparación final: ocho archivos previos modificados y cinco nuevos, todos listados
abajo; los otros 143 archivos previos permanecen intactos. SHA-256 de la migración
nueva: `0ce9aa32d86c8362252e1950e17832ad0ef17c377d5cb378925212877967ff80`.

## Archivos

| Archivo                                                                  | Cambio                                                                                                                     |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| supabase/migrations/20261101000500_reauthorize_membership_operations.sql | Única migración nueva: dos helpers privados, guard específico de envío y reemplazos controlados de tres cuerpos existentes |
| src/modules/auth/http.ts                                                 | Identidad verificada antes de If-Match; expected ausente llega nulo al guard SQL; reutiliza cliente verificado por request |
| src/modules/auth/service.ts                                              | Permite reutilizar ese cliente en rpc, preservando validación/error mapping existentes                                     |
| src/modules/auth/actions.ts                                              | Envío por guard específico, destinatario de DB; expected ausente llega nulo a SQL en edición/lifecycle                     |
| tests/unit/am03-auth.test.ts                                             | Doce casos HTTP/Server Action, incluyendo invocación forjada y proveedor demorado/fallido                                  |
| supabase/tests/am03.test.sql                                             | 31 aserciones nuevas sobre autorización, precondiciones, replay, permisos de envío y aceptación                            |
| scripts/lib/am03-concurrency.mjs                                         | Procesos psql independientes, barreras de locks reales y comprobación de efectos                                           |
| scripts/test-s2-security-isolated.mjs                                    | Siete hashes inmutables, ejecución concurrente y ampliación de pruebas HTTP Auth/PostgREST                                 |
| supabase/tests/tenancy.test.sql                                          | Actualiza inventario de definers de 12 a 15; mantiene el resto de cobertura S1                                             |
| supabase/tests/s2_security_fixes.test.sql                                | Agrega únicamente el nuevo RPC autorizado a la allowlist ejecutable                                                        |
| supabase/function-catalog.md                                             | Grants, guards y protocolo de las funciones                                                                                |
| docs/CHANGELOG.md y este informe                                         | Registro y resultados de esta autorización                                                                                 |

## C-01 — Identidad, autorización y precondiciones

Next verifica el usuario confirmado mediante getUser antes de clasificar If-Match.
El cliente se reutiliza sólo dentro del request; no se cachea sesión global. Ausencia
de header/form version se pasa como expected nulo. SQL decide después de comprobar
actor, tenant, objetivo, no autoedición y techo de rol. No hay consulta privilegiada
desde Next para averiguar estado de recursos ajenos.

| Condición                                                | Contrato preservado/corregido                                           |
| -------------------------------------------------------- | ----------------------------------------------------------------------- |
| Sin identidad válida                                     | 401 UNAUTHENTICATED                                                     |
| Actor/objetivo fuera del ámbito o inexistente            | 404 NOT_FOUND                                                           |
| MFA insuficiente o techo de rol incumplido               | 403 MFA_REQUIRED/FORBIDDEN                                              |
| Request nuevo autorizado, expected ausente               | 428 PRECONDITION_REQUIRED                                               |
| Request nuevo autorizado, expected obsoleto              | 412 PRECONDITION_FAILED                                                 |
| Misma key, intención/expected distinto, incluido ausente | 409 IDEMPOTENCY_KEY_REUSED                                              |
| Replay exacto con autorización actual                    | Resultado original antes de comparar versión actual; sin nuevos efectos |

Transporte conserva sus controles: CSRF/origen y sintaxis de IDs/Bearer pueden
rechazarse antes de autenticación; sintaxis inválida de If-Match da 400 después de
verificar identidad, sin consultar/comparar versión del recurso. Sigue siendo fuerte
y entre comillas. Key/normalización/hashes, envelopes, códigos 412, ETag y status de
éxito conservados. No se implementa retención de replay ni propagación de request_id.

## C-02 — Coordinación y revalidación

Coordinadores VOLATILE, comandos separados y aislamiento READ COMMITTED:

1. Preautorizar actor/objetivo sin locks de escritura. Aceptación usa identidad/token
   elegibles, no una membresía activa que todavía no existe.
2. Tomar business FOR UPDATE. Ningún DML/reclamación de replay con FK precede a raíz.
3. Reautorizar mediante comando SQL posterior a la espera, con snapshot fresco.
4. Bloquear replay existente cuando corresponda, miembro y luego invitación, siempre
   en ese orden. Validar intención/versión/estado y escribir efectos/audit/replay juntos.
5. Aceptación vuelve a comparar hash del token, email confirmado, estado del negocio,
   membresía, expiración y MFA después de la raíz y después de locks hijos.

Las funciones SQL wrapper existentes conservan firmas y permisos; la misma raíz
serializa con S2. app.require_member permanece STABLE e intacto: la frescura proviene
de invocarlo en un comando nuevo desde el coordinador VOLATILE, demostrada por las
pruebas de revocación. Los escritores rechazan REPEATABLE READ/SERIALIZABLE con
400 VALIDATION_ERROR antes de mutar, evitando reutilizar snapshots transaccionales
anteriores al lock. PostgREST y los consumidores inspeccionados usan READ COMMITTED.
Esta limitación explícita afecta a consumidores SQL que elijan otro aislamiento;
no se afirma soporte transparente para ellos.

El guard último owner, su trigger, firma y código PT409/LAST_OWNER quedan intactos.
Mantenimiento debe tomar raíz antes de hijos; el trigger por sí solo no corrige un
UPDATE crudo que ya tomó un hijo. No se añadieron workers, retries genéricos, advisory
locks ni protocolos de agenda S3. Los deadlocks ajenos no se convierten en permiso.

## C-07 — Envío y aceptación

api.prepare_member_auth_invite recibe sólo negocio/miembro como selectores. Verifica
actor activo, MFA, tenant, objetivo invited aún sin usuario, rol vigente y token de
invitación no aceptado/vencido, antes y después de coordinar. Admin sólo puede enviar
activación de barber; owner conserva sus posibilidades S2 sobre admin/owner. Devuelve
proyección fija id/business_id/email/version. No acepta email, actor ni rol afirmados
por el formulario. Anon/app_server/service_role no reciben EXECUTE.

La Server Action ejecuta ese RPC y recién después llama Auth Admin. No depende de
list_members ni de un botón visible. Pruebas unitarias invocan directamente la acción
con email/rol forjados: no se usan. Un RPC rechazado no alcanza al proveedor; uno
pendiente no provoca envío anticipado. No hay reintento automático de un fallo externo.

Una revocación posterior al RPC puede coexistir con el correo ya autorizado. No hay
transacción distribuida ni locks durante I/O. La aceptación vuelve a verificar toda
la autoridad/estado vigentes y nunca reactiva una invitación revocada/rotada/vencida.
La vigencia se evalúa con reloj real del servidor después de esperas, no con now()
anclado al comienzo de la transacción. Un replay de aceptación también requiere token
vigente y estado autorizado; expirado o revocado no devuelve el resultado antiguo.
Esto endurece ese caso frente al replay anterior que no volvía a comprobar vigencia.
No cambia el TTL de member_requests ni elimina registros (C-06 sigue pendiente).

## Evidencia de concurrencia

Comando: `node scripts/test-s2-security-isolated.mjs`. No carga .env ni usa recursos
del propietario. Conserva la infraestructura descartable PostgreSQL/Auth/PostgREST
fijada del harness anterior. Cada cliente concurrente es un proceso psql distinto y
una conexión/backend PostgreSQL independiente, no promesas de una conexión compartida.

La sesión holder confirma ROOT_READY después de tomar raíz. El test espera mediante
pg_stat_activity que el otro cliente tenga wait_event_type Lock antes de confirmar el
cambio concurrente y liberar raíz. La excepción de preautorización se prueba mientras
el holder sigue abierto. Son barreras reales; no se presume concurrencia por lanzar
dos requests o por sleeps arbitrarios. Sólo el caso de expiración espera el tiempo
necesario para cruzar el vencimiento bajo lock.

| Escenario                                                                                     | Resultado real                                                                   |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Outsider, barber y admin sobre owner con raíz retenida                                        | Rechazo antes de esperar el lock                                                 |
| Revocación de actor durante espera: update, invite, lifecycle y send guard                    | Cuatro casos: rechazo posterior a raíz, sin audit/replay ni cambios del objetivo |
| Promoción de objetivo durante espera: update y send guard                                     | Dos casos: admin pierde autoridad y obtiene 403                                  |
| Aceptación durante rotación, revocación, vencimiento, suspensión de negocio o cambio de email | Cinco casos: 404, sin vincular usuario ni crear auditoría                        |
| Correo autorizado simulado y demorado, seguido de revocación                                  | Otro escritor toma raíz; aceptación denegada; no lock retenido por envío         |
| Dos owners intentando despromoverse mutuamente                                                | Una operación válida, otra 403, un owner activo y una auditoría                  |
| Dos solicitudes idénticas con la misma key                                                    | Ambas responden; una sola mutación, versión, auditoría y fila replay             |
| Transacción REPEATABLE READ                                                                   | Rechazo antes de mutar; versión intacta                                          |

Son **16 escenarios con conexiones independientes: 15 de concurrencia y uno de
aislamiento**. No se observaron deadlocks en esa matriz; no se promete ausencia
universal de deadlocks ante DML externo que viole el protocolo.

## Validaciones ejecutadas

| Comando/cobertura                                   | Resultado                                                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Preflight A-08/A-05 antes de modificar dependencias | PASS, 156 pgTAP y regresión Auth/API del harness anterior                                           |
| Harness final                                       | PASS: 187 pgTAP + 16 escenarios independientes + Auth/PostgREST reales                              |
| am03.test.sql                                       | 31 aserciones correctas                                                                             |
| auth.test.sql                                       | 45 aserciones correctas                                                                             |
| tenancy.test.sql                                    | 69 aserciones correctas                                                                             |
| s2_security_fixes.test.sql                          | 42 aserciones correctas                                                                             |
| npm run test                                        | 84 tests en 10 archivos, todos correctos                                                            |
| npm run lint                                        | Correcto                                                                                            |
| npm run typecheck                                   | Correcto                                                                                            |
| npm run build                                       | Correcto; ejecutado fuera del sandbox por EPERM previamente comprobado en .next                     |
| npm run format:check                                | Falla exclusivamente por los 15 documentos preexistentes de arquitectura-v1.1, conservados intactos |
| Formato acotado y git diff --check                  | Correctos                                                                                           |

SQL: 156 regresiones anteriores conservadas + 31 nuevas. Las únicas adaptaciones
de inventario previas son los tres definers nuevos y el nuevo RPC específico. Auth
real cubre contraseña, MFA TOTP, selector, grants privados/públicos, equipo, invitación
y aceptación; HTTP ahora comprueba además guard de envío y 403/404/428/412 con expected
ausente u obsoleto según corresponda.
LAST_OWNER HTTP409 y rollback siguen correctos. No se detectaron regresiones S1/S2
en estas pruebas. Los recursos descartables fueron eliminados y se verificó ausencia
de contenedores/redes merivo-s2-check al finalizar.

## Estado y límites pendientes

- **C-01/C-02/C-07 implementados y validados; migración aún no aplicada al propietario.**
  No se ejecutó db/CLI/query contra su instancia, ni se alteró cuenta, password o MFA.
- Antes de usar las acciones nuevas en el entorno local, una autorización posterior
  debe permitir aplicar la migración. El guard específico no existe en un esquema
  viejo: el envío falla cerrado, sin fallback al listado amplio. Despliegue compatible
  futuro: esquema aditivo primero y aplicación después; no desplegado en esta fase.
- La regresión de navegador E2E original no se ejecuta: usa la base del propietario.
  No hubo cambios de UI; se probaron HTTP, SQL, Auth real y Server Actions directamente.
- Revocación global en Auth y DML manual ajeno no forman una transacción distribuida
  con datos de negocio. Se revalida estado actual en los puntos descritos; todo
  escritor de membresías/negocio debe respetar raíz primero para serialización.
- Correo tardío autorizado permitido; sin garantía exactamente una vez. Cooldown,
  deduplicación persistente de envío y jobs no se agregan a este alcance.
- C-03, C-04 y C-06 continúan pendientes; audit.request_id=p_key, listado completo y
  retención actual se conservan. No hay S3, nuevas funcionalidades, GAS, dependencias,
  commit, push ni despliegue. La ejecución se detiene en A-M03.
