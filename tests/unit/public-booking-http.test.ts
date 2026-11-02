import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { randomBytes } from "node:crypto";
const mock = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/modules/public-booking/repository", () => ({
  publicQuery: mock.query,
  PublicBookingError: class extends Error {
    constructor(
      public code: string,
      public status: number,
    ) {
      super(code);
    }
  },
}));
import { handlePublicBooking } from "@/modules/public-booking/http";
import {
  issueChallenge,
  verifyChallenge,
} from "@/modules/public-booking/challenge";
import { createInput } from "@/modules/public-booking/schemas";
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("PUBLIC_BOOKING_ENVIRONMENT", "discardable");
  vi.stubEnv("PUBLIC_BOOKING_TEST_ORIGIN", "http://127.0.0.1:3333");
  vi.stubEnv("PUBLIC_BOOKING_NETWORK_MODE", "loopback-only");
  vi.stubEnv(
    "PUBLIC_BOOKING_TEST_CHALLENGE_KEY",
    randomBytes(32).toString("base64url"),
  );
  vi.stubEnv(
    "PUBLIC_BOOKING_ENCRYPTION_KEYS",
    JSON.stringify({
      active: "v1",
      keys: { v1: randomBytes(32).toString("base64url") },
    }),
  );
  mock.query.mockResolvedValue(false);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("staging HTTP integration with simulated provider", () => {
  function setup() {
    const origin = "https://staging.example.test",
      id = "79000000-0000-4000-8000-000000000001";
    for (const [name, value] of Object.entries({
      PUBLIC_BOOKING_ENVIRONMENT: "staging",
      PUBLIC_BOOKING_ORIGIN: origin,
      VERCEL: "1",
      VERCEL_ENV: "preview",
      VERCEL_PROJECT_ID: "prj_test",
      PUBLIC_BOOKING_VERCEL_PROJECT_ID: "prj_test",
      PUBLIC_BOOKING_NETWORK_MODE: "vercel-direct",
      PUBLIC_BOOKING_NETWORK_KEY: randomBytes(32).toString("base64url"),
      PUBLIC_BOOKING_CHALLENGE_KEY: randomBytes(32).toString("base64url"),
      PUBLIC_BOOKING_TURNSTILE_SITE_KEY: "synthetic-turnstile-site",
      PUBLIC_BOOKING_TURNSTILE_SECRET: "synthetic-turnstile-secret",
    }))
      vi.stubEnv(name, value);
    const events: string[] = [];
    mock.query.mockImplementation(
      async (statement: string, values: (string | number | null)[]) => {
        if (statement.includes("public_staging_ready")) return true;
        if (statement.includes("get_public_business")) return { id };
        if (statement.includes("public_quota")) {
          events.push(`quota:${values[0]}`);
          return true;
        }
        if (statement.includes("public_create")) {
          events.push("create");
          return {
            id,
            business_id: id,
            status: "confirmed",
            version: 1,
            starts_at: "2026-11-03T12:00:00Z",
            ends_at: "2026-11-03T12:30:00Z",
            blocked_until: "2026-11-03T12:45:00Z",
            envelope: JSON.parse(String(values[8])),
            token_expires_at: values[7],
            generation: 1,
          };
        }
        throw Error("Unexpected staging query");
      },
    );
    const challenge = issueChallenge(
      Buffer.from(process.env.PUBLIC_BOOKING_CHALLENGE_KEY!, "base64url"),
      "merivo-test",
      "create",
      id,
    );
    const proof = verifyChallenge(
      Buffer.from(process.env.PUBLIC_BOOKING_CHALLENGE_KEY!, "base64url"),
      challenge,
      "merivo-test",
      "create",
      id,
    );
    const body = {
      id,
      attempt_id: id,
      staff_id: id,
      service_id: id,
      quote_id: id,
      starts_at: "2026-11-03T12:00:00Z",
      customer: { full_name: "Synthetic", phone_raw: "1144445555" },
      privacy_policy_version: "test-notice",
    };
    const request = (network = true) =>
      new Request(`${origin}/api`, {
        method: "POST",
        headers: {
          host: "staging.example.test",
          origin,
          "x-merivo-public": "1",
          "idempotency-key": id,
          "x-merivo-challenge": challenge,
          "x-merivo-human": "synthetic-token",
          cookie: `merivo_attempt_${id}=${randomBytes(32).toString("base64url")}`,
          ...(network ? { "x-vercel-forwarded-for": "192.0.2.1" } : {}),
        },
        body: JSON.stringify(body),
      });
    return { events, proof, request };
  }
  it("verifies human authority before quota consumption or reservation transaction", async () => {
    const f = setup();
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockImplementation(async () => {
        f.events.push("provider");
        return Response.json({
          success: true,
          hostname: "staging.example.test",
          action: "create",
          cdata: f.proof.nonce,
          challenge_ts: new Date().toISOString(),
        });
      }),
    );
    const response = await handlePublicBooking(f.request(), {
      slug: "merivo-test",
      kind: "create",
    });
    expect(response.status).toBe(201);
    expect(f.events).toEqual([
      "quota:read",
      "provider",
      "quota:write",
      "create",
    ]);
  });
  it("denies failed human checks without mutation or write nonce consumption", async () => {
    const f = setup();
    vi.stubGlobal(
      "fetch",
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(Response.json({ success: false })),
    );
    expect(
      (
        await handlePublicBooking(f.request(), {
          slug: "merivo-test",
          kind: "create",
        })
      ).status,
    ).toBe(403);
    expect(f.events).toEqual(["quota:read"]);
  });
  it("does not fall back to caller forwarded headers when platform identity is missing", async () => {
    const f = setup(),
      provider = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", provider);
    const request = f.request(false);
    request.headers.set("x-forwarded-for", "192.0.2.1");
    expect(
      (
        await handlePublicBooking(request, {
          slug: "merivo-test",
          kind: "create",
        })
      ).status,
    ).toBe(503);
    expect(provider).not.toHaveBeenCalled();
    expect(f.events).toEqual([]);
  });
});
describe("public booking transport gates", () => {
  it("preserves public customer fields without private notes and returns a recoverable encrypted create", async () => {
    const id = "79000000-0000-4000-8000-000000000001",
      attempt = "89000000-0000-4000-8000-000000000001",
      business = "19000000-0000-4000-8000-000000000001";
    const body = {
      id,
      attempt_id: attempt,
      staff_id: id,
      service_id: id,
      starts_at: "2026-11-03T09:00:00-03:00",
      quote_id: id,
      customer: { full_name: "Fixture", phone_raw: "1144445555" },
      privacy_policy_version: "test-notice-v1",
    };
    expect(Object.keys(createInput.parse(body).customer).sort()).toEqual([
      "email",
      "full_name",
      "instagram_handle",
      "phone_raw",
    ]);
    mock.query.mockImplementation(
      async (statement: string, values: (string | number | null)[]) => {
        if (statement.includes("public_runtime_ready")) return true;
        if (statement.includes("get_public_business")) return { id: business };
        if (statement.includes("public_quota")) return true;
        if (statement.includes("public_create"))
          return {
            id,
            business_id: business,
            status: "confirmed",
            version: 1,
            starts_at: body.starts_at,
            ends_at: "2026-11-03T12:30:00Z",
            blocked_until: "2026-11-03T12:45:00Z",
            envelope: JSON.parse(String(values[8])),
            token_expires_at: values[7],
            generation: 1,
          };
        throw Error("Unexpected query");
      },
    );
    const proof = issueChallenge(
      Buffer.from(process.env.PUBLIC_BOOKING_TEST_CHALLENGE_KEY!, "base64url"),
      "merivo-test",
      "create",
      id,
    );
    const r = await handlePublicBooking(
      new Request("http://localhost:3333/api/create", {
        method: "POST",
        headers: {
          Host: "127.0.0.1:3333",
          Origin: "http://127.0.0.1:3333",
          "Content-Type": "application/json",
          "X-Merivo-Public": "1",
          "Idempotency-Key": id,
          "X-Merivo-Challenge": proof,
          Cookie: `merivo_attempt_${attempt}=${"b".repeat(43)}`,
        },
        body: JSON.stringify(body),
      }),
      { slug: "merivo-test", kind: "create" },
    );
    expect(r.status).toBe(201);
    const result = await r.json();
    expect(
      typeof result.manage_url === "string" &&
        result.manage_url.includes("#t="),
    ).toBe(true);
    expect(result).not.toHaveProperty("envelope");
  });
  it("pins the actual Host and configured Origin even when Next supplies an internal URL", async () => {
    const r = await handlePublicBooking(
      new Request("http://localhost:3333/api/availability", {
        headers: { Host: "127.0.0.1:3333", "X-Merivo-Public": "1" },
      }),
      { slug: "merivo-test", kind: "availability" },
    );
    expect(r.status).toBe(503);
    expect((await r.json()).code).toBe("PUBLIC_BOOKING_DISABLED");
    expect(mock.query).toHaveBeenCalledTimes(1);
  });
  it("returns a retryable failure instead of a client validation error if creation response validation fails after SQL", async () => {
    const id = "79000000-0000-4000-8000-000000000001";
    mock.query.mockImplementation(async (statement: string) =>
      statement.includes("public_runtime_ready") ||
      statement.includes("public_quota")
        ? true
        : statement.includes("get_public_business")
          ? { id }
          : { id },
    );
    const proof = issueChallenge(
      Buffer.from(process.env.PUBLIC_BOOKING_TEST_CHALLENGE_KEY!, "base64url"),
      "merivo-test",
      "create",
      id,
    );
    const response = await handlePublicBooking(
      new Request("http://localhost:3333/create", {
        method: "POST",
        headers: {
          Host: "127.0.0.1:3333",
          Origin: "http://127.0.0.1:3333",
          "Content-Type": "application/json",
          "X-Merivo-Public": "1",
          "Idempotency-Key": id,
          "X-Merivo-Challenge": proof,
          Cookie: `merivo_attempt_${id}=${"b".repeat(43)}`,
        },
        body: JSON.stringify({
          id,
          attempt_id: id,
          staff_id: id,
          service_id: id,
          quote_id: id,
          starts_at: "2026-11-03T12:00:00Z",
          customer: { full_name: "Fixture", phone_raw: "1144445555" },
          privacy_policy_version: "test-notice-v1",
        }),
      }),
      { slug: "merivo-test", kind: "create" },
    );
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("UNAVAILABLE");
    expect(
      mock.query.mock.calls.some(([statement]) =>
        String(statement).includes("public_create"),
      ),
    ).toBe(true);
  });
  it.each([
    {
      Host: "untrusted.example",
      "X-Forwarded-Host": "127.0.0.1:3333",
      "X-Merivo-Public": "1",
    },
    { Host: "127.0.0.1:3333" },
    {
      Host: "127.0.0.1:3333",
      "X-Merivo-Public": "1",
      Origin: "https://untrusted.example",
    },
    {
      Host: "127.0.0.1:3333",
      "X-Merivo-Public": "1",
      Origin: "http://127.0.0.1:3333",
      "Sec-Fetch-Site": "cross-site",
    },
  ])("rejects invalid origin/transport before DB", async (headers) => {
    const transportHeaders = new Headers();
    for (const [name, value] of Object.entries(headers))
      if (typeof value === "string") transportHeaders.set(name, value);
    const r = await handlePublicBooking(
      new Request("http://localhost:3333/api/attempts", {
        method: "POST",
        headers: transportHeaders,
        body: "{}",
      }),
      { slug: "merivo-test", kind: "attempt" },
    );
    expect(r.status).toBe(403);
    expect(mock.query).not.toHaveBeenCalled();
  });
  it("fails closed outside disposable configuration without loading a database", async () => {
    vi.stubEnv("PUBLIC_BOOKING_ENVIRONMENT", "production");
    const r = await handlePublicBooking(new Request("http://localhost/api"), {
      slug: "merivo-test",
      kind: "attempt",
    });
    expect(r.status).toBe(503);
    expect(mock.query).not.toHaveBeenCalled();
  });
});
