import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { randomBytes, randomUUID, createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";

function sql(input: string) {
  try {
    return execFileSync(
      "docker",
      [
        "exec",
        "-i",
        "supabase_db_turnosmerivo",
        "psql",
        "-U",
        "postgres",
        "-d",
        "postgres",
        "-v",
        "ON_ERROR_STOP=1",
        "-At",
      ],
      {
        input,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      },
    );
  } catch {
    throw new Error(
      "Local Auth test fixture failed; verify Docker and migrations.",
    );
  }
}
function totp(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits = [...secret]
    .map((char) => alphabet.indexOf(char).toString(2).padStart(5, "0"))
    .join("");
  const key = Buffer.from(
    bits.match(/.{8}/g)!.map((byte) => parseInt(byte, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hash = createHmac("sha1", key).update(counter).digest();
  const offset = hash.at(-1)! & 15;
  return ((hash.readUInt32BE(offset) & 0x7fffffff) % 1000000)
    .toString()
    .padStart(6, "0");
}

test("real login, MFA, tenant switching, member authorization and logout", async ({
  page,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  let pageErrors = 0;
  page.on("pageerror", () => {
    pageErrors++;
  });
  const origin = new URL(testInfo.project.use.baseURL!).origin;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const adminKey = process.env.SUPABASE_AUTH_ADMIN_KEY;
  if (url !== "http://127.0.0.1:54321" || !publicKey || !adminKey)
    throw new Error(
      "Run auth:configure-local before Auth E2E; only the local project is permitted.",
    );
  const admin = createClient(url, adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  }).auth.admin;
  const password = randomBytes(24).toString("base64url");
  const suffix = randomUUID();
  const emails = [
    `owner-${suffix}@example.test`,
    `barber-${suffix}@example.test`,
    `outsider-${suffix}@example.test`,
  ];
  const users: string[] = [];
  const businessIds = [randomUUID(), randomUUID()];
  const barberMember = randomUUID();
  const mailIds: string[] = [];
  try {
    for (const email of emails) {
      const { data, error } = await admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { role: "owner", business_id: businessIds[0] },
      });
      if (error || !data.user)
        throw new Error("Local Auth fixture creation failed.");
      users.push(data.user.id);
    }
    sql(`begin;
      insert into public.businesses(id,slug,name) values('${businessIds[0]}','e2e-${suffix.slice(0, 18)}','Merivo Prueba A'),('${businessIds[1]}','e2b-${suffix.slice(0, 18)}','Merivo Prueba B');
      insert into public.business_settings(business_id) values('${businessIds[0]}'),('${businessIds[1]}');
      insert into public.business_members(business_id,user_id,role) values('${businessIds[0]}','${users[0]}','owner'),('${businessIds[1]}','${users[0]}','owner');
      insert into public.business_members(id,business_id,user_id,role) values('${barberMember}','${businessIds[0]}','${users[1]}','barber');
      commit;`);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/login/);
    await page.screenshot({
      path: testInfo.outputPath("login.png"),
      fullPage: true,
    });
    await page.getByLabel("Email", { exact: true }).fill(emails[0]);
    await page.getByLabel("Contraseña", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Ingresar", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Mis negocios." }),
    ).toBeVisible();
    const cookies = await page.context().cookies();
    expect(
      cookies
        .filter((cookie) => cookie.name.includes("auth-token"))
        .every((cookie) => cookie.httpOnly && cookie.sameSite === "Lax"),
    ).toBe(true);
    expect(cookies.some((cookie) => cookie.name.includes("auth-token"))).toBe(
      true,
    );
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).some((key) => key.includes("auth-token")),
      ),
    ).toBe(false);
    await page.getByRole("link", { name: /Merivo Prueba A/ }).click();
    await expect(page).toHaveURL(/\/seguridad/);
    await page
      .getByRole("button", { name: "Configurar autenticador", exact: true })
      .click();
    await expect(page.locator(".mfa-setup code")).toBeVisible();
    const qr = page.getByRole("img", {
      name: "Código QR para configurar tu autenticador",
    });
    await expect(qr).toBeVisible();
    await expect(qr).toHaveJSProperty("complete", true);
    expect(
      await qr.evaluate((image: HTMLImageElement) => image.naturalWidth > 0),
    ).toBe(true);
    expect(pageErrors).toBe(0);
    const secret = await page.locator(".mfa-setup code").textContent();
    if (!secret)
      throw new Error("MFA enrollment did not return a local setup key.");
    await page.getByLabel("Código de 6 dígitos").fill(totp(secret));
    await page.getByRole("button", { name: "Verificar y continuar" }).click();
    await expect(page).toHaveURL(/\/app$/);
    await page.screenshot({
      path: testInfo.outputPath("businesses.png"),
      fullPage: true,
    });
    await page.getByRole("link", { name: /Merivo Prueba B/ }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Merivo Prueba B.",
    );
    await page
      .getByRole("link", { name: "Cambiar de negocio", exact: false })
      .click();
    await page.getByRole("link", { name: /Merivo Prueba A/ }).click();
    await page.getByRole("link", { name: /Equipo y permisos/ }).click();
    await expect(
      page.getByRole("heading", { name: "Tu equipo." }),
    ).toBeVisible();
    const inviteEmail = `invite-${suffix}@example.test`;
    await page.getByLabel("Email de la persona").fill(inviteEmail);
    await page
      .locator(".invite-card")
      .getByRole("combobox", { name: "Rol", exact: true })
      .selectOption("barber");
    await page.getByRole("button", { name: "Crear invitación" }).click();
    await expect(
      page.getByRole("link", { name: "Abrir invitación" }),
    ).toBeVisible();
    const invitation = await page
      .getByRole("link", { name: "Abrir invitación" })
      .getAttribute("href");
    expect(!!invitation?.includes("#t=")).toBe(true);
    const invitedCard = page
      .locator(".member-card")
      .filter({ hasText: inviteEmail });
    await invitedCard
      .getByRole("button", { name: "Enviar alta por email" })
      .click();
    await expect(invitedCard.getByRole("status")).toContainText(
      "Email de alta enviado",
    );
    const invitedUserId = sql(
      `select id from auth.users where email='${inviteEmail}';`,
    ).trim();
    if (!/^[0-9a-f-]{36}$/.test(invitedUserId))
      throw new Error("Invited local account was not created.");
    users.push(invitedUserId);
    const mail = await request.get(
      `http://127.0.0.1:54324/api/v1/search?query=${encodeURIComponent(`to:${inviteEmail}`)}`,
    );
    const messages = (await mail.json()).messages as { ID: string }[];
    if (!messages?.length)
      throw new Error("Local invitation email was not captured.");
    mailIds.push(...messages.map((message) => message.ID));
    const detail = await request.get(
      `http://127.0.0.1:54324/api/v1/message/${messages[0].ID}`,
    );
    const mailText = (await detail.json()).Text as string;
    const emailCode = mailText.match(/\b\d{6}\b/)?.[0];
    if (!emailCode)
      throw new Error(
        "Local invite template did not contain a confirmation code.",
      );
    await page.screenshot({
      path: testInfo.outputPath("members.png"),
      fullPage: true,
    });
    const memberCard = page
      .locator(".member-card")
      .filter({ hasText: emails[1] });
    await memberCard
      .getByRole("combobox", { name: "Estado", exact: true })
      .selectOption("suspended");
    await memberCard.getByRole("button", { name: "Guardar cambios" }).click();
    await expect(memberCard.getByRole("status")).toHaveText(
      "Membresía actualizada.",
    );
    const patchUrl = `/api/v1/businesses/${businessIds[0]}/members/${barberMember}`;
    const concurrent = await Promise.all(
      [1, 2].map(() =>
        page.request.patch(patchUrl, {
          headers: {
            Origin: origin,
            "If-Match": '"2"',
            "Idempotency-Key": randomUUID(),
          },
          data: { role: "barber", status: "suspended" },
        }),
      ),
    );
    if (
      concurrent.some((response) => ![200, 412].includes(response.status()))
    ) {
      const codes = await Promise.all(
        concurrent.map(async (response) => (await response.json()).code),
      );
      throw new Error(
        `Concurrent membership requests failed: ${codes.join(", ")}`,
      );
    }
    expect(concurrent.map((response) => response.status()).sort()).toEqual([
      200, 412,
    ]);
    const noVersion = await page.request.patch(patchUrl, {
      headers: {
        Origin: origin,
        "Idempotency-Key": randomUUID(),
      },
      data: { role: "barber", status: "active" },
    });
    expect(noVersion.status()).toBe(428);
    await page.getByRole("button", { name: "Salir", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto(`/app/${businessIds[0]}/miembros`);
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/auth/alta");
    await page.getByLabel("Email", { exact: true }).fill(inviteEmail);
    await page.getByLabel("Código del email").fill(emailCode);
    await page.getByRole("button", { name: "Confirmar mi email" }).click();
    await expect(page).toHaveURL(/\/seguridad/);
    await page.getByLabel("Nueva contraseña").fill(password);
    await page.getByRole("button", { name: "Actualizar contraseña" }).click();
    await expect(page.getByRole("status")).toHaveText(
      "Contraseña actualizada.",
    );
    await page.goto(invitation!);
    await page
      .getByRole("button", { name: "Usar invitación del enlace" })
      .click();
    await expect
      .poll(
        async () =>
          (await page.getByLabel("Clave de invitación").inputValue()).length,
      )
      .toBe(43);
    await page
      .getByRole("button", { name: "Aceptar invitación", exact: true })
      .click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/app");
    await expect(
      page.getByRole("link", { name: /Merivo Prueba A/ }),
    ).toBeVisible();
    await page.getByRole("link", { name: /Merivo Prueba A/ }).click();
    await expect(
      page.getByRole("link", { name: /Equipo y permisos/ }),
    ).toHaveCount(0);
    await page.goto(`/app/${businessIds[0]}/miembros`);
    await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
    await page.goto("/app");
    await page.getByRole("button", { name: "Salir", exact: true }).click();

    // Real JWTs, not postgres claims, exercise direct PostgREST and Next API boundaries.
    const client = createClient(url, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const signup = await client.auth.signUp({
      email: `blocked-${suffix}@example.test`,
      password,
    });
    expect(signup.error?.code).toBe("signup_disabled");
    const outsider = await client.auth.signInWithPassword({
      email: emails[2],
      password,
    });
    if (outsider.error || !outsider.data.session)
      throw new Error("Local outsider sign-in failed.");
    const outsiderToken = outsider.data.session.access_token;
    const me = await request.get("/api/v1/me", {
      headers: { Authorization: `Bearer ${outsiderToken}` },
    });
    expect(me.status()).toBe(200);
    expect((await me.json()).memberships).toEqual([]);
    const cross = await request.get(
      `/api/v1/businesses/${businessIds[0]}/members`,
      { headers: { Authorization: `Bearer ${outsiderToken}` } },
    );
    expect(cross.status()).toBe(404);
    const direct = await client
      .schema("api")
      .rpc("list_members", { p_business_id: businessIds[0] });
    expect(direct.error?.code).toBe("PT404");
    const rawWrite = await client
      .from("business_members")
      .update({ role: "owner" })
      .eq("id", barberMember);
    expect(rawWrite.error?.code).toBe("42501");
    const missingOrigin = await request.post(
      `/api/v1/businesses/${businessIds[0]}/members/invite`,
      { data: {} },
    );
    expect(missingOrigin.status()).toBe(403);
    const barber = await client.auth.signInWithPassword({
      email: emails[1],
      password,
    });
    if (barber.error || !barber.data.session)
      throw new Error("Local barber sign-in failed.");
    const suspended = await request.get(
      `/api/v1/businesses/${businessIds[0]}/members`,
      {
        headers: {
          Authorization: `Bearer ${barber.data.session.access_token}`,
        },
      },
    );
    expect(suspended.status()).toBe(404);
    await client.auth.signOut();
  } finally {
    // Exact random fixture IDs only, local database only. No reset or business data deletion.
    sql(`begin; set local session_replication_role=replica;
      delete from app.member_requests where business_id in ('${businessIds[0]}','${businessIds[1]}');
      delete from app.member_invitations where business_id in ('${businessIds[0]}','${businessIds[1]}');
      delete from public.audit_logs where business_id in ('${businessIds[0]}','${businessIds[1]}');
      delete from public.business_members where business_id in ('${businessIds[0]}','${businessIds[1]}');
      delete from public.business_settings where business_id in ('${businessIds[0]}','${businessIds[1]}');
      delete from public.businesses where id in ('${businessIds[0]}','${businessIds[1]}'); commit;`);
    for (const id of users) await admin.deleteUser(id);
    if (mailIds.length)
      await request.delete("http://127.0.0.1:54324/api/v1/messages", {
        data: { IDs: mailIds },
      });
  }
});
