import { test, expect, Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', "ananya@technova.in");
  await page.fill('input[type="password"]', "Welcome@123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 10000 });
}

test.describe("Admin Dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("shows dashboard with stat cards", async ({ page }) => {
    await expect(page.locator("text=Payroll Dashboard")).toBeVisible();
    await expect(page.locator("text=Active Employees")).toBeVisible();
    await expect(page.locator("text=Last Payroll")).toBeVisible();
  });

  test("quick actions are visible", async ({ page }) => {
    await expect(page.locator("text=Run Payroll")).toBeVisible();
    await expect(page.locator("text=Add Employee")).toBeVisible();
  });

  test("navigate to employees page", async ({ page }) => {
    await page.click("text=Employees >> nth=0");
    await page.waitForURL(/\/employees/);
    await expect(page.locator("text=Employees")).toBeVisible();
  });

  test("navigate to payroll runs", async ({ page }) => {
    await page.click("text=Payroll Runs");
    await page.waitForURL(/\/payroll\/runs/);
    await expect(page.locator("text=Payroll Runs")).toBeVisible();
  });
});
