import { describe, it, expect } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import {
  parseKeyring,
  sealToken,
  openToken,
  backupKeyring,
  restoreKeyring,
} from "@/modules/public-booking/crypto";
const key = () => randomBytes(32).toString("base64url");
const aad = {
  business_id: randomUUID(),
  appointment_id: randomUUID(),
  generation: 1,
  expires_at: "2026-11-03T12:00:00.000Z",
};
describe("public booking key custody", () => {
  it("encrypts with a fresh nonce and binds all capability metadata", () => {
    const ring = parseKeyring(
        JSON.stringify({ active: "v1", keys: { v1: key() } }),
      ),
      token = key(),
      a = sealToken(ring, token, aad),
      b = sealToken(ring, token, aad);
    expect(a.nonce).not.toBe(b.nonce);
    expect(JSON.stringify(a).includes(token)).toBe(false);
    expect(openToken(ring, a, aad) === token).toBe(true);
    for (const altered of [
      { ...aad, business_id: randomUUID() },
      { ...aad, appointment_id: randomUUID() },
      { ...aad, generation: 2 },
      { ...aad, expires_at: "2026-11-04T12:00:00.000Z" },
    ])
      expect(() => openToken(ring, a, altered)).toThrow();
  });
  it("rejects wrong nonce, authentication tag, ciphertext and unknown key id", () => {
    const ring = parseKeyring(
        JSON.stringify({ active: "v1", keys: { v1: key() } }),
      ),
      envelope = sealToken(ring, key(), aad);
    for (const changed of [
      { ...envelope, nonce: randomBytes(12).toString("base64url") },
      { ...envelope, tag: randomBytes(16).toString("base64url") },
      { ...envelope, ciphertext: key() },
      { ...envelope, key_id: "missing" },
    ])
      expect(() => openToken(ring, changed, aad)).toThrow();
  });
  it("rotates encryption without discarding keys needed for old replay", () => {
    const first = key(),
      v1 = parseKeyring(JSON.stringify({ active: "v1", keys: { v1: first } })),
      token = key(),
      old = sealToken(v1, token, aad),
      v2 = parseKeyring(
        JSON.stringify({ active: "v2", keys: { v1: first, v2: key() } }),
      );
    expect(openToken(v2, old, aad) === token).toBe(true);
    const wrapped = sealToken(v2, openToken(v2, old, aad), aad);
    expect(wrapped.key_id).toBe("v2");
    expect(openToken(v2, wrapped, aad) === token).toBe(true);
    expect(() =>
      openToken(
        parseKeyring(JSON.stringify({ active: "v2", keys: { v2: key() } })),
        old,
        aad,
      ),
    ).toThrow();
  });
  it("recovers lost runtime keys only from an authenticated encrypted backup and independent recovery key", () => {
    const ring = parseKeyring(
        JSON.stringify({ active: "v1", keys: { v1: key() } }),
      ),
      recovery = randomBytes(32),
      token = key(),
      envelope = sealToken(ring, token, aad),
      backup = backupKeyring(ring, recovery);
    expect(JSON.stringify(backup).includes(ring.keys.v1)).toBe(false);
    const recovered = restoreKeyring(backup, recovery);
    expect(openToken(recovered, envelope, aad) === token).toBe(true);
    expect(() => restoreKeyring(backup, randomBytes(32))).toThrow();
    expect(() =>
      restoreKeyring(
        { ...backup, tag: randomBytes(16).toString("base64url") },
        recovery,
      ),
    ).toThrow();
  });
  it.each([
    "",
    "{}",
    JSON.stringify({ active: "v1", keys: { v1: "short" } }),
    JSON.stringify({ active: "v2", keys: { v1: key() } }),
  ])("fails closed for invalid key custody configuration", (input) => {
    expect(() => parseKeyring(input)).toThrow();
  });
});
