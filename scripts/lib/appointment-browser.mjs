import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
export async function runAppointmentBrowser({
  browser,
  origin,
  jar,
  users,
  sql,
}) {
  const b = randomUUID(),
    staff = randomUUID(),
    member = randomUUID(),
    customer = randomUUID(),
    customer2 = randomUUID(),
    service = randomUUID(),
    plan = randomUUID();
  const day = sql(
    "select ((clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date+1)::text",
  );
  sql(
    `insert into public.businesses(id,slug,name) values('${b}','in-ui-${b.slice(0, 16)}','Agenda de prueba');insert into public.business_settings(business_id,min_notice_minutes) values('${b}',0);insert into public.business_members(business_id,user_id,role) values('${b}','${users[0].id}','owner'),('${b}','${users[1].id}','admin');insert into public.business_members(id,business_id,user_id,role) values('${member}','${b}','${users[2].id}','barber');insert into public.staff_members(id,business_id,member_id,display_name) values('${staff}','${b}','${member}','Profesional agenda');insert into public.customers(id,business_id,full_name,phone_raw,phone_status,private_notes) values('${customer}','${b}','Cliente agenda uno','1144445555','needs_review','Do not disclose'),('${customer2}','${b}','Cliente agenda dos','1144445555','needs_review',null);insert into public.services(id,business_id,name,price_cents,duration_minutes,buffer_minutes) values('${service}','${b}','Corte agenda',180000,30,15);insert into public.staff_services(business_id,staff_member_id,service_id,duration_override_minutes) values('${b}','${staff}','${service}',45);insert into public.staff_working_plans(id,business_id,staff_member_id,effective_from,created_by) values('${plan}','${b}','${staff}','${day}','${users[0].id}');insert into public.working_hours(business_id,plan_id,position,weekday,start_minute,end_minute) select '${b}','${plan}',n,n,540,1080 from generate_series(1,7)n;`,
  );
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
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
  page.on("pageerror", () => errors++);
  const base = `${origin}/api/v1/businesses/${b}`;
  async function api(url, body, user = users[1], extra = {}) {
    const r = await fetch(base + url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${user.token}`,
        "Content-Type": "application/json",
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, data: await r.json(), headers: r.headers };
  }
  const createBody = (time = "09:00:00") => ({
    id: randomUUID(),
    customer_id: customer2,
    staff_id: staff,
    service_id: service,
    starts_at: `${day}T${time}-03:00`,
    context_versions: {
      staff: 1,
      service: 1,
      customer: 1,
      calendar: 1,
      settings: 1,
      business: 1,
    },
  });
  let checkpoint = "open agenda";
  try {
    await page.goto(`${origin}/app/${b}/agenda`);
    await expect(
      page.getByRole("heading", { name: "Agenda.", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Buscar cliente", { exact: true })
      .fill("Cliente agenda");
    await page
      .getByRole("button", { name: "Buscar fichas", exact: true })
      .click();
    await expect(
      page.getByLabel("Ficha del cliente", { exact: true }).locator("option"),
    ).toHaveCount(3);
    assert.equal(
      await page.getByLabel("Ficha del cliente", { exact: true }).inputValue(),
      "",
    );
    await page
      .getByLabel("Ficha del cliente", { exact: true })
      .selectOption(customer);
    await page
      .getByLabel("Profesional del turno", { exact: true })
      .selectOption(staff);
    await page
      .getByLabel("Servicio del turno", { exact: true })
      .selectOption(service);
    await page.getByLabel("Fecha del nuevo turno", { exact: true }).fill(day);
    await page
      .getByRole("button", { name: "Consultar horarios", exact: true })
      .click();
    await expect(
      page.getByLabel("Horario del nuevo turno", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Horario del nuevo turno", { exact: true })
      .selectOption({ label: "09:00" });
    checkpoint = "confirm booking";
    await page
      .getByRole("button", { name: "Confirmar turno", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText("Turno confirmado.");
    const id = sql(
      `select id from public.appointments where business_id='${b}'`,
    );
    assert.equal(
      sql(
        `select duration_minutes_snapshot from public.appointments where id='${id}'`,
      ),
      "45",
    );
    assert.equal((await api(`/appointments/${id}`)).headers.get("etag"), '"1"');
    assert.equal(
      JSON.stringify((await api(`/appointments/${id}`)).data).includes(
        "Do not disclose",
      ),
      false,
    );
    checkpoint = "HTTP safety and occupancy";
    assert.equal(
      (
        await api("/appointments", createBody(), users[1], {
          "Idempotency-Key": randomUUID(),
        })
      ).data.code,
      "SLOT_TAKEN",
    );
    assert.equal(
      (
        await api("/appointments", createBody("09:45:00"), users[1], {
          "Idempotency-Key": randomUUID(),
        })
      ).data.code,
      "SLOT_TAKEN",
    );
    const preview = (
      await api(
        `/schedule-preview?staff_id=${staff}&service_id=${service}&from=${day}&days=1`,
      )
    ).data;
    assert.equal(preview.occupancy_checked, true);
    assert.ok(
      !preview.slots.some((s) => s.label === "09:00" || s.label === "09:45"),
    );
    assert.equal(
      (
        await api("/appointments", createBody("10:00:00"), users[2], {
          "Idempotency-Key": randomUUID(),
        })
      ).status,
      403,
    );
    assert.equal(
      (await api(`/appointments?from=${day}`, undefined, users[2])).status,
      403,
    );
    const own = (
      await api(
        `/schedule-preview?staff_id=${staff}&service_id=${service}&from=${day}`,
        undefined,
        users[2],
      )
    ).data;
    assert.equal(own.occupancy_checked, true);
    assert.ok(!JSON.stringify(own).includes("Cliente agenda"));
    assert.ok(!JSON.stringify(own).includes("1144445555"));
    const diffBody = createBody("10:00:00"),
      key = randomUUID();
    let response = await api("/appointments", diffBody, users[1], {
      "Idempotency-Key": key,
    });
    assert.equal(response.status, 201);
    assert.equal(
      (
        await api("/appointments", diffBody, users[1], {
          "Idempotency-Key": key,
        })
      ).status,
      201,
    );
    assert.equal(
      (
        await api(
          "/appointments",
          { ...diffBody, starts_at: `${day}T11:00:00-03:00` },
          users[1],
          { "Idempotency-Key": key },
        )
      ).status,
      409,
    );
    const move = {
      starts_at: `${day}T10:00:00-03:00`,
      context_versions: { staff: 1, calendar: 1, settings: 1, business: 1 },
    };
    assert.equal(
      (
        await api(`/appointments/${id}/reschedule`, move, users[1], {
          "Idempotency-Key": randomUUID(),
        })
      ).status,
      428,
    );
    assert.equal(
      (
        await api(`/appointments/${id}/reschedule`, move, users[1], {
          "Idempotency-Key": randomUUID(),
          "If-Match": '"99"',
        })
      ).status,
      412,
    );
    assert.equal(
      (
        await api(`/appointments/${id}/reschedule`, move, users[1], {
          "Idempotency-Key": randomUUID(),
          "If-Match": '"1"',
        })
      ).data.code,
      "SLOT_TAKEN",
    );
    assert.equal(
      sql(`select version from public.appointments where id='${id}'`),
      "1",
    );
    assert.equal(
      sql(
        `select count(*) from app.appointment_occupancy where appointment_id='${id}'`,
      ),
      "1",
    );
    // HS conflict is an allowlisted ID/date projection, never customer contacts or SQL text.
    response = await api(
      "/schedule-exceptions",
      {
        id: randomUUID(),
        action: "save",
        data: { date: day, kind: "closed", intervals: [] },
      },
      users[1],
      { "Idempotency-Key": randomUUID(), "If-Match": '"1"' },
    );
    assert.equal(response.status, 409);
    assert.equal(response.data.code, "APPOINTMENTS_AFFECTED");
    assert.equal(response.data.conflicts.appointments.length, 2);
    assert.ok(!JSON.stringify(response.data).includes("Cliente agenda"));
    checkpoint = "reschedule UI";
    await page.getByLabel("Nueva fecha", { exact: true }).fill(day);
    await page
      .getByRole("button", { name: "Consultar para reprogramar", exact: true })
      .click();
    await expect(
      page.getByLabel("Nuevo horario", { exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Nuevo horario", { exact: true })
      .selectOption({ label: "11:00" });
    await page
      .getByLabel("Motivo privado", { exact: true })
      .fill("Cambio solicitado en prueba");
    await page
      .getByRole("button", { name: "Confirmar reprogramación", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText("Turno reprogramado.");
    mkdirSync("test-results", { recursive: true });
    await page.screenshot({
      path: path.resolve("test-results/internal-agenda-desktop.png"),
      fullPage: true,
    });
    assert.equal(
      sql(
        `select count(*) from app.appointment_occupancy where appointment_id='${id}'`,
      ),
      "2",
    );
    await page.setViewportSize({ width: 390, height: 844 });
    mkdirSync("test-results", { recursive: true });
    await page.screenshot({
      path: path.resolve("test-results/internal-agenda-mobile.png"),
      fullPage: true,
    });
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    checkpoint = "cancel UI";
    await page
      .getByRole("button", { name: "Cancelar turno", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Confirmar cancelación", exact: true })
      .click();
    await expect(page.getByRole("status")).toHaveText(
      "Turno cancelado. El horario quedó libre.",
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
    assert.equal(
      sql(
        `select count(*) from app.appointment_outbox where appointment_id='${id}'`,
      ),
      "3",
    );
    assert.equal(
      sql(
        `select count(distinct request_id) from public.appointment_events where appointment_id='${id}'`,
      ),
      "3",
    );
    await api(`/appointments/${diffBody.id}/cancel`, {}, users[1], {
      "Idempotency-Key": randomUUID(),
      "If-Match": '"1"',
    });
    response = await api(
      "/schedule-exceptions",
      {
        id: randomUUID(),
        action: "save",
        data: { date: day, kind: "closed", intervals: [] },
      },
      users[1],
      { "Idempotency-Key": randomUUID(), "If-Match": '"1"' },
    );
    assert.equal(response.status, 200);
    assert.equal(errors, 0);
    console.log(
      "Internal agenda UI/HTTP PASS: explicit shared-contact selection, frozen override/price, occupied buffer, 428/412, failed move rollback, replay, barber boundaries, HS conflicts, create/move/cancel, trace and mobile.",
    );
  } catch (error) {
    throw Error(
      `Internal agenda ${checkpoint}: ${error.message.split("\n")[0]}`,
    );
  } finally {
    await context.close();
  }
}
