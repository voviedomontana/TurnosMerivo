import { describe, expect, it, vi } from "vitest";
import { getPublicCatalogResponse } from "@/modules/businesses/public-catalog-http";
import { publicCatalogSchema } from "@/modules/businesses/public-catalog";
const value = {
  business: {
    id: "19000000-0000-4000-8000-000000000001",
    slug: "merivo-test",
    name: "Merivo",
    timezone: "America/Argentina/Buenos_Aires",
    phone: null,
    address_line: null,
    city: null,
    region: null,
    country: "AR",
    logo_path: null,
    locale: "es-AR",
    currency: "ARS",
  },
  professionals: [],
};
describe("public catalog boundary", () => {
  it("returns explicit public data, trace and no-store", async () => {
    const read = vi.fn().mockResolvedValue(value);
    const r = await getPublicCatalogResponse("merivo-test", read);
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual(value);
    expect(r.headers.get("Cache-Control")).toBe("no-store");
    expect(r.headers.get("X-Request-Id")).toMatch(/^[a-f0-9-]{36}$/);
    expect(read).toHaveBeenCalledWith("merivo-test");
  });
  it.each(["APP", "app", "bad/slug", "x", "valid-"])(
    "rejects invalid slug %s without querying",
    async (slug) => {
      const read = vi.fn();
      expect((await getPublicCatalogResponse(slug, read)).status).toBe(404);
      expect(read).not.toHaveBeenCalled();
    },
  );
  it("does not distinguish disabled and missing business", async () => {
    expect(
      (await getPublicCatalogResponse("merivo-test", async () => null)).status,
    ).toBe(404);
  });
  it("does not expose driver errors or private fields", async () => {
    const r = await getPublicCatalogResponse("merivo-test", async () => {
      throw Error("postgres://credential/private");
    });
    expect(r.status).toBe(503);
    expect(await r.text()).not.toContain("credential");
    const malformed = { ...value, private_notes: "secret" };
    expect(publicCatalogSchema.safeParse(malformed).success).toBe(false);
  });
  it("rejects private membership/versions nested in public professionals", () => {
    expect(
      publicCatalogSchema.safeParse({
        ...value,
        professionals: [
          {
            id: value.business.id,
            display_name: "Public",
            bio: null,
            member_id: value.business.id,
            services: [],
          },
        ],
      }).success,
    ).toBe(false);
  });
});
