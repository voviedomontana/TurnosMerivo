import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { publicBookingFixture } from "./public-booking-fixture.mjs";
export async function runPublicBookingBrowser({ browser, origin, sql, users }) {
  const f = publicBookingFixture(sql, users[0].id),
    context = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
    }),
    page = await context.newPage();
  let errors = 0,
    checkpoint = "disabled gate";
  page.on("pageerror", () => errors++);
  const endpoint = (fixture) => `${origin}/api/v1/public/${fixture.slug}`;
  async function api(ctx, fixture, p, body, headers = {}) {
    const r = await ctx.request.fetch(endpoint(fixture) + p, {
      method: body === undefined ? "GET" : "POST",
      headers: { "X-Merivo-Public": "1", Origin: origin, ...headers },
      ...(body === undefined ? {} : { data: body }),
    });
    return { status: r.status(), data: await r.json(), headers: r.headers() };
  }
  async function fill(fixture) {
    await page.goto(`${origin}/b/${fixture.slug}`);
    await page
      .getByRole("button", { name: "Comenzar reserva de prueba", exact: true })
      .click();
    await page
      .getByLabel("Profesional público", { exact: true })
      .selectOption(fixture.staff);
    await page
      .getByLabel("Servicio público", { exact: true })
      .selectOption(fixture.service);
    await page.getByLabel("Fecha pública", { exact: true }).fill(fixture.day);
    await page
      .getByRole("button", { name: "Consultar horarios libres", exact: true })
      .click();
    await page
      .getByLabel("Horario público", { exact: true })
      .selectOption({ label: "09:00" });
    await page
      .getByLabel("Nombre", { exact: true })
      .fill("Cliente ficticio público");
    await page
      .getByLabel("Teléfono declarado", { exact: true })
      .fill("1144445555");
    await page.getByRole("checkbox").check();
  }
  try {
    assert.equal(
      (
        await api(
          context,
          f,
          `/availability?staff_id=${f.staff}&service_id=${f.service}&from=${f.day}`,
        )
      ).status,
      503,
    );
    sql("update app.public_booking_runtime set disposable=true;");
    checkpoint = "response lost after commit";
    await fill(f);
    let observedStatus = 0,
      observedCode = "",
      payloadShape = "";
    let resolveIntercept;
    const intercepted = new Promise((resolve) => {
      resolveIntercept = resolve;
    });
    await page.route(
      `**/api/v1/public/${f.slug}/appointments`,
      async (route) => {
        try {
          const dto = route.request().postDataJSON();
          payloadShape = JSON.stringify({
            name:
              typeof dto.customer?.full_name === "string" &&
              dto.customer.full_name.length > 0,
            phone:
              typeof dto.customer?.phone_raw === "string" &&
              dto.customer.phone_raw.length > 0,
            quote: typeof dto.quote_id === "string",
            notice: typeof dto.privacy_policy_version === "string",
          });
          const r = await route.fetch();
          observedStatus = r.status();
          if (observedStatus === 201) await route.abort();
          else {
            const safe = await r.json();
            observedCode = /^[A-Z_]+$/.test(safe.code ?? "")
              ? safe.code
              : "UNCLASSIFIED";
            await route.fulfill({ response: r });
          }
        } catch {
          observedCode = "INTERCEPTION_FAILED";
          await route.abort();
        } finally {
          resolveIntercept();
        }
      },
      { times: 1 },
    );
    await page
      .getByRole("button", { name: "Confirmar reserva de prueba", exact: true })
      .click();
    await intercepted;
    assert.equal(
      observedStatus,
      201,
      `Create failed: ${observedStatus}/${observedCode}; field-presence flags ${payloadShape}`,
    );
    await expect(
      page.getByRole("button", {
        name: "Reintentar confirmación",
        exact: true,
      }),
    ).toBeEnabled();
    assert.equal(
      sql(
        `select count(*) from public.appointments where business_id='${f.b}'`,
      ),
      "1",
    );
    await page
      .getByRole("button", { name: "Reintentar confirmación", exact: true })
      .click();
    const link = page.getByRole("link", {
      name: "Abrir y guardar mi enlace de gestión",
      exact: true,
    });
    await expect(link).toBeVisible();
    const manageLink = await link.getAttribute("href"),
      id = sql(`select id from public.appointments where business_id='${f.b}'`);
    assert.equal(
      sql(
        `select count(*) from public.customers where business_id='${f.b}' and source='public_booking'`,
      ),
      "1",
    );
    assert.equal(
      sql(
        `select count(*) from public.appointment_events where appointment_id='${id}'`,
      ),
      "1",
    );
    assert.equal(
      sql(
        `select count(*) from app.appointment_outbox where appointment_id='${id}'`,
      ),
      "1",
    );
    const cookies = await context.cookies(endpoint(f) + "/appointments");
    assert.ok(
      cookies.some(
        (c) =>
          c.name.startsWith("merivo_attempt_") &&
          c.httpOnly &&
          c.sameSite === "Lax",
      ),
    );
    await link.click();
    await expect(
      page.getByRole("heading", { name: "Gestioná tu reserva.", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        "Corte público de prueba · Profesional público de prueba",
        { exact: true },
      ),
    ).toBeVisible();
    assert.equal(new URL(page.url()).hash, "");
    assert.ok(
      !(await page
        .locator("body")
        .innerText()
        .then((t) => t.includes("PRIVATE-NOTES") || t.includes("1144445555"))),
    );
    checkpoint = "self management";
    await page
      .getByLabel("Nueva fecha pública", { exact: true })
      .fill(f.nextDay);
    await page
      .getByRole("button", { name: "Buscar nuevo horario", exact: true })
      .click();
    await page
      .getByLabel("Nuevo horario público", { exact: true })
      .selectOption({ label: "11:00" });
    await page
      .getByRole("button", { name: "Confirmar cambio de horario", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText("Turno reprogramado.");
    assert.equal(
      sql(`select version from public.appointments where id='${id}'`),
      "2",
    );
    mkdirSync("test-results", { recursive: true });
    await page.screenshot({
      path: path.resolve("test-results/public-management-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: path.resolve("test-results/public-management-mobile.png"),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page
      .getByRole("button", { name: "Cancelar mi turno", exact: true })
      .click();
    await page
      .getByRole("button", {
        name: "Confirmar cancelación pública",
        exact: true,
      })
      .click();
    await expect(page.getByRole("status")).toHaveText(
      "Turno cancelado. Se liberó el horario.",
    );
    assert.equal(
      sql(
        `select count(*) from app.appointment_occupancy where appointment_id='${id}' and released_at is null`,
      ),
      "0",
    );
    assert.equal(
      sql(
        `select count(*) from public.appointment_events where appointment_id='${id}'`,
      ),
      "3",
    );
    const lost = await browser.newContext(),
      lostPage = await lost.newPage();
    await lostPage.goto(`${origin}/b/${f.slug}/r/${id}`);
    await expect(lostPage.getByRole("status")).toContainText(
      "No encontramos un acceso válido",
    );
    await lostPage.goto(origin + manageLink);
    await expect(lostPage.getByText(/min · Cancelado/)).toBeVisible();
    await lost.close();
    checkpoint = "response lost before commit";
    const second = publicBookingFixture(sql, users[0].id);
    await fill(second);
    await page.route(
      `**/api/v1/public/${second.slug}/appointments`,
      (route) => route.abort(),
      { times: 1 },
    );
    await page
      .getByRole("button", { name: "Confirmar reserva de prueba", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Reintentar confirmación",
        exact: true,
      }),
    ).toBeEnabled();
    assert.equal(
      sql(
        `select count(*) from public.appointments where business_id='${second.b}'`,
      ),
      "0",
    );
    await page
      .getByRole("button", { name: "Reintentar confirmación", exact: true })
      .click();
    await expect(
      page.getByRole("link", {
        name: "Abrir y guardar mi enlace de gestión",
        exact: true,
      }),
    ).toBeVisible();
    assert.equal(
      sql(
        `select count(*) from public.appointments where business_id='${second.b}'`,
      ),
      "1",
    );
    checkpoint = "persistent shared quota and origin";
    const quotaFixture = publicBookingFixture(sql, users[0].id),
      other = await browser.newContext();
    assert.equal(
      (
        await api(
          other,
          quotaFixture,
          "/attempts",
          { id: randomUUID() },
          { Origin: "https://untrusted.example" },
        )
      ).status,
      403,
    );
    for (let n = 0; n < 11; n++) {
      const r = await api(
        n % 2 ? other : context,
        quotaFixture,
        "/attempts",
        { id: randomUUID() },
        { "X-Forwarded-For": `192.0.2.${n + 1}` },
      );
      assert.equal(r.status, n < 10 ? 201 : 429);
    }
    await other.close();
    assert.equal(errors, 0);
    console.log(
      "Public booking E2E PASS: response lost before/after commit and authorized recovery, one customer/effect, HttpOnly cookie, fragment exchange/clear, self reschedule/cancel, lost-cookie denial, original-link recovery, shared persistent quota despite spoofed forwarding, origin checks and mobile.",
    );
  } catch (error) {
    throw Error(
      `Public booking ${checkpoint}: ${error.message.split("\n")[0]}`,
    );
  } finally {
    await context.close();
  }
}
