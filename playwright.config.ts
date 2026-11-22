import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests in real browser engines: Chromium (Chrome/Edge), Firefox
 * and WebKit (Safari), on desktop and phone viewports.
 *
 * Runs against production by default; set E2E_BASE_URL to test another
 * deployment or a local server. Tests run one at a time because every chat
 * turn calls the model, and AI Gateway rate limits are per team.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 1,
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: [["list"]],
  use: {
    baseURL:
      process.env.E2E_BASE_URL ??
      "https://vercel-agent-foundations-certificat-tan-eight.vercel.app",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "desktop-chrome", use: { ...devices["Desktop Chrome"] } },
    { name: "desktop-firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "desktop-safari", use: { ...devices["Desktop Safari"] } },
    { name: "iphone-safari", use: { ...devices["iPhone 15"] } },
    { name: "android-chrome", use: { ...devices["Pixel 7"] } },
  ],
});
