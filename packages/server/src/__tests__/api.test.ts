// ============================================================================
// EMP PAYROLL — Comprehensive API Integration Tests
// Tests against live deployment at https://testpayroll.empcloud.com
// Run: npx vitest run src/__tests__/api.test.ts
// ============================================================================

import { describe, it, expect, beforeAll } from "vitest";

const BASE = process.env.API_BASE_URL || "https://testpayroll.empcloud.com/api/v1";
let token = "";
let userId: number;
let orgId: string;
const U = Date.now();

// -- Shared IDs populated during tests --
let salaryStructureId = "";
let componentId = "";
let payrollRunId = "";
let payslipId = "";
let loanId = "";
let adjustmentId = "";
let benefitPlanId = "";
let enrollmentId = "";
let glMappingId = "";
let journalId = "";
let insurancePolicyId = "";
let insuranceEnrollmentId = "";
let globalEmployeeId = "";
let globalPayrollRunId = "";
let invoiceId = "";
let earnedWageRequestId = "";

// Employee IDs (test employees)
const EMP_ID_1 = "2"; // Use string IDs for payroll
const EMP_ID_2 = "3";

// ============================================================================
// Helper
// ============================================================================
async function api(path: string, opts: RequestInit = {}) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(opts.headers as Record<string, string>),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { ...opts, headers });
  const text = await res.text();
  let body: any = {};
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: res.status, body };
}

// ============================================================================
// Auth
// ============================================================================
beforeAll(async () => {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "ananya@technova.in", password: "Welcome@123" }),
  });
  const json: any = await res.json();
  token = json.data?.tokens?.accessToken || json.data?.token || json.data?.accessToken;
  userId = json.data?.user?.empcloudUserId || json.data?.user?.id;
  orgId = String(json.data?.user?.empcloudOrgId || json.data?.user?.organizationId || "");
  expect(token).toBeTruthy();
  expect(userId).toBeTruthy();
});

// ============================================================================
// 1. AUTH
// ============================================================================
describe("Auth", () => {
  it("1.1 POST /auth/login — valid credentials", async () => {
    const { status, body } = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "ananya@technova.in", password: "Welcome@123" }),
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data?.tokens?.accessToken || body.data?.token).toBeTruthy();
  });

  it("1.2 POST /auth/login — wrong password", async () => {
    const { status, body } = await api("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "ananya@technova.in", password: "WrongPassword" }),
    });
    expect(status).toBeGreaterThanOrEqual(400);
    expect(body.success).toBe(false);
  });

  it("1.3 POST /auth/refresh-token — missing token", async () => {
    const { status, body } = await api("/auth/refresh-token", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it("1.4 Unauthenticated request returns 401", async () => {
    const res = await fetch(`${BASE}/payroll`, {
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(401);
  });
});

// ============================================================================
// 2. SALARY STRUCTURES
// ============================================================================
describe("Salary Structures", () => {
  it("2.1 POST /salary-structures — create structure", async () => {
    const { status, body } = await api("/salary-structures", {
      method: "POST",
      body: JSON.stringify({
        name: `Standard CTC ${U}`,
        description: "Standard Cost-to-Company structure",
        type: "ctc",
        is_default: false,
      }),
    });
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    salaryStructureId = body.data.id;
    expect(salaryStructureId).toBeTruthy();
  });

  it("2.2 GET /salary-structures — list structures", async () => {
    const { status, body } = await api("/salary-structures");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("2.3 GET /salary-structures/:id — get single structure", async () => {
    const { status, body } = await api(`/salary-structures/${salaryStructureId}`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(salaryStructureId);
  });

  it("2.4 PUT /salary-structures/:id — update structure", async () => {
    const { status, body } = await api(`/salary-structures/${salaryStructureId}`, {
      method: "PUT",
      body: JSON.stringify({ description: `Updated CTC structure ${U}` }),
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("2.5 POST /salary-structures/:id/components — add component", async () => {
    const { status, body } = await api(`/salary-structures/${salaryStructureId}/components`, {
      method: "POST",
      body: JSON.stringify({
        name: "Basic Salary",
        type: "earning",
        calculation_type: "percentage",
        value: 50,
        is_taxable: true,
        sort_order: 1,
      }),
    });
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    componentId = body.data.id;
    expect(componentId).toBeTruthy();
  });

  it("2.6 GET /salary-structures/:id/components — list components", async () => {
    const { status, body } = await api(`/salary-structures/${salaryStructureId}/components`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("2.7 PUT /salary-structures/:id/components/:cid — update component", async () => {
    const { status, body } = await api(
      `/salary-structures/${salaryStructureId}/components/${componentId}`,
      {
        method: "PUT",
        body: JSON.stringify({ value: 45 }),
      },
    );
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("2.8 GET /salary-structures/employee/:empId — get employee salary", async () => {
    const { status, body } = await api(`/salary-structures/employee/${EMP_ID_1}`);
    expect([200, 404]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });

  it("2.9 GET /salary-structures/employee/:empId/history — salary history", async () => {
    const { status, body } = await api(`/salary-structures/employee/${EMP_ID_1}/history`);
    expect([200, 404]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });
});

// ============================================================================
// 3. PAYROLL RUNS
// ============================================================================
describe("Payroll Runs", () => {
  it("3.1 POST /payroll — create payroll run", async () => {
    const { status, body } = await api("/payroll", {
      method: "POST",
      body: JSON.stringify({
        month: 3,
        year: 2026,
        name: `March 2026 Payroll ${U}`,
      }),
    });
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    payrollRunId = body.data.id;
    expect(payrollRunId).toBeTruthy();
  });

  it("3.2 GET /payroll — list payroll runs", async () => {
    const { status, body } = await api("/payroll");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it("3.3 GET /payroll/:id — get payroll run", async () => {
    const { status, body } = await api(`/payroll/${payrollRunId}`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(payrollRunId);
  });

  it("3.4 POST /payroll/:id/compute — compute payroll", async () => {
    const { status, body } = await api(`/payroll/${payrollRunId}/compute`, { method: "POST" });
    expect([200, 400]).toContain(status); // May fail if no employees configured
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });

  it("3.5 GET /payroll/:id/summary — run summary", async () => {
    const { status, body } = await api(`/payroll/${payrollRunId}/summary`);
    expect([200, 404]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });

  it("3.6 GET /payroll/:id/payslips — run payslips", async () => {
    const { status, body } = await api(`/payroll/${payrollRunId}/payslips`);
    expect([200, 404]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
      const payslips = body.data || [];
      if (payslips.length > 0) {
        payslipId = payslips[0].id;
      }
    }
  });

  it("3.7 POST /payroll/:id/revert — revert to draft", async () => {
    const { status, body } = await api(`/payroll/${payrollRunId}/revert`, { method: "POST" });
    expect([200, 400]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });

  it("3.8 GET /payroll/reports/tds-challan — TDS challan report", async () => {
    const { status, body } = await api("/payroll/reports/tds-challan?quarter=4&fy=2025-2026");
    expect([200, 400, 404]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });
});

// ============================================================================
// 4. PAYSLIPS
// ============================================================================
describe("Payslips", () => {
  it("4.1 GET /payslips — list payslips (admin)", async () => {
    const { status, body } = await api("/payslips");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("4.2 GET /payslips/employee/:empId — employee payslips", async () => {
    const { status, body } = await api(`/payslips/employee/${EMP_ID_1}`);
    expect([200, 404]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
      const slips = body.data || [];
      if (slips.length > 0 && !payslipId) {
        payslipId = slips[0].id;
      }
    }
  });

  it("4.3 GET /payslips/:id — get single payslip", async () => {
    if (!payslipId) return;
    const { status, body } = await api(`/payslips/${payslipId}`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("4.4 GET /payslips/:id/pdf — generate payslip PDF/HTML", async () => {
    if (!payslipId) return;
    const res = await fetch(`${BASE}/payslips/${payslipId}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect([200, 404]).toContain(res.status);
    if (res.status === 200) {
      const ct = res.headers.get("content-type") || "";
      expect(ct).toContain("text/html");
    }
  });

  it("4.5 POST /payslips/:id/dispute — dispute payslip", async () => {
    if (!payslipId) return;
    const { status, body } = await api(`/payslips/${payslipId}/dispute`, {
      method: "POST",
      body: JSON.stringify({ reason: `API test dispute ${U}` }),
    });
    expect([200, 400]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });
});

// ============================================================================
// 5. TAX DECLARATIONS
// ============================================================================
describe("Tax Declarations", () => {
  it("5.1 GET /tax/computation/:empId — get tax computation", async () => {
    const { status, body } = await api(`/tax/computation/${EMP_ID_1}`);
    expect([200, 404]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });

  it("5.2 POST /tax/computation/:empId/compute — compute tax", async () => {
    const { status, body } = await api(`/tax/computation/${EMP_ID_1}/compute`, { method: "POST" });
    expect([200, 400, 404]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });

  it("5.3 GET /tax/declarations/:empId — get declarations", async () => {
    const { status, body } = await api(`/tax/declarations/${EMP_ID_1}?fy=2025-2026`);
    expect([200, 404]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });

  it("5.4 POST /tax/declarations/:empId — submit declarations", async () => {
    const { status, body } = await api(`/tax/declarations/${EMP_ID_1}`, {
      method: "POST",
      body: JSON.stringify({
        financialYear: "2025-2026",
        declarations: [
          { section: "80C", description: "PPF", amount: 150000, proofSubmitted: false },
          { section: "80D", description: "Health Insurance", amount: 25000, proofSubmitted: false },
        ],
      }),
    });
    expect([200, 201, 400]).toContain(status);
    if (status === 201) {
      expect(body.success).toBe(true);
    }
  });

  it("5.5 GET /tax/regime/:empId — get tax regime", async () => {
    const { status, body } = await api(`/tax/regime/${EMP_ID_1}`);
    expect([200, 404]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });

  it("5.6 PUT /tax/regime/:empId — update tax regime", async () => {
    const { status, body } = await api(`/tax/regime/${EMP_ID_1}`, {
      method: "PUT",
      body: JSON.stringify({ regime: "new" }),
    });
    expect([200, 400, 404]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });
});

// ============================================================================
// 6. LOANS
// ============================================================================
describe("Loans", () => {
  it("6.1 POST /loans — create loan", async () => {
    const { status, body } = await api("/loans", {
      method: "POST",
      body: JSON.stringify({
        employeeId: EMP_ID_1,
        type: "personal",
        amount: 100000,
        tenure: 12,
        interestRate: 8,
        emiStartMonth: "2026-04",
        description: `API test loan ${U}`,
      }),
    });
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    loanId = body.data.id;
    expect(loanId).toBeTruthy();
  });

  it("6.2 GET /loans — list all loans", async () => {
    const { status, body } = await api("/loans");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("6.3 GET /loans/employee/:empId — employee loans", async () => {
    const { status, body } = await api(`/loans/employee/${EMP_ID_1}`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("6.4 GET /loans/employee/:empId/emi-total — active EMI total", async () => {
    const { status, body } = await api(`/loans/employee/${EMP_ID_1}/emi-total`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.data.totalEMI).toBe("number");
  });

  it("6.5 POST /loans/:id/payment — record payment", async () => {
    const { status, body } = await api(`/loans/${loanId}/payment`, {
      method: "POST",
      body: JSON.stringify({ amount: 10000 }),
    });
    expect([200, 400]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });
});

// ============================================================================
// 7. REIMBURSEMENTS
// ============================================================================
describe("Reimbursements", () => {
  it("7.1 GET /reimbursements — list reimbursements", async () => {
    const { status, body } = await api("/reimbursements");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("7.2 GET /reimbursements?status=pending — filter by status", async () => {
    const { status, body } = await api("/reimbursements?status=pending");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

// ============================================================================
// 8. ADJUSTMENTS
// ============================================================================
describe("Adjustments", () => {
  it("8.1 POST /adjustments — create adjustment", async () => {
    const { status, body } = await api("/adjustments", {
      method: "POST",
      body: JSON.stringify({
        employeeId: EMP_ID_1,
        type: "bonus",
        description: `Quarterly bonus API test ${U}`,
        amount: 25000,
        isTaxable: true,
        isRecurring: false,
        effectiveMonth: "2026-03",
      }),
    });
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    adjustmentId = body.data.id;
    expect(adjustmentId).toBeTruthy();
  });

  it("8.2 GET /adjustments — list adjustments", async () => {
    const { status, body } = await api("/adjustments");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("8.3 GET /adjustments/employee/:empId — employee adjustments", async () => {
    const { status, body } = await api(`/adjustments/employee/${EMP_ID_1}`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("8.4 GET /adjustments/employee/:empId/pending — pending for run", async () => {
    const { status, body } = await api(`/adjustments/employee/${EMP_ID_1}/pending`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("8.5 POST /adjustments/:id/cancel — cancel adjustment", async () => {
    const { status, body } = await api(`/adjustments/${adjustmentId}/cancel`, { method: "POST" });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

// ============================================================================
// 9. BENEFITS
// ============================================================================
describe("Benefits", () => {
  it("9.1 GET /benefits/dashboard — benefits dashboard", async () => {
    const { status, body } = await api("/benefits/dashboard");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("9.2 POST /benefits/plans — create benefit plan", async () => {
    const { status, body } = await api("/benefits/plans", {
      method: "POST",
      body: JSON.stringify({
        name: `Health Insurance Plan ${U}`,
        type: "health_insurance",
        description: "Company health insurance plan",
        provider: "Test Provider",
        employerContribution: 5000,
        employeeContribution: 2000,
        isActive: true,
      }),
    });
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    benefitPlanId = body.data.id;
    expect(benefitPlanId).toBeTruthy();
  });

  it("9.3 GET /benefits/plans — list plans", async () => {
    const { status, body } = await api("/benefits/plans");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("9.4 GET /benefits/plans/:id — get single plan", async () => {
    const { status, body } = await api(`/benefits/plans/${benefitPlanId}`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.id).toBe(benefitPlanId);
  });

  it("9.5 PUT /benefits/plans/:id — update plan", async () => {
    const { status, body } = await api(`/benefits/plans/${benefitPlanId}`, {
      method: "PUT",
      body: JSON.stringify({ description: `Updated health plan ${U}` }),
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("9.6 POST /benefits/enroll — enroll employee", async () => {
    const { status, body } = await api("/benefits/enroll", {
      method: "POST",
      body: JSON.stringify({
        planId: benefitPlanId,
        employeeId: EMP_ID_1,
        startDate: "2026-04-01",
      }),
    });
    expect([200, 201, 400]).toContain(status);
    if (status === 201) {
      enrollmentId = body.data.id;
    }
  });

  it("9.7 GET /benefits/enrollments — list enrollments", async () => {
    const { status, body } = await api("/benefits/enrollments");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("9.8 GET /benefits/my — my benefits", async () => {
    const { status, body } = await api("/benefits/my");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("9.9 GET /benefits/employee/:empId — employee benefits", async () => {
    const { status, body } = await api(`/benefits/employee/${EMP_ID_1}`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

// ============================================================================
// 10. GL ACCOUNTING
// ============================================================================
describe("GL Accounting", () => {
  it("10.1 POST /gl/mappings — create GL mapping", async () => {
    const { status, body } = await api("/gl/mappings", {
      method: "POST",
      body: JSON.stringify({
        componentName: "Basic Salary",
        debitAccount: "5100",
        creditAccount: "2100",
        description: `GL mapping API test ${U}`,
      }),
    });
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    glMappingId = body.data.id;
    expect(glMappingId).toBeTruthy();
  });

  it("10.2 GET /gl/mappings — list mappings", async () => {
    const { status, body } = await api("/gl/mappings");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("10.3 PUT /gl/mappings/:id — update mapping", async () => {
    const { status, body } = await api(`/gl/mappings/${glMappingId}`, {
      method: "PUT",
      body: JSON.stringify({ description: `Updated GL mapping ${U}` }),
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("10.4 GET /gl/journals — list journal entries", async () => {
    const { status, body } = await api("/gl/journals");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    const journals = body.data || [];
    if (journals.length > 0) {
      journalId = journals[0].id;
    }
  });

  it("10.5 POST /gl/journals/generate — generate journal (requires payroll run)", async () => {
    if (!payrollRunId) return;
    const { status, body } = await api("/gl/journals/generate", {
      method: "POST",
      body: JSON.stringify({ payrollRunId }),
    });
    expect([200, 201, 400]).toContain(status);
    if (status === 201 && body.data?.id) {
      journalId = body.data.id;
    }
  });

  it("10.6 GET /gl/journals/:id — get journal entry", async () => {
    if (!journalId) return;
    const { status, body } = await api(`/gl/journals/${journalId}`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("10.7 DELETE /gl/mappings/:id — delete mapping", async () => {
    const { status, body } = await api(`/gl/mappings/${glMappingId}`, { method: "DELETE" });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

// ============================================================================
// 11. INSURANCE
// ============================================================================
describe("Insurance", () => {
  it("11.1 GET /insurance/dashboard — insurance dashboard", async () => {
    const { status, body } = await api("/insurance/dashboard");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("11.2 POST /insurance/policies — create policy", async () => {
    const { status, body } = await api("/insurance/policies", {
      method: "POST",
      body: JSON.stringify({
        name: `Group Health Insurance ${U}`,
        type: "health",
        provider: "Test Insurance Co",
        policyNumber: `POL-${U}`,
        sumInsured: 500000,
        premium: 12000,
        startDate: "2026-04-01",
        endDate: "2027-03-31",
        isActive: true,
      }),
    });
    expect(status).toBe(201);
    expect(body.success).toBe(true);
    insurancePolicyId = body.data.id;
    expect(insurancePolicyId).toBeTruthy();
  });

  it("11.3 GET /insurance/policies — list policies", async () => {
    const { status, body } = await api("/insurance/policies");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("11.4 GET /insurance/policies/:id — get single policy", async () => {
    const { status, body } = await api(`/insurance/policies/${insurancePolicyId}`);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("11.5 PUT /insurance/policies/:id — update policy", async () => {
    const { status, body } = await api(`/insurance/policies/${insurancePolicyId}`, {
      method: "PUT",
      body: JSON.stringify({ sumInsured: 750000 }),
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("11.6 POST /insurance/enroll — enroll employee", async () => {
    const { status, body } = await api("/insurance/enroll", {
      method: "POST",
      body: JSON.stringify({
        policyId: insurancePolicyId,
        employeeId: EMP_ID_1,
        coverType: "individual",
        startDate: "2026-04-01",
      }),
    });
    expect([200, 201, 400]).toContain(status);
    if (status === 201) {
      insuranceEnrollmentId = body.data.id;
    }
  });

  it("11.7 GET /insurance/enrollments — list enrollments", async () => {
    const { status, body } = await api("/insurance/enrollments");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("11.8 GET /insurance/my — my insurance", async () => {
    const { status, body } = await api("/insurance/my");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("11.9 GET /insurance/claims — list claims", async () => {
    const { status, body } = await api("/insurance/claims");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("11.10 GET /insurance/my-claims — my claims", async () => {
    const { status, body } = await api("/insurance/my-claims");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

// ============================================================================
// 12. GLOBAL PAYROLL
// ============================================================================
describe("Global Payroll", () => {
  it("12.1 GET /global/dashboard — global payroll dashboard", async () => {
    const { status, body } = await api("/global/dashboard");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("12.2 GET /global/cost-analysis — cost analysis", async () => {
    const { status, body } = await api("/global/cost-analysis");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("12.3 GET /global/countries — list countries", async () => {
    const { status, body } = await api("/global/countries");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("12.4 POST /global/employees — add global employee", async () => {
    const { status, body } = await api("/global/employees", {
      method: "POST",
      body: JSON.stringify({
        empcloudUserId: parseInt(EMP_ID_2),
        countryId: "1",
        employmentType: "full_time",
        currency: "USD",
        monthlySalary: 8000,
        startDate: "2026-04-01",
      }),
    });
    expect([200, 201, 400]).toContain(status);
    if (status === 201) {
      globalEmployeeId = body.data.id;
    }
  });

  it("12.5 GET /global/employees — list global employees", async () => {
    const { status, body } = await api("/global/employees");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("12.6 GET /global/payroll-runs — list global payroll runs", async () => {
    const { status, body } = await api("/global/payroll-runs");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("12.7 GET /global/invoices — list contractor invoices", async () => {
    const { status, body } = await api("/global/invoices");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

// ============================================================================
// 13. EARNED WAGE ACCESS
// ============================================================================
describe("Earned Wage Access", () => {
  it("13.1 GET /earned-wage/settings — get settings", async () => {
    const { status, body } = await api("/earned-wage/settings");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("13.2 GET /earned-wage/available — check available amount", async () => {
    const { status, body } = await api("/earned-wage/available");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("13.3 GET /earned-wage/my — my wage advance requests", async () => {
    const { status, body } = await api("/earned-wage/my");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it("13.4 GET /earned-wage/requests — list all requests (admin)", async () => {
    const { status, body } = await api("/earned-wage/requests");
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

// ============================================================================
// 14. SELF-SERVICE
// ============================================================================
describe("Self-Service", () => {
  it("14.1 GET /self-service/dashboard — employee dashboard", async () => {
    const { status, body } = await api("/self-service/dashboard");
    expect([200, 404]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });

  it("14.2 GET /self-service/payslips — my payslips", async () => {
    const { status, body } = await api("/self-service/payslips");
    expect([200, 404]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });

  it("14.3 GET /self-service/salary — my salary details", async () => {
    const { status, body } = await api("/self-service/salary");
    expect([200, 404]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });

  it("14.4 GET /self-service/tax — my tax summary", async () => {
    const { status, body } = await api("/self-service/tax");
    expect([200, 404]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });

  it("14.5 GET /self-service/loans — my loans", async () => {
    const { status, body } = await api("/self-service/loans");
    expect([200, 404]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });

  it("14.6 GET /self-service/reimbursements — my reimbursements", async () => {
    const { status, body } = await api("/self-service/reimbursements");
    expect([200, 404]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });
});

// ============================================================================
// 15. ORGANIZATIONS
// ============================================================================
describe("Organizations", () => {
  it("15.1 GET /organizations/current — current org", async () => {
    const { status, body } = await api("/organizations/current");
    expect([200, 404]).toContain(status);
    if (status === 200) {
      expect(body.success).toBe(true);
    }
  });
});

// ============================================================================
// 16. HEALTH CHECK
// ============================================================================
describe("Health", () => {
  it("16.1 GET /health — health check passes", async () => {
    const healthBase = BASE.replace("/api/v1", "/health");
    const res = await fetch(healthBase);
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(body.status).toBe("ok");
  });
});
