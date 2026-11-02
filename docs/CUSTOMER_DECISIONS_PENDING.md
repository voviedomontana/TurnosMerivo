# Clientes — decisiones establecidas y aprobaciones pendientes

Fecha: 2026-11-01. Estado: diseño exclusivamente documental. Entregar este registro
no autoriza escribir código, SQL, aplicar migraciones ni avanzar a reservas.

Documentos: [diseño](CUSTOMER_MODULE_DESIGN.md), [permisos](CUSTOMER_PERMISSION_MATRIX.md),
[lotes](CUSTOMER_MIGRATION_PROPOSAL.md), [pruebas](CUSTOMER_TEST_PLAN.md).

## 1. Ya establecido por el usuario — no pendiente

| ID   | Decisión firme                                                                      | Efecto sobre propuestas históricas                                                                              |
| ---- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| E-01 | Teléfono compartido permitido; sin unicidad obligatoria de teléfono/email/Instagram | Reemplaza phone unique de arquitectura-v1.1/04 §3.12, visión y S3-A B-CLI/B-M03. Sin upsert/match por contacto. |
| E-02 | Tratamiento operativo separado de marketing voluntario                              | No flag único de «aceptó términos» ni consentimiento comercial inferido de una reserva.                         |
| E-03 | Barber sin directorio; futuro mínimo sólo con turno propio comprobable              | No assigned_barber_id ni permisos read_own ficticios antes de appointments.                                     |
| E-04 | Clientes sin Supabase Auth                                                          | No alta de cuentas, relación de identidad con public.users o recuperación por teléfono.                         |
| E-05 | PostgreSQL fuente de verdad                                                         | Hoja, búsqueda o normalizador no unen personas ni acreditan propiedad.                                          |
| E-06 | Sin merge/importaciones GAS/vínculos externos                                       | No alias, mappings, columnas external_id, endpoints ni integración anticipada.                                  |

No se modificaron los documentos históricos para reflejar estas sustituciones;
los cinco nuevos registran su precedencia y el alcance solicitado. Arquitectura
vigente S1/S2/catálogo y doce migraciones se preservan.

## 2. Propuestas concretas que requieren aprobación

| ID / responsable                    | Recomendación propuesta                                                                                                                                                                                 | Alternativa / consecuencia                                                                                                                            | Gate                                                             |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| CD-01 — Producto                    | Sólo nombre obligatorio (1–120); contactos opcionales; notas 2000; archivo/restauración sin active paralelo; campos exactos del diseño                                                                  | Exigir contacto en alta administrativa: impediría fichas presenciales sin datos e induce valores ficticios. No inferir requisito de reservas futuras. | CM-01/02/05.                                                     |
| CD-02 — Producto/Seguridad          | Owner/admin aal2 gestionan fichas y registran grant/revoke; evidencia histórica sólo owner; admin ve resumen. Notas sólo detalle administrativo.                                                        | Restringir también grant a owner reduce operadores pero necesita decisión explícita; nunca ampliar barber.                                            | CM-02/04/05.                                                     |
| CD-03 — Producto/Backend            | Normalización customer-contact-v1 conservadora, sin conversión nacional automática; + explícito y candidatos internacionales de 8–15 dígitos; raw needs_review permitido; búsqueda/hints sin linking    | Normalizador por librería de planes nacionales requeriría selección, versión fijada y batería aprobada. No instalar ni inferir algoritmo ahora.       | CM-01/02/05.                                                     |
| CD-04 — Producto/API                | REST /api/v1, PUT completo, keyset created_at/id 50/200; POST search sin PII en URL; cursores no firmados ligados a tenant/filtros; DTO y errores del diseño                                            | GET?q es más enlazable pero expone contactos en historial; firma de cursor agrega custodia de secretos sin sustituir autorización.                    | CM-02/04/05.                                                     |
| CD-05 — Backend/Seguridad           | Reusar raíz exclusiva S2, READ COMMITTED, preflight/revalidación, replay→customer→evento; perfil y consentimiento con versiones distintas                                                               | No adoptar todavía protocolo SHARE/UPDATE de reservas. La serialización por negocio puede limitar throughput, debe medirse.                           | Todos los writers nuevos.                                        |
| CD-06 — Backend/Seguridad           | Ledger clientes independiente, 48 h, purga privada ≤500 sin scheduler; UUID estables y versiones para evitar repetición sensible                                                                        | Ventana distinta requiere política explícita. No ampliar automáticamente ledgers S2/catálogo ni conservar payload PII para replay.                    | CM-01/02/04.                                                     |
| CD-07 — Producto/Privacidad         | Eventos privados append-only, canal email inicial, not_recorded virtual v1, declaración operator_attestation; marketing_revision invalida al cambiar cualquier contacto o archivar; restore no reotorga | Contacto/canal específico más fino exige modelo adicional. Registro administrativo no prueba identidad ni habilita delivery.                          | CM-03/04/05 comercial.                                           |
| CD-08 — Responsable/Legal           | Revisar aviso operativo y marketing versionados por negocio, base de tratamiento, suficiencia de evidencia y responsable que publica; sin texto ficticio/default legal                                  | Se puede desarrollar con avisos sintéticos aprobando contrato, pero no recolectar datos reales/consentimientos con textos de fixture.                 | Avisos reales y operación real; grant comercial CM-04.           |
| CD-09 — Responsable/Legal/Operación | Definir retención por clase, derechos, verificación independiente del contacto compartido, tratamiento de backups y eliminación/disociación                                                             | No asignar «X años» sin fundamento ni considerar soft delete una supresión. Diseñar ejecución de derechos por autorización posterior.                 | Uso con datos reales; no bloquea pruebas sintéticas de CM-01/02. |

Ninguna fila CD está aprobada por esta entrega. Aprobar el diseño debe identificar
filas aceptadas y luego autorizar implementación de lotes exactos. Las seis decisiones
E no requieren ser vueltas a negociar y no se habilitan excepciones implícitas.

## 3. Riesgos y decisiones diferidas fuera del mínimo

- **Contacto compartido y campañas:** consentimiento por ficha no equivale a permiso
  de todos los destinatarios de un teléfono/email. Antes de enviar habrá que resolver
  verificación de destinatario, supresión por canal y alcance de revocaciones que
  afecten un contacto compartido. No enviar campañas ni ofrecer eligible_for_delivery
  en este bloque; no fusionar perfiles para resolverlo.
- **Evidencia declarada:** operator_attestation demuestra qué registró un operador,
  no que una persona controlaba el contacto. Legal debe evaluar si basta para la
  finalidad/canal; si no, mantener grant deshabilitado hasta un flujo aprobado.
- **Retención vs evidencia inmutable:** append-only operativo no decide conservación
  perpetua. Evidencia, UUID/actor y backups son vinculables; derechos de supresión
  pueden exigir otra representación/procedimiento, todavía sin SQL autorizado.
- **Aviso cambiado:** nueva versión no reescribe evidencia previa. Necesidad de
  recabar consentimiento nuevo por cambio de finalidad requiere revisión legal;
  ningún sistema de campañas puede asumir validez global del último grant.
- **Búsqueda y escala:** prefijos indexados, sin fuzzy ni ranking. Medir antes de
  proponer pg_trgm, índices extras o exportaciones; no incluirlos como requisitos.
- **Paginación:** consistente sobre conjunto estable, sin snapshot/reconciliación
  incremental. Un cursor alterado sólo mueve la posición dentro del scope autorizado.
- **Permisos canónicos JSON:** no existe aún; extensión finita TS/SQL con tests de
  paridad es compatible con catálogo. No condicionar clientes a un refactor general.
- **Barber:** demostrar reserva/miembro/staff/cliente en el mismo tenant y aprobar
  ventana/estados/proyección será un gate futuro. Denegado ahora, sin excepción.
- **Reservas:** límites por persona no pueden basarse en teléfono único compartido.
  El futuro antifraude y selección de customer deberán diseñarse sin enumerar otras
  personas o asumir que mismo contacto=mismo customer. No se resuelve aquí.

## 4. Alcance mínimo implementable tras aprobación

Recomendación: aprobar CD-01…06 y desarrollar **CM-01/02 + UI de ficha CM-05** en
descartable: directorio administrativo con alta, edición, búsqueda/paginación y
archivo/restauración, notas privadas, RLS, versiones, auditoría e idempotencia. Sin
marketing mutable, sin barber, sin agenda ni clientes Auth. No crear flags temporales
que luego se interpreten como consentimiento histórico.

CD-07/08 habilitarían después CM-03/04 y sección comercial de CM-05 con aviso y
evidencia revisados. Alternativamente se pueden aprobar juntos si Producto/Legal
resuelven esos gates antes. CD-08/09 deben cerrarse antes de cargar datos reales;
no basta que tests técnicos pasen. Ningún lote se considera autorizado ahora.

Aplicar a la instancia del propietario requiere otra autorización explícita, respaldo
y verificación de destino/historial. Una autorización anterior de catálogo no se
extiende a clientes ni a futuras migraciones. No implementar automáticamente cuando
se acepte un documento de diseño.

## 5. Checklist de autorización futura

- [ ] Aceptar/rechazar filas CD-01…09 y registrar diferencias concretas.
- [ ] Definir lotes CM incluidos; separar pruebas sintéticas de habilitación real.
- [ ] Confirmar E-01…06 preservadas, sin unicidad/contacto como identidad ni barber abierto.
- [ ] Revisar teléfonos AR/internacionales, evidencia y transiciones de contexto con ejemplos.
- [ ] Validar matriz de permisos y proyecciones por RPC directa, no sólo UI.
- [ ] Aprobar protocolo de locks/versión/replay sin refactorizar las doce migraciones.
- [ ] Aprobar plan de pruebas descartable y criterios de salida por lote.
- [ ] Resolver aviso, derechos, retención y responsable antes de uso con datos reales.
- [ ] Emitir autorización de implementación; no confundirla con autorización de aplicación local.

## 6. Registro de cambios de esta entrega

Se crean únicamente CUSTOMER_MODULE_DESIGN.md, CUSTOMER_PERMISSION_MATRIX.md,
CUSTOMER_MIGRATION_PROPOSAL.md, CUSTOMER_TEST_PLAN.md y este documento. No se edita
CHANGELOG/AGENTS ni arquitectura histórica por la restricción expresa del usuario.
La validación documental y preservación de archivos se registra aquí al cerrar.

### Validación ejecutada en esta entrega

| Check                                                | Resultado real                                                                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| npm run lint                                         | PASS.                                                                                                                                                                           |
| npm run typecheck                                    | PASS.                                                                                                                                                                           |
| npm run test                                         | PASS, 139 tests existentes / 13 archivos; no hay módulo de clientes implementado.                                                                                               |
| npm run build                                        | PASS; aplicación actual compilada, sin nuevas rutas funcionales.                                                                                                                |
| npm run format:check                                 | FAIL por los 15 Markdown preexistentes de docs/arquitectura-v1.1, sin modificarlos.                                                                                             |
| Prettier de los cinco documentos nuevos              | PASS.                                                                                                                                                                           |
| Enlaces locales de los cinco documentos              | 18 destinos comprobados, ninguno inexistente.                                                                                                                                   |
| git diff --check                                     | PASS.                                                                                                                                                                           |
| SHA-256 de archivos previos no ignorados/no secretos | 188 archivos intactos, ninguno eliminado; las doce migraciones, código, dependencias, assets, AGENTS e informes históricos conservados. Únicos agregados: estos cinco Markdown. |

No se ejecutaron db, CLI Supabase, consultas SQL, pgTAP, Docker, integración HTTP
contra datos locales ni E2E. No se usaron credenciales, datos ni MFA del propietario.
Las pruebas CS/CH/CC/CE anteriores son criterios futuros, no resultados obtenidos.
Se consultaron fuentes oficiales públicas para los puntos de numeración y revisión
legal; los enlaces están junto a sus afirmaciones en el diseño. No se cambiaron
secretos/configuración, no se crearon migraciones, no hubo commit/push/despliegue.
