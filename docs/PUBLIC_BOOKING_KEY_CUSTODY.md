# Custodia y recuperación de claves — circuito público descartable

Fecha: 2026-11-02. Contrato de desarrollo PB-03 aprobado expresamente por el usuario.
No provisiona claves del propietario ni habilita producción.

## Separación y almacenamiento

- La capacidad de intento y el manage_token se generan con randomBytes(32) del
  runtime Node y se representan en base64url. No derivarlos de teléfono, UUID,
  Idempotency-Key o claves de cifrado.
- PostgreSQL conserva hashes SHA-256, generación/vigencia/revocación y un sobre
  cifrado; nunca la clave AES ni el token en texto plano. Argumentos secretos sólo
  atraviesan memoria y consultas parametrizadas del backend confiable.
- PUBLIC_BOOKING_ENCRYPTION_KEYS es configuración privada del proceso: objeto con
  active (key_id) y keys (mapa de key_id a 32 bytes base64url). Cada clave es CSPRNG,
  sin valor predeterminado. No usar NEXT_PUBLIC, Git, tablas PostgreSQL o logs.
- La clave HMAC de desafío de prueba es independiente; se rechaza reutilizar una
  clave AES para ese propósito. No constituye prueba humana o proveedor anti-bot.
- En el harness, todo el material es sintético y sólo vive en memoria y en el entorno
  de su proceso Next temporal. No se escribe en .env del propietario, manifest,
  capturas ni fixtures versionados. La destrucción del entorno elimina sus datos.

## Cifrado y vínculo de autoridad

AES-256-GCM con nonce nuevo de 12 bytes, tag de 16 bytes y key_id explícito. AAD
canónico: dominio merivo-manage-v1, business_id y appointment_id normalizados,
generación y expiración ISO UTC. Abrir el sobre exige la clave indicada y los
mismos metadatos autorizados por SQL. Cualquier cambio de AAD/nonce/tag/ciphertext
o key_id desconocido produce error seguro, sin retornar un token alternativo.

El backend cifra antes de adquirir la raíz. El sobre se persiste junto con la
reserva, cliente, asignación, evento, auditoría y ledger. En replay se devuelve el
sobre original de la generación vigente tras reautorizar la capacidad original;
no se emite un token nuevo como sustituto de un resultado perdido o revocado.
El descifrado ocurre después del commit; si falta la clave, la reserva puede existir
y la respuesta falla cerrada. Restaurar la clave retenida permite repetir la misma
petición con su autoridad original, sin recrear efectos.

## Rotación del keyring

1. Incorporar una clave nueva con otro key_id y hacerla active en configuración
   privada del proceso; retener las anteriores para descifrar sobres existentes.
2. Reiniciar controladamente el proceso con el keyring actualizado. Los sobres
   nuevos usan la clave activa; los anteriores siguen ligados a su key_id.
3. No retirar una clave por haber pasado sólo la ventana de replay de 48 h: existen
   reservas futuras con tokens hasta inicio+24 h y respaldos con ciphertext. Retirar
   únicamente después de agotar referencias/vigencias y la retención de backups.
4. Un rewrap, si se necesita, abre y vuelve a cifrar con AAD idéntico y nonce nuevo;
   no cambia token/hash/generación. No existe endpoint público para administrar
   claves ni rewrap. Ningún comando lo hace automáticamente en el propietario.

Prueba automatizada: v1 cifra; v2 activo conservando v1 descifra ese sobre; un sobre
nuevo usa v2; retirar v1 antes de tiempo falla cerrado. Se comprueba apertura y
reseal con el mismo secreto sin imprimirlo. No se afirma una rotación productiva.

## Backup y recuperación del keyring

Las funciones backupKeyring/restoreKeyring usan otra clave de recuperación CSPRNG
de 32 bytes, independiente de las claves de datos y desafío. El keyring serializado
se cifra AES-GCM con dominio/AAD merivo-public-keyring-backup-v1. El backup cifrado
y la clave de recuperación se custodian por separado, fuera de Git y PostgreSQL.

En esta fase se prueba con artefactos sólo en memoria: crear sobre, respaldar
keyring cifrado, reconstruir el runtime desde ese backup y descifrar el sobre
original. Una clave de recuperación incorrecta o tag alterado se rechazan. El
backup no es texto plano ni contiene un mecanismo de recuperación por contacto.

Antes de producción habrá que asignar custodios y ubicaciones privadas concretas,
acceso mínimo, retención, recuperación del entorno y simulacro operacional con la
infraestructura elegida. Eso no está provisionado ni certificado aquí. Si se pierden
keyring y su respaldo/clave de recuperación, no existe recuperación criptográfica
garantizada. No almacenar un master secret en la misma base como atajo.

## Rotación y revocación de capacidades

La rotación de una clave AES no rota los tokens. La función privada de mantenimiento
app.rotate_public_capability crea una nueva generación y revoca la anterior bajo
raíz, con sobre y expiración explícitos. No tiene EXECUTE de roles de aplicación.
Registra una auditoría de seguridad con actor system, rol de mantenimiento,
generaciones, expiración y request_id; nunca incluye el secreto del token.
No hay botón público de rotación ni recuperación administrativa por email en este
bloque; el test utiliza exclusivamente mantenimiento privilegiado del fixture.

Una generación revocada/vencida no autoriza lectura, replay o cambios. Un movimiento
administrativo no prorroga ese token. Una reprogramación pública autorizada ajusta
la vigencia y el AAD; la actualización exige que la generación siga activa y no
haya vencido. El enlace original sigue conteniendo el mismo secreto para esa
generación. La cancelación deja sólo lectura hasta expiración.

La autorización se decide dentro de SQL tras la espera por la raíz. Una respuesta
ya autorizada puede llegar después de una revocación posterior al commit; ese
secreto no recupera validez y su uso posterior se rechaza. No se mantienen locks
mientras se devuelve la respuesta o se realiza trabajo criptográfico/externo.

## Logs y límites del entorno

Los handlers no registran bodies, cookies, tokens, sobres, claves o URLs con bearer.
Las consultas del backend son parametrizadas y sus excepciones se convierten en
errores permitidos, sin volcar detalles SQL. request_id es sólo correlación.

El harness configura únicamente su PostgreSQL UUID para no registrar sentencias
de error ni parámetros; comprueba esos ajustes antes de los fixtures de capacidad.
Next temporal no vuelca stdout/stderr de solicitudes. Los tests comparan resultados
secretos como booleanos, sin introducirlos como expected/actual de diagnósticos.

Producción permanece bloqueada tanto por configuración del proceso como por el
marcador privado de BD, inicialmente false y sin setter de aplicación. Antes de
usar datos reales se deberán revisar logs del proveedor, capturas de observabilidad,
TLS/proxy, cookies Secure, desafío real y secret store. El desafío HMAC del harness
es explícitamente sintético; no se presenta como CAPTCHA ni seguridad humana real.
