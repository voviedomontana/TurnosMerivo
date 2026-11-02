import { describe, it, expect } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import {
  issueChallenge,
  verifyChallenge,
} from "@/modules/public-booking/challenge";
import { publicConfig } from "@/modules/public-booking/config";
describe("disposable public security boundaries", () => {
  const key = randomBytes(32),
    id = randomUUID(),
    now = 1793635200000;
  it("binds challenge to business, action, resource and bounded expiry", () => {
    const proof = issueChallenge(key, "merivo", "create", id, now);
    expect(
      verifyChallenge(key, proof, "merivo", "create", id, now).resource,
    ).toBe(id);
    for (const [slug, action, resource, clock] of [
      ["other", "create", id, now],
      ["merivo", "cancel", id, now],
      ["merivo", "create", randomUUID(), now],
      ["merivo", "create", id, now + 90000],
    ] as const)
      expect(() =>
        verifyChallenge(key, proof, slug, action, resource, clock),
      ).toThrow();
  });
  it("rejects changed signature, signing key and unbounded signed values", () => {
    const proof = issueChallenge(key, "merivo", "create", id, now);
    expect(() =>
      verifyChallenge(randomBytes(32), proof, "merivo", "create", id, now),
    ).toThrow();
    expect(() =>
      verifyChallenge(key, proof + ".extra", "merivo", "create", id, now),
    ).toThrow();
    expect(() =>
      verifyChallenge(key, proof, "merivo", "create", id, now - 1000),
    ).toThrow();
  });
  it("has no production bypass via environment or spoofed proxy mode", () => {
    const env = {
      PUBLIC_BOOKING_ENVIRONMENT: "discardable",
      PUBLIC_BOOKING_NETWORK_MODE: "loopback-only",
      PUBLIC_BOOKING_TEST_ORIGIN: "http://127.0.0.1:3333",
      PUBLIC_BOOKING_TEST_CHALLENGE_KEY: randomBytes(32).toString("base64url"),
      PUBLIC_BOOKING_ENCRYPTION_KEYS: JSON.stringify({
        active: "v1",
        keys: { v1: randomBytes(32).toString("base64url") },
      }),
    };
    expect(publicConfig(env).origin).toBe(env.PUBLIC_BOOKING_TEST_ORIGIN);
    for (const invalid of [
      { ...env, PUBLIC_BOOKING_ENVIRONMENT: "production" },
      { ...env, PUBLIC_BOOKING_TEST_ORIGIN: "https://example.com" },
      { ...env, PUBLIC_BOOKING_NETWORK_MODE: "x-forwarded-for" },
      { ...env, PUBLIC_BOOKING_ENCRYPTION_KEYS: "{}" },
    ])
      expect(() => publicConfig(invalid)).toThrow();
  });
});
