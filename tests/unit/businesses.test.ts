import { describe, expect, it, vi } from "vitest";
import { isBusinessSlug } from "@/modules/businesses/schemas";
import { resolvePublicBusiness } from "@/modules/businesses/service";

describe("business slug boundary", () => {
  it.each(["merivo", "barberia-central", "a-b", "a".repeat(40)])(
    "accepts %s",
    (slug) => {
      expect(isBusinessSlug(slug)).toBe(true);
    },
  );
  it.each([
    "api",
    "app",
    "admin",
    "b",
    "ab",
    "Mixed-Case",
    "a".repeat(41),
    "has space",
    "-leading",
    "trailing-",
    "../../etc",
    "a%2fb",
  ])("rejects %s", (slug) => {
    expect(isBusinessSlug(slug)).toBe(false);
  });
  it("rejects invalid input without querying the database", async () => {
    const read = vi.fn();
    expect(await resolvePublicBusiness("admin", read)).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });
  it("returns the repository's absent result for an unknown business", async () => {
    const read = vi.fn().mockResolvedValue(null);
    expect(await resolvePublicBusiness("unknown-business", read)).toBeNull();
    expect(read).toHaveBeenCalledWith("unknown-business");
  });
});
