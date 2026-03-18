import { test, expect, Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', "ananya@technova.in");
  await page.fill('input[type="password"]', "Welcome@123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(dashboard|my)/, { timeout: 10000 });
}

test.describe("Self-Service Portal", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("self-service dashboard loads", async ({ page }) => {
    await page.goto("/my");
    await expect(page.locator("text=Welcome")).toBeVisible({ timeout: 5000 });
  });

  test("my payslips page loads", async ({ page }) => {
    await page.goto("/my/payslips");
    await expect(page.locator("text=My Payslips")).toBeVisible();
  });

  test("my salary page loads", async ({ page }) => {
    await page.goto("/my/salary");
    await expect(page.locator("text=My Salary")).toBeVisible();
  });

  test("my profile page loads with change password", async ({ page }) => {
    await page.goto("/my/profile");
    await expect(page.locator("text=My Profile")).toBeVisible();
    await expect(page.locator("text=Change Password")).toBeVisible();
  });

  test("declarations page has quick declare button", async ({ page }) => {
    await page.goto("/my/declarations");
    await expect(page.locator("text=Tax Declarations")).toBeVisible();
    await expect(page.locator("text=Quick Declare All")).toBeVisible();
  });
});
