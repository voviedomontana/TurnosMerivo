import { describe, it, expect } from "vitest";
import {
  createAppointmentInput,
  rescheduleInput,
} from "@/modules/appointments/schemas";
import { can } from "@/modules/auth/permissions";
const id = "79000000-0000-4000-8000-000000000001";
describe("internal appointments boundary", () => {
  it("accepts explicit client/staff/service UUID and offset time; not price or actor", () => {
    const value = {
      id,
      customer_id: id,
      staff_id: id,
      service_id: id,
      starts_at: "2026-11-03T09:00:00-03:00",
      context_versions: {
        staff: 1,
        service: 1,
        customer: 1,
        calendar: 1,
        settings: 1,
        business: 1,
      },
    };
    expect(createAppointmentInput.safeParse(value).success).toBe(true);
    expect(
      createAppointmentInput.safeParse({ ...value, price_cents: 1 }).success,
    ).toBe(false);
    expect(
      createAppointmentInput.safeParse({ ...value, actor: "owner" }).success,
    ).toBe(false);
    expect(
      createAppointmentInput.safeParse({
        ...value,
        starts_at: "2026-11-03T09:00",
      }).success,
    ).toBe(false);
  });
  it("leaves missing preconditions for SQL authorization, but rejects unknown context", () => {
    expect(
      rescheduleInput.safeParse({ starts_at: "2026-11-03T12:00:00Z" }).success,
    ).toBe(true);
    expect(
      rescheduleInput.safeParse({
        starts_at: "2026-11-03T12:00:00Z",
        context_versions: { override: true },
      }).success,
    ).toBe(false);
  });
  it.each(["owner", "admin", "barber"] as const)(
    "permissions for %s",
    (role) => {
      const actor = {
        userId: "u",
        businessId: "a",
        role,
        active: true,
        aal: "aal2" as const,
      };
      expect(can(actor, "appointments:read", { businessId: "a" })).toBe(
        role !== "barber",
      );
      expect(can(actor, "appointments:write", { businessId: "a" })).toBe(
        role !== "barber",
      );
      expect(
        can({ ...actor, aal: "aal1" }, "appointments:write", {
          businessId: "a",
        }),
      ).toBe(false);
      expect(can(actor, "appointments:read", { businessId: "b" })).toBe(false);
    },
  );
});
