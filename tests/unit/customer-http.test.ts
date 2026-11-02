import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ getUser: vi.fn(), query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mock.getUser },
    schema: () => ({ rpc: mock.query }),
  }),
}));
import { handleCustomerRequest } from "@/modules/customers/http";
describe("customer HTTP boundary", () => {
  const businessId = "18000000-0000-4000-8000-000000000001",
    id = "38000000-0000-4000-8000-000000000001",
    key = "58000000-0000-4000-8000-000000000001";
  beforeEach(() => {
    vi.resetAllMocks();
    mock.getUser.mockResolvedValue({
      data: { user: { email_confirmed_at: "2026-01-01" } },
      error: null,
    });
  });
  const request = (method: string, body: unknown, match?: string) =>
    new Request("http://localhost/api/customers", {
      method,
      headers: {
        Authorization: "Bearer fixture-token",
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        ...(match ? { "If-Match": match } : {}),
      },
      body: JSON.stringify(body),
    });
  it("preserves stable create UUID and emits ETag without PII", async () => {
    mock.query.mockResolvedValue({
      data: { id, business_id: businessId, version: 1, deleted_at: null },
      error: null,
    });
    const response = await handleCustomerRequest(
      request("POST", { id, data: { full_name: "Fixture" } }),
      { businessId },
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("ETag")).toBe('"1"');
    expect(await response.json()).not.toHaveProperty("full_name");
    expect(mock.query).toHaveBeenCalledWith(
      "write_customer",
      expect.objectContaining({ p_id: id, p_key: key, p_expected: null }),
    );
  });
  it("rejects unauthenticated before precondition syntax", async () => {
    mock.getUser.mockResolvedValue({
      data: { user: null },
      error: { code: "invalid" },
    });
    expect(
      (
        await handleCustomerRequest(
          request("PUT", { full_name: "Fixture" }, "invalid"),
          { businessId, resourceId: id },
        )
      ).status,
    ).toBe(401);
    expect(mock.query).not.toHaveBeenCalled();
  });
  it.each([
    ["PT403", "FORBIDDEN", 403],
    ["PT404", "NOT_FOUND", 404],
    ["PT428", "PRECONDITION_REQUIRED", 428],
    ["PT412", "PRECONDITION_FAILED", 412],
    ["PT409", "IDEMPOTENCY_KEY_REUSED", 409],
    ["23514", "private database detail", 500],
  ])("maps %s safely", async (code, message, status) => {
    mock.query.mockResolvedValue({ data: null, error: { code, message } });
    const response = await handleCustomerRequest(
      request("PUT", { full_name: "Fixture" }),
      { businessId, resourceId: id },
    );
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("private database detail");
  });
  it("rejects unknown profile authority and marketing fields", async () => {
    expect(
      (
        await handleCustomerRequest(
          request("POST", {
            id,
            data: { full_name: "Fixture", marketing_opt_in: true },
          }),
          { businessId },
        )
      ).status,
    ).toBe(400);
    expect(mock.query).not.toHaveBeenCalled();
  });
  it("keeps cookie CSRF checks", async () => {
    expect(
      (
        await handleCustomerRequest(
          new Request("http://localhost/api/customers", {
            method: "POST",
            body: "{}",
          }),
          { businessId },
        )
      ).status,
    ).toBe(403);
  });
});
