import { beforeEach, describe, it, expect, vi } from "vitest";
const mock = vi.hoisted(() => ({ getUser: vi.fn(), query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mock.getUser },
    schema: () => ({ rpc: mock.query }),
  }),
}));
import { handleScheduleRequest } from "@/modules/availability/http";
import {
  parseIntervals,
  minute,
  planInput,
} from "@/modules/availability/schemas";
describe("scheduling transport and input", () => {
  const businessId = "19000000-0000-4000-8000-000000000001",
    staffId = "39000000-0000-4000-8000-000000000001",
    id = "59000000-0000-4000-8000-000000000001",
    key = "69000000-0000-4000-8000-000000000001";
  beforeEach(() => {
    vi.resetAllMocks();
    mock.getUser.mockResolvedValue({
      data: { user: { email_confirmed_at: "2026-01-01" } },
      error: null,
    });
  });
  const request = (match?: string) =>
    new Request("http://localhost/schedule", {
      method: "PUT",
      headers: {
        Authorization: "Bearer fixture-token",
        "Content-Type": "application/json",
        "Idempotency-Key": key,
        ...(match ? { "If-Match": match } : {}),
      },
      body: JSON.stringify({
        id,
        data: { effective_from: "2026-11-03", intervals: [] },
      }),
    });
  it("supports split shifts and midnight end without crossing a row", () => {
    expect(parseIntervals("09:10-13:00, 14:00-24:00")).toHaveLength(2);
    expect(minute("24:00", true)).toBe(1440);
    expect(() => minute("24:00")).toThrow();
    expect(() => parseIntervals("22:00-02:00")).toThrow();
  });
  it("rejects unknown authority fields and more than 14 intervals", () => {
    expect(
      planInput.safeParse({
        effective_from: "2026-11-03",
        intervals: [],
        actor: "owner",
      }).success,
    ).toBe(false);
    expect(
      planInput.safeParse({
        effective_from: "2026-11-03",
        intervals: Array.from({ length: 15 }, () => ({
          weekday: 1,
          start_minute: 1,
          end_minute: 2,
        })),
      }).success,
    ).toBe(false);
  });
  it("verifies identity before If-Match syntax", async () => {
    mock.getUser.mockResolvedValue({
      data: { user: null },
      error: { code: "bad" },
    });
    expect(
      (
        await handleScheduleRequest(request("invalid"), {
          businessId,
          staffId,
          kind: "plan",
        })
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
    ["23514", "sensitive SQL detail", 500],
  ])("preserves %s safely", async (code, message, status) => {
    mock.query.mockResolvedValue({ data: null, error: { code, message } });
    const response = await handleScheduleRequest(request(), {
      businessId,
      staffId,
      kind: "plan",
    });
    expect(response.status).toBe(status);
    expect(await response.text()).not.toContain("sensitive SQL detail");
  });
  it("returns ETag, stable ID/key and request UUID", async () => {
    mock.query.mockResolvedValue({
      data: { id, staff_id: staffId, version: 2, kind: "plan", action: "save" },
      error: null,
    });
    const response = await handleScheduleRequest(request('"1"'), {
      businessId,
      staffId,
      kind: "plan",
    });
    expect(response.headers.get("ETag")).toBe('"2"');
    expect(response.headers.get("X-Request-Id")).toMatch(/^[a-f0-9-]{36}$/);
    expect(mock.query).toHaveBeenCalledWith(
      "write_schedule",
      expect.objectContaining({ p_expected: 1, p_id: id, p_key: key }),
    );
  });
});
