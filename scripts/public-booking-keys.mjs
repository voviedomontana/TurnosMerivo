import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import {
  readFile,
  open,
  realpath,
  lstat,
  unlink,
  mkdtemp,
  rmdir,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseKeyring,
  backupKeyring,
  restoreKeyring,
  sealToken,
  openToken,
} from "../src/modules/public-booking/crypto.ts";

const repository = await realpath(new URL("..", import.meta.url));
const key = () => randomBytes(32).toString("base64url");
function recoveryKey(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value))
    throw Error("INVALID_RECOVERY_KEY");
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length !== 32 || bytes.toString("base64url") !== value)
    throw Error("INVALID_RECOVERY_KEY");
  return bytes;
}
function independent(ring, recovery) {
  if (
    Object.values(ring.keys).some((v) =>
      timingSafeEqual(Buffer.from(v, "base64url"), recovery),
    )
  )
    throw Error("RECOVERY_KEY_NOT_INDEPENDENT");
}
async function outsideRepository(filename, exists) {
  if (!filename || !path.isAbsolute(filename))
    throw Error("ABSOLUTE_PATH_REQUIRED");
  const absolute = exists
    ? await realpath(filename)
    : path.join(
        await realpath(path.dirname(filename)),
        path.basename(filename),
      );
  const relative = path.relative(repository, absolute);
  if (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  )
    throw Error("BACKUP_MUST_BE_OUTSIDE_REPOSITORY");
  if (exists) {
    const stat = await lstat(filename);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 65536)
      throw Error("INVALID_BACKUP_FILE");
  }
  return absolute;
}
async function save(filename, ring, recovery) {
  independent(ring, recovery);
  const destination = await outsideRepository(filename, false);
  const envelope = backupKeyring(ring, recovery);
  if (!matches(ring, restoreKeyring(envelope, recovery)))
    throw Error("BACKUP_VERIFICATION_FAILED");
  const content = JSON.stringify(envelope);
  if (Buffer.byteLength(content) > 65536) throw Error("BACKUP_TOO_LARGE");
  const file = await open(destination, "wx", 0o600);
  try {
    await file.writeFile(content, "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
}
async function restore(filename, recovery) {
  const source = await outsideRepository(filename, true);
  return restoreKeyring(JSON.parse(await readFile(source, "utf8")), recovery);
}
function matches(a, b) {
  const ids = Object.keys(a.keys).sort();
  return (
    a.active === b.active &&
    ids.join("\n") === Object.keys(b.keys).sort().join("\n") &&
    ids.every((id) =>
      timingSafeEqual(
        Buffer.from(a.keys[id], "base64url"),
        Buffer.from(b.keys[id], "base64url"),
      ),
    )
  );
}
async function drill() {
  // Synthetic material only. Never load the operator's environment or database.
  const directory = await mkdtemp(path.join(tmpdir(), "merivo-key-drill-"));
  const filename = path.join(directory, "keyring.encrypted.json");
  try {
    const first = parseKeyring(
      JSON.stringify({ active: "v1", keys: { v1: key() } }),
    );
    const ring = parseKeyring(
      JSON.stringify({ active: "v2", keys: { ...first.keys, v2: key() } }),
    );
    const token = key(),
      recovery = randomBytes(32);
    const aad = {
      business_id: randomUUID(),
      appointment_id: randomUUID(),
      generation: 1,
      expires_at: "2030-01-01T00:00:00.000Z",
    };
    const envelope = sealToken(first, token, aad);
    await save(filename, ring, recovery);
    const restored = await restore(filename, recovery);
    if (
      !matches(ring, restored) ||
      openToken(restored, envelope, aad) !== token
    )
      throw Error("DRILL_FAILED");
    let wrongKeyRejected = false;
    try {
      await restore(filename, randomBytes(32));
    } catch {
      wrongKeyRejected = true;
    }
    if (!wrongKeyRejected) throw Error("DRILL_FAILED");
    return {
      status: "PASS",
      synthetic: true,
      encrypted_file_restore: true,
      retained_key_decryption: true,
      wrong_recovery_key_rejected: true,
    };
  } finally {
    // Only remove the exact file and directory created by this invocation.
    await unlink(filename).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
    await rmdir(directory);
  }
}

try {
  const [command, option, filename, ...extra] = process.argv.slice(2);
  if (extra.length) throw Error("INVALID_ARGUMENTS");
  let result;
  if (command === "drill" && !option) {
    result = await drill();
  } else if (
    ["backup", "verify"].includes(command) &&
    option === (command === "backup" ? "--output" : "--input") &&
    filename
  ) {
    const ring = parseKeyring(process.env.PUBLIC_BOOKING_ENCRYPTION_KEYS ?? "");
    const recovery = recoveryKey(process.env.PUBLIC_BOOKING_RECOVERY_KEY);
    independent(ring, recovery);
    if (command === "backup") {
      await save(filename, ring, recovery);
      result = { status: "PASS", encrypted_backup_written: true };
    } else {
      if (!matches(ring, await restore(filename, recovery)))
        throw Error("KEYRING_MISMATCH");
      result = { status: "PASS", backup_matches_configured_keyring: true };
    }
  } else throw Error("INVALID_ARGUMENTS");
  console.log(JSON.stringify(result));
} catch {
  // Never print exceptions, paths, key IDs, arguments, keys or recovered plaintext.
  console.error(
    "Public booking key operation failed. Check arguments, private configuration, file permissions and backup integrity. No keys were printed or exported.",
  );
  process.exitCode = 1;
}
