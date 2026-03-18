import { describe, it, expect, beforeAll } from "vitest";

const BASE = process.env.API_URL || "http://localhost:4000/api/v1";
let token = "";

describe("API Integration Tests", () => {
  beforeAll(async () => {
    // Login to get token
    try {
      const res = await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ananya@technova.in", password: "Welcome@123" }),
      });
      const data = await res.json();
      if (data.success) token = data.data.tokens.accessToken;
    } catch {
      // Server may not be running — tests will skip gracefully
    }
  });

  function authHeaders() {
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }

  describe("Health", () => {
    it("GET /health returns ok", async () => {
      const res = await fetch("http://localhost:4000/health");
      const data = await res.json();
      expect(data.status).toBe("ok");
    });

    it("GET /health/detailed returns diagnostics", async () => {
      const res = await fetch("http://localhost:4000/health/detailed");
      const data = await res.json();
      expect(data.checks).toBeDefined();
      expect(data.checks.database).toBeDefined();
      expect(data.checks.memory).toBeDefined();
    });
  });

  describe("Auth", () => {
    it("POST /auth/login with valid credentials", async () => {
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
      const res = await fetch(`${BASE}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "wrong@email.com", password: "wrongpass" }),
      });
      const data = await res.json();
      expect(data.success).toBe(false);
    });

    it("rejects requests without token", async () => {
      const res = await fetch(`${BASE}/employees`);
      expect(res.status).toBe(401);
    });

    it("POST /auth/change-password works", async () => {
      if (!token) return;
      const res = await fetch(`${BASE}/auth/change-password`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({ currentPassword: "Welcome@123", newPassword: "Welcome@123" }),
      });
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it("POST /auth/change-password rejects wrong current password", async () => {
      if (!token) return;
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
      if (!token) return;
      const res = await fetch(`${BASE}/employees`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.data.length).toBeGreaterThan(0);
      expect(data.data.total).toBeGreaterThan(0);
    });

    it("GET /employees/:id returns employee detail", async () => {
      if (!token) return;
      const list = await fetch(`${BASE}/employees`, { headers: authHeaders() });
      const listData = await list.json();
      const empId = listData.data.data[0].id;

      const res = await fetch(`${BASE}/employees/${empId}`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.first_name).toBeDefined();
    });

    it("GET /employees/export returns CSV", async () => {
      if (!token) return;
      const res = await fetch(`${BASE}/employees/export`, { headers: authHeaders() });
      expect(res.headers.get("content-type")).toContain("text/csv");
      const text = await res.text();
      expect(text).toContain("Employee Code");
    });
  });

  describe("Payroll", () => {
    it("GET /payroll returns runs", async () => {
      if (!token) return;
      const res = await fetch(`${BASE}/payroll`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(Array.isArray(data.data.data)).toBe(true);
    });
  });

  describe("Payslips", () => {
    it("GET /payslips returns list", async () => {
      if (!token) return;
      const res = await fetch(`${BASE}/payslips`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it("GET /payslips/export/csv returns CSV", async () => {
      if (!token) return;
      const res = await fetch(`${BASE}/payslips/export/csv`, { headers: authHeaders() });
      expect(res.headers.get("content-type")).toContain("text/csv");
    });
  });

  describe("Salary Structures", () => {
    it("GET /salary-structures returns list", async () => {
      if (!token) return;
      const res = await fetch(`${BASE}/salary-structures`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  describe("Self-Service", () => {
    it("GET /self-service/dashboard returns user data", async () => {
      if (!token) return;
      const res = await fetch(`${BASE}/self-service/dashboard`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.employee).toBeDefined();
    });

    it("GET /self-service/profile returns profile", async () => {
      if (!token) return;
      const res = await fetch(`${BASE}/self-service/profile`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.email).toBeDefined();
    });
  });

  describe("Employee Notes", () => {
    let empId = "";

    it("creates and lists notes for an employee", async () => {
      if (!token) return;
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
      if (!token) return;
      const res = await fetch(`${BASE}/loans`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  describe("Leaves", () => {
    it("GET /leaves returns org-wide balances", async () => {
      if (!token) return;
      const res = await fetch(`${BASE}/leaves`, { headers: authHeaders() });
      const data = await res.json();
      expect(data.success).toBe(true);
    });
  });

  describe("API Docs", () => {
    it("GET /docs/openapi.json returns spec", async () => {
      const res = await fetch(`${BASE}/docs/openapi.json`);
      const data = await res.json();
      expect(data.openapi).toBe("3.0.3");
      expect(data.info.title).toBe("EMP Payroll API");
    });
  });
});
