# Clientes — lotes de migración propuestos

Fecha: 2026-11-01. Estado: **plan no ejecutable**. No archivos SQL nuevos, DDL ni
operaciones db autorizadas. Sólo se proponen lotes para aprobación independiente.

Decisiones establecidas E-01…E-06 y contratos en [diseño](CUSTOMER_MODULE_DESIGN.md).
Condiciones de aprobación en [registro](CUSTOMER_DECISIONS_PENDING.md) y aceptación
en [pruebas](CUSTOMER_TEST_PLAN.md). Las elecciones CD-xx son propuestas, no permisos.

## 1. Base inmutable y evidencias

Doce fuentes de migración presentes, desde init_tenancy hasta
20261101000900_create_professional_service_catalog. El informe de activación confirma
doce aplicadas localmente; en esta tarea no se usa CLI, Docker, SQL ni conexión
para verificarlo. No editar las cinco iniciales ni las siete posteriores. No tocar
datos ni cuentas/MFA/invitaciones. Los hashes de las doce fuentes se verifican como
archivos, junto con el resto del repositorio, al cerrar esta entrega documental.

Se conserva public.audit_logs, app.member_requests, app.catalog_requests y sus
retenciones/funciones; no agregar operaciones clientes a sus CHECK ni reemplazar
cuerpos de app.manage_member o app.write_catalog. customers no necesita alterar
staff_members/services ni introducir una tabla appointment ficticia.

## 2. Lotes propuestos

Los nombres son identificadores de revisión, **no nombres de archivos generados**.
La fecha/versiones reales se asignarán después de nueva inspección y autorización.

| Lote                                 | Objetos propuestos                                                                                                                                                                       | Gates previos                                                           | Aceptación antes de habilitar                                                                                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CM-01: ficha y seguridad cerrada     | public.customers, índices no únicos tenant-first, normalizadores puros privados, app.touch_record, marketing_revision derivado, RLS deny-all/revokes; app.customer_requests e índice TTL | CD-01/03/05/06; E-01 sin excepciones                                    | Tipos/límites, UUID estable, teléfonos compartidos, aislamiento FK, ningún grant directo. No RPC pública aún.                                                     |
| CM-02: lectura y escritura de ficha  | Core privado, RPC finitas de perfil, búsqueda/paginación, audit/replay y purgador privado                                                                                                | CM-01 + CD-02/04/05/06                                                  | Preflight/raíz/revalidación, keyset, contratos HTTP, rollback y carreras S2/catálogo. Grants sólo al final del lote y sólo firmas verificadas.                    |
| CM-03: privacidad y eventos privados | app.customer_privacy_notices y app.customer_marketing_events; FKs/índices, append-only y RLS sin grants; proyección de agregado por último evento                                        | CD-07/08; CM-01; matriz owner-only de evidencia CD-02                   | Eventos no modificables, FK aviso marketing del mismo tenant, sin booleano heredado ni consentimiento por alta. Sin contenido legal ficticio ni seed de personas. |
| CM-04: capacidades de consentimiento | Lectura de aviso/resumen, historia owner-only y comando grant/revoke con control de dos versiones, evidencia/audit/replay atómicos                                                       | CM-02/03 + CD-02/04/05/06/07; aviso/evidencia CD-08                     | Revocación, replay posterior a revoke/archivo, contacto compartido, roles y publicidad deshabilitada.                                                             |
| CM-05: módulo HTTP y UI              | Archivos futuros en modules/customers, handlers finos, componentes y pantallas; extensión acotada can()                                                                                  | CM-02 para ficha; CM-04 para controles comerciales; CD-01…08 aplicables | Pruebas DTO, REST, E2E por rol, mobile Merivo, 412 y sin PII en URL/logs. No es una migración SQL.                                                                |

CM-01/02 pueden implementarse y probarse con datos sintéticos sin CM-03/04 una vez
aprobados sus contratos. No activar el formulario comercial con un booleano temporal
para suplir los lotes bloqueados. Registro de avisos/evidencias no habilita campañas.
La operación real del directorio exige circuito y aviso operativo revisados CD-08/09.

No dependen del predicado EXCLUDE, clientes Auth, merge ni reservas. Sí dependen de
coordinar todas las escrituras con la raíz S2 vigente: no basta aprobar sólo tablas.
No introducir el protocolo SHARE/UPDATE futuro para reservas dentro de estos lotes.

## 3. Constraints, índices y grants que deberá revisar el DDL

- customers PK(id), UNIQUE(business_id,id), FK negocio, no unicidad de contacto/nombre;
  timestamps/ID/tenant inmutables, versiones positivas, baja lógica coherente.
- Normalizadores iguales en toda ruta pública/RPC, controles raw/e164/status, límites
  en SQL además de Zod; campos derivados ignorados o rechazados, no aceptados del body.
- Marketing notices UNIQUE(business_id,purpose,notice_version) y clave compuesta
  para impedir que un evento de grant use aviso operations o de otro negocio.
- Marketing events UUID estable, FK tenant/customer y tenant/member, restricción
  channel=email/purpose=marketing; versión por cliente/canal única, event IDs únicos,
  fuente/actor/notice/evidencia coherentes y sólo recorded_at de servidor.
- El estado not_recorded versión 1 es virtual: no estado mutable paralelo ni trigger
  que aplique app.touch_record a eventos. Append versión ≥2 bajo raíz/customer.
- Replay separado, scope tenant/usuario/operación/key, canon_version=1; sin payload
  con PII en resultado. TTL por reloj servidor, máximo 500 en purga, sin scheduler.
- ENABLE/FORCE RLS en las cuatro tablas. Sin políticas/grants directos de lectura o
  escritura a los cinco roles de aplicación. Definers postgres verifican guardas.
- Revocar EXECUTE de helpers/cores/purger; sólo firmas api explícitas authenticated.
  No ampliar app_server/service_role; sin objetos nuevos en app_internal para clientes.
- Índices exactos del diseño, sin pg_trgm nuevo ni índices únicos de teléfono/email/
  Instagram. Medir rendimiento sintético y explicar cualquier cambio de índice.
- Guard de append-only de eventos independiente de auditoría existente, incluido
  TRUNCATE por privilegios y revisión de capacidades de mantenimiento.

## 4. Compatibilidad del protocolo

Mantener READ COMMITTED; preautorización y reautorización mediante los helpers S2
existentes. Orden único para clientes: raíz negocio → replay → customer → lectura
del último evento/inserción. No nuevo lock de miembro/staff tras customer. Publicar
avisos usa raíz antes de insertar; purga sólo replay, nunca raíz/recurso después.

Mantener contratos y hashes de las doce migraciones; inventario de nuevas funciones
definer y comparación de grants/default ACL antes/después. Nuevas pruebas de
superficie deben admitir únicamente los nombres aprobados, sin eliminar aserciones
S1/S2/catálogo. Last-owner, invitaciones, MFA, TTL y paginación de equipo no cambian.

Auditoría UUID por intento y origin_request_id en replay; no usar key como trace ni
actualizar IDs históricos. Las mutaciones no disparan notificaciones, outbox ficticio
o feed de integración. Conocer un contacto compartido no puede recuperar otra ficha.

## 5. Ejecución futura y gates de activación

1. Aprobar filas CD aplicables y autorizar **implementación** de lotes concretos.
2. Releer AGENTS/estado real y capturar hashes sin leer secretos. Añadir únicamente
   migraciones nuevas posteriores a la última que exista entonces.
3. Reproducir las doce anteriores y cada lote en infraestructura descartable propia.
   Fixtures sintéticos, Auth de prueba y conexiones independientes; nunca el propietario.
4. Pasar aceptación de [CUSTOMER_TEST_PLAN](CUSTOMER_TEST_PLAN.md), revisión de grants,
   privacidad y compatibilidad acumulada. No presentar mocks como concurrencia SQL.
5. Detenerse y entregar resultados reales. Una autorización de desarrollo no permite
   aplicar en instancia local del propietario ni publicar.
6. Sólo con autorización separada: respaldo privado, verificación de recuperación,
   destino e historial, ventana sin escrituras y aplicación compatible sin reset.
   Validación local de sólo lectura, sin fixtures ni cambios de cuentas/MFA.

No hay migración de datos actuales a clientes, backfill por usuarios Auth o import
de contactos. Las nuevas tablas nacen vacías. Si otro trabajo ya creó customers,
detener el lote y reconciliar; no IF NOT EXISTS que oculte un esquema incompatible.

## 6. Recuperación y bloqueos

DDL transaccional por lote; fallo→rollback del lote, historial consistente. No down
destructivo automático. Si un lote previo deny-all se instaló, dejarlo cerrado y
corregir mediante migración nueva. Rollback de UI puede ocultar accesos, no eliminar
clientes ni evidencia. Una restauración de respaldo requiere plan y autorización
independientes; no «volver atrás» borrando personas, consentimientos o migraciones.

Bloqueado fuera de estos lotes: acceso de barber por reserva, normalización invasiva,
supresión/retención material sin CD-09, marketing delivery y contactos compartidos
sin política de destinatario, merge, GAS, exportación masiva, agenda y EXCLUDE.
