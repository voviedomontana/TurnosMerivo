import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { createServerClient } from "@supabase/ssr";
import { expect } from "@playwright/test";
export async function runScheduleBrowser({
  browser,
  origin,
  jar,
  users,
  sql,
  gatewayUrl,
  publicKey,
}) {
  const b = randomUUID(),
    staff = randomUUID(),
    other = randomUUID(),
    member = randomUUID(),
    service = randomUUID();
  sql(
    `insert into public.businesses(id,slug,name) values('${b}','hs-ui-${b.slice(0, 16)}','Horarios de prueba');insert into public.business_settings(business_id,min_notice_minutes) values('${b}',0);insert into public.business_members(business_id,user_id,role) values('${b}','${users[0].id}','owner'),('${b}','${users[1].id}','admin');insert into public.business_members(id,business_id,user_id,role) values('${member}','${b}','${users[2].id}','barber');insert into public.staff_members(id,business_id,member_id,display_name) values('${staff}','${b}','${member}','Profesional de horarios'),('${other}','${b}',null,'Otro profesional');insert into public.services(id,business_id,name,price_cents,duration_minutes,buffer_minutes) values('${service}','${b}','Corte de prueba',150000,30,10);insert into public.staff_services(business_id,staff_member_id,service_id,duration_override_minutes) values('${b}','${staff}','${service}',45);`,
  );
  const day = sql(
      `select ((clock_timestamp() at time zone timezone)::date+1)::text from public.businesses where id='${b}'`,
    ),
    weekday = Number(
      sql(`select extract(isodow from '${day}'::date)::integer`),
    ),
    names = [
      "Lunes",
      "Martes",
      "Miércoles",
      "Jueves",
      "Viernes",
      "Sábado",
      "Domingo",
    ];
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
  const base = `${origin}/api/v1/businesses/${b}`,
    route = `${origin}/app/${b}/horarios`;
  const api = async (
    url,
    body,
    user = users[1],
    method = "POST",
    headers = {},
  ) => {
    const r = await fetch(base + url, {
      method,
      headers: {
        Authorization: `Bearer ${user.token}`,
        "Content-Type": "application/json",
        ...headers,
      },
      ...(method !== "GET" ? { body: JSON.stringify(body) } : {}),
    });
    return { status: r.status, data: await r.json(), headers: r.headers };
  };
  let checkpoint = "open editor";
  try {
    await page.goto(route);
    await expect(
      page.getByRole("heading", { name: "Horarios.", exact: true }),
    ).toBeVisible();
    if (
      (await page.getByLabel("Profesional", { exact: true }).inputValue()) !==
      staff
    ) {
      const loaded = page.waitForResponse(
        (r) =>
          r.url().endsWith(`/staff/${staff}/schedule`) &&
          r.request().method() === "GET",
      );
      await page.getByLabel("Profesional", { exact: true }).selectOption(staff);
      await loaded;
    }
    await expect(
      page.getByRole("button", { name: "Recargar configuración" }),
    ).toBeEnabled();
    await expect(
      page.getByText("Profesional de horarios", { exact: true }).first(),
    ).toBeAttached();
    const week = page.getByRole("form", { name: "Semana de atención" }),
      exception = page.getByRole("form", { name: "Nueva excepción" }),
      block = page.getByRole("form", { name: "Nuevo bloqueo" }),
      preview = page.getByRole("form", { name: "Vista previa" });
    checkpoint = "weekly plan";
    await week.getByLabel("Vigente desde").fill(day);
    await week
      .getByLabel(names[weekday - 1], { exact: true })
      .fill("09:10-13:00, 14:00-18:00");
    await week.getByRole("button", { name: "Guardar semana" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Configuración guardada",
    );
    checkpoint = "weekly preview";
    await preview.getByLabel("Desde", { exact: true }).fill(day);
    await preview
      .getByRole("button", { name: "Calcular vista previa" })
      .click();
    await expect(page.locator(".preview-slots li").first()).toContainText(
      "09:15",
    );
    checkpoint = "personal special hours";
    await exception.getByLabel("Fecha", { exact: true }).fill(day);
    await exception
      .getByLabel("Tipo de excepción")
      .selectOption("custom_hours");
    await exception.getByLabel("Intervalos especiales").fill("10:00-11:00");
    await exception
      .getByLabel("Motivo privado")
      .fill("Motivo privado individual");
    await exception.getByRole("button", { name: "Guardar excepción" }).click();
    await expect(page.getByRole("status")).toContainText(
      "Configuración guardada",
    );
    await expect(
      page
        .locator(".schedule-record")
        .filter({ hasText: "Motivo privado individual" }),
    ).toHaveCount(1);
    checkpoint = "global closure";
    await exception.getByLabel("Aplicar a todo el negocio").check();
    await exception.getByLabel("Tipo de excepción").selectOption("closed");
    await exception.getByLabel("Motivo privado").fill("Motivo privado global");
    await exception.getByRole("button", { name: "Guardar excepción" }).click();
    await expect(
      page
        .locator(".schedule-record")
        .filter({ hasText: "Motivo privado global" }),
    ).toHaveCount(1);
    await preview
      .getByRole("button", { name: "Calcular vista previa" })
      .click();
    await expect(page.locator(".schedule-preview-results")).toContainText(
      "0 horarios posibles",
    );
    await page
      .locator(".schedule-record")
      .filter({ hasText: "Motivo privado global" })
      .getByRole("button", { name: "Retirar excepción" })
      .click();
    await expect(
      page
        .locator(".schedule-record")
        .filter({ hasText: "Motivo privado global" }),
    ).toHaveCount(0);
    checkpoint = "block and buffer";
    await block.getByLabel("Fecha de inicio").fill(day);
    await block.getByLabel("Fecha de fin").fill(day);
    await block.getByLabel("Hora de inicio").fill("10:00");
    await block.getByLabel("Hora de fin").fill("10:10");
    await block.getByLabel("Motivo privado").fill("Motivo privado bloqueo");
    await block.getByRole("button", { name: "Guardar bloqueo" }).click();
    await expect(
      page
        .locator(".schedule-record")
        .filter({ hasText: "Motivo privado bloqueo" }),
    ).toHaveCount(1);
    await preview
      .getByRole("button", { name: "Calcular vista previa" })
      .click();
    await expect(page.locator(".preview-slots li").first()).toContainText(
      "10:15",
    );
    const result = await api(
      `/schedule-preview?staff_id=${staff}&service_id=${service}&from=${day}`,
      null,
      users[1],
      "GET",
    );
    assert.equal(result.status, 200);
    assert.equal(result.data.can_book, false);
    assert.equal(result.data.occupancy_checked, true);
    assert.equal(result.data.duration_minutes, 45);
    checkpoint = "conflict and draft";
    const source = (
      await api(`/staff/${staff}/schedule`, null, users[1], "GET")
    ).data;
    const newDay = sql(`select ('${day}'::date+1)::text`),
      key = randomUUID(),
      id = randomUUID(),
      trace = randomUUID(),
      body = { id, data: { effective_from: newDay, intervals: [] } };
    const a = await api(
      `/staff/${staff}/working-hours`,
      body,
      users[1],
      "PUT",
      {
        "Idempotency-Key": key,
        "If-Match": `"${source.staff_version}"`,
        "X-Request-Id": trace,
      },
    );
    assert.equal(a.status, 200);
    assert.equal(
      (
        await api(`/staff/${staff}/working-hours`, body, users[1], "PUT", {
          "Idempotency-Key": key,
          "If-Match": `"${source.staff_version}"`,
        })
      ).status,
      200,
    );
    assert.equal(
      sql(
        `select count(*) from public.audit_logs where entity_id='${id}' and request_id='${trace}'`,
      ),
      "1",
    );
    assert.equal(
      sql(
        `select origin_request_id from app.schedule_requests where business_id='${b}' and key='${key}'`,
      ),
      trace,
    );
    await week.getByRole("button", { name: "Guardar semana" }).click();
    await expect(page.getByRole("status")).toContainText(
      "La configuración cambió",
    );
    await expect(
      week.getByLabel(names[weekday - 1], { exact: true }),
    ).toHaveValue("09:10-13:00, 14:00-18:00");
    assert.equal(
      (
        await api(
          `/staff/${staff}/working-hours`,
          { id: randomUUID(), data: { effective_from: day, intervals: [] } },
          users[1],
          "PUT",
          { "Idempotency-Key": randomUUID() },
        )
      ).status,
      428,
    );
    assert.equal(
      (
        await api(`/staff/${staff}/working-hours`, body, users[2], "PUT", {
          "Idempotency-Key": randomUUID(),
          "If-Match": '"1"',
        })
      ).status,
      403,
    );
    assert.equal(
      (await api(`/staff/${other}/schedule`, null, users[2], "GET")).status,
      404,
    );
    const own = await api(`/staff/${staff}/schedule`, null, users[2], "GET");
    assert.equal(own.status, 200);
    assert.ok(!JSON.stringify(own.data).includes("Motivo privado"));
    const screenshots = path.join(process.cwd(), "test-results");
    mkdirSync(screenshots, { recursive: true });
    await page.evaluate(() =>
      scrollTo({ top: 0, left: 0, behavior: "instant" }),
    );
    await page.screenshot({
      path: path.join(screenshots, "scheduling-desktop.png"),
      fullPage: false,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() =>
      scrollTo({ top: 0, left: 0, behavior: "instant" }),
    );
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    );
    await page.screenshot({
      path: path.join(screenshots, "scheduling-mobile.png"),
      fullPage: false,
    });
    checkpoint = "barber view";
    const barberJar = [];
    const client = createServerClient(gatewayUrl, publicKey, {
      cookies: {
        getAll: () => barberJar,
        setAll: (values) => {
          for (const c of values) {
            const i = barberJar.findIndex((v) => v.name === c.name);
            if (i >= 0) barberJar.splice(i, 1);
            barberJar.push(c);
          }
        },
      },
    });
    assert.equal((await client.auth.setSession(users[2].session)).error, null);
    const barber = await browser.newContext();
    await barber.addCookies(cookies(barberJar));
    const p = await barber.newPage();
    await p.goto(route);
    await expect(
      p.getByRole("form", { name: "Semana de atención" }),
    ).toHaveCount(0);
    await expect(p.getByRole("form", { name: "Nueva excepción" })).toHaveCount(
      0,
    );
    await expect(
      p.getByText("Motivo privado individual", { exact: true }),
    ).toHaveCount(0);
    await expect(p.getByLabel("Profesional").locator("option")).toHaveCount(1);
    await barber.close();
    assert.equal(errors, 0);
    console.log(
      "Scheduling UI/HTTP PASS: weekly plan, grid, personal/global precedence, blocks, override, explicit preview-only, replay/trace, 428/412 draft, barber own/no reasons, mobile.",
    );
  } catch (error) {
    throw Error(`Scheduling ${checkpoint}: ${error.message.split("\n")[0]}`);
  } finally {
    await context.close();
  }
}
