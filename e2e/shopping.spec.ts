import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

/*
 * Storefront + shopping agent, end to end in a real browser.
 */

const CHAT_STORAGE_KEY = "ship-it-shop:shopping-chat";

/**
 * Console errors that come from the platform, not the app:
 * - The Vercel Analytics script only exists on Vercel deployments.
 * - WebKit reports Next.js prefetches (same-origin `_rsc=` requests) that a
 *   navigation cancels as "… due to access control checks".
 */
function isPlatformNoise(text: string, url: string): boolean {
  if (/_vercel\/insights/.test(url) || /_vercel\/insights/.test(text)) return true;
  if (/favicon/i.test(url)) return true;
  return text.includes("_rsc=") && text.includes("access control checks");
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    if (isPlatformNoise(message.text(), message.location().url)) return;
    errors.push(message.text());
  });
  page.on("pageerror", (error) => {
    // WebKit surfaces the cancelled prefetch above as an unhandled rejection.
    if (isPlatformNoise(error.message, "")) return;
    errors.push(error.message);
  });
  return errors;
}

async function openChat(page: Page) {
  await page.goto("/");
  await page.evaluate((key) => localStorage.removeItem(key), CHAT_STORAGE_KEY);
  await page.reload();
  await page.getByRole("button", { name: "Toggle agent panel" }).click();
  const input = page.getByRole("textbox", { name: "Message the shopping assistant" });
  await expect(input).toBeVisible();
  return input;
}

async function send(page: Page, text: string) {
  const input = page.getByRole("textbox", { name: "Message the shopping assistant" });
  await input.fill(text);
  await input.press("Enter");
}

test("storefront loads products and the shopping chat opens", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Ship It Shop" })).toBeVisible();
  await expect(page.locator('a[href^="/products/"]').first()).toBeVisible();
  await openChat(page);
  await expect(page.getByText("Hi! How can I help you shop?")).toBeVisible();
  expect(errors).toEqual([]);
});

test("shopping agent answers with browsable product results", async ({ page }) => {
  const errors = collectConsoleErrors(page);
  await openChat(page);
  await send(page, "Show me hoodies");

  // Generative UI: product cards with links to existing product pages.
  const results = page.locator('section[aria-label^="Product results"]');
  await expect(results.locator('a[href^="/products/"]').first()).toBeVisible({ timeout: 120_000 });
  await expect(results).toContainText("$");

  // A written reply follows, and no failure notice appears.
  const assistant = page.locator(".is-assistant").last();
  await expect(assistant).toContainText(/hoodie/i, { timeout: 120_000 });
  await expect(page.getByText("Temporarily unavailable")).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("a refresh mid-reply reconnects without duplicating the answer", async ({ page }) => {
  await openChat(page);
  await send(page, "What categories do you have?");

  // Wait until the run has started, then reload while it streams.
  await expect
    .poll(
      () =>
        page.evaluate((key) => {
          const saved = localStorage.getItem(key);
          return saved ? (JSON.parse(saved).activeRunId as string | null) : null;
        }, CHAT_STORAGE_KEY),
      { timeout: 30_000 },
    )
    .not.toBeNull();
  await page.reload();

  // Exactly one question and one answer after recovery.
  await expect(page.getByRole("textbox", { name: "Message the shopping assistant" })).toBeVisible();
  await expect(page.locator(".is-user")).toHaveCount(1);
  await expect(page.locator(".is-assistant")).toHaveCount(1, { timeout: 120_000 });
  await expect(page.locator('ul[aria-label="Store categories"] a').first()).toBeVisible({
    timeout: 120_000,
  });
  // The run is cleared once the reply finishes; a rate-limited model call can
  // retry with backoff, so allow the same budget as the other model waits.
  await expect
    .poll(
      () =>
        page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "{}").activeRunId ?? null, CHAT_STORAGE_KEY),
      { timeout: 120_000 },
    )
    .toBeNull();
  await expect(page.locator(".is-user")).toHaveCount(1);
  await expect(page.locator(".is-assistant")).toHaveCount(1);
});

test("admin area is protected when signed out", async ({ page, request }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/login/);
  const response = await request.post("/api/admin/chat", {
    data: { messages: [{ id: "u", role: "user", parts: [{ type: "text", text: "hi" }] }] },
  });
  expect(response.status()).toBe(401);
});

test("storefront and chat have no serious accessibility violations", async ({ page }) => {
  await openChat(page);
  const results = await new AxeBuilder({ page })
    .include('[data-sidebar="sidebar"], [data-slot="sheet-content"]')
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
});
