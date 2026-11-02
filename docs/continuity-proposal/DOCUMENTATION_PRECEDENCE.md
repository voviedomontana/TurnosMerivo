# Propuesta de precedencia documental

Fecha de análisis: 2026-11-01. Sólo revisión y planificación. No modifica AGENTS,
especificaciones existentes, código, credenciales o base de datos.

## 1. Regla de adopción

Por instrucción expresa del usuario, `../arquitectura-v1.1/` es la referencia
principal para diseñar funcionalidades futuras. Esto **no** aprueba automáticamente
sus ADR, ejemplos SQL, contratos contradictorios o incorporación de nuevas capacidades.
Las implementaciones y cinco migraciones existentes se preservan y se contrastan;
un documento no demuestra que una funcionalidad exista ni habilita reescribir SQL aplicado.

## 2. Orden para resolver discrepancias

| Prioridad | Fuente                                                                            | Uso                                                                                    |
| --------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1         | Instrucción explícita vigente del usuario                                         | Alcance autorizado, restricciones, excepciones y decisiones expresas                   |
| 2         | Decisiones de producto/arquitectura aceptadas explícitamente, con alcance y fecha | Contratos aprobados; una recomendación posterior no las revoca por sí sola             |
| 3         | Nueva arquitectura v1.1                                                           | Diseño futuro compatible con 1–2; detectar contradicciones internas antes de ejecutar  |
| 4         | Histórico original, doc 14, informes S1/S2 y catálogo                             | Trazabilidad, garantías ya adoptadas y compatibilidad del sistema existente            |
| 5         | Propuestas de esta carpeta                                                        | Opciones y plan a revisar; no constituyen aprobación ni autorización de implementación |

La evidencia tiene un eje diferente de la autoridad normativa: código, migraciones,
tests y reportes permiten establecer **qué existe**. La norma indica **qué debería
existir**. Si difieren, registrar la diferencia y un cambio compatible autorizado;
no convertir el código actual en especificación futura ni fingir que el documento
ya se ejecutó. Una consulta estática tampoco certifica el catálogo de una BD en ejecución.

AGENTS actual sigue intacto. Las excepciones de esta tarea provienen del usuario:
nueva referencia para diseño, sólo planificación, sin sobrescribir documentos,
sin ejecutar migraciones, reset o herramientas que alteren cuentas/datos.

## 3. Excepciones expresas a la nueva arquitectura

| Tema             | Disposición aplicable en esta revisión                                                                                                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P-02             | Opción A provisional: completed/no_show conservan ocupación histórica; falta aprobación de implementación. No copiar el EXCLUDE que excluye no_show de v1.1/04 §3.13 ni la liberación automática de v1.1/06 |
| P-05             | MVP por barridos completos por alcance y reconciliación; change_log/xid8/horizonte quedan como propuesta no aprobada, sin implementación ni garantía declarada                                              |
| Identidad Merivo | Conservar logo y tema oscuro aprobados; v1.1/09 §1.5 no autoriza volver al tema claro                                                                                                                       |
| Base existente   | No reemplazar las cinco migraciones, reiniciar cuentas, debilitar MFA o recrear propietarios para acomodar el nuevo texto                                                                                   |
| Herramientas     | npm y package-lock existentes; la plantilla pnpm de v1.1 no reemplaza instrucciones reales                                                                                                                  |
| DoD              | S0–S2 implementados localmente; sin acreditación de cierre formal, CI remoto, staging o producción                                                                                                          |

Los puntos restantes se resuelven en [DECISION_REGISTER.md](DECISION_REGISTER.md)
y [ARCHITECTURE_RECONCILIATION.md](ARCHITECTURE_RECONCILIATION.md). No elegir
silenciosamente entre dos documentos contradictorios de la misma versión.

## 4. Categorías de estado

- **IVL — Implementado y verificado localmente**: hay código y resultados históricos
  identificados. En esta revisión no significa una nueva ejecución.
- **IPV — Implementado, pendiente de verificación**: inspeccionado estáticamente,
  sin prueba suficiente del requisito completo o del comportamiento nuevo solicitado.
- **EA — Especificado y aprobado**: decisión expresa aplicable; puede estar sin código.
- **PP — Propuesto, pendiente de aprobación**: recomendación, ADR no aceptado o detalle pendiente.
- **NI — No implementado**: sin objetos/endpoint/flujo que entreguen la capacidad.
- **BD — Bloqueado por una decisión pendiente**: no implementar la parte dependiente
  hasta registrar aceptación; continuar análisis de partes independientes.

P-02 provisional no se clasifica EA para SQL. Estados de arquitectura e implementación
se registran por separado en la matriz. No atribuir el resultado de una suite S1/S2
a funcionalidades futuras de reservas, feed, GAS, recuperación o soporte.

## 5. Identificadores y referencias

Conservar dos espacios de nombres hasta aprobar una reconciliación de ADR:
`H-ADR-nnn` = `../13_ARCHITECTURAL_DECISIONS.md`; `V11-ADR-nnn` =
`../arquitectura-v1.1/13_ARCHITECTURAL_DECISIONS.md`. H-ADR-022 trata membresías S1;
V11-ADR-022 trata mapeos externos. H-ADR-023 registra sesiones/membresías S2 y no
aparece en la serie nueva. No renumerar silenciosamente ni sobrescribir sus decisiones.

Las referencias `V11/04 §3.13` y `H/04 §...` de los informes indican versión y
sección. Archivos de evidencia se referencian desde la raíz del repositorio.

## 6. Procedimiento propuesto para futuras tareas

1. Planificación: inspección de documentos, cambios locales, código y dependencias.
2. Diseño: entidades, contratos, reglas, seguridad, migraciones futuras y pruebas.
3. Revisión: decisiones concretas y alcance para aprobación; registrar qué no se aprobó.
4. Implementación: únicamente paquete y sprint autorizados; migraciones adicionales.
5. Validación: pruebas aplicables en entorno identificado y resultados reales.
6. Entrega: archivos, evidencia, limitaciones, compatibilidad y riesgos pendientes.
7. Autorización: no comenzar otro sprint automáticamente.

Esta secuencia fue solicitada por el usuario para el trabajo futuro; su incorporación
a AGENTS y a la guía existente queda pendiente de una aprobación posterior, como
pidió expresamente. Esta carpeta no efectúa esa actualización.

## 7. Alcance de comprobaciones de esta tarea

Inspección estática de Markdown, código/configuración no sensible, SQL y tests;
inventario y comprobación de preservación por hashes. Sin lectura de archivos
de secretos, conexiones a la BD ni pruebas que creen fixtures. No ejecutar E2E,
integración, provisioning o db:test sobre la instancia del propietario para una
revisión documental. Los resultados previos se citan con su origen histórico.
