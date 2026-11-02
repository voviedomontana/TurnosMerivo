import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ getUser: vi.fn(), query: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: { getUser: mock.getUser },
    schema: () => ({ rpc: mock.query }),
  }),
}));
import { handleAppointmentRequest } from "@/modules/appointments/http";
import { handleScheduleRequest } from "@/modules/availability/http";
const id = "79000000-0000-4000-8000-000000000001",
  businessId = "19000000-0000-4000-8000-000000000001",
  key = "89000000-0000-4000-8000-000000000001";
const request = (body: unknown, match?: string) =>
  new Request("http://localhost/api/appointments", {
    method: "POST",
    headers: {
      Authorization: "Bearer fixture-token",
      "Content-Type": "application/json",
      "Idempotency-Key": key,
      ...(match ? { "If-Match": match } : {}),
    },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.resetAllMocks();
  mock.getUser.mockResolvedValue({
    data: { user: { email_confirmed_at: "2026-01-01" } },
    error: null,
  });
});
describe("internal booking HTTP boundary", () => {
  it("authenticates before malformed preconditions", async () => {
    mock.getUser.mockResolvedValue({
      data: { user: null },
      error: { code: "invalid" },
    });
    expect(
      (
        await handleAppointmentRequest(request({}, "invalid"), {
          businessId,
          appointmentId: id,
          action: "cancel",
        })
      ).status,
    ).toBe(401);
    expect(mock.query).not.toHaveBeenCalled();
  });
  it("passes missing If-Match to authorized SQL for 428", async () => {
    mock.query.mockResolvedValue({
      data: null,
      error: { code: "PT428", message: "PRECONDITION_REQUIRED" },
    });
    const r = await handleAppointmentRequest(request({}), {
      businessId,
      appointmentId: id,
      action: "cancel",
    });
    expect(r.status).toBe(428);
    expect(mock.query).toHaveBeenCalledWith(
      "manage_appointment",
      expect.objectContaining({
        p_key: key,
        p_id: id,
        p_expected: null,
        p_data: {},
      }),
    );
  });
  it.each([
    ["PT409", "SLOT_TAKEN", 409],
    ["PT412", "PRECONDITION_FAILED", 412],
    ["PT404", "NOT_FOUND", 404],
    ["PT403", "MFA_REQUIRED", 403],
    ["23P01", "private exclusion", 503],
    ["23514", "private check", 500],
  ])("safely maps %s %s", async (code, message, status) => {
    mock.query.mockResolvedValue({
      data: null,
      error: { code, message, details: "private SQL detail" },
    });
    const r = await handleAppointmentRequest(request({}), {
      businessId,
      appointmentId: id,
      action: "cancel",
    });
    expect(r.status).toBe(status);
    expect(await r.text()).not.toContain("private");
  });
  it("returns stable create metadata, ETag and request UUID", async () => {
    mock.query.mockResolvedValue({
      data: {
        id,
        business_id: businessId,
        status: "confirmed",
        version: 1,
        starts_at: "2026-11-03T12:00:00Z",
        ends_at: "2026-11-03T12:30:00Z",
        blocked_until: "2026-11-03T12:45:00Z",
      },
      error: null,
    });
    const r = await handleAppointmentRequest(
      request({
        id,
        customer_id: id,
        staff_id: id,
        service_id: id,
        starts_at: "2026-11-03T09:00:00-03:00",
      }),
      { businessId },
    );
    expect(r.status).toBe(201);
    expect(r.headers.get("etag")).toBe('"1"');
    expect(r.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
    expect(await r.json()).not.toHaveProperty("customer_name");
  });
  it("denies unexpected GET actions and cookie cross-origin writes", async () => {
    expect(
      (
        await handleAppointmentRequest(
          new Request("http://localhost/api/cancel"),
          { businessId, appointmentId: id, action: "cancel" },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await handleAppointmentRequest(
          new Request("http://localhost/api/appointments", {
            method: "POST",
            body: "{}",
          }),
          { businessId },
        )
      ).status,
    ).toBe(403);
  });
  it("projects only validated affected appointments in HS conflicts", async () => {
    const appointments = [
      {
        id,
        staff_id: id,
        starts_at: "2026-11-03T12:00:00Z",
        ends_at: "2026-11-03T12:30:00Z",
      },
    ];
    mock.query.mockResolvedValue({
      data: null,
      error: {
        code: "PT409",
        message: "APPOINTMENTS_AFFECTED",
        details: JSON.stringify({ appointments, has_more: false }),
      },
    });
    const r = await handleScheduleRequest(
      request(
        { id, data: { date: "2026-11-03", kind: "closed", intervals: [] } },
        '"1"',
      ),
      { businessId, kind: "exception" },
    );
    expect(r.status).toBe(409);
    expect((await r.json()).conflicts).toEqual({
      appointments,
      has_more: false,
    });
  });
  it("drops unrecognized SQL details even for the named domain error", async () => {
    mock.query.mockResolvedValue({
      data: null,
      error: {
        code: "PT409",
        message: "APPOINTMENTS_AFFECTED",
        details: JSON.stringify({
          appointments: [],
          has_more: false,
          secret: "private",
        }),
      },
    });
    const r = await handleScheduleRequest(
      request(
        { id, data: { date: "2026-11-03", kind: "closed", intervals: [] } },
        '"1"',
      ),
      { businessId, kind: "exception" },
    );
    expect(await r.json()).not.toHaveProperty("conflicts");
  });
});
