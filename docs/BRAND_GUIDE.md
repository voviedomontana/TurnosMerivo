# Identidad de interfaz — Merivo

Decisión del usuario, 2026-10-31: usar el logo de Merivo y el lenguaje visual de las
publicaciones adjuntas en toda la experiencia de TurnosMerivo, incluida la aplicación
que se construirá en sprints posteriores. Esta edición aplica esa identidad a la
landing existente y los componentes/tokens compartidos; no implementa pantallas futuras.

## Paleta de implementación

Valores derivados visualmente de las referencias; no se recibieron códigos HEX de
un manual oficial. El PNG original del logo se conserva sin recolorear ni retocar.

| Uso                                    | Token CSS            | Color   |
| -------------------------------------- | -------------------- | ------- |
| Negro del logo                         | --brand-black        | #000000 |
| Fondo carbón                           | --background         | #101113 |
| Superficie de tarjetas                 | --card               | #18181C |
| Superficie elevada                     | --popover            | #202025 |
| Texto principal                        | --foreground         | #F5F5F4 |
| Texto secundario                       | --muted-foreground   | #B5AFB3 |
| Rojo rubí: acciones/destacados         | --primary            | #B71926 |
| Texto sobre rojo                       | --primary-foreground | #FFFFFF |
| Hover de acción                        | --primary-hover      | #99121E |
| Rojo legible para texto pequeño/iconos | --accent             | #F0747F |
| Dorado cálido: firma y detalles        | --brand-gold         | #C89C6B |
| Foco accesible                         | --ring               | #E2B681 |
| Bordes decorativos                     | --border             | #383238 |
| Controles futuros                      | --input              | #81747E |

La fuente de verdad ejecutable es `src/app/globals.css`, con aliases Tailwind para
los tokens de shadcn. Fondo oscuro por defecto y `color-scheme: dark`. No volver
a introducir la paleta verde/clara anterior en pantallas nuevas.

## Logo y composición

- Archivo original: `public/brand/merivo-logo.png`, procedente del primer adjunto.
  Componente compartido: `src/components/brand-logo.tsx`.
- Mantener diamante rojo y nombre dorado, proporción cuadrada, fondo negro y espacio
  alrededor. Sin deformación, filtros, tintes, tijeras sustitutas ni logo recreado.
- Usar `BrandLogo` en cabeceras/pies y la imagen original en identidad institucional.
  El texto TurnosMerivo acompaña al símbolo para conservar legibilidad a tamaños pequeños.
- El PNG adjunto es de baja resolución: no agrandarlo para piezas de gran formato.
  Una fuente vectorial oficial podría sustituir el asset en el futuro sin cambiar el diseño.
- La segunda referencia orienta paleta, tipografía fuerte y bloques rojos; su fotografía
  y texto publicitario no se incorporan como contenido del sistema de turnos.
- Blanco/gris para lectura, rojo para acción principal, dorado con moderación.
  Jerarquía tipográfica marcada, títulos contundentes y espaciado generoso.

## Accesibilidad y estados

- No usar el rojo oscuro como texto pequeño sobre carbón: usar --accent o blanco.
- Acciones rubí con texto blanco; foco dorado visible y objetivos táctiles de 44 px.
- Los bordes --border son separadores decorativos; los límites de futuros controles
  interactivos deben usar --input o un indicador contrastante, además de foco visible.
- Error/éxito/selección deben incluir texto o icono y no depender sólo del color.
  El rojo de marca por sí solo no comunica un error. No implementar estados de reservas
  antes de su sprint; sus etiquetas y contrastes se validarán al construirlos.
- Mantener el tema Merivo como identidad de plataforma. La futura configuración por
  negocio sigue su arquitectura multi-tenant; no se cambian datos o permisos con CSS.

## Alcance y validación

Se actualizan tokens globales, logo compartido, favicon, landing, Button, especificación
UX y prueba E2E de carga real del logo. No cambia la API ni el esquema de base de datos.
Revisar visualmente escritorio y móvil; ejecutar los checks del repositorio y E2E.
