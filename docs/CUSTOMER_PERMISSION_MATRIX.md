# Clientes — matriz de permisos propuesta

Fecha: 2026-11-01. Estado: **propuesta CD-02 para aprobación; nada implementado**.
Contrato principal: [diseño](CUSTOMER_MODULE_DESIGN.md). Gates:
[decisiones](CUSTOMER_DECISIONS_PENDING.md). E-01…E-06 son decisiones ya establecidas
por el usuario; las capacidades y proyecciones de esta matriz son propuestas.

## 1. Invariantes establecidas

- E-03: barber no accede a directorio/ficha/consentimientos ahora. No permiso temporal,
  no assigned_barber_id ni acceso por sólo pertenecer al mismo negocio.
- E-04/E-05: customer sin Auth; identidad del operador deriva de auth.uid, tenant
  validado en PostgreSQL. Teléfono/email/Instagram no son credenciales.
- Aislamiento, RLS, MFA de owner/admin, grants mínimos y guardas SQL S2 se conservan.
- E-06: anon/app_server/GAS no reciben capacidades de clientes en este bloque.

## 2. Acciones finitas propuestas

Todas las columnas owner/admin requieren miembro y perfil activos, email Auth
confirmado, negocio activo/no archivado y aal2. «No» también aplica aunque se invoque
la RPC directamente o se falsifique actor/rol en body/header. No wildcard de owner.

| Acción                                                    | owner           | admin           | barber              | anon | app_server |
| --------------------------------------------------------- | --------------- | --------------- | ------------------- | ---- | ---------- |
| customers:list / search, incluidos archivados             | Sí              | Sí              | No                  | No   | No         |
| customers:read (detalle con notas)                        | Sí              | Sí              | No                  | No   | No         |
| customers:create / update                                 | Sí              | Sí              | No                  | No   | No         |
| customers:archive / restore                               | Sí              | Sí              | No                  | No   | No         |
| customers:marketing:read (resumen)                        | Sí              | Sí              | No                  | No   | No         |
| customers:marketing:grant / revoke                        | Sí              | Sí              | No                  | No   | No         |
| customers:marketing:history (evidencia)                   | Sí              | No              | No                  | No   | No         |
| customers:privacy-notices:read                            | Sí              | Sí              | No                  | No   | No         |
| Publicar avisos / purgar replay                           | No vía app      | No vía app      | No                  | No   | No         |
| Exportar, suprimir, fusionar, importar, vincular externos | No implementado | No implementado | No                  | No   | No         |
| Clientes de «mis turnos»                                  | Diferido        | Diferido        | Diferido y denegado | No   | No         |

service_role tampoco recibe ninguna capacidad de datos del módulo. platform_admin
sin membresía del negocio no obtiene acceso; no se implementan support_grants ni
impersonación. Si tiene membresía válida, se evalúa esa membresía y el MFA existente.
Mantenimiento postgres no es un rol de usuario final ni una API de soporte.

Grant/revoke por admin y evidencia sólo owner son decisiones CD-02/CD-07 a aprobar.
El permiso de revocar no exige que ese operador haya registrado el grant original.
Admin puede enviar una declaración privada nueva sin poder recuperar todo el historial.
La pertenencia a otro negocio nunca otorga derechos sobre el cliente consultado.

## 3. Proyecciones explícitas

| Proyección                    | Datos permitidos                                                                                                                                                          | Exclusiones                                                                              |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Lista/búsqueda administrativa | id, full_name, phone_raw, phone_e164, phone_status, email, instagram_handle, version, created_at, deleted_at                                                              | Sin notas, consentimientos, actor, evidencia, estadísticas ni hash de búsqueda.          |
| Detalle administrativo        | Lista + private_notes, source, updated_at                                                                                                                                 | Sin evidencias ni hashes de idempotencia.                                                |
| Marketing resumido            | customer_id, channel, consent_version, recorded_status, recorded_at, applicability y causa acotada; notice_id/notice_version del último grant                             | Sin evidence_summary, copia de contacto, actor email, IP o payload original.             |
| Historia de marketing (owner) | event_id, channel, consent_version, decision, marketing_revision, notice_id/version, source, evidence_kind/summary, recorded_at, actor_user_id/member_id/role, request_id | No contactos adicionales ni datos de Auth. Actor por UUID, no consulta de email general. |
| Aviso vigente                 | id, purpose, notice_version, locale, content_text, published_at                                                                                                           | Sin datos de clientes, campos internos ni herramientas de edición.                       |
| Resultado de mutación/replay  | Sólo IDs, versiones y estado/decisión registrados según diseño                                                                                                            | Nunca instantánea de nombre, contacto, nota o evidencia.                                 |

No SELECT *, to_jsonb de filas completas ni reutilización de DTO interno para API.
No almacenar resultados de directorio/consentimientos en caché pública, localStorage,
SSR de otro tenant, telemetría, cuerpos de error, analytics, trazas o URL de búsqueda.
No ampliar api.me, api.read_business_private ni la proyección pública S1 para esto.

## 4. RLS, privilegios y funciones propuestos

Todos los objetos nuevos: ENABLE/FORCE RLS, dueño postgres, sin grants de tablas a
PUBLIC/anon/authenticated/app_server/service_role. Propuesta: tablas deny-all sin
políticas de acceso directo; no crear una política genérica is_active_member que
en el futuro abra notas a barberos al conceder SELECT por error. No es necesario
exponer una política para que el definer postgres haga su proyección autorizada.
FORCE RLS no evita BYPASSRLS; cada definer debe cumplir sus guardas por sí mismo.

| Objeto lógico propuesto                                                              | Autoridad de ejecución                                                                                            |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| api.list_customers_page, api.search_customers_page, api.read_customer                | authenticated; app.require_member(...,true) antes de leer o validar cursor sensible.                              |
| api.create_customer, api.update_customer, api.archive_customer, api.restore_customer | authenticated; core privado, coordinador raíz S2 y reautorización.                                                |
| api.read_customer_marketing, api.record_customer_marketing                           | authenticated; owner/admin con guardas específicas y versiones independientes.                                    |
| api.list_customer_marketing_events                                                   | authenticated; guard explícito de owner antes de leer evidencia, no sólo p_manage=true.                           |
| api.read_customer_privacy_notice                                                     | authenticated; owner/admin.                                                                                       |
| app.customer_* core y normalizadores                                                 | Privados; sin EXECUTE para roles de aplicación.                                                                   |
| app.purge_customer_requests                                                          | Invoker privado, mantenimiento postgres autorizado; máximo 500, sin elevación.                                    |
| Publicación de avisos                                                                | Procedimiento de mantenimiento identificado, con revisión y raíz del negocio; sin endpoint ni grant a app_server. |

Nombres son contratos propuestos, no funciones existentes. Cada definer: search_path
vacío, nombres calificados, firma tipada, sin SQL dinámico, dueño revisado y REVOKE
PUBLIC explícito/defaults existentes. Sólo firmas api revisadas reciben EXECUTE
authenticated. Registrar en function-catalog **cuando se autorice implementar**.
No hacer GRANT ON ALL FUNCTIONS/TABLES ni modificar defaults de S1/S2.

RLS/grants no sustituyen FKs compuestas: evidencia y avisos del negocio B no se
pueden insertar en A ni desde una función defectuosa. Las funciones privadas no
aceptan actor, role, bypass, verified_contact o un contexto setter controlable.

## 5. Autorización concurrente y prioridades

Lecturas: require_member true en cada petición, incluso cada página/reintento;
historia comprueba owner actual. Un SELECT ya iniciado usa su snapshot y puede
terminar si la revocación confirma después de autorizarlo; no se promete revocación
retroactiva de bytes ya devueltos. La próxima solicitud queda denegada. No mantener
locks de escritura durante navegación para evitar esa limitación inherente.

Escrituras: preflight no bloqueante → lock_managed_business → nueva comprobación
de rol/capacidad → replay → customer → eventos. Una revocación S2 que confirma
antes de que el escritor obtenga la raíz lo invalida. Si el escritor obtuvo primero
la raíz y se autorizó, puede confirmar antes de la revocación: orden serial válido.
No I/O externo dentro de la transacción; no bloquear primero customer y luego raíz.

Replay requiere permiso actual de la operación, aunque el resultado no tenga PII.
Invitado/suspendido/otro negocio→404; barber del propio negocio→403; owner/admin
sin aal2→403 MFA_REQUIRED; sin identidad→401. Ocultar existencia y versiones hasta
pasar esas guardas. Mismo request_id no sustituye un replay autorizado.

## 6. Condición futura para barberos, no implementación

La existencia de staff_members.member_id no acredita relación con un cliente.
Sólo un futuro recurso appointment del mismo tenant, enlazado a customer y a staff
vinculado a la membresía actual, podrá demostrarla dentro de PostgreSQL. Deben
aprobarse además ventana temporal, estados habilitados y campos necesarios.
No se declara ahora permiso customers:read_own y no se deja una RPC abierta como
placeholder. Cuando se diseñe, devolverá una proyección por reserva, sin directorio,
notas globales, consentimientos ni búsquedas por contacto. E-03 no está pendiente de
reaprobación: el acceso actual permanece denegado.
