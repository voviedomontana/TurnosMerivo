import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  getUser: vi.fn(),
  query: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/ssr", () => ({ createServerClient: mocks.create }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ getAll: () => [], set: vi.fn() }),
}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/config", () => ({
  getSupabaseConfig: () => ({
    url: "http://127.0.0.1:9998",
    publishableKey: "sb_publishable_fixture",
  }),
}));

import { getRequestId } from "@/lib/http/request-id";
import { handleAuthRequest } from "@/modules/auth/http";
import { updateMemberAction } from "@/modules/auth/actions";

const businessId = "16000000-0000-4000-8000-000000000001";
const memberId = "26000000-0000-4000-8000-000000000001";
const key = "36000000-0000-4000-8000-000000000001";
const traceA = "46000000-0000-4000-8000-000000000001";
const traceB = "46000000-0000-4000-8000-000000000002";
const uuid = /^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function update(trace?: string) {
  return new Request(
    "http://localhost/api/v1/businesses/example/members/example",
    {
      method: "PATCH",
      headers: {
        Authorization: "Bearer fixture-token",
        "Idempotency-Key": key,
        "If-Match": '"1"',
        "Content-Type": "application/json",
        ...(trace ? { "X-Request-Id": trace } : {}),
      },
      body: JSON.stringify({ role: "barber", status: "suspended" }),
    },
  );
}
function list(query = "") {
  return new Request(
    `http://localhost/api/v1/businesses/example/members${query}`,
    {
      headers: {
        Authorization: "Bearer fixture-token",
        "X-Request-Id": traceA,
      },
    },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { email_confirmed_at: "2026-11-01T00:00:00Z" } },
    error: null,
  });
  mocks.create.mockImplementation(
    (
      _url: string,
      _key: string,
      options: { global: { headers: Record<string, string> } },
    ) => ({
      auth: { getUser: mocks.getUser },
      schema: () => ({
        rpc: (name: string, args: Record<string, unknown>) =>
          mocks.query(name, args, options.global.headers["X-Request-Id"]),
      }),
    }),
  );
});
describe("C-03 per-attempt correlation", () => {
  it.each([undefined, "invalid", " ", "line\nvalue"])(
    "generates a valid UUID for absent/invalid metadata: %s",
    (value) => {
      expect(getRequestId(value)).toMatch(uuid);
      expect(getRequestId(value)).not.toBe(getRequestId(value));
    },
  );
  it("normalizes a valid supplied UUID", () =>
    expect(getRequestId(traceA.toUpperCase())).toBe(traceA));
  it("forwards the HTTP ID through the actual SSR client headers", async () => {
    mocks.query.mockResolvedValue({ data: { version: 2 }, error: null });
    const response = await handleAuthRequest(update(traceA), "update", {
      businessId,
      memberId,
    });
    expect(response.headers.get("X-Request-Id")).toBe(traceA);
    expect(mocks.query).toHaveBeenCalledWith(
      "update_member",
      expect.objectContaining({ p_key: key }),
      traceA,
    );
    expect(mocks.create.mock.calls[0][2].global.headers.Authorization).toBe(
      "Bearer fixture-token",
    );
    expect(mocks.create.mock.calls[0][2].cookieOptions.httpOnly).toBe(true);
  });
  it("keeps concurrent request IDs isolated and independent of the replay key", async () => {
    mocks.query.mockImplementation(async () => {
      await Promise.resolve();
      return { data: { version: 2 }, error: null };
    });
    const responses = await Promise.all(
      [traceA, traceB].map((id) =>
        handleAuthRequest(update(id), "update", { businessId, memberId }),
      ),
    );
    expect(responses.map((r) => r.headers.get("X-Request-Id"))).toEqual([
      traceA,
      traceB,
    ]);
    expect(mocks.query.mock.calls.map((c) => c[2]).sort()).toEqual([
      traceA,
      traceB,
    ]);
    expect(mocks.query.mock.calls.every((c) => c[1].p_key === key)).toBe(true);
  });
  it("returns a replacement ID on errors without echoing malformed metadata", async () => {
    mocks.query.mockResolvedValue({
      data: null,
      error: { code: "PT403", message: "FORBIDDEN" },
    });
    const response = await handleAuthRequest(update("invalid"), "update", {
      businessId,
      memberId,
    });
    const problem = await response.json();
    expect(response.status).toBe(403);
    expect(problem.request_id).toMatch(uuid);
    expect(problem.request_id).toBe(response.headers.get("X-Request-Id"));
    expect(mocks.query.mock.calls[0][2]).toBe(problem.request_id);
  });
  it("generates and returns a separate ID for each direct Server Action attempt", async () => {
    mocks.query.mockResolvedValue({ data: { version: 2 }, error: null });
    const form = new FormData();
    for (const [name, value] of Object.entries({
      businessId,
      memberId,
      key,
      version: "1",
      role: "barber",
      status: "suspended",
      request_id: traceA,
    }))
      form.set(name, value);
    const a = await updateMemberAction({}, form),
      b = await updateMemberAction({}, form);
    expect(a.request_id).toMatch(uuid);
    expect(b.request_id).toMatch(uuid);
    expect(a.request_id).not.toBe(b.request_id);
    expect(a.request_id).not.toBe(key);
    expect(a.request_id).not.toBe(traceA);
    expect(mocks.query.mock.calls.map((c) => c[2])).toEqual([
      a.request_id,
      b.request_id,
    ]);
  });
});
describe("C-04 compatible opt-in pagination", () => {
  it("keeps the legacy endpoint and RPC complete", async () => {
    const data = Array.from({ length: 213 }, () => ({
      id: crypto.randomUUID(),
      user_id: null,
      email: "fixture@example.test",
      role: "barber",
      status: "invited",
      version: 1,
      expires_at: null,
    }));
    mocks.query.mockResolvedValue({ data, error: null });
    const response = await handleAuthRequest(list(), "list", { businessId });
    expect((await response.json()).data).toHaveLength(213);
    expect(mocks.query.mock.calls[0][0]).toBe("list_members");
  });
  it.each([
    ["?cursor=abc", 50, "abc"],
    ["?limit=200", 200, null],
    ["?limit=50&cursor=abc", 50, "abc"],
  ])("uses the new RPC for %s", async (query, limit, cursor) => {
    mocks.query.mockResolvedValue({
      data: { data: [], page: { next_cursor: null, has_more: false } },
      error: null,
    });
    const response = await handleAuthRequest(list(query), "list", {
      businessId,
    });
    expect(response.status).toBe(200);
    expect(mocks.query).toHaveBeenCalledWith(
      "list_members_page",
      { p_business_id: businessId, p_limit: limit, p_cursor: cursor },
      traceA,
    );
  });
  it.each([
    "?limit=0",
    "?limit=201",
    "?limit=1.5",
    "?limit=-1",
    "?limit=",
    "?limit=50&limit=100",
    "?cursor=",
    "?cursor=!",
    "?cursor=a&cursor=b",
  ])("rejects malformed paging input: %s", async (query) => {
    const response = await handleAuthRequest(list(query), "list", {
      businessId,
    });
    expect(response.status).toBe(400);
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it.each([
    ["PT404", "NOT_FOUND", 404],
    ["PT403", "MFA_REQUIRED", 403],
    ["PT400", "VALIDATION_ERROR", 400],
  ])(
    "preserves SQL reauthorization/cursor rejection %s",
    async (code, message, status) => {
      mocks.query.mockResolvedValue({ data: null, error: { code, message } });
      expect(
        (
          await handleAuthRequest(list("?limit=50&cursor=abc"), "list", {
            businessId,
          })
        ).status,
      ).toBe(status);
    },
  );
});
