import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
export async function runPublicCatalogBrowser({ browser, origin, sql }) {
  const b = randomUUID(),
    staff = randomUUID(),
    offline = randomUUID(),
    service = randomUUID(),
    slug = `public-ui-${b.slice(0, 12)}`;
  sql(
    `insert into public.businesses(id,slug,name,tax_id) values('${b}','${slug}','Merivo catálogo de prueba','DO-NOT-PUBLISH');insert into public.business_settings(business_id) values('${b}');insert into public.staff_members(id,business_id,display_name,bio) values('${staff}','${b}','Profesional público','Cortes y estilo personal.');insert into public.staff_members(id,business_id,display_name,accepts_online) values('${offline}','${b}','PRIVATE-OFFLINE',false);insert into public.services(id,business_id,name,description,price_cents,duration_minutes) values('${service}','${b}','Corte clásico','Terminación a tu estilo.',180000,30);insert into public.staff_services(business_id,staff_member_id,service_id,price_override_cents,duration_override_minutes) values('${b}','${staff}','${service}',250000,45),('${b}','${offline}','${service}',null,null);`,
  );
  const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    }),
    page = await context.newPage();
  let errors = 0;
  page.on("pageerror", () => errors++);
  try {
    const response = await fetch(`${origin}/api/v1/public/${slug}/catalog`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    const data = await response.json();
    assert.equal(data.professionals.length, 1);
    assert.equal(data.professionals[0].services[0].price_cents, 250000);
    assert.ok(!JSON.stringify(data).includes("PRIVATE"));
    assert.ok(!JSON.stringify(data).includes("DO-NOT-PUBLISH"));
    await page.goto(`${origin}/b/${slug}`);
    await expect(
      page.getByRole("heading", {
        name: "Merivo catálogo de prueba.",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Profesional público", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("45 min", { exact: true })).toBeVisible();
    await expect(
      page.getByText("La reserva online todavía no está habilitada.", {
        exact: true,
      }),
    ).toBeVisible();
    assert.equal(
      await page.getByRole("button", { name: /confirmar|reservar/i }).count(),
      0,
    );
    assert.equal(
      await context
        .cookies()
        .then((c) => c.filter((v) => v.name.includes("auth-token")).length),
      0,
    );
    mkdirSync("test-results", { recursive: true });
    await page.screenshot({
      path: path.resolve("test-results/public-catalog-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.resolve("test-results/public-catalog-mobile.png"),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    sql(
      `update public.business_settings set public_booking_enabled=false where business_id='${b}'`,
    );
    assert.equal(
      (await fetch(`${origin}/api/v1/public/${slug}/catalog`)).status,
      404,
    );
    assert.equal((await page.goto(`${origin}/b/${slug}`)).status(), 404);
    assert.equal(
      (await fetch(`${origin}/api/v1/public/missing-catalog/catalog`)).status,
      404,
    );
    assert.equal(errors, 0);
    console.log(
      "Public catalog UI/HTTP PASS: anonymous, effective override, private/offline exclusion, disabled/missing 404, no false booking CTA, no Auth cookies and responsive desktop/mobile.",
    );
  } finally {
    await context.close();
  }
}
