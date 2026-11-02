# Revisión previa a publicar la aplicación en GitHub

Fecha: 2026-11-02. Repositorio configurado localmente y verificado por navegador,
con autorización explícita de sólo lectura:
[voviedomontana/TurnosMerivo](https://github.com/voviedomontana/TurnosMerivo).

## Estado observado

- Es público, rama main, un commit y sólo carpeta docs visible en la raíz.
- Git local tiene catorce archivos ya versionados. El código de la aplicación,
  scripts, pruebas, assets y migraciones desarrollados siguen sin publicarse.
- La instantánea previa a los dos informes de esta entrega contiene 302 archivos
  candidatos no ignorados; incluye trabajo acumulado de las etapas anteriores,
  no solamente la corrección del pooler. No es un diff pequeño de este bloque.
- El equipo Vercel merivo-group no tiene proyectos. Vincular hoy el repositorio
  tal como está publicado no entregaría la aplicación desarrollada.
- Supabase staging kuqtskhtsvpluhalxiav fue creado por el usuario, separado de
  Ecosistema Merivo aadrzawmzrstpyuluxqk. No se le aplicaron migraciones.

GitHub guardará historial y revisiones; Vercel podrá construir releases de ese
historial. No hace falta copiar archivos manualmente en cada cambio. El schema y
datos no se sincronizan como archivos: las migraciones requieren un procedimiento
propio y un destino verificado. No conectar despliegue automático de SQL ahora.

## Revisión realizada

- .env.local, .env.production, .vercel, test-results y backups quedan ignorados.
  Se añadió .vercel/ para excluir configuración/artefactos del CLI futuro.
- No hay artefactos privados de esas categorías en el inventario candidato.
- Búsqueda por nombres de archivo de patrones de claves privadas PEM, tokens
  sb_secret y GitHub: sin coincidencias en código, scripts, tests, docs y Supabase.
  No se imprimieron posibles valores, se leyeron .env privados ni se inspeccionaron
  paneles de claves. Es una comprobación acotada, no una certificación exhaustiva.
- Búsqueda del identificador personal conocido en las fuentes candidatas: sin
  coincidencias; no se exportaron datos de clientes/usuarios del propietario.
- Los IDs de proyectos/equipo compartidos por el usuario son metadatos de destino,
  no credenciales. El manifest de staging no admite campos extra para secretos.
- Regresión descartable y checks documentados en STAGING_PROVISIONING_REPORT.md.

## Publicación propuesta para autorización

1. Conservar main remoto y el proyecto Ecosistema Merivo sin cambios.
2. Crear una rama codex/staging-readiness para el trabajo acumulado revisado.
3. Revisar el inventario final de archivos, diff de docs y exclusiones antes de
   stagear; no usar git add indiscriminado que incluya artefactos ignorados a la fuerza.
4. Resolver el fallo conocido de formato: quince Markdown históricos de
   arquitectura-v1.1. Propuesta: autorizar exclusivamente formato mecánico, sin
   cambios de requisitos, y demostrar que no se modificó el contenido técnico.
   No se ejecutó ni se ocultó con un ignore/excepción de CI en esta entrega.
5. Ejecutar checks sobre el conjunto final y registrar el estado real de CI.
6. Con autorización explícita, crear el commit y hacer push sólo a esa rama para
   revisión. No merge/push a main, no despliegue ni aplicación de migraciones por
   extensión de ese permiso. El repositorio público expone las fuentes publicadas.

No se creó rama, commit, push ni PR durante esta preparación. La autorización de
inspeccionar GitHub fue sólo lectura; no autoriza la publicación anterior.

## Conexión posterior a Vercel

Usar el mismo repositorio, con permisos limitados a ese proyecto. La instalación
de la integración GitHub/Vercel y sus permisos deberá completarse por el titular
cuando se conozca su solicitud concreta; no otorgar acceso a todos los repositorios
sin necesidad. No se instaló ninguna integración en esta entrega.

Crear merivo-turnos-staging como proyecto separado, fijar protección y configuración
Preview antes de pruebas alojadas. La primera importación puede disparar un build;
no presentarla como una conexión inocua si crea un despliegue. Reservas cerradas por
defecto; no habilitar production ni conectar credenciales de otros entornos.

Completar el ID Vercel y origen HTTPS en STAGING_TARGET_PENDING.json, usar el
preflight offline y solicitar autorización del despliegue/migración del destino
concreto. La prueba de configuración no demuestra que el hosting funcione: faltan
proveedor real, TLS/pooler, RLS/roles alojados, permisos, protección y restore.
