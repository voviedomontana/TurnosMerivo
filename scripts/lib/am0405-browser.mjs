import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import {
  cpSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { chromium, expect } from "@playwright/test";
import { runCatalogBrowser } from "./catalog-browser.mjs";
import { runCustomerBrowser } from "./customer-browser.mjs";
import { runScheduleBrowser } from "./schedule-browser.mjs";
import { runPublicCatalogBrowser } from "./public-catalog-browser.mjs";
import { runPublicBookingBrowser } from "./public-booking-browser.mjs";
import { runPublicBookingHttp } from "./public-booking-http.mjs";

export async function runAm0405Browser({
  publicDatabaseUrl,
  publicFocus,
  sql,
  auth,
  rest,
  users,
  business,
  member,
}) {
  const root = process.cwd(),
    project = mkdtempSync(path.join(tmpdir(), "merivo-ui-"));
  const traces = [];
  let checkpoint = "temporary build";
  let server, browser;
  const publicKey = `sb_publishable_${randomBytes(24).toString("base64url")}`;
  const gateway = http.createServer((request, response) => {
    const route = request.url.startsWith("/auth/v1/")
      ? [auth, "/auth/v1"]
      : request.url.startsWith("/rest/v1/")
        ? [rest, "/rest/v1"]
        : null;
    if (!route) {
      response.writeHead(404);
      response.end();
      return;
    }
    const target = new URL(route[0] + request.url.slice(route[1].length));
    // Only metadata is observed. Bodies, credentials, cookies and tokens are not logged.
    if (request.headers["x-request-id"])
      traces.push({
        path: target.pathname,
        id: request.headers["x-request-id"],
      });
    const upstream = http.request(
      target,
      {
        method: request.method,
        headers: { ...request.headers, host: target.host },
      },
      (incoming) => {
        response.writeHead(incoming.statusCode, incoming.headers);
        incoming.pipe(response);
      },
    );
    upstream.on("error", () => {
      response.writeHead(503);
      response.end();
    });
    request.pipe(upstream);
  });
  const execute = (args, env) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: project,
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let diagnostic = "";
      child.stdout.on("data", (chunk) => {
        diagnostic += chunk;
      });
      child.stderr.on("data", (chunk) => {
        diagnostic += chunk;
      });
      child.on("error", () =>
        reject(new Error("Isolated Next build could not start")),
      );
      child.on("close", (code) => {
        if (code !== 0)
          reject(
            new Error(
              `Isolated Next build failed (${code}); ${diagnostic.includes("Type error") ? "TypeScript diagnostics present" : "no output exposed"}`,
            ),
          );
        else resolve();
      });
    });
  try {
    await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
    const gatewayUrl = `http://127.0.0.1:${gateway.address().port}`;
    const systemKeys = [
      "PATH",
      "Path",
      "SystemRoot",
      "WINDIR",
      "ComSpec",
      "TEMP",
      "TMP",
      "USERPROFILE",
      "APPDATA",
      "LOCALAPPDATA",
      "PATHEXT",
      "NUMBER_OF_PROCESSORS",
    ];
    const env = Object.fromEntries(
      systemKeys
        .filter((key) => process.env[key])
        .map((key) => [key, process.env[key]]),
    );
    Object.assign(env, {
      NODE_ENV: "production",
      NEXT_TELEMETRY_DISABLED: "1",
      NEXT_PUBLIC_SUPABASE_URL: gatewayUrl,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publicKey,
      SUPABASE_AUTH_ADMIN_KEY: "isolated-unused-key",
      DATABASE_URL_APP_SERVER: publicDatabaseUrl,
      PUBLIC_BOOKING_ENVIRONMENT: "discardable",
      PUBLIC_BOOKING_NETWORK_MODE: "loopback-only",
      PUBLIC_BOOKING_TEST_ORIGIN: "http://127.0.0.1:1",
      PUBLIC_BOOKING_TEST_CHALLENGE_KEY: randomBytes(32).toString("base64url"),
      PUBLIC_BOOKING_ENCRYPTION_KEYS: JSON.stringify({
        active: "v1",
        keys: { v1: randomBytes(32).toString("base64url") },
      }),
    });
    // Copy application sources only: no .env, backups, Git metadata or credentials.
    for (const file of [
      "src",
      "public",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "next.config.ts",
      "postcss.config.mjs",
      "components.json",
    ])
      cpSync(path.join(root, file), path.join(project, file), {
        recursive: true,
      });
    symlinkSync(
      path.join(root, "node_modules"),
      path.join(project, "node_modules"),
      "junction",
    );
    const next = path.join(root, "node_modules/next/dist/bin/next");
    console.log(
      "Building isolated Next copy with synthetic Auth/API configuration (no owner .env).",
    );
    await execute([next, "build", project, "--webpack"], env);
    const reservation = net.createServer();
    await new Promise((resolve) => reservation.listen(0, "127.0.0.1", resolve));
    const port = reservation.address().port;
    await new Promise((resolve) => reservation.close(resolve));
    const origin = `http://127.0.0.1:${port}`;
    env.PUBLIC_BOOKING_TEST_ORIGIN = origin;
    server = spawn(
      process.execPath,
      [
        next,
        "start",
        project,
        "--hostname",
        "127.0.0.1",
        "--port",
        String(port),
      ],
      {
        cwd: project,
        env,
        windowsHide: true,
        stdio: ["ignore", "ignore", "ignore"],
      },
    );
    let ready = false;
    for (let n = 0; n < 100; n++) {
      try {
        if ((await fetch(origin, { signal: AbortSignal.timeout(1000) })).ok) {
          ready = true;
          break;
        }
      } catch {
        /* New test process only. */
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    assert.ok(ready, "Isolated Next server did not become ready");
    const endpoint = `${origin}/api/v1/businesses/${business}/members`;
    const key = randomUUID(),
      traceA = randomUUID(),
      traceB = randomUUID();
    const patch = async (trace) => {
      const response = await fetch(`${endpoint}/${member}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${users[1].token}`,
          "Content-Type": "application/json",
          "If-Match": '"2"',
          "Idempotency-Key": key,
          "X-Request-Id": trace,
        },
        body: JSON.stringify({ role: "barber", status: "active" }),
      });
      return {
        status: response.status,
        trace: response.headers.get("X-Request-Id"),
        data: await response.json(),
      };
    };
    const a = await patch(traceA),
      b = await patch(traceB);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.trace, traceA);
    assert.equal(b.trace, traceB);
    assert.deepEqual(a.data, b.data);
    assert.equal(
      sql(
        `select origin_request_id from app.member_requests where business_id='${business}' and key='${key}'`,
      ),
      traceA,
    );
    assert.equal(
      sql(
        `select count(*) from public.audit_logs where business_id='${business}' and entity_id='${member}' and request_id='${traceA}'`,
      ),
      "1",
    );
    assert.ok(
      traces.some((t) => t.path === "/rpc/update_member" && t.id === traceA),
    );
    assert.ok(
      traces.some((t) => t.path === "/rpc/update_member" && t.id === traceB),
    );
    const legacy = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${users[0].token}` },
    });
    assert.equal((await legacy.json()).data.length, 214);
    const paged = await fetch(`${endpoint}?limit=50`, {
      headers: { Authorization: `Bearer ${users[0].token}` },
    });
    assert.equal((await paged.json()).data.length, 50);
    const invalid = await fetch(`${endpoint}?limit=201`, {
      headers: {
        Authorization: `Bearer ${users[0].token}`,
        "X-Request-Id": "invalid",
      },
    });
    assert.equal(invalid.status, 400);
    assert.match(invalid.headers.get("X-Request-Id"), /^[a-f0-9-]{36}$/);
    console.log(
      "Next HTTP PASS: supplied trace A through SSR/PostgREST/audit, replay B, complete legacy and paged endpoint.",
    );

    const jar = [];
    const client = createServerClient(gatewayUrl, publicKey, {
      cookieOptions: {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        path: "/",
      },
      cookies: {
        getAll: () => jar,
        setAll: (values) => {
          for (const cookie of values) {
            const index = jar.findIndex((x) => x.name === cookie.name);
            if (index >= 0) jar.splice(index, 1);
            jar.push(cookie);
          }
        },
      },
    });
    const session = await client.auth.setSession(users[0].session);
    assert.equal(session.error, null, "Synthetic aal2 session must be valid");
    assert.ok(jar.length > 0);
    browser = await chromium.launch({ headless: true });
    if (!publicFocus) {
      for (const viewport of [
        { width: 1280, height: 900 },
        { width: 390, height: 844 },
      ]) {
        checkpoint = `team navigation ${viewport.width}px`;
        const context = await browser.newContext({ viewport });
        await context.addCookies(
          jar.map((cookie) => ({
            name: cookie.name,
            value: cookie.value,
            domain: "127.0.0.1",
            path: "/",
            httpOnly: true,
            secure: false,
            sameSite: "Lax",
          })),
        );
        const page = await context.newPage();
        let pageErrors = 0;
        page.on("pageerror", () => {
          pageErrors++;
        });
        const route = `${origin}/app/${business}/miembros`;
        await page.goto(route);
        await page.getByRole("heading", { name: "Tu equipo." }).waitFor();
        await expect(page.locator("article.member-card")).toHaveCount(50);
        const first = await page
          .locator("article.member-card h3")
          .allTextContents();
        await page.getByRole("link", { name: "Ver más miembros" }).click();
        await page
          .getByRole("link", { name: "Primera página", exact: true })
          .waitFor();
        await expect(page.locator("article.member-card")).toHaveCount(50);
        const second = await page
          .locator("article.member-card h3")
          .allTextContents();
        assert.ok(second.every((email) => !first.includes(email)));
        await page
          .getByRole("link", { name: "Primera página", exact: true })
          .click();
        await expect(page.locator("article.member-card")).toHaveCount(50);
        assert.ok(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
          "Pagination must not introduce horizontal overflow",
        );
        if (viewport.width === 1280) {
          checkpoint = "last page and Server Action";
          await page.goto(`${route}?limit=200`);
          await expect(page.locator("article.member-card")).toHaveCount(200);
          await page.getByRole("link", { name: "Ver más miembros" }).click();
          await page.getByText("No hay más miembros para mostrar.").waitFor();
          await expect(page.locator("article.member-card")).toHaveCount(14);
          await page.waitForLoadState("networkidle");
          const card = page.locator("article.member-card").filter({
            has: page.getByRole("heading", {
              name: users[2].email,
              exact: true,
            }),
          });
          await card.locator('select[name="status"]').selectOption("suspended");
          const responsePromise = page.waitForResponse(
            (response) =>
              response.request().method() === "POST" &&
              response.url().includes(`/app/${business}/miembros`),
          );
          await card.getByRole("button", { name: "Guardar cambios" }).click();
          await responsePromise;
          await page
            .getByText("Membresía actualizada.", { exact: true })
            .waitFor();
          const actionTrace = sql(
            `select request_id from public.audit_logs where business_id='${business}' and entity_id='${member}' order by created_at desc,id desc limit 1`,
          );
          assert.match(actionTrace, /^[a-f0-9-]{36}$/);
          assert.notEqual(actionTrace, traceA);
          assert.notEqual(actionTrace, traceB);
          assert.ok(
            traces.some(
              (t) => t.path === "/rpc/update_member" && t.id === actionTrace,
            ),
          );
          assert.equal(
            sql(
              `select count(*) from public.audit_logs where business_id='${business}' and entity_id='${member}' and request_id='${actionTrace}'`,
            ),
            "1",
          );
          assert.equal(
            sql(
              `select count(*) from app.member_requests where business_id='${business}' and origin_request_id='${actionTrace}' and key<>origin_request_id`,
            ),
            "1",
          );
          checkpoint = "invalid cursor and return to first page";
          await page.goto(`${route}?cursor=!`);
          await page
            .getByRole("heading", {
              name: "No pudimos abrir esta página del equipo.",
            })
            .waitFor();
          await page
            .getByRole("link", { name: "Volver a la primera página" })
            .click();
          await expect(page.locator("article.member-card")).toHaveCount(50);
        }
        assert.equal(pageErrors, 0, "Browser must not emit pageerror");
        await context.close();
        console.log(
          `Browser PASS: isolated aal2 team navigation ${viewport.width}px, 50 rows, distinct pages and first-page link.`,
        );
      }
      checkpoint = "catalog browser and HTTP";
      await runCatalogBrowser({
        browser,
        origin,
        jar,
        users,
        sql,
        gatewayUrl,
        publicKey,
      });
      checkpoint = "customer browser and HTTP";
      await runCustomerBrowser({
        browser,
        origin,
        jar,
        users,
        sql,
        gatewayUrl,
        publicKey,
      });
      checkpoint = "scheduling browser and HTTP";
      await runScheduleBrowser({
        browser,
        origin,
        jar,
        users,
        sql,
        gatewayUrl,
        publicKey,
      });
      checkpoint = "internal appointment browser and HTTP";
      await runAppointmentBrowser({ browser, origin, jar, users, sql });
    }
    checkpoint = "public catalog browser and HTTP";
    await runPublicCatalogBrowser({ browser, origin, sql });
    sql("update app.public_booking_runtime set disposable=true;");
    checkpoint = "public booking HTTP security";
    await runPublicBookingHttp({
      browser,
      origin,
      sql,
      users,
      keyring: env.PUBLIC_BOOKING_ENCRYPTION_KEYS,
    });
    sql("update app.public_booking_runtime set disposable=false;");
    checkpoint = "public booking browser and HTTP";
    await runPublicBookingBrowser({ browser, origin, sql, users });
    if (!publicFocus)
      console.log(
        "Server Action PASS: attempt UUID matches SSR header, audit and replay origin; administration works outside first page.",
      );
  } catch (error) {
    throw new Error(
      `Isolated browser checkpoint ${checkpoint}: ${error.message.split("\n")[0]}`,
    );
  } finally {
    if (browser) await browser.close();
    if (server && server.exitCode === null && server.signalCode === null) {
      const closed = new Promise((resolve) => server.once("close", resolve));
      server.kill();
      await closed;
    }
    gateway.closeAllConnections();
    await new Promise((resolve) => gateway.close(resolve));
    // Verified absolute temporary target; never recurse through the dependency junction.
    const target = realpathSync(project),
      parent = realpathSync(tmpdir());
    assert.equal(path.dirname(target).toLowerCase(), parent.toLowerCase());
    assert.ok(path.basename(target).startsWith("merivo-ui-"));
    try {
      unlinkSync(path.join(target, "node_modules"));
    } catch {
      /* Build may have failed before creating the junction. */
    }
    rmSync(target, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
}
import { runAppointmentBrowser } from "./appointment-browser.mjs";
