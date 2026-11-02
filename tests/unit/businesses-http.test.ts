import { describe, expect, it, vi } from "vitest";
import { getPublicBusinessResponse } from "@/modules/businesses/http";
import { resolvePublicBusiness } from "@/modules/businesses/service";
import type { PublicBusiness } from "@/modules/businesses/types";

const business: PublicBusiness = {
  id: "10000000-0000-4000-8000-000000000001",
  slug: "test-alpha",
  name: "Alpha",
  timezone: "America/Argentina/Buenos_Aires",
  phone: null,
  address_line: null,
  city: null,
  region: null,
  country: "AR",
  logo_path: null,
  locale: "es-AR",
  currency: "ARS",
};

describe("public business HTTP boundary", () => {
  it("derives tenant context from the database record", async () => {
    const resolved = await resolvePublicBusiness(
      "test-alpha",
      async () => business,
    );
    expect(resolved?.tenant).toEqual({
      businessId: business.id,
      slug: business.slug,
      actor: "public",
    });
  });
  it("returns only the public business without internal context", async () => {
    const response = await getPublicBusinessResponse(
      "test-alpha",
      async () => business,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(business);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("uses a uniform not-found response for invalid or absent slugs", async () => {
    const read = vi.fn().mockResolvedValue(null);
    const missing = await getPublicBusinessResponse("not-found", read);
    const invalid = await getPublicBusinessResponse("admin", read);
    expect(missing.status).toBe(404);
    expect(invalid.status).toBe(404);
    const { request_id: missingId, ...missingProblem } = await missing.json();
    const { request_id: invalidId, ...invalidProblem } = await invalid.json();
    expect(missingProblem).toEqual(invalidProblem);
    expect(missing.headers.get("content-type")).toContain(
      "application/problem+json",
    );
    expect(missingId).toBeTruthy();
    expect(invalidId).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(1);
  });
  it("returns a safe 503 when configuration or the database is unavailable", async () => {
    const response = await getPublicBusinessResponse("test-alpha", async () => {
      throw new Error("sensitive connection details");
    });
    expect(response.status).toBe(503);
    const body = await response.text();
    expect(body).toContain("UNAVAILABLE");
    expect(body).not.toContain("sensitive");
  });
});
