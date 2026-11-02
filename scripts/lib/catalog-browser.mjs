import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import { mkdirSync } from "node:fs";
import path from "node:path";

export async function runCatalogBrowser({
  browser,
  origin,
  jar,
  users,
  sql,
  gatewayUrl,
  publicKey,
}) {
  const b = randomUUID();
  sql(`insert into public.businesses(id,slug,name) values('${b}','ui-${b.slice(0, 20)}','Catálogo de prueba');
    insert into public.business_settings(business_id) values('${b}');
    insert into public.business_members(business_id,user_id,role) values('${b}','${users[0].id}','owner'),('${b}','${users[1].id}','admin'),('${b}','${users[2].id}','barber');`);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.addCookies(
    jar.map((c) => ({
      name: c.name,
      value: c.value,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    })),
  );
  const page = await context.newPage();
  let errors = 0;
  page.on("pageerror", () => {
    errors++;
  });
  const route = `${origin}/app/${b}`;
  await page.goto(`${route}/servicios`);
  const form = page.locator("aside form");
  await form.locator('[name="name"]').fill("Corte de prueba");
  await form.locator('[name="price"]').fill("1250,50");
  await form.getByRole("button", { name: "Crear servicio" }).click();
  await expect(
    page.getByRole("heading", { name: "Corte de prueba", exact: true }),
  ).toBeVisible();
  assert.equal(
    sql(`select price_cents from public.services where business_id='${b}'`),
    "125050",
  );
  const card = page.locator("article.catalog-card");
  await card.locator("summary").click();
  await card.locator('[name="price"]').fill("1500");
  await card.getByRole("button", { name: "Guardar servicio" }).click();
  await expect(
    card.getByText("Servicio guardado.", { exact: true }),
  ).toBeVisible();
  assert.equal(
    sql(
      `select version||':'||price_cents from public.services where business_id='${b}'`,
    ),
    "2:150000",
  );
  await card.getByRole("button", { name: "Archivar", exact: true }).click();
  await expect(page.locator("article.catalog-card")).toHaveCount(0);
  await page.goto(`${route}/servicios?archivados=1`);
  await page.getByRole("button", { name: "Restaurar", exact: true }).click();
  await expect(page.locator("article.catalog-card")).toHaveCount(0);
  await page.goto(`${route}/profesionales`);
  await form.locator('[name="display_name"]').fill("Profesional de prueba");
  await form.locator('[name="service_ids"]').check();
  await form.getByRole("button", { name: "Crear profesional" }).click();
  await expect(
    page.getByRole("heading", { name: "Profesional de prueba", exact: true }),
  ).toBeVisible();
  assert.equal(
    sql(
      `select (member_id is null)::text from public.staff_members where business_id='${b}'`,
    ),
    "true",
  );
  assert.equal(
    sql(`select count(*) from public.staff_services where business_id='${b}'`),
    "1",
  );
  const screenshots = path.join(process.cwd(), "test-results");
  mkdirSync(screenshots, { recursive: true });
  await page.screenshot({
    path: path.join(screenshots, "catalog-desktop.png"),
    fullPage: true,
  });
  for (const screen of ["servicios", "profesionales"]) {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${route}/${screen}`);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      "Catalog mobile overflow",
    );
  }
  await page.screenshot({
    path: path.join(screenshots, "catalog-mobile.png"),
    fullPage: true,
  });
  // Real Next HTTP adapter, with a separately authenticated read-only barber.
  const endpoint = `${origin}/api/v1/businesses/${b}/catalog`,
    id = randomUUID(),
    key = randomUUID();
  const headers = {
    Authorization: `Bearer ${users[1].token}`,
    "Content-Type": "application/json",
    "Idempotency-Key": key,
  };
  const body = JSON.stringify({
    id,
    data: { name: "Barba HTTP", price_cents: 50000, duration_minutes: 20 },
  });
  const created = await fetch(`${endpoint}/service`, {
    method: "POST",
    headers,
    body,
  });
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("ETag"), '"1"');
  const replay = await fetch(`${endpoint}/service`, {
    method: "POST",
    headers,
    body,
  });
  assert.equal(replay.status, 201);
  assert.equal(
    sql(`select count(*) from public.audit_logs where entity_id='${id}'`),
    "1",
  );
  const denied = await fetch(`${endpoint}/service`, {
    method: "POST",
    headers: { ...headers, Authorization: `Bearer ${users[2].token}` },
    body,
  });
  assert.equal(denied.status, 403);
  const read = await fetch(endpoint, {
    headers: { Authorization: `Bearer ${users[2].token}` },
  });
  assert.equal(read.status, 200);
  const foreign = await fetch(
    `${origin}/api/v1/businesses/${randomUUID()}/catalog`,
    { headers: { Authorization: `Bearer ${users[2].token}` } },
  );
  assert.equal(foreign.status, 404);
  const barberJar = [];
  const client = createServerClient(gatewayUrl, publicKey, {
    cookies: {
      getAll: () => barberJar,
      setAll: (values) => {
        for (const value of values) {
          const index = barberJar.findIndex((c) => c.name === value.name);
          if (index >= 0) barberJar.splice(index, 1);
          barberJar.push(value);
        }
      },
    },
  });
  assert.equal((await client.auth.setSession(users[2].session)).error, null);
  const barberContext = await browser.newContext();
  await barberContext.addCookies(
    barberJar.map((c) => ({
      name: c.name,
      value: c.value,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    })),
  );
  const barberPage = await barberContext.newPage();
  for (const screen of ["servicios", "profesionales"]) {
    await barberPage.goto(`${route}/${screen}`);
    await expect(
      barberPage.locator("article.catalog-card").first(),
    ).toBeVisible();
    await expect(
      barberPage.locator("aside,summary,form.catalog-state-form"),
    ).toHaveCount(0);
  }
  await barberContext.close();
  assert.equal(errors, 0);
  await context.close();
  console.log(
    "Catalog UI/HTTP PASS: create/edit/archive/restore, unlinked staff/service association, 390px layout, real API ETag/replay, barber denied writes, tenant isolation.",
  );
}
