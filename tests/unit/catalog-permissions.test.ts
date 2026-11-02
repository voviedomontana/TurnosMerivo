import { describe, expect, it } from "vitest";
import { can, type Actor } from "@/modules/auth/permissions";
describe("approved catalog permissions", () => {
  for (const role of ["owner", "admin", "barber"] as const)
    for (const aal of ["aal1", "aal2"] as const) {
      const actor: Actor = {
        userId: "actor",
        businessId: "a",
        role,
        aal,
        active: true,
      };
      it(`${role}/${aal} catalog read and write boundary`, () => {
        expect(can(actor, "catalog:read", { businessId: "a" })).toBe(
          role === "barber" || aal === "aal2",
        );
        expect(can(actor, "catalog:write", { businessId: "a" })).toBe(
          role !== "barber" && aal === "aal2",
        );
        expect(can(actor, "catalog:read", { businessId: "b" })).toBe(false);
        expect(
          can({ ...actor, active: false }, "catalog:write", {
            businessId: "a",
          }),
        ).toBe(false);
        expect(
          can(actor, "unknown" as "catalog:read", { businessId: "a" }),
        ).toBe(false);
      });
    }
});
