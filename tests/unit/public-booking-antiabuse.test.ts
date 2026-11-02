import { describe, it, expect, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import {
  networkIdentity,
  verifyHuman,
} from "@/modules/public-booking/antiabuse";
import { publicConfig, runtimeGate } from "@/modules/public-booking/config";
const human = {
  secret: "synthetic-secret-never-real",
  siteKey: "synthetic-site-never-real",
  hostname: "staging.example.test",
};
const nonce = randomUUID(),
  now = Date.parse("2026-11-02T12:00:00Z");
const result = {
  success: true,
  hostname: human.hostname,
  action: "create",
  cdata: nonce,
  challenge_ts: new Date(now).toISOString(),
};
describe("hosted antiabuse adapter", () => {
  it("verifies at the fixed provider without sending network identity or request data", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json(result));
    await verifyHuman(human, "synthetic-token", "create", nonce, fetcher, now);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toBe(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    );
    expect(options?.redirect).toBe("error");
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(
      [...new URLSearchParams(String(options?.body)).keys()].sort(),
    ).toEqual(["response", "secret"]);
  });
  it.each([
    { success: false },
    { hostname: "other.example.test" },
    { action: "cancel" },
    { cdata: randomUUID() },
    { challenge_ts: new Date(now - 300000).toISOString() },
    { challenge_ts: new Date(now + 31000).toISOString() },
    { challenge_ts: undefined },
  ])("denies invalid provider authority or freshness %#", async (change) => {
    await expect(
      verifyHuman(
        human,
        "synthetic-token",
        "create",
        nonce,
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(Response.json({ ...result, ...change })),
        now,
      ),
    ).rejects.toThrow("CHALLENGE_INVALID");
  });
  it("fails closed on provider outage, malformed response and transport timeout", async () => {
    for (const fetcher of [
      vi
        .fn<typeof fetch>()
        .mockRejectedValue(Error("private provider diagnostic")),
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("bad", { status: 503 })),
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ success: "yes" })),
    ])
      await expect(
        verifyHuman(human, "synthetic-token", "create", nonce, fetcher, now),
      ).rejects.toThrow("HUMAN_VERIFICATION_UNAVAILABLE");
  });
  it("rejects missing or oversized tokens before external I/O", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const token of ["", "x".repeat(2049)])
      await expect(
        verifyHuman(human, token, "create", nonce, fetcher, now),
      ).rejects.toThrow("CHALLENGE_INVALID");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses only the platform header and rejects absence, lists and malformed addresses", () => {
    const key = randomBytes(32);
    for (const value of [
      "",
      "unknown",
      "192.0.2.1, 192.0.2.2",
      "[::1]",
      "fe80::1%eth0",
    ]) {
      expect(() =>
        networkIdentity(
          new Headers({
            "x-forwarded-for": "192.0.2.1",
            "x-vercel-forwarded-for": value,
          }),
          key,
          "business",
        ),
      ).toThrow();
    }
    const a = networkIdentity(
      new Headers({
        "x-vercel-forwarded-for": "192.0.2.1",
        "x-forwarded-for": "198.51.100.1",
      }),
      key,
      "business",
    );
    const b = networkIdentity(
      new Headers({
        "x-vercel-forwarded-for": "192.0.2.1",
        "x-forwarded-for": "198.51.100.2",
      }),
      key,
      "business",
    );
    expect(a === b).toBe(true);
    expect(a.includes("192.0.2.1")).toBe(false);
    expect(
      networkIdentity(
        new Headers({ "x-vercel-forwarded-for": "192.0.2.1" }),
        key,
        "other",
      ) === a,
    ).toBe(false);
    expect(
      networkIdentity(
        new Headers({ "x-vercel-forwarded-for": "::ffff:192.0.2.1" }),
        key,
        "business",
      ) === a,
    ).toBe(true);
    expect(
      networkIdentity(
        new Headers({ "x-vercel-forwarded-for": "2001:0db8:0:0:0:0:0:1" }),
        key,
        "business",
      ) ===
        networkIdentity(
          new Headers({ "x-vercel-forwarded-for": "2001:db8::1" }),
          key,
          "business",
        ),
    ).toBe(true);
  });
  it("accepts only pinned Vercel preview staging with independent private keys", () => {
    const env = {
      PUBLIC_BOOKING_ENVIRONMENT: "staging",
      PUBLIC_BOOKING_ORIGIN: "https://staging.example.test",
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_PROJECT_ID: "prj_fixture",
      PUBLIC_BOOKING_VERCEL_PROJECT_ID: "prj_fixture",
      PUBLIC_BOOKING_NETWORK_MODE: "vercel-direct",
      PUBLIC_BOOKING_NETWORK_KEY: randomBytes(32).toString("base64url"),
      PUBLIC_BOOKING_CHALLENGE_KEY: randomBytes(32).toString("base64url"),
      PUBLIC_BOOKING_TURNSTILE_SITE_KEY: human.siteKey,
      PUBLIC_BOOKING_TURNSTILE_SECRET: human.secret,
      PUBLIC_BOOKING_ENCRYPTION_KEYS: JSON.stringify({
        active: "v1",
        keys: { v1: randomBytes(32).toString("base64url") },
      }),
    };
    expect(
      runtimeGate(publicConfig(env)).statement.includes("public_staging_ready"),
    ).toBe(true);
    for (const change of [
      { VERCEL: "0" },
      { VERCEL_ENV: "production" },
      { VERCEL_PROJECT_ID: "other" },
      { PUBLIC_BOOKING_ORIGIN: "http://staging.example.test" },
      { PUBLIC_BOOKING_NETWORK_MODE: "x-forwarded-for" },
      { PUBLIC_BOOKING_ENVIRONMENT: "production" },
      { PUBLIC_BOOKING_NETWORK_KEY: env.PUBLIC_BOOKING_CHALLENGE_KEY },
      { PUBLIC_BOOKING_TURNSTILE_SITE_KEY: "1x00000000000000000000AA" },
    ])
      expect(() => publicConfig({ ...env, ...change })).toThrow();
  });
});
