import { test, expect } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

const countries = [
  { id: "india", code: "IN", name: "India", currency: "INR" },
  { id: "uae", code: "AE", name: "United Arab Emirates", currency: "AED" },
  { id: "uk", code: "GB", name: "United Kingdom", currency: "GBP" },
];

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "mock-country-picker-test");
    localStorage.setItem("i18nextLng", "en");
    localStorage.setItem(
      "user",
      JSON.stringify({
        id: 1,
        empcloudUserId: 1,
        empcloudOrgId: 1,
        role: "hr_admin",
        firstName: "Test",
        lastName: "Reviewer",
        email: "reviewer@example.test",
      }),
    );
  });
});

for (const employeeScenario of ["India employee only", "no employees"] as const) {
  test(`country catalog remains selectable with ${employeeScenario}`, async ({ page }) => {
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith("/api/")) return route.continue();
      expect(route.request().method()).toBe("GET");
      let data: unknown = [];
      if (path.endsWith("/global/countries")) data = countries;
      if (path.endsWith("/global/employees") && employeeScenario === "India employee only") {
        data = [
          {
            id: "employee-in",
            country_id: "india",
            country_code: "IN",
            status: "active",
            employment_type: "direct_hire",
            start_date: "2026-01-01",
          },
        ];
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data }),
      });
    });
    await page.goto("/global-payroll/runs");
    await page.getByRole("button", { name: "Create Run", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "Create Global Payroll Run" });
    const picker = modal.getByRole("combobox").first();
    await expect(picker.locator("option")).toHaveText([
      "Select a country...",
      "India (INR)",
      "United Arab Emirates (AED)",
      "United Kingdom (GBP)",
    ]);
    await picker.selectOption("uae");
    await expect(modal.getByText("Employer identity on payslips", { exact: true })).toBeVisible();
    await picker.selectOption("uk");
    await expect(picker).toHaveValue("uk");
  });
}

test("failed country request offers retry and restores the catalog", async ({ page }) => {
  let countriesFail = true;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.startsWith("/api/")) return route.continue();
    expect(route.request().method()).toBe("GET");
    const isCountries = path.endsWith("/global/countries");
    await route.fulfill({
      status: isCountries && countriesFail ? 503 : 200,
      contentType: "application/json",
      body: JSON.stringify(
        isCountries && countriesFail
          ? { success: false, error: { message: "Temporary catalog failure" } }
          : { success: true, data: isCountries ? countries : [] },
      ),
    });
  });
  await page.goto("/global-payroll/runs");
  await page.getByRole("button", { name: "Create Run", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Create Global Payroll Run" });
  const picker = modal.getByRole("combobox").first();
  await expect(modal.getByRole("alert")).toContainText(
    "Could not load countries. Please try again.",
  );
  await expect(picker).toBeDisabled();
  countriesFail = false;
  await modal.getByRole("button", { name: "Retry loading countries", exact: true }).click();
  await expect(picker).toBeEnabled();
  await expect(picker.locator("option")).toHaveText([
    "Select a country...",
    "India (INR)",
    "United Arab Emirates (AED)",
    "United Kingdom (GBP)",
  ]);
  await expect(modal.getByRole("alert")).toHaveCount(0);
});

test("empty country catalog has a distinct empty state", async ({ page }) => {
  await page.route("**/api/**", async (route) => {
    if (!new URL(route.request().url()).pathname.startsWith("/api/")) return route.continue();
    expect(route.request().method()).toBe("GET");
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data: [] }),
    });
  });
  await page.goto("/global-payroll/runs");
  await page.getByRole("button", { name: "Create Run", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Create Global Payroll Run" });
  const picker = modal.getByRole("combobox").first();
  await expect(picker.locator("option")).toHaveText(["No active countries are available."]);
  await expect(picker).toBeDisabled();
  await expect(modal.getByRole("button", { name: "Retry loading countries" })).toHaveCount(0);
});
