# Sprint 3 — propuesta de diseño y aprobación

Fecha: 2026-11-01. **Sin SQL nuevo, DDL ejecutable, migraciones creadas o cambios de aplicación.**
El próximo trabajo autorizable es S3-A documental. S3-B es una autorización distinta,
condicionada a decisiones y matriz aprobadas. El diseño físico dependiente de P-02
no queda aprobado ni se fija en este documento.

## 1. Resultado esperado y fronteras

Preparar una base operativa que reutilice las cinco migraciones S1/S2 y permita
construir catálogo, disponibilidad y motor posteriormente. No entregar todavía
CRUD funcional, reservas, autenticación nueva, GAS, workers o pantallas de agenda.
Preservar propietario, contraseñas, MFA, datos, logo/tema Merivo, npm y carpetas.

Entradas: V11/04 completo; V11/02, 05, 06, 08, 11; instrucciones explícitas de esta
revisión; [DECISION_REGISTER.md](DECISION_REGISTER.md) y evidencia actual. Los
fragmentos SQL ilustrativos de V11 no se copian como migración aprobada.

## 2. S3-A — decisiones que deben producir una matriz firmada por alcance

| Paquete de decisión  | Contenido mínimo                                                                                                                | Gate                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Compatibilidad S2    | PT/TS y code 412, If-Match fuerte, request_id, ETags/listados, locks preautorización, contrato de auditoría, permisos canónicos | Antes de ampliar handlers o helpers existentes                                   |
| P-02                 | Resultado vs ocupación, cancelación/expiración, liberación/corrección/reversión, permiso, ventanas, EXCLUDE y pruebas           | Antes del esquema de ocupación/appointments dependiente                          |
| P-03                 | Coordinación global/individual, recursos y orden completo, writers de catálogo y expiración, carreras de autorización           | Antes de diseñar hooks que condicionen escritores futuros                        |
| P-06                 | Control padre/global, intención+versión en replay, ciclo manage_token y respuesta secreta recuperable                           | Antes de columnas/control de versión y replay definitivos                        |
| P-04                 | FKs tipadas, unicidades, merge vs guard, candidates/import, vínculos y fase física                                              | Antes de DDL externo si se adelanta a S3                                         |
| Settings de atención | completion_early/no_show_grace/revert_window, defaults/temporales; diferenciar completed_at futuro de turno aún no iniciado     | Antes de columnas/defaults/constraints dependientes                              |
| P-05/P-08            | Sin feed S3; barridos por alcance; lectura GAS base y Modo A sin aprobación                                                     | No introducir contrato incremental ni credenciales de escritura como dependencia |
| Seguridad/ADR        | Matriz por objeto/rol/contexto; tipos de identidad global/tenant; namespaces de ADR; fuente JSON/SQL/TS                         | Antes de cualquier grant nuevo                                                   |

Entrega de S3-A: ERD aprobado sin ambigüedad, contratos de funciones/endpoints
futuros, tabla de cambios compatibles, pruebas por invariante y lotes de migración
con rollout/roll-forward. Toda decisión todavía abierta bloquea únicamente el lote
que la necesita, pero no permite llamar al S3 completo terminado.

## 3. Reutilización y compatibilidad de lo existente

| Objeto existente                       | Tratamiento propuesto                                                                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| businesses                             | Mantener ID/slug/datos, status/timezone y versión. Cambiar zona con reservas futuras requiere operación validada, no un PATCH genérico                                               |
| business_settings                      | Preservar todas las columnas y valores actuales; agregar sólo políticas aprobadas con defaults compatibles y posterior exposición controlada                                         |
| users/auth.users                       | Mantener identidad global y sincronización ya aplicada; ninguna fila nueva para clientes públicos                                                                                    |
| business_members                       | Mantener IDs, roles/estado, invitaciones y único compuesto; ampliar permiso sólo por función autorizada                                                                              |
| platform_admins                        | Mantener tabla deny-all; no agregar acceso de soporte implícito                                                                                                                      |
| audit_logs                             | Mantener UUID y snapshots actuales para consumidores S2; si se necesitan nuevos campos/índices, expansión compatible. No renombrar/reconvertir por copiar el tipo bigint del ejemplo |
| app.member_invitations/member_requests | No borrar ni reutilizar como idempotencia de reservas; definir limpieza futura sin tocar claves en curso                                                                             |
| Funciones/grants actuales              | Mantener catálogo y revocación global; si se sustituye helper, hacerlo por migración adicional y comprobar políticas dependientes                                                    |

No repetir bootstrap de propietario ni usar el reset como estrategia de adaptación.
Código antiguo debe seguir funcionando con esquema expandido y viceversa mientras
dure el despliegue. La migración contract se pospone hasta probar que no quedan
consumidores; esta tarea no autoriza ninguna de esas etapas.

## 4. Clasificación de objetos operativos

E = existentes; A = candidatos S3-B no dependientes de ocupación; B = bloqueados por
decisiones de agenda; I = integración diferible a S10; O = operaciones posteriores.
Todos requieren aprobación de implementación, incluso los candidatos A.

| Clase / objeto              | Campos/relaciones e invariantes a diseñar                                                                                  | Índices/restricciones/seguridad                                                                                                                                | Dependencia            |
| --------------------------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| E businesses/settings       | Tenant raíz, políticas y control de cambios                                                                                | Conservar únicos/PK/RLS; nuevo control global sólo aprobado                                                                                                    | Compatibilidad S2/P-06 |
| A staff_members             | ID, business, miembro opcional, nombre, activo/online, color, orden, baja lógica                                           | UNIQUE business,id; FK business,member a membership; vínculo único vivo; índices business/activo/orden. Lectura rol/own definida                               |
| A services                  | Nombre/descripción/categoría, precio en centavos, moneda, duración/buffer, activo/orden/baja                               | Nombre único por negocio normalizado, CHECK de límites/moneda aprobados, índice público elegible; no DML directo                                               |
| A staff_services            | Business + staff + service, overrides válidos                                                                              | FKs compuestas a ambos, unicidad de asociación, índice por service; control de versión padre aprobado                                                          |
| A customers                 | Nombre, teléfono E.164, email/Instagram opcionales, notas/consentimiento/marketing, source, baja/fusión                    | Único parcial por teléfono vivo/no fusionado y tenant; FK de merged_into al mismo tenant; impedir auto-fusión/ciclos en operación autorizada; índices búsqueda |
| B working_hours             | Staff, día ISO, intervalos locales, vigencias                                                                              | FK compuesta, orden horas/fechas y protección de solapes de vigencia por staff/día; lock bajo P-03; versión padre                                              |
| B schedule_exceptions       | Fecha local, staff opcional para global, closed/custom_hours, intervalos                                                   | Combinaciones de null correctas, cierre vs intervalos incompatibles; múltiples intervalos válidos; índices business/staff/fecha; control padre o global        |
| B time_blocks               | Rango absoluto finito no vacío [), staff opcional, motivo/tipo/baja                                                        | FK compuesta si hay staff, GiST rangos según plan, versión del recurso de control y locks globales/individuales                                                |
| B control de agenda global  | Recurso de versión para cierres/excepciones/bloqueos de negocio                                                            | Una autoridad de versión identificable por API; no inventar versión de un hijo inexistente ni mezclar cambios sin documentar                                   |
| B appointments y ocupación  | Customer/staff/service del mismo tenant, starts_at, snapshots, derivados, estado/resultado, capacidad de gestión y versión | EXCLUDE e integridad de ocupación quedan pendientes del cierre P-02; FKs, CHECK temporales y guards sólo tras aprobación                                       |
| B appointment_events        | Reserva y tenant, tipo, cambios previos/nuevos, actor/contexto verificado, requestId                                       | FK compuesta; append-only, orden por reserva/id; sin secretos de tokens; lectura admin/own acotada                                                             |
| B notifications             | Outbox de reserva/customer, canal/tipo, estado/lease/retry, scheduled_for, dedupe                                          | FKs compuestas, dedupe por tenant, índice de pendientes; deny-all para roles de usuario fuera de proyección autorizada                                         |
| B idempotencia de reservas  | Autoridad/capacidad, tenant/operación/key, hash de intención+versión, resultado seguro/TTL                                 | Unicidad completa aprobada, purga compatible con transacciones; cifrado/recovery pendiente P-06; no raw manage_token                                           |
| A/PP role_permissions       | Fuente canónica aprobada y proyección TS                                                                                   | SQL privado sin DML de app; tests equivalencia por rol/acción/own, denegación por defecto; no otorgar permisos de funcionalidades ausentes                     |
| I integration_credentials   | Tipo/token hash/scopes/expiry y miembro para user_token                                                                    | FK compuesta del miembro, CHECK lectura de service_key y validación por operación; no secretos ni emisión S3                                                   |
| I external_id_mappings      | Referencias tipadas por entidad; no internal_id sin FK                                                                     | Un único destino, FKs por tenant, únicos directo/inverso excepto customer; guard y excepción merge revisados                                                   |
| I candidatos/import         | Corrida, origen, candidatos sin vínculo confirmado, revisión/resultado                                                     | Representar destino aún desconocido sin vínculo falso; límites de tamaño, autorización, audit y recuperación de lote                                           |
| I corridas/reconciliación   | Alcance y finalización, versiones/proyección/tombstones                                                                    | Contrato convergente P-05; no confundir estado de corrida con un feed incremental                                                                              |
| O support_grants            | Plataforma, negocio, motivo, permisos y vencimiento                                                                        | MFA, acceso temporal/revocable/notificado/auditado; sin acceso implícito por ser platform_admin                                                                |
| O job_runs/leases           | Ejecución/reclamo/resultado y métricas                                                                                     | Datos mínimos y permisos de worker; decidir en S9/S12, no job HTTP abierto                                                                                     |
| Fuera change_log/feed_state | Alternativa V11 con xid8 no adoptada para MVP                                                                              | No incluir en lotes S3; reserva conceptual hasta prueba/aprobación explícita de feed                                                                           |

No presentar cliente con teléfono como identidad verificada. Validar E.164 de
almacenamiento no prueba propiedad del número ni autoriza acceso a historial.
El profesional puede existir sin cuenta; decidir cómo afecta una membresía suspendida
a su elegibilidad sin equiparar automáticamente suspensión de login con baja de agenda.

## 5. Propuesta de lotes de migraciones futuras

Son nombres de paquetes, **no archivos SQL ni timestamps reservados**.

| Lote  | Objetivo futuro                                                                    | Gate y verificación                                                                                    |
| ----- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| M3-01 | Compatibilidad/permisos compartidos y ampliaciones aprobadas de settings/auditoría | Decisiones S2 y catálogo; probar login/MFA/miembros antes/después y contrato estable                   |
| M3-02 | Catálogo staff/services/associations y customers                                   | Matriz/validaciones aprobadas; pgTAP tenant, únicos, baja, identidad inmutable, RLS/grants             |
| M3-03 | Recursos de calendario y versiones de padre/global                                 | P-03/P-06, semántica intervalos/excepciones; solapes y globals; sin RPC writable aún si no se autoriza |
| M3-04 | Reserva/ocupación e integridad temporal/snapshots                                  | P-02 y token P-06 físicos aprobados; EXCLUDE/history/derivados; no motor S6 encubierto                 |
| M3-05 | Eventos/outbox/replay aprobados y tipos generados de esquema                       | Compatibilidad referencial, secretos/TTL, append-only y error/actor contract; catálogo                 |
| M10-* | Credenciales/mapeos/candidatos y controles de reconciliación                       | Diferir a S10 propuesto; adelanto S3 requiere aceptación propia y deny-all, sin endpoints              |

Si M3-04 está bloqueado, se puede solicitar autorización sólo de M3-02; no se crea
un esquema placeholder inseguro ni se considera S3 completo. Un lote no debe referenciar
tablas futuras inexistentes; las dependencias FK determinan su orden real.
Estrategia expand → validar/backfill aprobado → activar wrappers → contract futuro.
Para convertir tipos/IDs existentes, primero justificación, consumidores, datos y
plan reversible; no asumir que la BD está vacía.

## 6. Funciones, propietarios y permisos a diseñar

| Superficie                                     | Dueño propuesto / llamada                                      | Contrato                                                                                   |
| ---------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| app helpers RLS                                | Propietario revisado; authenticated sólo excepciones acotadas  | Booleanos/proyecciones mínimos, auth.uid y membresía vigente/MFA apropiada, sin recursión  |
| app núcleo/contexto/autorización               | Privado, sin EXECUTE de roles API                              | Contexto derivado en wrapper; p_role deseado/ID destinatario no son actor autorizado       |
| api operaciones sesión                         | Definer revisado, EXECUTE sólo authenticated                   | Actor propio, selector tenant validado, permiso/own, versión, lock/eventos según operación |
| app_internal público                           | Definer revisado, EXECUTE sólo app_server                      | Slug/capacidad comprobados en BD, proyección fija y source/override/status no arbitrarios  |
| app_internal integración/worker                | Sólo al aprobar sprint correspondiente                         | Credencial/lease/job vigente, tenant derivado; no acceso a tablas de app_server            |
| Triggers de identidad/versionado/tiempos/audit | Sin grants públicos; invoker/definer justificado por necesidad | No autorizan actor desde GUC; no deben crear vía lateral un permiso de escritura           |

Mantener el propietario actual postgres donde se apruebe y reconocer que puede
saltear FORCE RLS; todo definer valida explícitamente. No es una orden de crear
roles nuevos ni de conceder privilegios de mantenimiento a la aplicación.

Para snapshots/merge, no basta un setter de GUC que el llamador pueda activar. La
operación privilegiada revalida permiso y contexto y controla el cambio; un flag
interno, si se usa, sólo diferencia una operación ya autorizada, con tests de llamada
directa y ausencia de DML. Diseñar catalogación de cada excepción, no bypass genérico.

## 7. Matriz de RLS/grants propuesta

| Familia                                  | authenticated                                                                      | anon / service_role / app_server                    | Escritura futura                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------- |
| Tenant y settings                        | Proyección privada según rol; revisar SELECT amplio heredado de S1                 | Sin acceso directo; público sólo proyección interna | api de owner/admin con MFA, versión y coordinación    |
| Staff/services/associations              | SELECT mínimo según miembro activo; no exposición de miembro privado al público    | Sin acceso directo                                  | RPC de catálogo revisadas S4                          |
| Calendario                               | Admin completo, own para barbero permitido; globals sin permiso de edición barbero | Sin acceso directo                                  | RPC S5 con control padre/global                       |
| Clientes y reservas                      | Admin del negocio; barbero sólo relación/agenda propia y columnas permitidas       | Sin acceso directo                                  | RPC S6; público sólo capacidad, no SELECT anon        |
| Eventos/auditoría                        | Sólo proyección autorizada admin/own; auditoría global sin acceso implícito        | Sin DML ni lectura rutinaria                        | Inserción por operación autorizada; append-only       |
| Notifications/replay/credenciales/mapeos | Deny-all por defecto, proyecciones por funciones cuando se habiliten               | Sin acceso directo                                  | Únicamente wrappers catalogados del sprint autorizado |
| Identidad/plataforma/control privado     | Conservar políticas específicas; no inventar business_id para identidad global     | Sin acceso directo                                  | Mantenimiento o operación explícita revisada          |

ENABLE/FORCE no obliga a inventar políticas abiertas: tablas internas pueden ser
deny-all con excepción catalogada. El test genérico de V11 debe reconocer esas
excepciones y verificar ACL real, no fallar por no tener una política permisiva.

## 8. API/UI y tipos: qué cambia en S3 y qué no

No crear endpoints de catálogo, disponibilidad, reserva o integración sólo por
generar sus tablas. Los contratos se diseñan ahora, se implementan por sprint.
Conservar /api/v1/public/{slug}, /me y miembros. La ampliación de proyección pública
requiere habilitación y tests de privacidad en su sprint.

Generar tipos desde una instancia aislada con el esquema aprobado, revisar el diff
y publicarlos sin incluir credenciales/fixtures. No confundir tipos con implementación
ni reemplazar interfaces actuales de forma que rompa S2. can TS seguirá presentando
permisos; la decisión autoritativa reside en operaciones SQL verificadas.

## 9. Plan de validación del futuro S3-B

1. Preflight read-only permitido y verificable sobre el destino **aislado** de prueba;
   no usar la BD del propietario. Aislar por proyecto/contenedor, no por una variable
   cuyo valor no se haya verificado. Datos sintéticos; nunca copiar secretos/PII.
2. Aplicar desde cero las cinco migraciones + lotes nuevos allí; ensayar upgrade de
   un estado equivalente a S2 con datos sintéticos. La reconstrucción debe estar
   autorizada y comprobada antes de cualquier reset de esa instancia descartable.
3. pgTAP: actores reales authenticated/anon/app_server, tenants A/B/multinegocio,
   activos/suspendidos, aal1/aal2, CRUD directo, funciones/grants/defaults y helpers.
4. Constraints: FK compuesta, únicos/baja/fusión, rangos [), límites y derivados,
   snapshots, eventos/audit inmutables, ocupación histórica y liberación aprobada.
5. Concurrencia: tests específicos de constraints/locks si se habilitan escritores;
   no afirmar protocolo entero S6 sólo por constraints aislados. Ningún hook de prueba
   permanente en producción; fallos inyectados dejan estado completo original.
6. Regresión: unit, API S1/S2 y E2E dev/producción; landing sin configuración activa;
   compatibilidad cookies/MFA/equipo y proyecciones. Revisar nuevos chunks sin secretos
   sólo con herramientas autorizadas y sin imprimir valores.
7. lint/format/typecheck/build, db lint y catálogo. CI remoto y staging cuando estén
   autorizados; si faltan, registrar límite y no certificar DoD global.
8. Roll-forward y fallback compatibles; conservar copias/backup verificados antes
   de cambios con datos. No editar migraciones aplicadas para hacer pasar pruebas.

## 10. Checklist para solicitar la próxima autorización

- [ ] Aceptar la precedencia y enumerar excepciones de V11; no copiar su plantilla AGENTS.
- [ ] Aprobar **S3-A sólo documental**, o confirmar que se aprueban decisiones concretas de esta propuesta.
- [ ] Resolver P-02 A completa y su representación futura; sin aprobar por inferencia.
- [ ] Resolver P-03/P-06 y contrato token/replay antes de los objetos dependientes.
- [ ] Elegir fuente/matriz de permisos y catálogo semántico con excepciones legítimas.
- [ ] Elegir compatibilidad S2/auditoría/HTTP y autorizar separado cualquier reparación de código.
- [ ] Confirmar S3 base vs S10 para mapeos, credenciales y candidatos; sin feed obligatorio.
- [ ] Aceptar lista exacta de lotes, tablas, índices, funciones/grants y pruebas para S3-B.
- [ ] Preparar entorno aislado, backup/recuperación y verificación de destino sin tocar al propietario.
- [ ] Obtener autorización explícita de **S3-B** y revisión SQL antes de crear migraciones.

**Próximo trabajo propuesto:** S3-A de cierre de diseño, acotado a documentación y
decisiones. **Próximo trabajo autorizado ahora:** finalizar esta revisión y entregar
los seis informes; no comenzar otra fase ni modificar las guías históricas.
