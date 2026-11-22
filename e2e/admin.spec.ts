import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/*
 * Store admin agent, end to end. Signs in with the admin password from
 * ADMIN_E2E_PASSWORD (defaults to the template's demo password), so the same
 * tests run against localhost and production.
 */

const DEMO_PASSWORD = process.env.ADMIN_E2E_PASSWORD ?? "letmeinadminagent";

test("wrong password is rejected", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Password").fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/error=1/);
  await expect(page.getByText("Incorrect password.")).toBeVisible();
});

test("admin agent computes in the sandbox, then sign-out locks the area", async ({ page }) => {
  await page.goto("/admin/login");
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await page.evaluate(() => localStorage.removeItem("ship-it-shop:admin-chat"));
  await page.reload();

  const input = page.getByRole("textbox", { name: "Message the store admin agent" });
  await input.fill("Which low-stock items are top sellers this month?");
  await input.press("Enter");

  // Data lookups, sandbox command activity, then a written answer.
  await expect(page.getByText("Inventory").first()).toBeVisible({ timeout: 150_000 });
  await expect(page.getByText("Sandbox").first()).toBeVisible({ timeout: 150_000 });
  await expect(page.getByRole("status").filter({ hasText: /Done|Failed/ }).first()).toBeVisible({
    timeout: 150_000,
  });
  await expect(page.locator(".is-assistant").last()).toContainText(/stock/i, { timeout: 150_000 });
  await expect(page.getByText("Temporarily unavailable")).toHaveCount(0);

  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const serious = axe.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(
    serious.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).join(", ")})`),
  ).toEqual([]);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admin\/login/);
  const cookies = await page.context().cookies();
  const response = await page.request.post("/api/admin/chat", {
    data: { messages: [{ id: "u", role: "user", parts: [{ type: "text", text: "hi" }] }] },
  });
  expect(cookies.some((c) => c.name === "admin_auth")).toBe(false);
  expect(response.status()).toBe(401);
});
