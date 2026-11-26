import { test, expect, type Page } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

type BulkRequest = { mode: "create" | "update"; csv: string; apply: boolean };
type BulkResult = {
  mode: BulkRequest["mode"];
  total: number;
  valid: number;
  invalid: number;
  applied: number;
  results: {
    row: number;
    identifier: string;
    status: "valid" | "error" | "created" | "updated" | "unchanged";
    errors: string[];
    changes: { field: string; before: string; after: string }[];
  }[];
};

const createCsv =
  "firstName,lastName,email,countryCode,employmentType,jobTitle,startDate,salaryAmount,salaryFrequency\n" +
  "Bulk,Employee,qa@example.com,GB,direct_hire,Engineer,2026-10-01,1200.00,monthly\n";
const updateCsv = "employeeId,salaryAmount,jobTitle\nemployee-1,1200.00,\n";
const employee = {
  id: "employee-1",
  first_name: "Bulk",
  last_name: "Employee",
  email: "qa@example.com",
  country_id: "uk",
  country_code: "GB",
  country_name: "United Kingdom",
  employment_type: "direct_hire",
  contract_type: "full_time",
  job_title: "Engineer",
  start_date: "2026-10-01",
  salary_amount: 100000,
  salary_currency: "GBP",
  salary_frequency: "monthly",
  status: "active",
};

function successfulResult(request: BulkRequest): BulkResult {
  return {
    mode: request.mode,
    total: 1,
    valid: 1,
    invalid: 0,
    applied: request.apply ? 1 : 0,
    results: [
      {
        row: 2,
        identifier: request.mode === "create" ? "qa@example.com" : "employee-1",
        status: request.apply ? (request.mode === "create" ? "created" : "updated") : "valid",
        errors: [],
        changes:
          request.mode === "update"
            ? [{ field: "salaryAmount", before: "1000.00", after: "1200.00" }]
            : [{ field: "firstName", before: "", after: "Bulk" }],
      },
    ],
  };
}

async function mockGlobalEmployees(
  page: Page,
  options: {
    existingEmployee?: boolean;
    bulk?: (request: BulkRequest) => BulkResult | Promise<BulkResult>;
  } = {},
) {
  const state = {
    requests: [] as BulkRequest[],
    downloads: [] as string[],
    employeeReads: 0,
    detailReads: 0,
    applied: false,
  };
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith("/api/")) return route.continue();
    let data: unknown = [];
    if (url.pathname.endsWith("/global/employees/bulk")) {
      expect(request.method()).toBe("POST");
      const body = request.postDataJSON() as BulkRequest;
      state.requests.push(body);
      const result = await (options.bulk?.(body) ?? successfulResult(body));
      state.applied ||= body.apply && result.applied > 0;
      data = result;
    } else {
      // Any unexpected write (including per-employee APIs) fails the test.
      expect(request.method()).toBe("GET");
      if (url.pathname.endsWith("/global/countries"))
        data = [{ id: "uk", code: "GB", name: "United Kingdom", currency: "GBP" }];
      if (url.pathname.endsWith("/global/employees")) {
        state.employeeReads++;
        data =
          options.existingEmployee || state.applied
            ? [{ ...employee, salary_amount: state.applied ? 120000 : 100000 }]
            : [];
      }
      if (url.pathname.endsWith("/global/employees/employee-1")) {
        state.detailReads++;
        data = {
          ...employee,
          salary_amount: state.applied ? 120000 : 100000,
          compliance_percentage: 100,
          compliance_checklist: [],
          country: { code: "GB", name: "United Kingdom", compliance_notes: {} },
        };
      }
      if (
        url.pathname.endsWith("/global/employees/bulk/template") ||
        url.pathname.endsWith("/global/employees/bulk/export")
      ) {
        state.downloads.push(`${url.pathname}${url.search}`);
        const filename = url.pathname.endsWith("/export")
          ? "current-employees.csv"
          : "employees.csv";
        await route.fulfill({
          status: 200,
          contentType: "text/csv; charset=utf-8",
          headers: { "content-disposition": `attachment; filename="${filename}"` },
          body: url.searchParams.get("mode") === "create" ? createCsv : updateCsv,
        });
        return;
      }
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, data }),
    });
  });
  return state;
}

async function openBulk(page: Page, mode: BulkRequest["mode"]) {
  await page.goto("/global-payroll/employees");
  await page
    .getByRole("button", { name: mode === "create" ? "Bulk upload" : "Bulk update", exact: true })
    .click();
  return page.getByRole("dialog", {
    name: mode === "create" ? "Bulk upload global employees" : "Bulk update global employees",
    exact: true,
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("access_token", "mock-bulk-employee-test");
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

test("offers both bulk actions and downloads the selected template and current employees", async ({
  page,
}) => {
  const state = await mockGlobalEmployees(page);
  await page.goto("/global-payroll/employees");
  await expect(page.getByRole("button", { name: "Bulk upload", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bulk update", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Bulk upload", exact: true }).click();
  const upload = page.getByRole("dialog", { name: "Bulk upload global employees", exact: true });
  await expect(upload.getByRole("button", { name: "Apply upload", exact: true })).toBeDisabled();
  const [template] = await Promise.all([
    page.waitForEvent("download"),
    upload.getByRole("button", { name: "Download template", exact: true }).click(),
  ]);
  expect(template.suggestedFilename()).toBe("employees.csv");
  expect(state.downloads).toEqual([expect.stringMatching(/\/bulk\/template\?mode=create$/)]);

  const update = await openBulk(page, "update");
  const [current] = await Promise.all([
    page.waitForEvent("download"),
    update.getByRole("button", { name: "Download current employees", exact: true }).click(),
  ]);
  expect(current.suggestedFilename()).toBe("current-employees.csv");
  expect(state.downloads.at(-1)).toMatch(/\/bulk\/export$/);
  expect(state.requests).toHaveLength(0);
});

test("previews a CSV without writes, applies it once and refreshes the employee list", async ({
  page,
}) => {
  const state = await mockGlobalEmployees(page);
  const modal = await openBulk(page, "create");
  await modal.getByLabel("CSV file", { exact: true }).setInputFiles({
    name: "employees.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(createCsv),
  });
  await modal.getByRole("button", { name: "Preview upload", exact: true }).click();
  await expect(modal.getByText("qa@example.com", { exact: true })).toBeVisible();
  expect(state.requests).toEqual([{ mode: "create", csv: createCsv, apply: false }]);
  const readsBeforeApply = state.employeeReads;
  await modal.getByRole("button", { name: "Apply upload", exact: true }).click();
  await expect.poll(() => state.employeeReads).toBeGreaterThan(readsBeforeApply);
  await expect(page.getByText("Bulk Employee", { exact: true })).toBeVisible();
  expect(state.requests).toEqual([
    { mode: "create", csv: createCsv, apply: false },
    { mode: "create", csv: createCsv, apply: true },
  ]);
});

test("shows invalid-row details and prevents applying a partially valid file", async ({ page }) => {
  const state = await mockGlobalEmployees(page, {
    bulk: (request) => ({
      ...successfulResult(request),
      total: 2,
      invalid: 1,
      results: [
        ...successfulResult(request).results,
        {
          row: 3,
          identifier: "invalid-email",
          status: "error",
          errors: ["Enter a valid email address"],
          changes: [],
        },
      ],
    }),
  });
  const modal = await openBulk(page, "create");
  await modal.getByLabel("CSV file", { exact: true }).setInputFiles({
    name: "invalid.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      createCsv + "Wrong,Email,invalid-email,GB,direct_hire,Engineer,2026-10-01,1200.00,monthly\n",
    ),
  });
  await modal.getByRole("button", { name: "Preview upload", exact: true }).click();
  await expect(modal.getByText("Enter a valid email address", { exact: true })).toBeVisible();
  await expect(modal.getByRole("button", { name: "Apply upload", exact: true })).toBeDisabled();
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0].apply).toBe(false);
  expect(state.applied).toBe(false);
});

test("updates show before and after values and explain that blank cells keep existing data", async ({
  page,
}) => {
  const state = await mockGlobalEmployees(page, { existingEmployee: true });
  const modal = await openBulk(page, "update");
  await expect(
    modal.getByText(
      /For updates, employeeId identifies the employee\. Blank cells leave existing values unchanged\./,
    ),
  ).toBeVisible();
  await modal.getByLabel("CSV file", { exact: true }).setInputFiles({
    name: "updates.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(updateCsv),
  });
  await modal.getByRole("button", { name: "Preview updates", exact: true }).click();
  await modal.getByText("View changes (1)", { exact: true }).click();
  await expect(modal.getByText("1000.00", { exact: true })).toBeVisible();
  await expect(modal.getByText("1200.00", { exact: true })).toBeVisible();
  const readsBeforeApply = state.employeeReads;
  await modal.getByRole("button", { name: "Apply updates", exact: true }).click();
  await expect.poll(() => state.employeeReads).toBeGreaterThan(readsBeforeApply);
  expect(state.requests).toEqual([
    { mode: "update", csv: updateCsv, apply: false },
    { mode: "update", csv: updateCsv, apply: true },
  ]);
});

test("prevents repeated apply requests while a bulk write is pending", async ({ page }) => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const state = await mockGlobalEmployees(page, {
    bulk: async (request) => {
      if (request.apply) await pending;
      return successfulResult(request);
    },
  });
  const modal = await openBulk(page, "create");
  await modal.getByLabel("CSV file", { exact: true }).setInputFiles({
    name: "employees.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(createCsv),
  });
  await modal.getByRole("button", { name: "Preview upload", exact: true }).click();
  const apply = modal.getByRole("button", { name: /^(Apply upload|Applying…)$/ });
  await expect(apply).toBeEnabled();
  try {
    await apply.click({ clickCount: 2 });
    await expect(apply).toBeDisabled();
    await expect(modal.getByLabel("CSV file", { exact: true })).toBeDisabled();
    await expect.poll(() => state.requests.filter((request) => request.apply).length).toBe(1);
  } finally {
    release();
  }
  await expect.poll(() => state.applied).toBe(true);
  expect(state.requests.filter((request) => request.apply)).toHaveLength(1);
});

test("changing the CSV invalidates the previous preview before another apply", async ({ page }) => {
  const state = await mockGlobalEmployees(page);
  const modal = await openBulk(page, "create");
  const file = modal.getByLabel("CSV file", { exact: true });
  await file.setInputFiles({
    name: "first.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(createCsv),
  });
  await modal.getByRole("button", { name: "Preview upload", exact: true }).click();
  await expect(modal.getByRole("button", { name: "Apply upload", exact: true })).toBeEnabled();
  await file.setInputFiles({
    name: "replacement.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(createCsv.replace("1200.00", "1400.00")),
  });
  await expect(modal.getByRole("button", { name: "Apply upload", exact: true })).toBeDisabled();
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0].apply).toBe(false);
});

test("an unchanged preview cannot be applied", async ({ page }) => {
  const state = await mockGlobalEmployees(page, {
    existingEmployee: true,
    bulk: (request) => ({
      ...successfulResult(request),
      results: [{ row: 2, identifier: "employee-1", status: "unchanged", errors: [], changes: [] }],
    }),
  });
  const modal = await openBulk(page, "update");
  await modal.getByLabel("CSV file", { exact: true }).setInputFiles({
    name: "unchanged.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("employeeId,salaryAmount\nemployee-1,1000.00\n"),
  });
  await modal.getByRole("button", { name: "Preview updates", exact: true }).click();
  await expect(modal.getByRole("cell", { name: "unchanged", exact: true })).toBeVisible();
  await expect(modal.getByRole("button", { name: "Apply updates", exact: true })).toBeDisabled();
  expect(state.requests).toHaveLength(1);
  expect(state.requests[0].apply).toBe(false);
});

test("mixed updates count changed employees separately from unchanged rows", async ({ page }) => {
  const state = await mockGlobalEmployees(page, {
    existingEmployee: true,
    bulk: (request) => ({
      ...successfulResult(request),
      total: 2,
      valid: 2,
      results: [
        ...successfulResult(request).results,
        { row: 3, identifier: "employee-2", status: "unchanged", errors: [], changes: [] },
      ],
    }),
  });
  const modal = await openBulk(page, "update");
  await modal.getByLabel("CSV file", { exact: true }).setInputFiles({
    name: "mixed.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(updateCsv + "employee-2,,\n"),
  });
  await modal.getByRole("button", { name: "Preview updates", exact: true }).click();
  await expect(modal.getByRole("cell", { name: "unchanged", exact: true })).toBeVisible();
  await modal.getByRole("button", { name: "Apply updates", exact: true }).click();
  await expect(page.getByText("1 employee updated. 1 unchanged.", { exact: true })).toBeVisible();
  expect(state.requests.filter((request) => request.apply)).toHaveLength(1);
});

test("bulk updates refresh a previously cached employee detail without reloading the app", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  const state = await mockGlobalEmployees(page, { existingEmployee: true });
  await page.goto("/global-payroll/employees/employee-1");
  await expect(page.getByText("GBP 1,000", { exact: false })).toBeVisible();
  expect(state.detailReads).toBe(1);

  // Stay within the SPA: a full navigation would discard the query cache and hide this regression.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Bulk Employee", exact: true }).click();
  await expect(page.getByText("GBP 1,000", { exact: false })).toBeVisible();
  expect(state.detailReads).toBe(1);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.getByRole("button", { name: "Bulk update", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "Bulk update global employees", exact: true });
  await modal.getByLabel("CSV file", { exact: true }).setInputFiles({
    name: "salary-update.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(updateCsv),
  });
  await modal.getByRole("button", { name: "Preview updates", exact: true }).click();
  await modal.getByText("View changes (1)", { exact: true }).click();
  await expect(modal.getByText("1200.00", { exact: true })).toBeVisible();
  await modal.screenshot({ path: testInfo.outputPath("bulk-update-preview.png") });
  await modal.getByRole("button", { name: "Apply updates", exact: true }).click();
  await expect(modal).toBeHidden();
  await page.getByRole("button", { name: "Bulk Employee", exact: true }).click();
  await expect.poll(() => state.detailReads).toBe(2);
  await expect(page.getByText("GBP 1,200", { exact: false })).toBeVisible();
  await expect(page.getByText("GBP 1,000", { exact: false })).toHaveCount(0);
});
