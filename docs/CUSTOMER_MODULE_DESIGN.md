# Clientes — contrato técnico propuesto

Fecha: 2026-11-01. Estado: diseño para aprobación, **sin autorización de implementación**.
No contiene SQL ejecutable. Decisiones pendientes: [registro](CUSTOMER_DECISIONS_PENDING.md).
Permisos: [matriz](CUSTOMER_PERMISSION_MATRIX.md); DDL futuro: [lotes](CUSTOMER_MIGRATION_PROPOSAL.md);
verificación futura: [pruebas](CUSTOMER_TEST_PLAN.md).

## 1. Precedencia y decisiones establecidas

Las seis decisiones de esta solicitud prevalecen sobre ejemplos históricos:

| ID establecido | Contrato obligatorio                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| E-01           | Teléfono, email e Instagram pueden repetirse dentro y fuera de un negocio. Sin índices únicos ni upsert/match de identidad por contacto.       |
| E-02           | Gestión operativa de reservas y marketing voluntario son finalidades separadas. Negarse a marketing no bloquea la ficha ni una futura reserva. |
| E-03           | Barber sin directorio ni ficha en este bloque. Acceso futuro sólo mediante reserva propia comprobada; no crear assigned_barber_id.             |
| E-04           | Customer no es usuario Auth y no requiere cuenta, sesión ni verificación de contacto para existir.                                             |
| E-05           | PostgreSQL es la fuente de verdad; ninguna hoja, caché o contacto declarado acredita identidad.                                                |
| E-06           | Sin merge, importaciones GAS, alias, vínculos externos ni motor de reservas en este bloque.                                                    |

Todo contrato adicional de este documento es **propuesta**, identificado por CD-xx
en el registro. El título de diseño no implica aprobación de campos, permisos o SQL.

## 2. Compatibilidad comprobada en fuentes

Se inspeccionaron AGENTS, arquitectura-v1.1, propuestas S3-A y los informes S2,
catálogo y activación posteriores. No se consultó ninguna base de datos.

| Evidencia de repositorio                                                    | Consecuencia de diseño                                                                                                                                                    |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| arquitectura-v1.1/01 §1 y 04 §3.12; propuesta S3-A, «Modelo de clientes»    | Su teléfono como identificador/único queda reemplazado por E-01. UUID identifica la ficha; ningún contacto resuelve identidad. No se editan esos documentos históricos.   |
| arquitectura-v1.1/04 §3.12 y 05; S3-A B-CLI                                 | marketing_opt_in + consented_at no bastan para revocaciones/evidencia. Se propone registro privado de eventos; no se copian contadores, merged_into ni fuente import_gas. |
| 20261101000100, app.require_member, líneas 81–101                           | Identidad auth.uid, email confirmado, negocio/perfil/miembro activos y aal2 para privilegios. Usar p_manage=true también en lecturas de clientes para negar barberos.     |
| 20261101000500, app.lock_managed_business, líneas 4–15                      | Raíz UPDATE exclusiva, reautorización y READ COMMITTED; no adoptar directamente el orden staff→appointment de la guía antigua ni introducir SHARE/upgrades.               |
| 20261101000600, app.current_request_id; public.audit_logs en 20261101000100 | UUID por intento y auditoría transaccional con metadatos, no contacto/nota/evidencia. Request ID no es Idempotency-Key.                                                   |
| 20261101000700, api.list_members_page                                       | Keyset real 50/200, cursor validado dentro de SQL, reautorización por página. No alterar endpoint legado de miembros.                                                     |
| 20261101000800 y 20261101000900                                             | TTL lógico de replay 48 h, purga privada ≤500, SKIP LOCKED, recurso UUID estable, versiones y proyecciones explícitas. No reutilizar ledgers de miembros o catálogo.      |
| src/modules/auth/service.ts, rpc                                            | PT400/401/403/404/409/412/428; 23514 seguro 500 y 23505→409. No adoptar catálogo TSxxx de ejemplos ni cambiar errores S2.                                                 |
| src/modules/auth/permissions.ts; catálogo SQL 20261101000900                | Capacidades TS finitas/default deny y guardas SQL reales; no hay registro JSON general de permisos implementado. Extensión acotada, sin refactorizar S2.                  |
| LOCAL_CATALOG_ACTIVATION_REPORT.md                                          | Doce migraciones aplicadas según informe; catálogo local activado. No se recertifica ejecutando db.                                                                       |

No hay tablas de clientes ni reservas en las doce fuentes de migración actuales.
Los tests reportados del catálogo son evidencia histórica, no pruebas de este diseño.

## 3. customers propuesto — CD-01/CD-03

Tabla public.customers, sin relación con auth.users ni public.users. Sólo nombre
obligatorio; contactos opcionales para evitar datos ficticios al dar altas presenciales.
Una reserva futura podrá exigir contacto según su propio contrato, aún no aprobado.

| Campo                  | Tipo / nulabilidad | Restricción o responsabilidad                                                                                                                               |
| ---------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                     | uuid, NN, PK       | UUID v4 estable del comando de alta; no default que produzca otra ficha en un reintento. Inmutable.                                                         |
| business_id            | uuid, NN           | FK businesses; inmutable, validado por sesión. UNIQUE(business_id,id) para hijos futuros.                                                                   |
| full_name              | text, NN           | Trim + NFC, 1–120 caracteres Unicode, sin controles. No unicidad.                                                                                           |
| phone_raw              | text, NULL         | Entrada declarada y limpia, hasta 64 caracteres; no implica propiedad.                                                                                      |
| phone_e164             | text, NULL         | Derivado por normalizador SQL, nunca aceptado del body. Forma internacional sintáctica conservadora, no garantía de asignación/alcance.                     |
| phone_status           | text, NN           | missing / international / needs_review. Coherente con raw/e164; sin estado verified.                                                                        |
| normalization_version  | text, NN           | Valor fijo customer-contact-v1 derivado del servidor. Cambiar algoritmo requiere pruebas/migración aprobadas, no renormalización silenciosa.                |
| email                  | text, NULL         | Trim, máximo 254; sintaxis validada, sin consulta DNS ni prueba de titularidad. Preservar local-part.                                                       |
| instagram_handle       | text, NULL         | Sin @ inicial, ASCII letras/dígitos/._, 1–30 como límite de producto propuesto; no URL ni garantía de cuenta existente. Sin unicidad.                       |
| private_notes          | text, NULL         | Trim/NFC, máximo 2000; sólo detalle administrativo. Advertir que no se ingresen salud ni datos sensibles.                                                   |
| source                 | text, NN           | admin_panel / admin_api; derivado del wrapper confiable, no parámetro que concede privilegios. No public_web/import_gas en esta etapa.                      |
| marketing_revision     | integer, NN        | Empieza en 1; sube al cambiar un contacto almacenado o archivar. Invalida alcance de consentimientos antiguos sin borrarlos. No se cambia desde el cliente. |
| version                | integer, NN        | >0, empieza en 1; app.touch_record en cada UPDATE aprobado.                                                                                                 |
| created_at, updated_at | timestamptz, NN    | Servidor; created_at inmutable.                                                                                                                             |
| deleted_at             | timestamptz, NULL  | Baja lógica. current si NULL; archived si no NULL. No segundo booleano active contradictorio.                                                               |

Longitudes de textos en puntos de código Unicode después de normalizar, como
char_length PostgreSQL; Zod necesita el refinamiento equivalente, no contar unidades
UTF-16 por defecto. Rechazar controles salvo tab/newline en notas/evidencia. Email
propuesto ASCII: local-part 1–64 con letras/dígitos y . _ % + -, sin punto inicial,
final ni consecutivo; dominio con al menos dos labels de 1–63, letras/dígitos/guion,
sin guion inicial/final y máximo total 254. Sin quoted local-parts, EAI ni conversión
IDNA silenciosa. Es un subconjunto de producto, no validación completa de RFC/DNS;
la misma regla debe existir en Zod y SQL y requiere aprobación CD-01/CD-03.

Campos auxiliares derivados name_search, phone_search_digits, email_search e
instagram_search de tipo text, con normalización estable SQL. No se devuelven como
atributos de identidad. Para email, lower sólo en índice/búsqueda, no para equiparar
personas o afirmar equivalencia de buzones.

Índices propuestos no únicos, siempre tenant primero: (business_id,created_at,id)
parcial para actuales y otro para archivados; name_search con text_pattern_ops;
phone_e164; phone_search_digits con text_pattern_ops; email_search e instagram_search
con text_pattern_ops. Sin pg_trgm, unaccent, extensiones/dependencias nuevas o GIN
en el mínimo. Medir EXPLAIN con fixtures antes de agregar índices redundantes.
PK y clave compuesta son las únicas unicidades de customers.

Estado: crear→current; current→archived; archived→current. PUT sobre archivado: 409;
archivar archivado/restaurar actual con key nueva: 409. Replay válido puede devolver
el resultado original sin reaplicar la transición. No DELETE, anonimización ni merge
en esta API. Una baja no es supresión legal y no cancela reservas futuras.

## 4. Normalización y posibles duplicados — CD-03

Normalizador determinista en PostgreSQL; TS/Zod anticipa errores con los mismos
vectores, pero SQL vuelve a validar. Sin llamadas de verificación bajo locks.

1. Vacío después de trim→NULL/missing. Conservar número como texto, nunca integer.
2. Aceptar dígitos ASCII y separadores de presentación espacio, paréntesis, guion
   y punto; un único + al inicio. Letras, extensiones, controles y múltiple +→400.
3. Retirar sólo esos separadores para evaluar forma. Con + explícito, primer dígito
   1–9, longitud de producto 8–15 dígitos: candidato international. El mínimo 8 es
   una propuesta restrictiva de producto, no una regla universal E.164.
4. Para +54 aceptar como candidato sólo 10 dígitos nacionales, o 9 seguido de 10;
   otras longitudes plausibles se conservan needs_review con e164 NULL. No verificar
   áreas, operador, existencia o modalidad móvil por heurística.
5. Sin + explícito, conservar raw y dígitos como needs_review, e164 NULL. No agregar
   +54/9, quitar 0/15, interpretar 00 como internacional ni inferir área desde negocio.
6. Nunca equiparar automáticamente +54 fijo y +549 móvil ni dos cadenas nacionales
   ambiguas. Los índices y coincidencias son ayudas, no prueba de titularidad.

| Entrada ilustrativa, no fixture real | Resultado propuesto                                             |
| ------------------------------------ | --------------------------------------------------------------- |
| +54 9 11 2345-6789                   | +5491123456789, international, sin verificación de propietario. |
| +54 (11) 2345-6789                   | +541123456789; distinto del anterior.                           |
| 011 15 2345-6789 / 15 2345-6789      | needs_review, e164 NULL, sin inferir correspondencias.          |
| 0054 9 11 2345-6789                  | needs_review; no convertir 00.                                  |
| +1 (202) 555-0100                    | +12025550100, sólo forma sintáctica.                            |
| texto / +54... interno 2 / ++54      | 400; no descartar silenciosamente extensiones.                  |

ITU fija el máximo internacional de 15 dígitos. La numeración argentina documenta
el 9 de llamadas internacionales móviles; eso no justifica convertir automáticamente
cadenas locales ambiguas. Fuentes: [ITU E.164](https://www.itu.int/rec/T-REC-E.164/en),
[resolución argentina 124/2002](https://www.argentina.gob.ar/normativa/nacional/resoluci%C3%B3n-124-2002-76914/texto).
Los rangos/heurísticas anteriores siguen siendo propuestas de aplicación CD-03.

Posibles duplicados: usar la búsqueda administrativa exacta de contactos o prefijo
de nombre, devolviendo todas las coincidencias paginadas. Mostrar «Hay otras fichas
con este contacto; puede ser compartido». Permitir continuar el alta sin override
ni 409 por teléfono/email/Instagram. No tabla de candidatos persistente, scoring,
fusión, selección automática ni resultado singular «cliente identificado».
Dos altas deliberadas con UUID diferentes pueden representar dos personas iguales
en nombre/contacto; idempotencia sólo deduplica el mismo comando.

## 5. Marketing privado y auditable — CD-07/CD-08

Propuesta mínima: eventos append-only y proyección calculada, sin booleano mutable
marketing_opt_in en customers ni copia de evidencias en audit_logs. Canal inicial
propuesto: email únicamente, sin envíos ni proveedor. SMS/WhatsApp/Instagram no se
habilitan por reservar campos o por registrar un teléfono.

### Avisos versionados: app.customer_privacy_notices

id UUID PK; business_id NN/FK; purpose operations o marketing; notice_version text
1–64; locale es-AR; content_text 1–20000; content_sha256 bytea de 32 bytes calculado;
published_at timestamptz del servidor; created_by uuid NN/FK public.users, responsable
owner de publicación identificado y validado por mantenimiento autorizado. No se
acepta ese actor desde una RPC de aplicación ni se crean usuarios para publicar.
UNIQUE(business_id,purpose,notice_version) y clave (business_id,id,purpose). Texto,
hash y versión inmutables; nueva redacción=nueva fila. Índice tenant/purpose/
published_at/id. No activar avisos futuros por reloj: sólo publicar avisos aprobados.
El aviso actual es el último publicado por propósito, orden published_at/id, bajo
la misma raíz. Preparación inicial mediante mantenimiento autorizado, no endpoints
de edición ni seed de textos legales inventados.

El aviso operativo informa tratamiento, responsable y derechos; no equivale a
aceptar marketing. No registrar accepted=true porque un administrador creó una ficha.
Este bloque no registra una reserva ni prueba que el aviso operativo fue mostrado
al titular: ese flujo corresponde a una etapa futura.

### Evidencia: app.customer_marketing_events

| Campo                                      | Contrato propuesto                                                                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| id                                         | UUID v4 estable de evento/comando, PK; no reutilizable tras purga de replay.                                                                                                      |
| business_id, customer_id                   | NN, FK compuesta a customers; no cascada destructiva.                                                                                                                             |
| channel, purpose                           | email y marketing en este bloque; CHECK finitos.                                                                                                                                  |
| consent_version                            | Integer ≥2, UNIQUE(business_id,customer_id,channel,consent_version). Versión del agregado independiente de customer.version.                                                      |
| decision                                   | granted / revoked; no evento granted implícito al crear ficha.                                                                                                                    |
| marketing_revision                         | Copia del epoch vigente de customers, derivada bajo lock.                                                                                                                         |
| notice_id, notice_purpose                  | Para granted: aviso marketing actual obligatorio, FK (business_id,notice_id,notice_purpose). Para revoked puede ser NULL; nunca exigir aviso nuevo para retirar.                  |
| source                                     | in_person_statement / written_request, declaración administrativa controlada. No actor/token/canal externo afirmado.                                                              |
| evidence_kind                              | operator_attestation; no verificación independiente ni firma del titular.                                                                                                         |
| evidence_summary                           | Texto privado 1–500 para grant, opcional para revoke; sin adjuntos, URLs, tokens, documentos de identidad ni copia de mensajes completos. Su suficiencia requiere revisión legal. |
| actor_user_id, actor_member_id, actor_role | Servidor: auth.uid y miembro actual owner/admin. FK usuario existente y FK compuesta negocio/miembro; no aceptar del body.                                                        |
| request_id, recorded_at                    | UUID por intento y clock_timestamp del servidor; no backdating desde el body.                                                                                                     |

Además: UNIQUE(business_id,id), índice (business_id,customer_id,channel,consent_version
DESC) para estado e índice (business_id,customer_id,recorded_at,id) para historia.
UPDATE/DELETE/TRUNCATE sin grants; guard de inmutabilidad; mantenimiento ordinario no
borra evidencia. Una política legal de supresión futura requiere diseño independiente.

No se necesita tabla mutable de estado: sin eventos→versión virtual 1/not_recorded;
último evento por consent_version→estado registrado y versión. Nueva decisión
aceptada agrega evento con versión anterior+1, incluso si repite granted/revoked
con key nueva; replay no agrega nada. La raíz y lock customer serializan esa versión.
No usar app.touch_record sobre eventos inmutables.

La proyección distingue recorded_status y applicability. Un grant sólo es aplicable
al contexto registrado si la ficha está actual, coincide marketing_revision y no hay
revocación posterior. Un cambio de contacto o archivo invalida ese contexto; restaurar
o volver al contacto previo no lo reactiva. No generar revocaciones ficticias en nombre
del cliente: conservar el evento y señalar contact_changed_or_archived. Un cambio de
nombre/notas no altera marketing_revision. Este criterio conservador afecta a todos
los contactos aunque el canal inicial sea email; debe aprobarse expresamente.

Grant exige email presente, ficha actual y evidencia nueva. Revoke se permite aun
archivada o sin email; no exige evidencia positiva ni propiedad del teléfono. No
transferir decisiones entre fichas que comparten contactos. Ni grant ni applicability
autorizan envíos: propiedad, destinatarios compartidos y supresión por canal quedan
pendientes antes de cualquier funcionalidad comercial.

## 6. Escrituras, versiones y replay — CD-05/CD-06

Protocolo propuesto, sin modificar helpers existentes:

1. Verificar sesión; app.require_member(business,true). Para evidencia owner-only,
   comprobar ese rol expresamente. business_id es selector, no autoridad.
2. Validar forma del comando sin consultar estado sensible. Tomar raíz con
   app.lock_managed_business, READ COMMITTED y revalidar capacidad concreta.
3. Lock de app.customer_requests por scope; decidir TTL con clock_timestamp **después**
   de adquirirlo. Luego customer FOR UPDATE. Marketing usa ese mismo lock y consulta
   último evento; no toma locks de staff, servicios ni miembros después de customer.
4. Replay vigente: reautorizar recurso/capacidad, comparar intención y devolver sólo
   metadatos originales, antes de versiones. Recurso ausente→404. Una respuesta antigua
   no declara estado actual: UI vuelve a leer. Si fue archivado, replay no lo restaura.
5. Comando nuevo: existencia, precondiciones y luego estado/referencias. PUT/archive/restore
   exigen customer.version. Marketing exige su versión y customer.version observado.
   Sin esperada→428; obsoleta→412; transición incompatible→409. No retry automático 412.
6. Mutación/evento, audit_logs y replay en una transacción; cualquier fallo revierte
   todo. Cero I/O externo bajo locks. Una única actualización del perfil por comando.

app.customer_requests propuesto: business_id, user_id, operation finita, key UUID,
canonical_version=1, request_hash bytea, result JSON de metadatos, origin_request_id,
created_at de reloj servidor; PK(business_id,user_id,operation,key). Operaciones:
customer.create/update/archive/restore, customer.marketing.grant/revoke. TTL de 48 h
propuesto como en catálogo, no heredado sin aprobación. Purga invoker privada 1–500,
SKIP LOCKED, sin raíz posterior ni scheduler, sin tocar clientes/evidencia/auditoría.

Hash canónico SQL incluye versión de canonización, negocio, actor, operación, UUID
estable de recurso/evento, payload normalizado y todas las versiones esperadas.
NULL/vacío se normalizan según schema, claves desconocidas se rechazan. Hash privado
no se trata como anonimización de PII ni se expone en logs. No copiar notas/evidencia
en result. Auditoría sólo IDs, acción, versiones, flags de campos modificados y
request_id; nunca valores/contactos/notas/evidence_summary/cuerpo de búsqueda.

Tras expiración/purga, crear con mismo customer UUID produce 409 aunque esté archivado;
update/marketing con versión antigua producen 412. El UUID de evento no puede volver
a insertarse. Reenviar un grant antiguo tras revoke/contacto cambiado nunca reactiva
marketing. Cada intención nueva requiere versión vigente; no autorización por key.

## 7. API REST y Zod propuestos — CD-04

Base `/api/v1/businesses/{businessId}/customers`; respuestas private/no-store,
X-Request-Id UUID. Sesión cookie: mismo origen en POST/PUT; Bearer verificado. No claves
service_role ni app_server en este módulo. Los DTO y bodies son listas explícitas;
body strict rechaza business_id, actor, versiones internas, phone_e164 y propiedades
de marketing mezcladas con perfil. Límite body 100000 bytes como readJsonBody actual.

| Método / sufijo                                   | Entrada y salida                                                                                                                                                                                           |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET base                                          | state=current(default)/archived, limit=50 (1…200), cursor opcional. Lista mínima paginada; nunca contactos en query de URL.                                                                                |
| POST /search                                      | Body field=name/phone/email/instagram, mode=prefix/exact, value, state, limit, cursor. Igual paginación; lectura sin Idempotency-Key ni mutación. Evita PII en historial/URL; logs tampoco registran body. |
| POST base                                         | {id,data:{full_name,phone_raw,email,instagram_handle,private_notes}}. UUID estable, key UUID; 201 con metadatos y ETag de perfil. Sin consentimiento implícito.                                            |
| GET /{id}                                         | Detalle administrativo, ETag perfil. Archivado accesible explícitamente; no prueba identidad por contacto.                                                                                                 |
| PUT /{id}                                         | Sustitución completa de campos editables; opcionales ausentes→NULL, nombre obligatorio. If-Match y key. 200 metadatos.                                                                                     |
| POST /{id}/archive o /restore                     | Body vacío {}, If-Match y key; 200 metadatos. Sin DELETE.                                                                                                                                                  |
| GET /{id}/marketing-consent                       | Estado resumido, applicability y versión independiente; owner/admin. ETag del agregado.                                                                                                                    |
| POST /{id}/marketing-consent                      | {event_id,decision,customer_version,source,evidence_summary,notice_id?}; If-Match de consentimiento y key. Grant/revoke explícitos, 200 metadatos del evento; nunca perfil+marketing en un comando.        |
| GET /{id}/marketing-consent/events                | Historia paginada owner-only, evidencia explícita; 50/200, cursor propio ligado al cliente.                                                                                                                |
| GET /privacy-notices?purpose=operations/marketing | Texto/versión vigente que puede mostrarse al cliente; owner/admin, sin endpoints de publicación. No endpoint anónimo nuevo.                                                                                |

Zod strict refleja tipos/rangos anteriores, UUID v4, enteros seguros ≤2147483647,
If-Match como entero positivo entre comillas. customer_version de marketing ausente
se conserva como precondición faltante para SQL (428 después de autorización), no
se sustituye por el valor vigente. Crear con If-Match no está admitido (400).
Nombre búsqueda trim/NFC 2–120, teléfono 4–64 dígitos/separadores con la misma
normalización, email 3–254, Instagram 2–30. En exact también se exige mínimo para
evitar enumeración amplia accidental; búsqueda vacía se hace por GET listado.
Escapar %, _ y backslash al construir prefijos; ningún SQL dinámico desde field/mode.

DTO lista: id, full_name, phone_raw, phone_e164, phone_status, email, instagram_handle,
version, created_at, deleted_at. Sin notas, evidencia, marketing ni contadores.
Detalle agrega private_notes, source, updated_at. Respuesta de escritura sólo id,
business_id, version, deleted_at; marketing sólo event_id, customer_id, consent_version,
recorded_decision. La UI hace GET posterior; replay no devuelve PII histórica.

### Paginación y errores

Keyset ascendente (created_at,id), inmutables, limit+1; sin OFFSET ni truncamiento.
Cursor base64url máximo 1024: v=1, business_id, created_at UTC finito (microsegundos),
id y filter_hash de field/mode/value normalizados/state. SQL vuelve a derivar hash;
no incluye consulta literal ni PII en claro. Sigue siendo dato sensible/pseudónimo,
no se registra. Listado vacío tiene filtro canónico propio. Cursor de historia
incluye también customer_id y canal. Cambiar filtros exige reiniciar; tenant/filtro/
recurso distintos o cursor inválido→400 después de autorización.

Cursor no firmado, igual al patrón S2: selector no confiable, nunca permiso. Un
miembro autorizado puede saltar posiciones de su directorio; no evita RLS/guardas.
No prometer snapshot, feed incremental ni export completo consistente: altas
concurrentes y cambios de estado/filtro pueden alterar páginas. Reautorizar cada
página; no cargar todo el directorio para filtrar en el navegador.

Orden para rutas sintácticamente válidas: identidad → membresía/MFA/capacidad →
validación de forma → recurso → replay autorizado → precondiciones → estado. No
consultar existencia/versiones para un barber. Paths/JSON ilegibles pueden dar 400
sin revelar recursos. 401 sin sesión; 403 MFA/permisos; 404 negocio ajeno/miembro
inactivo/recurso ausente; 428/412 versiones; 409 key con otra intención, UUID existente
o transición incompatible. **Contactos compartidos nunca son DUPLICATE_RESOURCE.**
PT400 etc. explícitos; CHECK 23514 desconocido→500 interno seguro, jamás LAST_OWNER.
Fallo de conectividad→503 según adaptador actual. No exponer error.detail, SQL ni PII.

## 8. UX administrativa propuesta — CD-02/CD-04

`/app/{businessId}/clientes`: acceso sólo owner/admin con MFA desde el negocio.
Merivo: BrandLogo original, fondo carbón, tarjetas oscuras, acción rubí, foco dorado,
tipografía y controles existentes. Tabla/lista móvil con nombre, contactos declarados,
estado de teléfono y acción Abrir; 50 filas y siguiente/primera página. Búsqueda por
campo con envío POST y estado en memoria, no query de contacto en URL/localStorage.
Estado loading/vacío/error/permiso y navegación por teclado; targets ≥44 px.

Ficha: formulario de datos separado de notas internas y sección de marketing.
Contacto compartido muestra advertencia informativa, nunca validación bloqueante.
Archivo confirma conservación de datos e invalidación de contexto comercial;
restauración no vuelve a consentir. Conflicto 412 ofrece recargar y conservar borrador
en memoria, sin sobreescribir silenciosamente. No historial de visitas, total gastado,
no-show, estrellas ni fechas ficticias. No tab ni enlace de clientes para barber.

Marketing por defecto «Sin registro». No checkbox preseleccionado ni autorización
incluida en Guardar ficha. Grant abre aviso/version, fuente y declaración explícita;
revoke es accesible sin completar datos faltantes. Admin ve estado mínimo; evidencia
histórica sólo owner. Mostrar «Declaración registrada por un administrador», nunca
«titular verificado». No botón de enviar campañas ni exportar contactos.

## 9. Privacidad y revisión legal — CD-08/CD-09

Los avisos deben identificar responsable, finalidades, destinatarios y canales de
ejercicio de derechos. La base jurídica del tratamiento operativo y la suficiencia
de la evidencia de marketing requieren revisión legal; no se deducen de una reserva,
del login del operador ni del simple conocimiento de un teléfono. La Ley 25.326
aborda finalidad/calidad, consentimiento/información y derechos; su reglamentación
complementa el régimen publicitario. Fuentes oficiales para esa revisión:
[Ley 25.326, arts. 4–6, 14–16 y 27](https://www.argentina.gob.ar/normativa/nacional/ley-25326-64790/actualizacion),
[Decreto 1558/2001](https://www.argentina.gob.ar/normativa/nacional/70368/actualizacion).

Propuesta técnica: inventario por clase (ficha, notas, evidencia, auditoría, replay,
backups), plazos aprobados y procedimiento de acceso/rectificación/supresión con
verificación proporcional por canales independientes del contacto compartido.
No inventar un plazo universal de conservación ni heredar TTL de replay para datos
personales. Baja lógica no satisface una solicitud de supresión. Auditar metadatos
no los vuelve anónimos: UUID/actor siguen siendo datos vinculables. Definir borrado
o disociación y propagación a respaldos/proveedores antes de operación real.

No publicar endpoint de derechos, exportación masiva ni borrado legal improvisado.
El circuito manual, responsable, avisos y plazos son gates previos al uso con datos
reales; fixtures sintéticos bastan para desarrollo tras aprobar el contrato técnico.
Estos controles no autorizan marketing ni afirman cumplimiento legal automático.
