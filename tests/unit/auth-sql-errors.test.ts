import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), getUser: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mocks.getUser },
    schema: () => ({ rpc: mocks.rpc }),
  }),
}));

import { handleAuthRequest } from "@/modules/auth/http";

describe("SQL errors at the existing membership HTTP boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({
      data: { user: { email_confirmed_at: "2026-11-01T00:00:00Z" } },
      error: null,
    });
  });

  it.each([
    ["PT409", "LAST_OWNER", 409, "LAST_OWNER"],
    ["23514", "Cannot remove the last active owner", 500, "INTERNAL_ERROR"],
    ["23514", "Record identity is immutable", 500, "INTERNAL_ERROR"],
    ["23514", "Audit records are immutable", 500, "INTERNAL_ERROR"],
    [
      "23514",
      "business_settings_slot_interval_minutes_check",
      500,
      "INTERNAL_ERROR",
    ],
    ["23505", "private constraint detail", 409, "DUPLICATE_RESOURCE"],
    ["PT412", "PRECONDITION_FAILED", 412, "PRECONDITION_FAILED"],
    ["PT403", "FORBIDDEN", 403, "FORBIDDEN"],
    ["PT404", "NOT_FOUND", 404, "NOT_FOUND"],
    ["XX000", "private database detail", 503, "UNAVAILABLE"],
  ])(
    "maps %s / %s without exposing SQL details",
    async (code, message, status, expected) => {
      mocks.rpc.mockResolvedValue({ data: null, error: { code, message } });
      const response = await handleAuthRequest(
        new Request(
          "http://localhost/api/v1/businesses/example/members/example",
          {
            method: "PATCH",
            headers: {
              Authorization: "Bearer fixture-token",
              "Idempotency-Key": "33000000-0000-4000-8000-000000000001",
              "If-Match": '"1"',
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ role: "barber", status: "suspended" }),
          },
        ),
        "update",
        {
          businessId: "13000000-0000-4000-8000-000000000001",
          memberId: "23000000-0000-4000-8000-000000000001",
        },
      );
      const problem = await response.json();
      expect(response.status).toBe(status);
      expect(problem.code).toBe(expected);
      expect(problem).not.toHaveProperty("details");
      expect(problem).not.toHaveProperty("hint");
      if (code === "23514" || code === "XX000" || code === "23505")
        expect(JSON.stringify(problem)).not.toContain(message);
    },
  );
});
