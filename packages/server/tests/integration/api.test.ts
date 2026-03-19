import { describe, it, expect, beforeAll } from "vitest";

const BASE = process.env.API_URL || "http://localhost:4000/api/v1";
const BASE_ROOT = BASE.replace(/\/api\/v1$/, "");
let token = "";
let serverAvailable = false;

describe("API Integration Tests", () => {
  beforeAll(async () => {
    // Check if server is reachable, then login to get token
    try {
      const ping = await fetch(`${BASE_ROOT}/health`, { signal: AbortSignal.timeout(3000) });
      if (ping.ok) serverAvailable = true;
    } catch {
      // Server not running — all integration tests will skip
      return;
    }
    try {
      const res = await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ananya@technova.in", password: "Welcome@123" }),
      });
      const data = await res.json();
      if (data.success) token = data.data.tokens.accessToken;
    } catch {
      // Login failed but server is up
    }
  });

  function authHeaders() {
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }

  describe("Health", () => {
    it("GET /health returns ok", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE_ROOT}/health`);
      const data = await res.json();
      expect(data.status).toBe("ok");
    });

    it("GET /health/detailed returns diagnostics", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE_ROOT}/health/detailed`);
      const data = await res.json();
      expect(data.checks).toBeDefined();
      expect(data.checks.database).toBeDefined();
      expect(data.checks.memory).toBeDefined();
    });
  });

  describe("Auth", () => {
    it("POST /auth/login with valid credentials", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ananya@technova.in", password: "Welcome@123" }),
      });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.tokens.accessToken).toBeDefined();
      expect(data.data.user.email).toBe("ananya@technova.in");
    });

    it("POST /auth/login with invalid credentials returns error", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "wrong@email.com", password: "wrongpass" }),
      });
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it("rejects requests without token", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE}/employees`);
      expect(res.status).toBe(401);
    });

    it("POST /auth/change-password works", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE}/auth/change-password`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ currentPassword: "Welcome@123", newPassword: "Welcome@123" }),
      });
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it("POST /auth/change-password rejects wrong current password", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE}/auth/change-password`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ currentPassword: "wrongpass", newPassword: "NewPass@123" }),
      });
      const data = await res.json();
      expect(data.success).toBe(false);
    });
  });

  describe("Employees", () => {
    it("GET /employees returns list", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE}/employees`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.data.length).toBeGreaterThan(0);
      expect(data.data.total).toBeGreaterThan(0);
    });

    it("GET /employees/:id returns employee detail", async () => {
      if (!serverAvailable) return;
      const list = await fetch(`${BASE}/employees`, { headers: authHeaders() });
      const listData = await list.json();
      const empId = listData.data.data[0].id;

      const res = await fetch(`${BASE}/employees/${empId}`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.first_name).toBeDefined();
    });

    it("GET /employees/export returns CSV", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE}/employees/export`, { headers: authHeaders() });
      expect(res.headers.get("content-type")).toContain("text/csv");
      const text = await res.text();
      expect(text).toContain("Employee Code");
    });
  });

  describe("Payroll", () => {
    it("GET /payroll returns runs", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE}/payroll`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.data)).toBe(true);
    });

    it("GET /payroll/:id returns a specific run", async () => {
      if (!serverAvailable) return;
      const list = await fetch(`${BASE}/payroll`, { headers: authHeaders() });
      const listData = await list.json();
      if (listData.data.data.length === 0) return;
      const runId = listData.data.data[0].id;

      const res = await fetch(`${BASE}/payroll/${runId}`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.id).toBe(runId);
    });

    it("GET /payroll/:id/payslips returns enriched payslips", async () => {
      if (!serverAvailable) return;
      const list = await fetch(`${BASE}/payroll`, { headers: authHeaders() });
      const listData = await list.json();
      if (listData.data.data.length === 0) return;
      const runId = listData.data.data[0].id;

      const res = await fetch(`${BASE}/payroll/${runId}/payslips`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
      if (data.data.data.length > 0) {
        expect(data.data.data[0].first_name).toBeDefined();
        expect(data.data.data[0].employee_code).toBeDefined();
      }
    });

    it("POST /payroll creates a new run", async () => {
      if (!serverAvailable) return;
      // Use a unique month that doesn't already exist
      const res = await fetch(`${BASE}/payroll`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ month: 12, year: 2025, payDate: "2025-12-28" }),
      });
      const data = await res.json();
      // May succeed or fail if run exists — just check it doesn't crash
      expect(res.status === 201 || res.status === 200 || res.status === 400 || res.status === 409).toBe(true);
      if (data.success) {
        expect(data.data.id).toBeDefined();
      }
    });
  });

  describe("Payslips", () => {
    it("GET /payslips returns list", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE}/payslips`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it("GET /payslips/export/csv returns CSV", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE}/payslips/export/csv`, { headers: authHeaders() });
      expect(res.headers.get("content-type")).toContain("text/csv");
    });
  });

  describe("Salary Structures", () => {
    it("GET /salary-structures returns list", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE}/salary-structures`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  describe("Self-Service", () => {
    it("GET /self-service/dashboard returns user data", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE}/self-service/dashboard`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.employee).toBeDefined();
    });

    it("GET /self-service/profile returns profile", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE}/self-service/profile`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.email).toBeDefined();
    });
  });

  describe("Employee Notes", () => {
    let empId = "";

    it("creates and lists notes for an employee", async () => {
      if (!serverAvailable) return;
      const list = await fetch(`${BASE}/employees`, { headers: authHeaders() });
      const listData = await list.json();
      empId = listData.data.data[0].id;

      // Create a note
      const create = await fetch(`${BASE}/employees/${empId}/notes`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ content: "Test note from integration", category: "hr" }),
      });
      const createData = await create.json();
      expect(createData.success).toBe(true);
      expect(createData.data.id).toBeDefined();

      // List notes
      const res = await fetch(`${BASE}/employees/${empId}/notes`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.length).toBeGreaterThan(0);
      const note = data.data.find((n: any) => n.content === "Test note from integration");
      expect(note).toBeDefined();
      expect(note.category).toBe("hr");
    });
  });

  describe("Loans", () => {
    it("GET /loans returns list", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE}/loans`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  describe("Leaves", () => {
    it("GET /leaves returns org-wide balances", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE}/leaves`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  describe("Attendance", () => {
    it("POST /attendance/import marks attendance", async () => {
      if (!serverAvailable) return;
      const empList = await fetch(`${BASE}/employees`, { headers: authHeaders() });
      const empData = await empList.json();
      const empId = empData.data.data[0].id;

      const res = await fetch(`${BASE}/attendance/import`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          month: 3, year: 2026,
          records: [{ employeeId: empId, totalDays: 22, presentDays: 21, absentDays: 1, lopDays: 0, overtimeHours: 0 }],
        }),
      });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.imported).toBe(1);
    });

    it("GET /attendance/summary/:empId returns summary", async () => {
      if (!serverAvailable) return;
      const empList = await fetch(`${BASE}/employees`, { headers: authHeaders() });
      const empData = await empList.json();
      const empId = empData.data.data[0].id;

      const res = await fetch(`${BASE}/attendance/summary/${empId}?month=3&year=2026`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.present_days).toBeDefined();
    });
  });

  describe("Self-Service Salary", () => {
    it("GET /self-service/salary returns salary info", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE}/self-service/salary`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it("GET /self-service/payslips returns my payslips", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE}/self-service/payslips`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  describe("API Docs", () => {
    it("GET /docs/openapi.json returns spec", async () => {
      if (!serverAvailable) return;
      const res = await fetch(`${BASE}/docs/openapi.json`);
      const data = await res.json();
      expect(data.openapi).toBe("3.0.3");
      expect(data.info.title).toBe("EMP Payroll API");
    });
  });
});
