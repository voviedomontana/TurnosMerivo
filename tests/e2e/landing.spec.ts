import { expect, test } from "@playwright/test";

test("the initial landing loads and explains its development status", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(page).toHaveTitle(/TurnosMerivo/);
  await expect(page.locator(".brand-logo")).toHaveCount(2);
  for (const logo of await page.locator(".brand-logo, .visual-logo").all()) {
    await expect(logo).toBeVisible();
    await expect(logo).toHaveJSProperty("complete", true);
    expect(
      await logo.evaluate((element: HTMLImageElement) => element.naturalWidth),
    ).toBeGreaterThan(0);
  }
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Tu oficio merece toda tu atención.",
  );
  await expect(page.getByText("En desarrollo", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Conocé la plataforma" }).click();
  await expect(page).toHaveURL(/#funcionalidades$/);
  await expect(
    page.getByRole("heading", { name: "Todo conectado. Todo más simple." }),
  ).toBeVisible();
  await expect(page.locator("main article")).toHaveCount(3);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await page.goto("/");
  await page.screenshot({
    path: testInfo.outputPath("landing.png"),
    fullPage: true,
  });
});
