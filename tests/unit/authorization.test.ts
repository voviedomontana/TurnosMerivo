import { describe, expect, it } from "vitest";
import { can, type Actor } from "@/modules/auth/permissions";

const actor = (role: Actor["role"], aal: Actor["aal"] = "aal2"): Actor => ({
  userId: "user-a",
  businessId: "business-a",
  role,
  aal,
  active: true,
});

describe("business permission boundary", () => {
  it.each(["owner", "admin", "barber"] as const)(
    "allows %s to enter its business",
    (role) => {
      expect(
        can(actor(role), "business:enter", { businessId: "business-a" }),
      ).toBe(true);
    },
  );
  it.each(["owner", "admin", "barber"] as const)(
    "denies cross-tenant and suspended %s",
    (role) => {
      expect(
        can(actor(role), "business:enter", { businessId: "business-b" }),
      ).toBe(false);
      expect(
        can({ ...actor(role), active: false }, "business:enter", {
          businessId: "business-a",
        }),
      ).toBe(false);
    },
  );
  it("requires MFA for owner and admin even on reads", () => {
    for (const role of ["owner", "admin"] as const) {
      expect(
        can(actor(role, "aal1"), "members:read", { businessId: "business-a" }),
      ).toBe(false);
      expect(
        can(actor(role, "aal1"), "business:enter", {
          businessId: "business-a",
        }),
      ).toBe(false);
    }
    expect(
      can(actor("barber", "aal1"), "business:enter", {
        businessId: "business-a",
      }),
    ).toBe(true);
  });
  it("denies anonymous and barber membership management", () => {
    expect(can(null, "members:read", { businessId: "business-a" })).toBe(false);
    expect(
      can(actor("barber"), "members:read", { businessId: "business-a" }),
    ).toBe(false);
  });
  it("enforces the grant ceiling and prevents self changes", () => {
    expect(
      can(actor("owner"), "members:write", {
        businessId: "business-a",
        userId: "user-b",
        role: "admin",
        nextRole: "owner",
      }),
    ).toBe(true);
    expect(
      can(actor("admin"), "members:write", {
        businessId: "business-a",
        role: "barber",
        nextRole: "barber",
      }),
    ).toBe(true);
    expect(
      can(actor("admin"), "members:write", {
        businessId: "business-a",
        role: "admin",
        nextRole: "barber",
      }),
    ).toBe(false);
    expect(
      can(actor("admin"), "members:write", {
        businessId: "business-a",
        role: "barber",
        nextRole: "admin",
      }),
    ).toBe(false);
    expect(
      can(actor("owner"), "members:write", {
        businessId: "business-a",
        userId: "user-a",
        role: "owner",
        nextRole: "owner",
      }),
    ).toBe(false);
  });
});
