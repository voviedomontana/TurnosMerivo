import { defineConfig, devices } from "@playwright/test";

const development = process.env.PLAYWRIGHT_DEV_SERVER === "1";
const port = Number(process.env.PLAYWRIGHT_PORT || 3000);
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Invalid Playwright local port");
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    actionTimeout: 15_000,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
  ],
  webServer: {
    command: development
      ? `npm run dev -- --port ${port}`
      : `npm run build && npm run start -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: development,
    timeout: 180_000,
  },
});
