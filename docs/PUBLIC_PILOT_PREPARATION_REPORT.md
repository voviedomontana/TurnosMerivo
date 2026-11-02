# Preparación operativa del piloto público

Fecha: 2026-11-02. Pedido: preparar el circuito público para un piloto seguro.
Infraestructura confirmada: Vercel + Supabase alojado.

## Resultado

**Preparación local de custodia y plan de staging entregados. Piloto NO habilitado.**
No se modifica publicConfig, el marcador privado, rutas, UI ni políticas SQL. La
implementación vigente sigue aceptando escritura pública sólo en descartable.
No se provisionaron proyectos alojados ni se ejecutaron despliegues/migraciones.

## Archivos

Creados:

- scripts/public-booking-keys.mjs: operador offline de backup cifrado, verificación
  en memoria y drill sintético con lectura/escritura de archivo temporal.
- tests/unit/public-booking-key-cli.test.ts: siete pruebas de comportamiento del
  ejecutable, usando claves aleatorias y carpetas temporales exclusivas.
- docs/PUBLIC_PILOT_RUNBOOK.md: separación de entornos, configuración privada,
  procedimiento de custodia, contrato pendiente de antiabuso/red, staging, respuesta
  a incidentes y matriz G01…G12 de apertura.
- docs/PUBLIC_PILOT_PREPARATION_REPORT.md: esta evidencia de preparación.

Modificados:

- package.json: nuevo script pilot:keys; sin dependencia nueva ni cambio de lockfile.
- AGENTS.md: registra autorización de preparación y elección de infraestructura;
  conserva restricciones de datos reales, activación y despliegue.
- docs/CHANGELOG.md: registra alcance y referencia a este informe.

No se modifica documentación histórica aprobada de arquitectura, propuesta PB ni
informes anteriores. El runbook complementa esas fuentes y distingue hechos de
procedimientos aún no ejecutados.

## Custodia implementada

Reutiliza backupKeyring/restoreKeyring y sealToken/openToken del módulo AES-256-GCM
existente; no duplica el algoritmo ni cambia sus contratos. Ninguna conexión de
base, lectura de .env.local o carga de cuentas/datos del propietario.

`npm run pilot:keys -- drill` genera material sintético, activa v2 reteniendo v1,
persiste un backup cifrado en el directorio temporal del sistema, lo restaura y
descifra un token canario de v1. Comprueba rechazo con otra clave de recuperación.
Elimina sólo el archivo y directorio propios al terminar; sin borrado recursivo en
la herramienta. No crea secretos del propietario.

`backup --output <ruta-absoluta>` requiere keyring y clave de recuperación mediante
entorno privado. Exige independencia de la clave de recuperación, destino fuera
del repositorio tras resolver el padre real y creación exclusiva sin sobrescritura.
Autoverifica el sobre antes de escribirlo. Modo 0600 en POSIX; ACL de Windows y
permisos del almacén deben configurarse por el operador. No se imprime ruta, key IDs,
claves, token ni excepciones del sistema. Sólo un resultado booleano/estado seguro.

`verify --input <ruta-absoluta>` rechaza symlink de archivo, tamaño excesivo, clave
incorrecta, ciphertext alterado y contenido diferente del keyring esperado. No
exporta claves en texto plano. No es un importador del secret store del hosting.
Las carpetas operativas deben tener acceso privado; no se garantiza borrado seguro
ni defensa frente a otro proceso privilegiado que controle esa misma carpeta.

La custodia alojada, asignación de custodios y recuperación desde almacenes
independientes siguen pendientes. El drill local no las certifica.

## Validaciones reales de esta entrega

| Check                               | Resultado                                                                                                                                                                                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| npm run pilot:keys -- drill         | PASS: restore de archivo cifrado, clave v1 retenida y rechazo de clave incorrecta; synthetic=true                                                                                                                                                |
| npm run test                        | PASS: 233 tests en 24 archivos; siete nuevos de CLI                                                                                                                                                                                              |
| Casos de CLI                        | PASS: drill sin leer configuración del operador, backup/verify sin plaintext, no sobrescritura, ruta interna/relativa rechazada, clave reutilizada/config ausente, clave incorrecta/tamper/runtime diferente y argumentos adicionales rechazados |
| npm run lint                        | PASS                                                                                                                                                                                                                                             |
| npm run typecheck                   | PASS                                                                                                                                                                                                                                             |
| npm run build                       | PASS en reintento; primer intento falló con EPERM al crear .next/static/chunks/app/api/v1/public/[slug], luego compiló y terminó exit 0 con permiso de ejecución ampliado                                                                        |
| npm run format:check                | FAIL: mismos quince Markdown históricos de docs/arquitectura-v1.1; no se reformatean fuera de alcance                                                                                                                                            |
| Formato de archivos de esta entrega | PASS mediante Prettier                                                                                                                                                                                                                           |
| Integridad de migraciones           | PASS: dieciséis hashes históricos contrastados con el inventario y migración 17 con 35cbffffd009d5df0eb1d131dab2c7710c42d95c3ae47fc545c21ad8498aea16; total diecisiete, ninguna nueva                                                            |
| SQL/HTTP/E2E                        | No repetidos en esta preparación: sin cambios de UI, API, SQL ni runtime público; no se ejecutó test:e2e conectado al propietario                                                                                                                |

La regresión anterior de PB sigue documentada por separado: 554 pgTAP, 57 carreras
independientes, 23 escenarios HTTP públicos y E2E. **No son ejecuciones de esta
entrega ni evidencia de staging alojado.** Las únicas escrituras nuevas de prueba
son archivos sintéticos en carpetas temporales del sistema.

## Pendientes para el piloto

1. Implementar/probar el adaptador real de desafío, red confiable y evolución
   explícita de gates para alojamiento; hoy faltan, no se eluden con configuración.
2. Provisionar staging aislado y protegido, con identificadores/origen concretos y
   autorización de despliegue y migraciones sobre ese destino.
3. Configurar secretos independientes, custodios y recuperar base + claves con
   evidencia operacional; validar pooler y aislamiento de transacciones.
4. Ejecutar regresión/carga/recuperación HTTPS en ese entorno, observar errores
   saneados y probar cierre/reapertura sin perder turnos.
5. Revisar privacidad, retención y derechos con responsables; definir atención,
   participantes y comunicaciones. Emails/recordatorios no están implementados.
6. Aprobar la release y riesgos concretos antes de abrir reservas reales.

Sin cuentas/MFA/invitaciones del propietario alterados, sin GAS, notificaciones,
any-staff, estados terminales, commit, push o despliegue. Los gates productivos y
las dependencias externas permanecen explícitamente abiertos en el runbook.
