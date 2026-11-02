# Paquete B — Contratos de diseño S3-A

Fecha: 2026-11-01. Estado: **propuestas no aprobadas; sin SQL ni implementación**.

Base: registro P-01…P-08 y propuesta Sprint 3 de
[continuidad](../continuity-proposal/DECISION_REGISTER.md). Se cierran contratos
concretos; las decisiones pendientes quedan individualizadas en
[la matriz de aprobación](S3_A_APPROVAL_MATRIX.md). Opción A de P-02 sigue provisional.
Los nombres de operaciones/recursos nuevos son contratos propuestos, no endpoints
existentes. Nada de este documento concede permisos o altera los documentos originales.

## P-02 — Historia de ocupación y liberación explícita

### Contrato lógico propuesto, con opción A provisional

Separar resultado de atención, intervalo original y ocupación efectiva. Conservar
starts_at, ends_at, blocked_until y snapshots históricos, aun cuando haya corrección
o liberación. Intervalos UTC semiabiertos `[inicio, fin)`; inicio < fin y
blocked_until ≥ ends_at, duración/buffer válidos, profesional y negocio coherentes.
La zona IANA del negocio sólo gobierna interpretación/presentación local; probar
ambigüedades y saltos horarios. Ningún cambio de catálogo reescribe snapshots.

| Operación/estado                | Ocupación y efectos propuestos                                                       | Autoridad/guard                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| pending / confirmed             | Ocupan hasta blocked_until; pending no deja de ocupar sólo porque pasa el reloj      | Creación/transición validada por motor, no por consulta que ignore filas                  |
| completed                       | Conserva ocupación histórica y resultado                                             | Profesional propio autorizado o owner/admin; no completar con timestamp efectivo futuro   |
| no_show                         | Conserva ocupación; no libera automáticamente                                        | Profesional propio autorizado o owner/admin; umbral de ausencia debe aprobarse            |
| cancelación                     | Sólo pending/confirmed; libera ocupación como consecuencia explícita de cancelación  | Política/cutoff por contexto; razón auditada; no convierte completed/no_show en cancelled |
| expiración pending              | Transición explícita a expired y liberación atómica                                  | Job autorizado, revalida estado/plazo bajo protocolo de locks                             |
| reprogramación/reasignación     | Sólo pending/confirmed; reemplazo atómico, conserva historial del intervalo anterior | Versiones, límites y destino válidos; conflicto conserva origen completo                  |
| liberación de completed/no_show | Comando independiente con razón; no modifica resultado ni timestamps originales      | Sólo owner/admin aal2; expected version, key y auditoría obligatorios                     |
| corrección de resultado         | Operación administrativa explícita, nunca PATCH genérico de estado                   | Owner/admin aal2, razón y versión; política de ventana pendiente                          |

**Geometría de liberación que se propone aprobar:** sólo el tramo no transcurrido,
desde `max(reloj_servidor, starts_at)` hasta blocked_until. Preservar el prefijo
histórico ocupado. Si no queda tramo futuro, responder conflicto de operación sin
efecto (409), sin inventar una liberación retroactiva. No habilitar reservas en el
pasado como consecuencia de esta operación. Producto debe confirmar esta geometría;
la opción alternativa de liberar todo el intervalo histórico requiere aprobación
distinta y análisis de integridad. No confundir conservar auditoría con conservar
ocupación: son garantías diferentes.

**Correcciones.** Propuesta: operación atómica de reversión y aplicación del resultado
correcto, con dos eventos causales y una única versión final de la reserva por comando.
No exponer un estado confirmed intermedio ni disparar recordatorios por esa transición
interna. Restaurar ocupación previamente liberada requiere verificar conflictos y
puede fallar completo con 409. No restaurar silenciosamente ni borrar eventos.
Si existe vínculo contable/servicio externo, exigir previamente conciliación o
desvinculación autorizada; nunca modificar GAS o borrar registros financieros.
Propuesta de ventana: admin hasta 30 días, owner después con razón; es un valor
**pendiente**, no requisito inventado. Alternativa mínima: sólo owner hasta definir
ventana de admin. UI de barbero puede demorar un envío antes de confirmar; eso no
le concede permiso de reversión una vez aplicado.

Ausencia: proponer elegibilidad desde starts_at + tolerancia configurable, sin fijar
minutos por defecto. Complete requiere atención iniciada y fecha efectiva ≤ reloj
servidor; entered_at registra siempre el instante real de carga. Falta aprobar si se
permite completar antes del fin previsto y cómo documentar una finalización anticipada.
Cancelación pública, de barbero y administrativa conserva políticas/cutoffs separados;
override administrativo exige razón, no evita integridad temporal ni tenant.

**Bloqueo físico intencional.** No se elige todavía entre marcador/intervalo efectivo
y entidad de asignaciones con historial. La liberación parcial condiciona esa elección.
No se aprueba predicado EXCLUDE, lista de estados ni DDL. Después de aprobar geometría
se debe demostrar que filas efectivamente ocupadas no se solapan por negocio/profesional,
incluyendo buffers, reprogramación, cancelación, expiración, corrección y liberación.
Un predicado basado sólo en estados de V11 no cumple por sí mismo la opción A.

**Aceptación B-02.** Completed/no_show siguen bloqueando antes de liberación;
cancel/expire explícitos liberan una vez; el prefijo transcurrido sigue conservado
con la geometría recomendada; restauración conflictiva revierte todo; no existe
doble evento/outbox por replay. Pruebas de límites contiguos, DST, buffer, rollback
y dos conexiones para liberar/reprogramar/crear sobre el mismo intervalo. EXCLUDE
requiere otra aprobación con su matriz de verdad y pruebas físicas, no esta redacción.

## P-03 — Coordinación y orden global

### Elección recomendada

Fila raíz `businesses`: **FOR SHARE** para operaciones locales de agenda y **FOR
UPDATE** para cambios globales, membresías, elegibilidad y fusiones. Son locks
transaccionales reales que interaccionan con el FOR UPDATE ya usado por S2. No mezclar
con advisory locks que S2 desconoce. Determinar modo antes de adquirirlo: no hacer
upgrade compartido→exclusivo. Rutinas normales operan sobre un negocio; mantenimiento
multinegocio, si fuera necesario, toma todas las raíces por UUID antes de hijos.

### Orden obligatorio propuesto

1. Validar transporte e identidad; preautorizar sin locks de escritura. Para público,
   verificar negocio y capacidad aplicable; una clave idempotente nunca es identidad.
2. Adquirir coordinación raíz en el modo final. No hacer antes INSERT/UPDATE de hijos.
3. Revalidar autoridad/estado vigentes tras la espera mediante consultas nuevas en
   coordinador VOLATILE bajo READ COMMITTED. Un helper STABLE con snapshot anterior
   no es prueba suficiente. Cambios de rol/desactivación toman raíz exclusiva.
4. Reclamar/leer registro idempotente por scope y key; bloquearlo, verificar intención
   y reautorizar replay. Para replay válido terminar sin nueva mutación.
5. Descubrir candidatos bajo coordinación y bloquear **todos los profesionales
   necesarios por UUID**: origen, destino y candidatos de any antes del bucle.
6. Clientes por UUID; altas/normalización resuelven aquí sus índices únicos. Luego
   reservas por UUID y relectura de asignación, versión y estado. Si cambió el conjunto
   respecto del bloqueado, abortar/reintentar completo; no sumar locks anteriores.
7. Recursos secundarios/mapeos en orden tipado y UUID estable cuando existan. Controles
   globales/locales se leen bajo raíz/profesional y se bloquean en esta fase si se
   escriben; ningún camino inverso puede obtenerlos antes y después esperar staff.
8. Mutación, incrementos, eventos, auditoría, outbox y resultado idempotente en una
   sola transacción; sin llamadas de red ni escrituras Sheets.

**Ajuste explícito a la propuesta anterior:** mover reclamación de idempotencia
después de raíz. Un INSERT en replay con FK al negocio puede obtener KEY SHARE;
dos transacciones con claves distintas pueden retener esos locks y esperar convertir
la raíz a FOR UPDATE, formando un ciclo. La raíz se coordina primero, incluyendo
locks implícitos de FK. Es una corrección de la propuesta, no un cambio aplicado.

### Cobertura y consecuencias en funciones existentes

| Escritor                                                    | Coordinación y consecuencias                                                                                                                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S2 manage_member, lifecycle                                 | Mantener raíz exclusiva; agregar preflight y revalidación C-02. Hoy bloquean objetivo antes de consultar replay; converger al orden nuevo al aprobar reemplazo, sin mover replay delante de raíz |
| S2 accept_invitation                                        | Preflight específico por token/identidad, raíz exclusiva y nueva validación; no exigir membresía ya activa; preservar lock de invitación y miembro en orden fijo dentro de esta familia          |
| Guard último owner                                          | Mantener guard; DML de mantenimiento debe tomar raíz antes del UPDATE. El trigger toma raíz después de que el ejecutor puede haber bloqueado hijo: no repara un escritor fuera de protocolo      |
| Crear/confirmar/cancelar/complete/no_show/liberar/corregir  | Compartida + todos staff + clientes + reservas; revalidar permiso y P-02 antes de efectos                                                                                                        |
| Any staff / reprogramación cruzada                          | Todos los candidatos/origen/destino ordenados; el orden comercial de selección puede ser distinto del orden de lock, nunca alterar éste                                                          |
| Horario o excepción de staff                                | Compartida + staff + reservas afectadas; versión padre; conflicto visible sin cancelación automática                                                                                             |
| Horario/cierre global; alta/baja staff; servicio compartido | Exclusiva conservadora; estabiliza candidatos/relaciones y serializa con todas las operaciones locales; no reescribe snapshots de reservas                                                       |
| Fusión de clientes                                          | Exclusiva conservadora + staff afectados + clientes + reservas + vínculos. P-04 debe cerrar alias/mapeos antes de implementarla                                                                  |
| Expiración pending                                          | Descubrimiento sin lock, luego raíz→staff→reserva; SKIP LOCKED sólo donde no invierte orden; revalidar vencimiento y estado                                                                      |
| Purga replay                                                | Sólo replay con SKIP LOCKED; nunca espera raíz después, o usa raíz primero si se diseñara otra variante; no borrar registros en uso                                                              |
| Email/outbox                                                | Lease corto en transacción independiente; envío fuera, ack condicionado por lease; jamás retiene locks de agenda durante I/O                                                                     |

Desactivación global de usuario puede afectar varios negocios: no actualizar el
perfil global y después esperar raíces. Diseñar el conjunto de negocios/orden y
serialización antes de habilitar ese escritor; no agregarlo silenciosamente a S3.
Mantenimiento, seeds de tests y operaciones de soporte también cumplen el protocolo.

Adquirir coordinación y staff fuera de savepoints/bloques EXCEPTION que se reviertan
por un candidato; de otro modo se pueden soltar locks antes de la siguiente prueba.
40P01/40001 permiten reintento de transacción completa acotado (propuesta: máximo 3,
jitter) con misma intención/key; nunca reintentar 412/409 automáticamente. Un timeout
retorna error transitorio seguro, sin efecto parcial ni loop infinito. El protocolo
reduce ciclos conocidos; no garantiza ausencia absoluta de deadlocks por triggers,
índices únicos o writers externos. Configuración de timeout y carga debe medirse.

**Aceptación B-03.** Pruebas con conexiones/barreras para creación vs cierre global,
dos reprogramaciones cruzadas, any solapado, desactivación de staff, membresía revocada,
dos altas de cliente con mismo teléfono, fusión inversa, confirmación vs expiración,
replay/purga y mantenimiento último owner. Incluir caso de dos keys con FK para
demostrar que no se toma KEY SHARE antes de coordinar. Inspeccionar grafo de espera
y rollback; verificar que S2 concurrente sigue correcto. pgTAP aislado no basta.

## P-06 — Versiones, idempotencia y manage_token

### Recursos y versiones

Versiones son enteros positivos de servidor, no timestamps ni valores enviados como
autoridad. Se incrementa una vez por recurso mutable cambiado en un comando exitoso;
rollback/replay no incrementan. Conservar en S2 la semántica actual de UPDATE/version
(incluido no-op) hasta una autorización separada; la regla de evitar UPDATE sin cambio
es propuesta para recursos nuevos, no cambio encubierto al trigger existente.

| Recurso                             | Cambios que controla                                                                                                                   |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| business                            | Datos propios del negocio; no usar su versión como contador de cada reserva                                                            |
| business_settings                   | Política/configuración y valores propios; no sustituye control de agenda global                                                        |
| business_member                     | Rol/estado del objetivo; actor siempre se consulta vigente                                                                             |
| staff                               | Perfil, elegibilidad local, horario y asociaciones de servicios del profesional; hijos se editan con versión padre                     |
| service                             | Nombre/precio/duración/buffer/estado del catálogo; cambios no actualizan snapshots existentes                                          |
| customer                            | Perfil/contactos/consentimiento/estado de fusión; contadores derivados no deben causar conflictos arbitrarios de edición de perfil     |
| appointment                         | Estado lógico, horario, asignación y ocupación; transición compuesta produce una versión final y eventos causales                      |
| calendar_control (nombre propuesto) | Horarios/excepciones/bloqueos globales por negocio, con versión independiente; no incrementar todos los staff por una excepción global |

Asociar/desasociar servicio de staff incrementa staff; editar servicio incrementa
service y usa coordinación exclusiva para elegibilidad, sin incrementar cada staff
si no cambia su asociación/override. Cambio compuesto exige vector explícito de
versiones de los recursos que escribe, bloqueados según P-03. Versiones de catálogo
leídas para disponibilidad no se convierten en permisos ni justifican precio cliente.
Un conflicto devuelve sólo información del recurso autorizado.

Mantener If-Match fuerte y los códigos 428 ausencia, 412 PRECONDITION_FAILED,
409 conflicto de dominio/key reutilizada. Autorización precede precondición de estado;
replay exacto autorizado precede comparación contra versión actual. No introducir
VERSION_CONFLICT en S2 sin contrato de compatibilidad separado.

### Replay

Unicidad: negocio + autoridad verificada (usuario o capacidad/credencial específica)

- operación + UUID de key. Conservar el scope S2 existente para usuarios; nunca adoptar
  una PK sólo tenant/key/endpoint. Reconstruir hash canónico en servidor/SQL con acción,
  objetivos, datos normalizados y versiones esperadas. No confiar en hash calculado por
  cliente. Excluir request_id, resultados, UUIDs generados de salida, ciphertext y reloj
  del servidor; éstos no cambian la intención. Canonización debe tener versión estable.

Cada replay verifica autoridad actual, tenant, recurso/capacidad y vigencia antes de
devolver resultado. Otra intención con igual key vigente da 409. Registro de resultado
y efectos se confirman juntos. Retención de replay propuesta 48 h (C-06), diferente
de vigencia de tokens y retención de auditoría. Después no prometer recuperación
exacta; cliente refresca y usa nueva key. No guardar secretos en `result/response_body`.

### Ciclo de manage_token recomendado — pendiente de aprobación

- Capacidad aleatoria de 32 bytes CSPRNG, base64url; nunca derivada de teléfono/email.
  Reutilizable y revocable, no single-use en cada reprogramación. Permisos limitados
  a consulta saneada y comandos públicos autorizados de esa reserva, no a catálogo
  privado, otros clientes o acciones administrativas.
- Hash SHA-256 de token de alta entropía, generación, reserva/tenant, expiración y
  revocación en datos privados. Comparación segura. No reutilizar token entre reservas.
- Propuesta de expiración: inicio vigente + 24 h como referencia V11, sujeta a aprobación.
  Reprogramación pública válida puede ajustar vigencia dentro de límites aprobados.
  Un token ya vencido/revocado nunca resucita por un cambio administrativo de fecha:
  requiere rotación y nueva generación explícitas.
- Estado terminal/cutoffs siguen aplicando aunque token no venza. Cancelled permite
  como máximo consulta saneada hasta TTL, no modificaciones; completed/no_show no
  habilitan corrección/liberación pública. Replay no restaura generaciones revocadas.

### Respuesta perdida, cifrado y autoridad anónima

Se propone conservar el secreto recuperable **cifrado**, además del hash de validación,
para replay de creación y entregas. AES-256-GCM con nonce nuevo, key_id y AAD que
vincule negocio, reserva, generación y expiración. Clave de cifrado fuera de Git/DB,
en configuración privada del servidor; keyring con rotación/lectura de claves antiguas
hasta agotar ciphertext y política de backups. Usar capacidades crypto del runtime;
no instalar dependencias en esta fase. No crear ni mostrar una clave ahora.

Guardar en replay/outbox sólo referencia a sobre cifrado privado de generación
inmutable, nunca token plano ni URL completa. UUIDs necesarios para AAD pueden
generarse en servidor antes de escribir y validarse en DB; no aceptar un tenant del
cliente como AAD autorizado. Nonce/ciphertext no forman parte del hash de intención.
Al recuperar, revalidar autorización, generación y TTL; sólo entonces descifrar en
memoria y responder/entregar. Ciphertext puede vivir hasta expiración del token para
avisos, mientras replay vive 48 h. Revocación invalida también entrega pendiente;
un replay antiguo no vuelve a entregar la capacidad revocada. Fallo de clave/decrypt
es error seguro sin fallback a plaintext. Pruebas de rotación/restauración obligatorias.

**El problema de autoridad anónima no lo resuelve el cifrado.** Conocer key, teléfono
y body no autoriza recuperar un token. Propuesta: capacidad de intento de creación
emitida automáticamente al abrir el formulario público, aleatoria, tenant/intento
acotados; browser la transporta en cookie HttpOnly, Secure en producción, SameSite
Lax con CSRF/origen. Persistir hash, no secreto. Antes de crear o replay verificar
esa capacidad y su relación con el registro. Mantenerla durante ventana de replay;
la creación inicial tiene ventana menor propuesta de 30 min. No es una cuenta/Auth
ni hace obligatorio email. Conservar la misma autoridad al reintentar la misma key;
una capacidad nueva no puede reclamar la operación anterior.
La operación debe verificar el secreto presentado contra el hash privado; no aceptar
un actor, un flag de verificación o un hash afirmado por el cliente como autoridad.
El secreto sólo atraviesa memoria/canal TLS de la operación revisada, sin persistencia
plana. Si la entrada usa app_server, únicamente RPCs con grants específicos y guard
de capacidad: no DML de tablas ni un setter de identidad compartido.

Protocolo exacto de emisión/rotación, múltiples pestañas/intentos, límites antiabuso y
cookie en despliegue deben aprobarse y probarse antes de S5/S6. Pérdida de cookie y
token no se recupera sólo con teléfono/key: requiere un canal verificado diseñado
separadamente. Si email es opcional, no prometer recuperación por email para todos.
No aprobar el replay de secretos hasta cerrar este guard de autoridad.

Token puede aparecer únicamente donde el usuario necesita recibirlo; evitar logs,
analítica, errores, cache compartida y Referer. Propuesta: enlace con fragmento y
canje a sesión/capacidad HttpOnly de gestión, limpiar URL tras canje, `no-store` y
Referrer-Policy restrictiva; revisar CSRF en cada comando. No guardar en localStorage.
Outbox transaccional no garantiza email exactamente una vez: entrega con deduplicación
del proveedor si existe, lease/ack y comportamiento de resultado incierto explícitos.

**Aceptación B-06.** Versiones por recurso/vector, replay tras cambio de versión,
rol revocado, key de otro usuario/tenant/capacidad, intención distinta, crash antes y
después de commit, token nunca plano en tablas/replay/outbox/logs, respuesta perdida
recuperable sólo con autoridad original, generación revocada no recuperable, expiración,
nonce/AAD alterados rechazados, rotación de clave, cookie perdida y doble pestaña.
No reutilizar tests de invitación como prueba suficiente de gestión pública.

## Catálogo de profesionales y servicios

**Profesional (staff).** Identificador UUID, negocio, membresía opcional del mismo
negocio, display_name, bio/foto y color validados, active, accepts_online, orden,
version y baja lógica. Propuesta: una membresía no dada de baja puede vincularse a
un solo staff activo por negocio. Staff sin cuenta es válido; no crear Auth users
automáticamente. Suspender membresía quita acceso pero no desactiva automáticamente
el calendario del profesional: decisión de producto explícita para evitar cancelar
reservas por un cambio de login. Alta/baja/eligibilidad usa raíz exclusiva.

**Servicio.** UUID, negocio, nombre normalizado, categoría opcional, precio entero
en centavos no negativo, moneda de configuración, duración/buffer, active, orden,
version y baja lógica. Proponer nombre único case-insensitive entre servicios vivos,
duración 5–480 min y buffer 0–120 min; rangos y default ARS requieren aprobación, no
se heredan silenciosamente de ejemplos. Normalización definida antes del índice.

**Relación staff_service.** Única por negocio/staff/servicio; ambos extremos del mismo
tenant. Overrides opcionales de precio/duración con mismos límites. Sólo servicio
activo, staff activo/online y asociación habilitada participan del catálogo público.
Modificar asociación usa versión staff; modificar servicio usa versión service y
revalidación de elegibilidad con raíz exclusiva. El servidor calcula precio y tiempos;
el cliente no impone snapshots. Baja lógica oculta para nuevas reservas y reporta
reservas futuras afectadas, sin cancelarlas ni borrar historial automáticamente.

**Aceptación B-CAT.** FKs cruzadas fallan, duplicados normalizados, límites/overrides,
staff sin Auth, baja con reservas futuras y actualización de servicio con snapshots
intactos. Proyección pública no devuelve membresía, notas ni datos internos.

## Modelo de clientes y relaciones

Cliente pertenece a **un negocio**, no es `public.users` ni identidad de login.
UUID, nombre, teléfono E.164 normalizado, email/Instagram opcionales, notas privadas,
origen controlado, consentimiento con versión/fecha y version/baja lógica.
Propuesta: teléfono único entre clientes vivos no fusionados del mismo negocio;
el mismo teléfono en otros negocios es independiente. Email no identifica ni autoriza
y no se hace único. Normalización AR debe acordarse con casos nacionales/internacionales
antes de elegir una librería en implementación; no sumar dependencia ahora.

Consentimiento operativo/privacidad separado de marketing; no inferir aceptación
por crear un cliente ni por email confirmado en Auth. Mostrar notas sólo en contexto
administrativo autorizado. Barbero accede a proyección mínima para sus reservas,
sin directorio completo ni notas globales por defecto. Contadores se derivan de
resultados/eventos, no de ocupación retenida; evitar que recalcularlos incremente la
versión de edición del perfil sin cambio de éste.

Fusión propuesta preserva referencias/historial y alias; merged_into debe ser del
mismo tenant, distinto y sin ciclos. No implementar merge hasta cerrar P-04 y
reconciliación de vínculos. Por ahora puede aprobarse el modelo base sin escritor de
fusión. Notas y datos personales no van en logs ni proyección pública.

| Relación                                      | Integridad propuesta                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| business → staff/service/customer/appointment | business_id obligatorio, padre existente; estado/baja revalidados por operación                                   |
| staff → business_member                       | Opcional; FK compuesta business_id,member_id; no relacionar por user_id sin tenant                                |
| staff_service → staff y service               | FKs compuestas en ambos extremos; unicidad por pareja dentro del negocio                                          |
| appointment → staff/service/customer          | FKs compuestas y snapshots históricos; no ON DELETE CASCADE que borre historia                                    |
| customer → merged_into                        | Mismo tenant, sin self/ciclo; protocolo de merge aún bloqueado                                                    |
| users → business_members                      | Perfil global existente, no agregar business_id ficticio a identidad; membresía controla acceso                   |
| mapeos externos futuros                       | Referencias tipadas con tenant; P-04/S10 separados, no crear credenciales ni esquema polimórfico por anticipación |

Toda relación de negocio exige clave candidata `(business_id,id)` donde corresponda.
RLS y FKs se complementan: una no sustituye a la otra. Escrituras por operación
revisada, DML directo denegado. Helpers RLS anti-recursión deben seguir inventariados;
FORCE RLS no evita bypass del owner de una función privilegiada.

**Aceptación B-CLI.** Dos negocios con mismo teléfono, duplicado dentro del negocio,
normalización equivalente, email opcional, cliente sin Auth, proyecciones por rol,
FK entre tenants rechazada y merge no accesible mientras esté bloqueado.

## Matriz canónica de permisos propuesta

Fuente futura única JSON de acciones/roles y guards enumerados; genera seed SQL y
proyección TS con tests de equivalencia. No SQL arbitrario en JSON ni wildcard owner.
Acción desconocida denegada. SQL comprueba identidad/membresía actuales y condiciones;
TS sólo permite presentar UI coherente. No otorgar acciones futuras sólo porque
aparecen en el catálogo. Migrar reglas S2 sin ampliar permisos requiere pruebas de
paridad; hasta entonces se conserva su implementación, sin dos autoridades divergentes.

O/A = owner/admin activos con aal2 salvo selector; B = barber activo. `Propio` significa
staff vinculado a la membresía actual, no staff_id afirmado por el cliente.

| Acción/contexto                        | O                    | A                                          | B                             | Restricción canónica                                                                           |
| -------------------------------------- | -------------------- | ------------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------------- |
| selector/summary                       | Sí, aal1             | Sí, aal1                                   | Sí                            | Proyección api.me actual; no configuración privada                                             |
| business.private.read / settings.write | Sí                   | Sí                                         | No                            | Settings.write sólo cuando exista operación aprobada                                           |
| members.read                           | Sí                   | Sí                                         | No                            | Mismo tenant, MFA                                                                              |
| members.invite/update/renew/revoke     | Sí                   | Sólo objetivos barber y rol destino barber | No                            | No autoedición; último owner protegido                                                         |
| members.auth_invite                    | Sí                   | Sólo invitación vigente barber             | No                            | Destinatario DB; C-07, no concede membresía                                                    |
| catalog.read interno saneado           | Sí                   | Sí                                         | Sí                            | Negocio activo; omitir campos administrativos                                                  |
| catalog.write / asignaciones           | Sí                   | Sí                                         | No                            | Raíz exclusiva; versiones de recursos escritos                                                 |
| calendar.global.write                  | Sí                   | Sí                                         | No                            | Control global y conflictos; sin cancelación implícita                                         |
| calendar.staff.write                   | Sí                   | Sí                                         | Propio si settings lo permite | Versión staff, ámbito validado en SQL                                                          |
| customers.directory/write              | Sí                   | Sí                                         | No por defecto                | Barber sólo alta/edición mínima dentro de reserva propia autorizada; no escritor independiente |
| customers.read contextual              | Sí                   | Sí                                         | Propio, mínimo                | Sin notas globales ni acceso por teléfono como identidad                                       |
| appointments.read/manage               | Sí                   | Sí                                         | Propio                        | Transición y política por comando; global override no viola integridad                         |
| appointments.correct/release           | Sí                   | Sí según ventana aprobada                  | No                            | Razón, versión y auditoría; P-02                                                               |
| público anónimo                        | No es rol de negocio | No es rol de negocio                       | No es rol de negocio          | Catálogo público; creación bajo límites; gestión sólo por capacidad verificada                 |
| worker/integración                     | No hereda owner      | No hereda owner                            | No hereda barber              | Job/capacidad/scopes propios; GAS R/B sólo lectura, escrituras bloqueadas P-08                 |

Campos objetivo como member_id y rol deseado son datos válidos; prohibir autoridad
forjada (`actor_user_id`, rol efectivo, bypass), no nombres de parámetros por regex.
`platform_admin` no implica acceso de negocio sin flujo de soporte aprobado.

**Aceptación B-PERM.** Matriz ejecutable por acción/rol/estado/MFA/tenant, guard propio
con dos profesionales y dos negocios, acciones desconocidas denegadas, paridad
SQL/TS/JSON, ningún grant de tabla a app_server, service_role sólo Auth Admin/Storage.

## Compatibilidad S1/S2 y alcance de aprobación

- Preservar las cinco migraciones y datos existentes; nuevas migraciones aditivas y
  reemplazos controlados de cuerpos, no recrear usuarios, negocio ni membresías.
- Mantener api.me, contratos S2 y proyección pública; C-08 limita Table API deliberadamente.
  No cambiar UUID audit, códigos 412, npm, carpetas, dependencias o identidad Merivo.
- Nuevas entidades no requieren autenticación de clientes ni nuevo rol de negocio.
  No implementar catálogo/agenda/reservas en esta fase documental.
- Cierre formal de P-02 requiere decisión de producto y diseño físico posterior.
  P-03 exige pruebas concurrentes antes de aprobar escritores, P-06 exige autoridad
  de replay/cifrado antes de exponer secretos. Aprobar texto no aprueba EXCLUDE ni S3-B.
- Integración mantiene barridos completos/reconciliación y GAS R/B; feed, escrituras
  GAS, soporte, pagos y nuevas capacidades no se incorporan a estos paquetes.

La [matriz](S3_A_APPROVAL_MATRIX.md) permite aprobar contratos por separado. El
[plan de migraciones](S3_B_MIGRATION_PLAN.md) distingue dependencias; no hay autorización
implícita para implementarlo al aprobar una sola fila.
