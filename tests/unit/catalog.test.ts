import { describe, expect, it, vi, beforeEach } from "vitest";
const mock = vi.hoisted(() => ({ getUser: vi.fn(), query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mock.getUser },
    schema: () => ({ rpc: mock.query }),
  }),
}));
import { moneyToCents, serviceInput } from "@/modules/services/schemas";
import { staffInput } from "@/modules/staff/schemas";
import { handleCatalogRequest } from "@/modules/services/http";
describe("catalog input boundaries", () => {
  it.each([
    ["1250,50", 125050],
    ["0", 0],
    ["12.1", 1210],
    ["21474836.47", 2147483647],
  ])("converts %s without floating-point rounding", (input, expected) =>
    expect(moneyToCents(input)).toBe(expected),
  );
  it.each(["-1", "1.234", "1.000,50", "1e3", "21474836.48", ""])(
    "rejects ambiguous/invalid money %s",
    (input) => expect(() => moneyToCents(input)).toThrow(),
  );
  it.each([4, 481, 1.5])("rejects invalid duration %s", (duration) =>
    expect(
      serviceInput.safeParse({
        name: "Corte",
        price_cents: 100,
        duration_minutes: duration,
      }).success,
    ).toBe(false),
  );
  it("normalizes names and rejects authority fields", () => {
    expect(
      serviceInput.parse({
        name: " Corte ",
        price_cents: 1,
        duration_minutes: 5,
      }).name,
    ).toBe("Corte");
    expect(
      serviceInput.safeParse({
        name: "Corte",
        price_cents: 1,
        duration_minutes: 5,
        role: "owner",
      }).success,
    ).toBe(false);
  });
  it("allows an unlinked professional and rejects duplicate service selections", () => {
    expect(staffInput.parse({ display_name: "Ana" }).member_id).toBe(null);
    const service_id = "37000000-0000-4000-8000-000000000001";
    expect(
      staffInput.safeParse({
        display_name: "Ana",
        assignments: [{ service_id }, { service_id }],
      }).success,
    ).toBe(false);
  });
});
describe("catalog HTTP boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mock.getUser.mockResolvedValue({
      data: { user: { email_confirmed_at: "2026-11-01T00:00:00Z" } },
      error: null,
    });
  });
  const businessId = "17000000-0000-4000-8000-000000000001",
    id = "37000000-0000-4000-8000-000000000001",
    key = "57000000-0000-4000-8000-000000000001";
  const data = { name: "Corte", price_cents: 100, duration_minutes: 30 };
  function request(method: string, body: unknown, match?: string) {
    return new Request("http://localhost/api/catalog", {
      method,
      headers: {
        Authorization: "Bearer fixture-token",
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        ...(match ? { "If-Match": match } : {}),
      },
      body: JSON.stringify(body),
    });
  }
  it("preserves create id/key and emits ETag", async () => {
    mock.query.mockResolvedValue({ data: { id, version: 1 }, error: null });
    const response = await handleCatalogRequest(request("POST", { id, data }), {
      businessId,
      kind: "service",
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("ETag")).toBe('"1"');
    expect(mock.query).toHaveBeenCalledWith(
      "write_catalog",
      expect.objectContaining({
        p_id: id,
        p_key: key,
        p_action: "create",
        p_expected: null,
      }),
    );
  });
  it.each([
    ["PT403", "FORBIDDEN", 403],
    ["PT404", "NOT_FOUND", 404],
    ["PT428", "PRECONDITION_REQUIRED", 428],
    ["PT412", "PRECONDITION_FAILED", 412],
    ["PT409", "IDEMPOTENCY_KEY_REUSED", 409],
  ])(
    "delegates missing versions and authority to SQL: %s",
    async (code, message, status) => {
      mock.query.mockResolvedValue({ data: null, error: { code, message } });
      const response = await handleCatalogRequest(request("PUT", data), {
        businessId,
        kind: "service",
        resourceId: id,
      });
      expect(response.status).toBe(status);
      expect(mock.query).toHaveBeenCalledWith(
        "write_catalog",
        expect.objectContaining({ p_expected: null }),
      );
    },
  );
  it("verifies identity before preconditions", async () => {
    mock.getUser.mockResolvedValue({
      data: { user: null },
      error: { code: "invalid" },
    });
    expect(
      (
        await handleCatalogRequest(request("PUT", data), {
          businessId,
          kind: "service",
          resourceId: id,
        })
      ).status,
    ).toBe(401);
    expect(mock.query).not.toHaveBeenCalled();
  });
  it("keeps CSRF protection for cookie writes", async () => {
    const response = await handleCatalogRequest(
      new Request("http://localhost/api/catalog", {
        method: "POST",
        body: JSON.stringify({ id, data }),
      }),
      { businessId, kind: "service" },
    );
    expect(response.status).toBe(403);
    expect(mock.query).not.toHaveBeenCalled();
  });
  it("does not expose SQL details on unclassified checks", async () => {
    mock.query.mockResolvedValue({
      data: null,
      error: { code: "23514", message: "sensitive SQL detail" },
    });
    const response = await handleCatalogRequest(request("POST", { id, data }), {
      businessId,
      kind: "service",
    });
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("sensitive SQL detail");
  });
});
