// Isolated browser contract test. No server, database, .env or external provider.
import { readFileSync } from "node:fs";
import { chromium, expect } from "@playwright/test";
import ts from "typescript";
import assert from "node:assert/strict";

const source = ts.transpileModule(
  readFileSync("src/modules/public-booking/human-client.ts", "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  },
).outputText;
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const browser = await chromium.launch();
let passed = 0;
try {
  for (const outcome of ["success", "cancel", "expired", "script-failure"]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    try {
      const page = await context.newPage();
      await page.route("**/*", async (route) => {
        const url = route.request().url();
        if (url.startsWith("http://127.0.0.1:39199/")) {
          await route.fulfill({
            contentType: "text/html",
            body: "<!doctype html><html lang='es'><title>Fictitious challenge</title><body><button id='begin'>Prueba</button></body></html>",
          });
        } else if (
          url.startsWith(
            "https://challenges.cloudflare.com/turnstile/v0/api.js",
          )
        ) {
          if (outcome === "script-failure") await route.abort();
          else
            await route.fulfill({
              contentType: "application/javascript",
              body: "window.turnstile={render:(node,options)=>{window.widgetOptions=options;return 'fixture-widget'},remove:()=>{window.widgetRemoved=true}};",
            });
        } else await route.abort();
      });
      await page.goto("http://127.0.0.1:39199/");
      await page.evaluate(async (url) => {
        window.fixtureModule = await import(url);
      }, moduleUrl);
      await page.evaluate(() => {
        window.fixtureResult = "pending";
        window.fixtureModule
          .solveHuman({
            site_key: "synthetic-site",
            action: "create",
            cdata: "fixture-nonce",
          })
          .then((token) => {
            window.fixtureResult =
              token === "synthetic-response" ? "success" : "wrong";
          })
          .catch(() => {
            window.fixtureResult = "denied";
          });
      });
      if (outcome !== "script-failure") {
        await expect(
          page.getByRole("dialog", { name: "Verificá que sos una persona" }),
        ).toBeVisible();
        assert.ok(
          await page.evaluate(
            () =>
              document.querySelector("dialog").getBoundingClientRect().width <=
              window.innerWidth,
          ),
        );
        if (outcome === "success") {
          assert.ok(
            await page.evaluate(
              () =>
                window.widgetOptions.action === "create" &&
                window.widgetOptions.cData === "fixture-nonce",
            ),
          );
          await page.evaluate(() =>
            window.widgetOptions.callback("synthetic-response"),
          );
        } else if (outcome === "cancel")
          await page
            .getByRole("button", { name: "Cancelar verificación" })
            .click();
        else
          await page.evaluate(() => window.widgetOptions["expired-callback"]());
      }
      await expect
        .poll(() => page.evaluate(() => window.fixtureResult))
        .toBe(outcome === "success" ? "success" : "denied");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      if (outcome !== "script-failure")
        assert.ok(await page.evaluate(() => window.widgetRemoved === true));
      passed++;
    } finally {
      await context.close();
    }
  }
  console.log(
    `PASS: ${passed} isolated browser challenge contracts: success, cancellation, expiry and blocked provider script; mobile dialog, bound metadata and widget cleanup. Provider simulated; no hosted security claim.`,
  );
} finally {
  await browser.close();
}
