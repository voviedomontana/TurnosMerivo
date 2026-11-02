import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  invite: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
    schema: () => ({ rpc: mocks.rpc }),
  }),
}));
vi.mock("@/modules/auth/auth-admin", () => ({
  authAdminClient: () => ({ inviteUserByEmail: mocks.invite }),
}));

import { handleAuthRequest } from "@/modules/auth/http";
import { sendAccessInviteAction } from "@/modules/auth/actions";

const businessId = "14000000-0000-4000-8000-000000000001";
const memberId = "24000000-0000-4000-8000-000000000001";
function request(match?: string) {
  return new Request(
    "http://localhost/api/v1/businesses/example/members/example",
    {
      method: "PATCH",
      headers: {
        Authorization: "Bearer fixture-token",
        "Idempotency-Key": "34000000-0000-4000-8000-000000000001",
        "Content-Type": "application/json",
        ...(match === undefined ? {} : { "If-Match": match }),
      },
      body: JSON.stringify({ role: "barber", status: "suspended" }),
    },
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { email_confirmed_at: "2026-11-01T00:00:00Z" } },
    error: null,
  });
});

describe("C-01 identity before preconditions and SQL authority", () => {
  it("rejects an invalid identity before interpreting a missing or malformed If-Match", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { code: "invalid_token" },
    });
    for (const match of [undefined, "invalid", '"1"']) {
      const response = await handleAuthRequest(request(match), "update", {
        businessId,
        memberId,
      });
      expect(response.status).toBe(401);
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    ["PT403", "FORBIDDEN", 403],
    ["PT404", "NOT_FOUND", 404],
    ["PT428", "PRECONDITION_REQUIRED", 428],
    ["PT409", "IDEMPOTENCY_KEY_REUSED", 409],
  ])(
    "lets SQL authorize before classifying missing expected: %s",
    async (code, message, expected) => {
      mocks.rpc.mockResolvedValue({ data: null, error: { code, message } });
      const response = await handleAuthRequest(request(), "update", {
        businessId,
        memberId,
      });
      expect(response.status).toBe(expected);
      expect(mocks.rpc).toHaveBeenCalledWith(
        "update_member",
        expect.objectContaining({ p_expected: null }),
      );
      expect(mocks.getUser).toHaveBeenCalledTimes(1);
    },
  );
  it("preserves a stale version as 412 and quoted ETags on replay success", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { code: "PT412", message: "PRECONDITION_FAILED" },
    });
    expect(
      (
        await handleAuthRequest(request('"1"'), "update", {
          businessId,
          memberId,
        })
      ).status,
    ).toBe(412);
    mocks.rpc.mockResolvedValueOnce({ data: { version: 2 }, error: null });
    const replay = await handleAuthRequest(request('"1"'), "update", {
      businessId,
      memberId,
    });
    expect(replay.status).toBe(200);
    expect(replay.headers.get("ETag")).toBe('"2"');
  });
  it("still rejects malformed header syntax after verifying identity", async () => {
    expect(
      (
        await handleAuthRequest(request("1"), "update", {
          businessId,
          memberId,
        })
      ).status,
    ).toBe(400);
    expect(mocks.getUser).toHaveBeenCalledOnce();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe("C-07 direct Server Action authorization", () => {
  function form() {
    const value = new FormData();
    value.set("businessId", businessId);
    value.set("memberId", memberId);
    value.set("email", "forged@example.test");
    value.set("role", "owner");
    return value;
  }
  it.each(["FORBIDDEN", "NOT_FOUND", "MFA_REQUIRED"])(
    "never invokes Auth Admin when the dedicated guard rejects: %s",
    async (message) => {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { code: message === "NOT_FOUND" ? "PT404" : "PT403", message },
      });
      await sendAccessInviteAction({}, form());
      expect(mocks.rpc).toHaveBeenCalledWith("prepare_member_auth_invite", {
        p_business_id: businessId,
        p_member_id: memberId,
      });
      expect(mocks.invite).not.toHaveBeenCalled();
    },
  );
  it("awaits committed SQL authorization and uses only its recipient", async () => {
    let release: (value: {
      data: { email: string };
      error: null;
    }) => void = () => {};
    mocks.rpc.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    mocks.invite.mockResolvedValue({ error: null });
    const action = sendAccessInviteAction({}, form());
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalledOnce());
    expect(mocks.invite).not.toHaveBeenCalled();
    release({ data: { email: "authorized@example.test" }, error: null });
    await action;
    expect(mocks.invite).toHaveBeenCalledExactlyOnceWith(
      "authorized@example.test",
    );
  });
  it("does not automatically retry a provider failure", async () => {
    mocks.rpc.mockResolvedValue({
      data: { email: "authorized@example.test" },
      error: null,
    });
    mocks.invite.mockResolvedValue({ error: { code: "timeout" } });
    const result = await sendAccessInviteAction({}, form());
    expect(mocks.invite).toHaveBeenCalledOnce();
    expect(result.message).toContain("antes de reintentar");
  });
});
