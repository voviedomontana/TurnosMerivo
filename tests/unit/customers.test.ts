import { describe, expect, it } from "vitest";
import { customerInput, normalizePhone } from "@/modules/customers/schemas";
import { can } from "@/modules/auth/permissions";
describe("customer contact normalization", () => {
  it.each([
    [null, null, "missing"],
    ["", null, "missing"],
    ["+54 9 11 2345-6789", "+5491123456789", "international"],
    ["+54 (11) 2345-6789", "+541123456789", "international"],
    ["011 15 2345-6789", null, "needs_review"],
    ["0054 9 11 2345-6789", null, "needs_review"],
    ["+1 (202) 555-0100", "+12025550100", "international"],
  ])("normalizes %s conservatively", (input, phone_e164, phone_status) => {
    expect(normalizePhone(input)).toEqual({ phone_e164, phone_status });
  });
  it.each(["++54", "phone", "+0123456789", "+1234567890123456", "123 ext 2"])(
    "rejects %s",
    (value) => expect(() => normalizePhone(value)).toThrow(),
  );
  it("supports optional contacts, Unicode codepoints and rejects authority fields", () => {
    expect(customerInput.parse({ full_name: " Ana " }).full_name).toBe("Ana");
    expect(
      customerInput.safeParse({ full_name: "😀".repeat(120) }).success,
    ).toBe(true);
    expect(
      customerInput.safeParse({
        full_name: "Ana",
        phone_e164: "+5491123456789",
      }).success,
    ).toBe(false);
    expect(
      customerInput.safeParse({ full_name: "Ana", email: "a..b@example.test" })
        .success,
    ).toBe(false);
  });
  it.each(["owner", "admin", "barber"] as const)(
    "customer permissions for %s",
    (role) => {
      const actor = {
        userId: "u",
        businessId: "a",
        role,
        active: true,
        aal: "aal2" as const,
      };
      expect(can(actor, "customers:read", { businessId: "a" })).toBe(
        role !== "barber",
      );
      expect(can(actor, "customers:write", { businessId: "a" })).toBe(
        role !== "barber",
      );
      expect(can(actor, "customers:read", { businessId: "b" })).toBe(false);
      expect(
        can({ ...actor, aal: "aal1" }, "customers:write", { businessId: "a" }),
      ).toBe(false);
    },
  );
});
