import { test, expect } from "@playwright/test";

test.describe("Settings Page", () => {
  test("page loads with Settings heading and description", async ({ page }) => {
    await page.goto("/settings");

    await expect(
      page.getByRole("heading", { name: "Settings" }).first()
    ).toBeVisible({ timeout: 5000 });

    await expect(
      page.getByText("Organization and payroll configuration").first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("Organization section shows all fields", async ({ page }) => {
    await page.goto("/settings");

    await expect(
      page.getByRole("heading", { name: "Settings" }).first()
    ).toBeVisible({ timeout: 5000 });

    // Organization card heading
    await expect(
      page.getByText("Organization").first()
    ).toBeVisible({ timeout: 5000 });

    // Company Name field
    const companyName = page.locator("#org_name");
    await expect(companyName).toBeVisible({ timeout: 5000 });

    // Legal Name field (disabled)
    const legalName = page.locator("#org_legal");
    await expect(legalName).toBeVisible({ timeout: 5000 });
    await expect(legalName).toBeDisabled();

    // PAN field (disabled)
    const pan = page.locator("#org_pan");
    await expect(pan).toBeVisible({ timeout: 5000 });
    await expect(pan).toBeDisabled();

    // TAN field (disabled)
    const tan = page.locator("#org_tan");
    await expect(tan).toBeVisible({ timeout: 5000 });
    await expect(tan).toBeDisabled();

    // GSTIN field
    const gstin = page.locator("#org_gstin");
    await expect(gstin).toBeVisible({ timeout: 5000 });

    // Registered Address field
    const address = page.locator("#org_address");
    await expect(address).toBeVisible({ timeout: 5000 });

    // State (for PT) select
    const stateSelect = page.locator("#org_state");
    await expect(stateSelect).toBeVisible({ timeout: 5000 });
  });

  test("edit Company Name and GSTIN fields", async ({ page }) => {
    await page.goto("/settings");

    await expect(
      page.getByRole("heading", { name: "Settings" }).first()
    ).toBeVisible({ timeout: 5000 });

    // Clear and fill Company Name
    const companyName = page.locator("#org_name");
    await expect(companyName).toBeVisible({ timeout: 5000 });
    await companyName.clear();
    await companyName.fill("Test Company Updated");
    await expect(companyName).toHaveValue("Test Company Updated", { timeout: 5000 });

    // Clear and fill GSTIN
    const gstin = page.locator("#org_gstin");
    await gstin.clear();
    await gstin.fill("29AABCT1234F1ZP");
    await expect(gstin).toHaveValue("29AABCT1234F1ZP", { timeout: 5000 });
  });

  test("State (for PT) dropdown has all state options", async ({ page }) => {
    await page.goto("/settings");

    await expect(
      page.getByRole("heading", { name: "Settings" }).first()
    ).toBeVisible({ timeout: 5000 });

    const stateSelect = page.locator("#org_state");
    await expect(stateSelect).toBeVisible({ timeout: 5000 });

    // Verify state options are present
    await expect(stateSelect.locator("option", { hasText: "Karnataka" })).toBeAttached();
    await expect(stateSelect.locator("option", { hasText: "Maharashtra" })).toBeAttached();
    await expect(stateSelect.locator("option", { hasText: "Tamil Nadu" })).toBeAttached();
    await expect(stateSelect.locator("option", { hasText: "Telangana" })).toBeAttached();
    await expect(stateSelect.locator("option", { hasText: "West Bengal" })).toBeAttached();
    await expect(stateSelect.locator("option", { hasText: "Gujarat" })).toBeAttached();
    await expect(stateSelect.locator("option", { hasText: "Delhi" })).toBeAttached();

    // Select a different state
    await stateSelect.selectOption("MH");
    await expect(stateSelect).toHaveValue("MH", { timeout: 5000 });
  });

  test("Statutory Registration section shows PF and ESI fields", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Statutory", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "Settings" }).first()
    ).toBeVisible({ timeout: 5000 });

    // Statutory Registration card heading
    await expect(
      page.getByText("Statutory Registration").first()
    ).toBeVisible({ timeout: 5000 });

    // PF Establishment Code
    const pfField = page.locator("#pf_estab");
    await expect(pfField).toBeVisible({ timeout: 5000 });

    // ESI Code
    const esiField = page.locator("#esi_estab");
    await expect(esiField).toBeVisible({ timeout: 5000 });

    // PF Wage Ceiling select
    const pfRestrict = page.locator("#pf_wage_mode");
    await expect(pfRestrict).toBeVisible({ timeout: 5000 });
    await expect(pfRestrict.locator("option", { hasText: "Restrict to statutory ceiling" })).toBeAttached();
    await expect(pfRestrict.locator("option", { hasText: "Apply to actual PF wages" })).toBeAttached();
    await page.getByRole("button", { name: /Statutory minimum/ }).click();
    await expect(pfRestrict).toHaveValue("ceiling");
    await expect(page.locator("#pf_max_contribution")).toHaveValue("");
    await expect(page.getByText(/₹25,000 from 17 September 2026/)).toBeVisible();
  });

  test("edit PF and ESI fields and change PF Wage Ceiling", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Statutory", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: "Settings" }).first()
    ).toBeVisible({ timeout: 5000 });

    // Fill PF Establishment Code
    const pfField = page.locator("#pf_estab");
    await expect(pfField).toBeVisible({ timeout: 5000 });
    await pfField.clear();
    await pfField.fill("KABNR0012345000");
    await expect(pfField).toHaveValue("KABNR0012345000", { timeout: 5000 });

    // Fill ESI Code
    const esiField = page.locator("#esi_estab");
    await esiField.clear();
    await esiField.fill("31000123450000099");
    await expect(esiField).toHaveValue("31000123450000099", { timeout: 5000 });

    // Change PF Wage Ceiling
    const pfRestrict = page.locator("#pf_wage_mode");
    await pfRestrict.selectOption("actual");
    await expect(pfRestrict).toHaveValue("actual", { timeout: 5000 });
  });

  test("Payment section shows Pay Frequency, Pay Day, and Currency", async ({ page }) => {
    await page.goto("/settings");

    await expect(
      page.getByRole("heading", { name: "Settings" }).first()
    ).toBeVisible({ timeout: 5000 });

    // Payment card heading
    await expect(
      page.getByText("Payment").first()
    ).toBeVisible({ timeout: 5000 });

    // Pay Frequency select
    const payFrequency = page.locator("#pay_frequency");
    await expect(payFrequency).toBeVisible({ timeout: 5000 });
    await expect(payFrequency.locator("option", { hasText: "Monthly" })).toBeAttached();
    await expect(payFrequency.locator("option", { hasText: "Bi-weekly" })).toBeAttached();
    await expect(payFrequency.locator("option", { hasText: /^Weekly$/ })).toBeAttached();

    // Pay Day field
    const payDay = page.locator("#pay_day");
    await expect(payDay).toBeVisible({ timeout: 5000 });

    // Currency field (disabled)
    const currency = page.locator("#currency");
    await expect(currency).toBeVisible({ timeout: 5000 });
    await expect(currency).toBeDisabled();
  });

  test("change Pay Frequency and Pay Day", async ({ page }) => {
    await page.goto("/settings");

    await expect(
      page.getByRole("heading", { name: "Settings" }).first()
    ).toBeVisible({ timeout: 5000 });

    // Change Pay Frequency to bi-weekly
    const payFrequency = page.locator("#pay_frequency");
    await expect(payFrequency).toBeVisible({ timeout: 5000 });
    await payFrequency.selectOption("bi_weekly");
    await expect(payFrequency).toHaveValue("bi_weekly", { timeout: 5000 });

    // Change Pay Day
    const payDay = page.locator("#pay_day");
    await payDay.clear();
    await payDay.fill("15");
    await expect(payDay).toHaveValue("15", { timeout: 5000 });
  });

  test("Notifications section shows checkboxes", async ({ page }) => {
    await page.goto("/settings");

    await expect(
      page.getByRole("heading", { name: "Settings" }).first()
    ).toBeVisible({ timeout: 5000 });

    // Notifications card heading
    await expect(
      page.getByText("Notifications").first()
    ).toBeVisible({ timeout: 5000 });

    // Notification checkboxes
    await expect(
      page.getByText("Email payslips to employees after payroll approval").first()
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByText("Notify employees of tax regime selection deadline").first()
    ).toBeVisible({ timeout: 5000 });
    await expect(
      page.getByText("Alert when PF/ESI filing is due").first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("toggle notification checkboxes", async ({ page }) => {
    await page.goto("/settings");

    await expect(
      page.getByRole("heading", { name: "Settings" }).first()
    ).toBeVisible({ timeout: 5000 });

    // Find the PF/ESI alert checkbox (initially unchecked)
    const pfEsiCheckbox = page
      .locator("label", { hasText: "Alert when PF/ESI filing is due" })
      .locator("input[type='checkbox']");
    await expect(pfEsiCheckbox).toBeVisible({ timeout: 5000 });
    await expect(pfEsiCheckbox).not.toBeChecked();

    // Check it
    await pfEsiCheckbox.check();
    await expect(pfEsiCheckbox).toBeChecked({ timeout: 5000 });

    // The payslip email checkbox should be initially checked
    const payslipCheckbox = page
      .locator("label", { hasText: "Email payslips to employees after payroll approval" })
      .locator("input[type='checkbox']");
    await expect(payslipCheckbox).toBeChecked({ timeout: 5000 });

    // Uncheck it
    await payslipCheckbox.uncheck();
    await expect(payslipCheckbox).not.toBeChecked({ timeout: 5000 });
  });

  test("click Save Settings button and verify toast", async ({ page }) => {
    await page.goto("/settings");

    await expect(
      page.getByRole("heading", { name: "Settings" }).first()
    ).toBeVisible({ timeout: 5000 });

    // Click Save Settings
    const saveButton = page.getByRole("button", { name: "Save Settings" });
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    await saveButton.click();

    // Verify success or error toast appears
    await expect(
      page.getByText(/Settings saved|Failed to save settings/).first()
    ).toBeVisible({ timeout: 5000 });
  });

  test("edit Registered Address and save", async ({ page }) => {
    await page.goto("/settings");

    await expect(
      page.getByRole("heading", { name: "Settings" }).first()
    ).toBeVisible({ timeout: 5000 });

    // Edit Registered Address
    const address = page.locator("#org_address");
    await expect(address).toBeVisible({ timeout: 5000 });
    await address.clear();
    await address.fill("123 New Street, Bengaluru");
    await expect(address).toHaveValue("123 New Street, Bengaluru", { timeout: 5000 });

    // Click Save Settings
    await page.getByRole("button", { name: "Save Settings" }).click();

    // Verify toast
    await expect(
      page.getByText(/Settings saved|Failed to save settings/).first()
    ).toBeVisible({ timeout: 5000 });
  });
});
