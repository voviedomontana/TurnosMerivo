import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { z } from "zod";
const encoded = (bytes: number) =>
  z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .refine(
      (v) =>
        Buffer.from(v, "base64url").length === bytes &&
        Buffer.from(v, "base64url").toString("base64url") === v,
    );
const keyId = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
const keyringSchema = z
  .object({ active: keyId, keys: z.record(keyId, encoded(32)) })
  .strict()
  .refine((v) => Object.hasOwn(v.keys, v.active));
export type Keyring = z.infer<typeof keyringSchema>;
export function parseKeyring(value: string): Keyring {
  try {
    return keyringSchema.parse(JSON.parse(value));
  } catch {
    throw Error("KEY_CONFIGURATION_UNAVAILABLE");
  }
}
export const envelopeSchema = z
  .object({
    key_id: keyId,
    nonce: encoded(12),
    tag: encoded(16),
    ciphertext: z
      .string()
      .regex(/^[A-Za-z0-9_-]+$/)
      .max(8192),
  })
  .strict();
export type Envelope = z.infer<typeof envelopeSchema>;
export type TokenAAD = {
  business_id: string;
  appointment_id: string;
  generation: number;
  expires_at: string;
};
function tokenAAD(aad: TokenAAD) {
  return Buffer.from(
    JSON.stringify([
      "merivo-manage-v1",
      z.uuid().parse(aad.business_id).toLowerCase(),
      z.uuid().parse(aad.appointment_id).toLowerCase(),
      z.number().int().positive().parse(aad.generation),
      new Date(
        z.iso.datetime({ offset: true }).parse(aad.expires_at),
      ).toISOString(),
    ]),
  );
}
function encrypt(
  key: Buffer,
  key_id: string,
  value: Buffer,
  aad: Buffer,
): Envelope {
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return {
    key_id,
    nonce: nonce.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
  };
}
function decrypt(key: Buffer, envelope: Envelope, aad: Buffer) {
  const e = envelopeSchema.parse(envelope),
    cipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(e.nonce, "base64url"),
    );
  cipher.setAAD(aad);
  cipher.setAuthTag(Buffer.from(e.tag, "base64url"));
  return Buffer.concat([
    cipher.update(Buffer.from(e.ciphertext, "base64url")),
    cipher.final(),
  ]);
}
export function sealToken(ring: Keyring, token: string, aad: TokenAAD) {
  const valid = keyringSchema.parse(ring);
  encoded(32).parse(token);
  return encrypt(
    Buffer.from(valid.keys[valid.active], "base64url"),
    valid.active,
    Buffer.from(token),
    tokenAAD(aad),
  );
}
export function openToken(
  ring: Keyring,
  envelope: Envelope,
  aad: TokenAAD,
): string {
  try {
    const valid = keyringSchema.parse(ring),
      e = envelopeSchema.parse(envelope);
    if (!Object.hasOwn(valid.keys, e.key_id)) throw Error();
    return encoded(32).parse(
      decrypt(
        Buffer.from(valid.keys[e.key_id], "base64url"),
        e,
        tokenAAD(aad),
      ).toString(),
    );
  } catch {
    throw Error("TOKEN_RECOVERY_UNAVAILABLE");
  }
}
const recoveryAAD = Buffer.from("merivo-public-keyring-backup-v1");
export function backupKeyring(ring: Keyring, recoveryKey: Buffer) {
  if (recoveryKey.length !== 32) throw Error("RECOVERY_KEY_INVALID");
  return encrypt(
    recoveryKey,
    "recovery-v1",
    Buffer.from(JSON.stringify(keyringSchema.parse(ring))),
    recoveryAAD,
  );
}
export function restoreKeyring(backup: Envelope, recoveryKey: Buffer) {
  try {
    if (recoveryKey.length !== 32 || backup.key_id !== "recovery-v1")
      throw Error();
    return parseKeyring(decrypt(recoveryKey, backup, recoveryAAD).toString());
  } catch {
    throw Error("KEY_RECOVERY_UNAVAILABLE");
  }
}
