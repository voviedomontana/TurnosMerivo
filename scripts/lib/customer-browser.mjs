import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { expect } from "@playwright/test";

export async function runCustomerBrowser({
  browser,
  origin,
  jar,
  users,
  sql,
  gatewayUrl,
  publicKey,
}) {
  const b = randomUUID();
  sql(
    `insert into public.businesses(id,slug,name) values('${b}','customer-ui-${b.slice(0, 15)}','Clientes de prueba');insert into public.business_members(business_id,user_id,role) values('${b}','${users[0].id}','owner'),('${b}','${users[1].id}','admin'),('${b}','${users[2].id}','barber');`,
  );
  const cookies = (values) =>
    values.map((c) => ({
      name: c.name,
      value: c.value,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax",
    }));
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  await context.addCookies(cookies(jar));
  const page = await context.newPage();
  let errors = 0;
  page.on("pageerror", () => {
    errors++;
  });
  const route = `${origin}/app/${b}/clientes`,
    endpoint = `${origin}/api/v1/businesses/${b}/customers`;
  const api = async (
    url,
    body,
    user = users[1],
    method = "POST",
    extra = {},
  ) => {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${user.token}`,
        "Content-Type": "application/json",
        ...extra,
      },
      ...(method !== "GET" ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      data: await response.json(),
      headers: response.headers,
    };
  };
  try {
    await page.goto(route);
    await expect(
      page.getByRole("heading", { name: "Clientes.", exact: true }),
    ).toBeVisible();
    for (const name of ["Cliente fixture uno", "Cliente fixture dos"]) {
      await page
        .getByRole("button", { name: "Nuevo cliente", exact: true })
        .click();
      const form = page.locator("aside form");
      await form.locator('[name="full_name"]').fill(name);
      await form.locator('[name="phone_raw"]').fill("+54 9 11 2345-6789");
      await form.locator('[name="email"]').fill("shared@example.test");
      await form
        .locator('[name="private_notes"]')
        .fill("Nota privada de prueba");
      await form
        .getByRole("button", { name: "Guardar ficha", exact: true })
        .click();
      await expect(page.locator("aside")).toHaveCount(0);
    }
    await expect(page.locator("article.customer-card")).toHaveCount(2);
    await expect(
      page.getByText("Nota privada de prueba", { exact: true }),
    ).toHaveCount(0);
    const cards = page.locator("article.customer-card"),
      first = cards.filter({
        has: page.getByRole("heading", {
          name: "Cliente fixture uno",
          exact: true,
        }),
      });
    await first.getByRole("button", { name: "Abrir ficha" }).click();
    await expect(page.locator('aside [name="private_notes"]')).toHaveValue(
      "Nota privada de prueba",
    );
    await page.locator('aside [name="private_notes"]').fill("Nota editada");
    await page
      .getByRole("button", { name: "Guardar ficha", exact: true })
      .click();
    await expect(page.locator("aside")).toHaveCount(0);
    await first.getByRole("button", { name: "Abrir ficha" }).click();
    const id = sql(
      `select id from public.customers where business_id='${b}' and full_name='Cliente fixture uno'`,
    );
    const initial = (await api(`${endpoint}/${id}`, null, users[1], "GET"))
      .data;
    const changed = await api(
      `${endpoint}/${id}`,
      {
        full_name: initial.full_name,
        phone_raw: initial.phone_raw,
        email: initial.email,
        instagram_handle: initial.instagram_handle,
        private_notes: "Otro editor",
      },
      users[1],
      "PUT",
      { "Idempotency-Key": randomUUID(), "If-Match": `"${initial.version}"` },
    );
    assert.equal(changed.status, 200);
    await page
      .locator('aside [name="private_notes"]')
      .fill("Borrador conservado");
    await page
      .getByRole("button", { name: "Guardar ficha", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("La ficha cambió");
    await expect(page.locator('aside [name="private_notes"]')).toHaveValue(
      "Borrador conservado",
    );
    await page.getByRole("button", { name: "Recargar ficha" }).click();
    await expect(page.locator('aside [name="private_notes"]')).toHaveValue(
      "Otro editor",
    );
    await page
      .getByRole("button", { name: "Archivar ficha", exact: true })
      .click();
    await expect(cards).toHaveCount(1);
    const search = page.getByRole("form", { name: "Buscar clientes" });
    await search.getByLabel("Estado", { exact: true }).selectOption("archived");
    await search.getByRole("button", { name: "Buscar clientes" }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first().getByRole("heading")).toHaveText(
      "Cliente fixture uno",
    );
    await cards.first().getByRole("button", { name: "Abrir ficha" }).click();
    await page.getByRole("button", { name: "Restaurar ficha" }).click();
    await expect(cards).toHaveCount(0);
    await search.getByLabel("Estado", { exact: true }).selectOption("current");
    await search
      .getByLabel("Buscar por", { exact: true })
      .selectOption("phone");
    await search.getByLabel("Buscar", { exact: true }).fill("+5491123456789");
    await search.getByRole("button", { name: "Buscar clientes" }).click();
    await expect(cards).toHaveCount(2);
    assert.ok(!page.url().includes("2345"));
    const shared = await api(`${endpoint}/search`, {
      field: "phone",
      value: "+5491123456789",
      mode: "exact",
    });
    assert.equal(shared.data.data.length, 2);
    assert.ok(shared.data.data.every((c) => !("private_notes" in c)));
    const key = randomUUID(),
      resource = randomUUID(),
      trace = randomUUID(),
      payload = {
        id: resource,
        data: { full_name: "Cliente HTTP", phone_raw: "011 15 2345-6789" },
      };
    const a = await api(endpoint, payload, users[1], "POST", {
      "Idempotency-Key": key,
      "X-Request-Id": trace,
    });
    const replay = await api(endpoint, payload, users[1], "POST", {
      "Idempotency-Key": key,
    });
    assert.equal(a.status, 201);
    assert.equal(a.headers.get("etag"), '"1"');
    assert.deepEqual(a.data, replay.data);
    assert.equal(
      sql(
        `select count(*) from public.audit_logs where entity_id='${resource}' and request_id='${trace}'`,
      ),
      "1",
    );
    assert.equal(
      sql(
        `select origin_request_id from app.customer_requests where business_id='${b}' and key='${key}'`,
      ),
      trace,
    );
    assert.equal(
      (
        await api(
          endpoint,
          { ...payload, data: { full_name: "Other intent" } },
          users[1],
          "POST",
          { "Idempotency-Key": key },
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await api(
          `${endpoint}/${resource}`,
          { full_name: "No expected" },
          users[1],
          "PUT",
          { "Idempotency-Key": randomUUID() },
        )
      ).status,
      428,
    );
    assert.equal(
      (
        await api(
          `${endpoint}/${resource}`,
          { full_name: "Stale" },
          users[1],
          "PUT",
          { "Idempotency-Key": randomUUID(), "If-Match": '"9"' },
        )
      ).status,
      412,
    );
    assert.equal(
      (
        await api(endpoint, payload, users[2], "POST", {
          "Idempotency-Key": key,
        })
      ).status,
      403,
    );
    assert.equal(
      (await api(`${endpoint}/${id}`, null, users[2], "GET")).status,
      403,
    );
    assert.equal(
      (
        await api(
          `${origin}/api/v1/businesses/${randomUUID()}/customers`,
          null,
          users[1],
          "GET",
        )
      ).status,
      404,
    );
    sql(
      `insert into public.customers(id,business_id,full_name,phone_status,created_at) select gen_random_uuid(),'${b}','Paginado '||n,'missing','2026-01-01T00:00:00Z' from generate_series(1,151) n;`,
    );
    await page.reload();
    await expect(cards).toHaveCount(50);
    const firstPage = await cards.locator("h3").allTextContents();
    await page.getByRole("button", { name: "Ver más clientes" }).click();
    await expect(cards).toHaveCount(50);
    await expect
      .poll(async () =>
        JSON.stringify(await cards.locator("h3").allTextContents()),
      )
      .not.toBe(JSON.stringify(firstPage));
    assert.ok(
      (await cards.locator("h3").allTextContents()).every(
        (n) => !firstPage.includes(n),
      ),
    );
    const seen = new Set();
    let cursor = null;
    do {
      const result = await api(`${endpoint}/search`, { limit: 50, cursor });
      assert.equal(result.status, 200);
      for (const c of result.data.data) {
        assert.ok(!seen.has(c.id));
        seen.add(c.id);
      }
      cursor = result.data.page.next_cursor;
    } while (cursor);
    assert.equal(seen.size, 154);
    const firstPageApi = await api(
      endpoint + "?limit=50",
      null,
      users[1],
      "GET",
    );
    assert.equal(
      (
        await api(`${endpoint}/search`, {
          state: "archived",
          cursor: firstPageApi.data.page.next_cursor,
        })
      ).status,
      400,
    );
    const screenshots = path.join(process.cwd(), "test-results");
    mkdirSync(screenshots, { recursive: true });
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: path.join(screenshots, "customers-desktop.png"),
      fullPage: false,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload();
    await expect(cards).toHaveCount(50);
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.evaluate(() => scrollTo(0, 0));
    await page.screenshot({
      path: path.join(screenshots, "customers-mobile.png"),
      fullPage: false,
    });
    const barberJar = [];
    const client = createServerClient(gatewayUrl, publicKey, {
      cookies: {
        getAll: () => barberJar,
        setAll: (values) => {
          for (const c of values) {
            const index = barberJar.findIndex((x) => x.name === c.name);
            if (index >= 0) barberJar.splice(index, 1);
            barberJar.push(c);
          }
        },
      },
    });
    assert.equal((await client.auth.setSession(users[2].session)).error, null);
    const barber = await browser.newContext();
    await barber.addCookies(cookies(barberJar));
    const barberPage = await barber.newPage();
    await barberPage.goto(route);
    await expect(
      barberPage.getByRole("button", { name: "Nuevo cliente", exact: true }),
    ).toHaveCount(0);
    await expect(barberPage.locator("article.customer-card")).toHaveCount(0);
    await barber.close();
    assert.equal(errors, 0);
    console.log(
      "Customer UI/HTTP PASS: shared contacts, private detail, CRUD/archive/restore, 412 draft, keyset 154 rows, scoped cursors, trace/replay, roles, tenant isolation and mobile.",
    );
  } finally {
    await context.close();
  }
}
