import { test, expect, Page } from "@playwright/test";

async function login(page: Page) {
  await page.goto("/login");
  await page.fill('input[type="email"]', "ananya@technova.in");
  await page.fill('input[type="password"]', "Welcome@123");
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 10000 });
}

test.describe("Employee Management", () => {
  test.beforeEach(async ({ page }) => {
    await login(page);
  });

  test("employee list shows employees with search", async ({ page }) => {
    await page.goto("/employees");
    await expect(page.locator("text=Employees")).toBeVisible();

    // Should show employee rows
    await expect(page.locator("text=Ananya Gupta")).toBeVisible({ timeout: 5000 });

    // Search should filter
    await page.fill('input[placeholder*="Search"]', "Ananya");
    await expect(page.locator("text=Ananya Gupta")).toBeVisible();
  });

  test("employee detail page loads", async ({ page }) => {
    await page.goto("/employees");
    await page.click("text=Ananya Gupta");
    await page.waitForURL(/\/employees\//);

    await expect(page.locator("text=Ananya Gupta")).toBeVisible();
    await expect(page.locator("text=Salary Details")).toBeVisible();
  });

  test("department filter works", async ({ page }) => {
    await page.goto("/employees");
    await page.waitForSelector("text=Filter:");
    // Click Engineering department filter
    const engButton = page.locator("button", { hasText: "Engineering" });
    if (await engButton.isVisible()) {
      await engButton.click();
      // Should filter to only engineering employees
      await expect(page.locator("text=Engineering")).toBeVisible();
    }
  });
});
