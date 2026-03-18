import { test, expect } from "@playwright/test";

test.describe("Authentication", () => {
  test("login page loads", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator("h2")).toContainText("Welcome back");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test("login with valid credentials redirects to dashboard", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[type="email"]', "ananya@technova.in");
    await page.fill('input[type="password"]', "Welcome@123");
    await page.click('button[type="submit"]');

    // Should redirect to dashboard
    await page.waitForURL(/\/(dashboard|my)/, { timeout: 10000 });
    await expect(page.url()).toMatch(/\/(dashboard|my)/);
  });

  test("login with invalid credentials shows error", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[type="email"]', "wrong@email.com");
    await page.fill('input[type="password"]', "wrongpass");
    await page.click('button[type="submit"]');

    // Should show error toast
    await expect(page.locator("text=Login failed")).toBeVisible({ timeout: 5000 });
  });

  test("forgot password modal opens", async ({ page }) => {
    await page.goto("/login");
    await page.click("text=Forgot password?");
    await expect(page.locator("text=Reset Password")).toBeVisible();
    await expect(page.locator('input[type="email"]#forgotEmail')).toBeVisible();
  });
});
