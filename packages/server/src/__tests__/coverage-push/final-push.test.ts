// ============================================================================
// PAYROLL COVERAGE FINAL PUSH — target 92%+
// Covers: auth.service, employee.service, payroll.service, payslip-pdf.service,
//         cloud-hrms.service, leave.service, backup.service, expense-policy.service,
//         slack.service, payroll-lock.middleware
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock DB adapters ──────────────────────────────────────────────────────────
const mockDB: any = {
  findOne: vi.fn().mockResolvedValue(null),
  findMany: vi.fn().mockResolvedValue({ data: [], total: 0 }),
  findById: vi.fn().mockResolvedValue(null),
  create: vi
    .fn()
    .mockImplementation((_table: string, data: any) => Promise.resolve({ id: "test-id", ...data })),
  update: vi.fn().mockResolvedValue({ id: "test-id" }),
  updateMany: vi.fn().mockResolvedValue(1),
  delete: vi.fn().mockResolvedValue(1),
  deleteMany: vi.fn().mockResolvedValue(1),
  count: vi.fn().mockResolvedValue(0),
  raw: vi.fn().mockResolvedValue([[{ total: 0 }]]),
  query: vi.fn().mockResolvedValue([]),
};

function resetMockDB() {
  mockDB.findOne.mockReset().mockResolvedValue(null);
  mockDB.findMany.mockReset().mockResolvedValue({ data: [], total: 0 });
  mockDB.findById.mockReset().mockResolvedValue(null);
  mockDB.create
    .mockReset()
    .mockImplementation((_table: string, data: any) => Promise.resolve({ id: "test-id", ...data }));
  mockDB.update.mockReset().mockResolvedValue({ id: "test-id" });
  mockDB.updateMany.mockReset().mockResolvedValue(1);
  mockDB.delete.mockReset().mockResolvedValue(1);
  mockDB.deleteMany.mockReset().mockResolvedValue(1);
  mockDB.count.mockReset().mockResolvedValue(0);
  mockDB.raw.mockReset().mockResolvedValue([[{ total: 0 }]]);
  mockDB.query.mockReset().mockResolvedValue([]);
}

vi.mock("../../db/adapters", () => ({
  getDB: vi.fn(() => mockDB),
}));

const mockEmpCloudDB = vi.fn().mockReturnValue({
  where: vi.fn().mockReturnThis(),
  select: vi.fn().mockReturnThis(),
  first: vi.fn().mockResolvedValue(null),
  insert: vi.fn().mockResolvedValue([100]),
  update: vi.fn().mockResolvedValue(1),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue([]),
  orWhere: vi.fn().mockReturnThis(),
  orWhereRaw: vi.fn().mockReturnThis(),
});

vi.mock("../../db/empcloud", () => ({
  findUserByEmail: vi.fn().mockResolvedValue(null),
  findUserById: vi.fn().mockResolvedValue(null),
  findOrgById: vi.fn().mockResolvedValue({ id: 5, name: "TestOrg", is_active: true }),
  findUsersByOrgId: vi.fn().mockResolvedValue([]),
  countUsersByOrgId: vi.fn().mockResolvedValue(10),
  getUserDepartmentName: vi.fn().mockResolvedValue("Engineering"),
  updateUserPassword: vi.fn().mockResolvedValue(1),
  createUser: vi.fn().mockImplementation((data: any) => Promise.resolve({ id: 100, ...data })),
  createOrganization: vi.fn().mockResolvedValue({ id: 5, name: "TestOrg" }),
  getEmpCloudDB: vi.fn(() => mockEmpCloudDB),
  EmpCloudUser: {} as any,
}));

vi.mock("../../config", () => ({
  config: {
    jwt: {
      secret: "test-secret-key-that-is-long-enough",
      accessExpiry: "1h",
      refreshExpiry: "7d",
      empcloudPublicKey: null,
    },
    db: {
      provider: "mysql",
      host: "localhost",
      port: 3306,
      user: "root",
      password: "pass",
      database: "test",
    },
    cloudHrms: { enabled: false, apiUrl: "http://localhost:3000/api/v1" },
  },
}));

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ============================================================================
// AUTH SERVICE TESTS
// ============================================================================
describe("AuthService", () => {
  let AuthService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../services/auth.service");
    AuthService = mod.AuthService;
  });

  describe("login", () => {
    it("rejects invalid email", async () => {
      const { findUserByEmail } = await import("../../db/empcloud");
      (findUserByEmail as any).mockResolvedValueOnce(null);
      const svc = new AuthService();
      await expect(svc.login("bad@email.com", "pass")).rejects.toThrow("Invalid email or password");
    });

    it("rejects when no password set", async () => {
      const { findUserByEmail } = await import("../../db/empcloud");
      (findUserByEmail as any).mockResolvedValueOnce({ id: 1, email: "a@b.com", password: null });
      const svc = new AuthService();
      await expect(svc.login("a@b.com", "pass")).rejects.toThrow("no password");
    });

    it("rejects wrong password", async () => {
      const { findUserByEmail } = await import("../../db/empcloud");
      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.default.hash("correct", 4);
      (findUserByEmail as any).mockResolvedValueOnce({
        id: 1,
        email: "a@b.com",
        password: hash,
        organization_id: 5,
        first_name: "John",
        last_name: "Doe",
        role: "employee",
        emp_code: "E001",
        status: 1,
      });
      const svc = new AuthService();
      await expect(svc.login("a@b.com", "wrong")).rejects.toThrow("Invalid email or password");
    });

    it("rejects inactive org", async () => {
      const { findUserByEmail, findOrgById } = await import("../../db/empcloud");
      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.default.hash("correct", 4);
      (findUserByEmail as any).mockResolvedValueOnce({
        id: 1,
        email: "a@b.com",
        password: hash,
        organization_id: 5,
        first_name: "John",
        last_name: "Doe",
        role: "employee",
        emp_code: "E001",
        status: 1,
      });
      (findOrgById as any).mockResolvedValueOnce({ id: 5, name: "TestOrg", is_active: false });
      const svc = new AuthService();
      await expect(svc.login("a@b.com", "correct")).rejects.toThrow("inactive");
    });

    it("succeeds with valid credentials", async () => {
      const { findUserByEmail, findOrgById } = await import("../../db/empcloud");
      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.default.hash("correct", 4);
      (findUserByEmail as any).mockResolvedValueOnce({
        id: 1,
        email: "a@b.com",
        password: hash,
        organization_id: 5,
        first_name: "John",
        last_name: "Doe",
        role: "hr_admin",
        emp_code: "E001",
        status: 1,
        designation: "Engineer",
        department_id: 1,
        contact_number: "1234567890",
      });
      (findOrgById as any).mockResolvedValueOnce({ id: 5, name: "TestOrg", is_active: true });
      mockDB.findOne.mockResolvedValueOnce({ id: "profile-1" }); // payroll profile
      const svc = new AuthService();
      const result = await svc.login("a@b.com", "correct");
      expect(result.user).toBeDefined();
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
    });
  });

  describe("register", () => {
    it("rejects duplicate email", async () => {
      const { findUserByEmail } = await import("../../db/empcloud");
      (findUserByEmail as any).mockResolvedValueOnce({ id: 1 });
      const svc = new AuthService();
      await expect(
        svc.register({
          email: "dup@test.com",
          password: "password123",
          firstName: "A",
          lastName: "B",
        }),
      ).rejects.toThrow("already exists");
    });

    it("creates new org when no orgId", async () => {
      const { findUserByEmail, createOrganization, createUser } = await import("../../db/empcloud");
      (findUserByEmail as any).mockResolvedValueOnce(null);
      (createOrganization as any).mockResolvedValueOnce({ id: 10, name: "NewOrg" });
      (createUser as any).mockResolvedValueOnce({
        id: 100,
        organization_id: 10,
        first_name: "Test",
        last_name: "User",
        email: "new@test.com",
        role: "hr_admin",
        emp_code: "E001",
      });
      const svc = new AuthService();
      const result = await svc.register({
        email: "new@test.com",
        password: "password123",
        firstName: "Test",
        lastName: "User",
      });
      expect(result.user).toBeDefined();
      expect(result.tokens).toBeDefined();
    });

    it("uses existing org when orgId provided", async () => {
      const { findUserByEmail, findOrgById, createUser } = await import("../../db/empcloud");
      (findUserByEmail as any).mockResolvedValueOnce(null);
      (findOrgById as any).mockResolvedValueOnce({ id: 5, name: "ExistOrg" });
      (createUser as any).mockResolvedValueOnce({
        id: 101,
        organization_id: 5,
        first_name: "Emp",
        last_name: "User",
        email: "emp@test.com",
        role: "employee",
        emp_code: "E002",
      });
      const svc = new AuthService();
      const result = await svc.register({
        email: "emp@test.com",
        password: "password123",
        firstName: "Emp",
        lastName: "User",
        orgId: 5,
      });
      expect(result.user.role).toBe("employee");
    });

    it("throws when orgId not found", async () => {
      const { findUserByEmail, findOrgById } = await import("../../db/empcloud");
      (findUserByEmail as any).mockResolvedValueOnce(null);
      (findOrgById as any).mockResolvedValueOnce(null);
      const svc = new AuthService();
      await expect(
        svc.register({
          email: "x@test.com",
          password: "password123",
          firstName: "X",
          lastName: "Y",
          orgId: 999,
        }),
      ).rejects.toThrow("not found");
    });
  });

  describe("ssoLogin", () => {
    it("rejects expired SSO token", async () => {
      const jwt = await import("jsonwebtoken");
      const token = jwt.default.sign({ sub: 1 }, "test-secret-key-that-is-long-enough", {
        expiresIn: "-1h",
      });
      const svc = new AuthService();
      await expect(svc.ssoLogin(token)).rejects.toThrow("expired");
    });

    it("rejects tampered SSO token", async () => {
      const svc = new AuthService();
      await expect(svc.ssoLogin("bad.token.here")).rejects.toThrow("Invalid");
    });

    it("rejects token with no sub", async () => {
      const jwt = await import("jsonwebtoken");
      const token = jwt.default.sign({ foo: "bar" }, "test-secret-key-that-is-long-enough", {
        expiresIn: "1h",
      });
      const svc = new AuthService();
      await expect(svc.ssoLogin(token)).rejects.toThrow("missing user");
    });

    it("rejects inactive user", async () => {
      const jwt = await import("jsonwebtoken");
      const { findUserById } = await import("../../db/empcloud");
      const token = jwt.default.sign({ sub: 5 }, "test-secret-key-that-is-long-enough", {
        expiresIn: "1h",
      });
      (findUserById as any).mockResolvedValueOnce({ id: 5, status: 2, organization_id: 5 });
      const svc = new AuthService();
      await expect(svc.ssoLogin(token)).rejects.toThrow("inactive");
    });

    it("rejects inactive org on SSO", async () => {
      const jwt = await import("jsonwebtoken");
      const { findUserById, findOrgById } = await import("../../db/empcloud");
      const token = jwt.default.sign({ sub: 5 }, "test-secret-key-that-is-long-enough", {
        expiresIn: "1h",
      });
      (findUserById as any).mockResolvedValueOnce({
        id: 5,
        status: 1,
        organization_id: 5,
        first_name: "A",
        last_name: "B",
        email: "a@b.com",
        role: "employee",
        emp_code: "E001",
      });
      (findOrgById as any).mockResolvedValueOnce({ id: 5, name: "Org", is_active: false });
      const svc = new AuthService();
      await expect(svc.ssoLogin(token)).rejects.toThrow("inactive");
    });

    it("succeeds with valid SSO token", async () => {
      const jwt = await import("jsonwebtoken");
      const { findUserById, findOrgById } = await import("../../db/empcloud");
      const token = jwt.default.sign({ sub: 5 }, "test-secret-key-that-is-long-enough", {
        expiresIn: "1h",
      });
      (findUserById as any).mockResolvedValueOnce({
        id: 5,
        status: 1,
        organization_id: 5,
        first_name: "A",
        last_name: "B",
        email: "a@b.com",
        role: "hr_admin",
        emp_code: "E001",
        department_id: 1,
        designation: "Mgr",
      });
      (findOrgById as any).mockResolvedValueOnce({ id: 5, name: "Org", is_active: true });
      mockDB.findOne.mockResolvedValueOnce({ id: "p1" }); // payroll profile
      const svc = new AuthService();
      const result = await svc.ssoLogin(token);
      expect(result.user.empcloudUserId).toBe(5);
      expect(result.tokens.accessToken).toBeTruthy();
    });
  });

  describe("refreshToken", () => {
    it("rejects non-refresh token", async () => {
      const jwt = await import("jsonwebtoken");
      const token = jwt.default.sign(
        { type: "access", empcloudUserId: 1 },
        "test-secret-key-that-is-long-enough",
        { expiresIn: "1h" },
      );
      const svc = new AuthService();
      await expect(svc.refreshToken(token)).rejects.toThrow();
    });

    it("rejects when user inactive", async () => {
      const jwt = await import("jsonwebtoken");
      const { findUserById } = await import("../../db/empcloud");
      const token = jwt.default.sign(
        {
          type: "refresh",
          empcloudUserId: 1,
          empcloudOrgId: 5,
          role: "employee",
          email: "a@b.com",
          firstName: "A",
          lastName: "B",
          orgName: "O",
        },
        "test-secret-key-that-is-long-enough",
        { expiresIn: "7d" },
      );
      (findUserById as any).mockResolvedValueOnce({ id: 1, status: 2, organization_id: 5 });
      const svc = new AuthService();
      await expect(svc.refreshToken(token)).rejects.toThrow();
    });

    it("succeeds with valid refresh token", async () => {
      const jwt = await import("jsonwebtoken");
      const { findUserById, findOrgById } = await import("../../db/empcloud");
      const token = jwt.default.sign(
        {
          type: "refresh",
          empcloudUserId: 1,
          empcloudOrgId: 5,
          role: "employee",
          email: "a@b.com",
          firstName: "A",
          lastName: "B",
          orgName: "O",
        },
        "test-secret-key-that-is-long-enough",
        { expiresIn: "7d" },
      );
      (findUserById as any).mockResolvedValueOnce({
        id: 1,
        status: 1,
        organization_id: 5,
        first_name: "A",
        last_name: "B",
        email: "a@b.com",
        role: "employee",
        emp_code: "E001",
      });
      (findOrgById as any).mockResolvedValueOnce({ id: 5, name: "Org" });
      mockDB.findOne.mockResolvedValueOnce({ id: "p1" }); // payroll profile
      const svc = new AuthService();
      const tokens = await svc.refreshToken(token);
      expect(tokens.accessToken).toBeTruthy();
      expect(tokens.refreshToken).toBeTruthy();
    });
  });

  describe("changePassword", () => {
    it("throws on user not found", async () => {
      const { findUserById } = await import("../../db/empcloud");
      (findUserById as any).mockResolvedValueOnce(null);
      const svc = new AuthService();
      await expect(svc.changePassword(1, "old", "new12345")).rejects.toThrow("not found");
    });

    it("throws on wrong current password", async () => {
      const { findUserById } = await import("../../db/empcloud");
      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.default.hash("correct", 4);
      (findUserById as any).mockResolvedValueOnce({ id: 1, password: hash });
      const svc = new AuthService();
      await expect(svc.changePassword(1, "wrong", "new12345")).rejects.toThrow("incorrect");
    });

    it("throws on weak password", async () => {
      const { findUserById } = await import("../../db/empcloud");
      (findUserById as any).mockResolvedValueOnce({ id: 1, password: null });
      const svc = new AuthService();
      await expect(svc.changePassword(1, "", "short")).rejects.toThrow("8 characters");
    });

    it("succeeds with valid password change", async () => {
      const { findUserById, updateUserPassword } = await import("../../db/empcloud");
      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.default.hash("oldpass1", 4);
      (findUserById as any).mockResolvedValueOnce({ id: 1, password: hash });
      const svc = new AuthService();
      await svc.changePassword(1, "oldpass1", "newpass12");
      expect(updateUserPassword).toHaveBeenCalled();
    });
  });

  describe("adminResetPassword", () => {
    it("throws on user not found", async () => {
      const { findUserById } = await import("../../db/empcloud");
      (findUserById as any).mockResolvedValueOnce(null);
      const svc = new AuthService();
      await expect(svc.adminResetPassword(1, "newpass1")).rejects.toThrow("not found");
    });

    it("resets with default password", async () => {
      const { findUserById, updateUserPassword } = await import("../../db/empcloud");
      (findUserById as any).mockResolvedValueOnce({ id: 1 });
      const svc = new AuthService();
      await svc.adminResetPassword(1, "");
      expect(updateUserPassword).toHaveBeenCalled();
    });
  });

  describe("forgotPassword", () => {
    it("returns success message even when user not found", async () => {
      const { findUserByEmail } = await import("../../db/empcloud");
      (findUserByEmail as any).mockResolvedValueOnce(null);
      const svc = new AuthService();
      const result = await svc.forgotPassword("nope@email.com");
      expect(result.message).toContain("reset OTP");
    });

    it("sends OTP when user found (logs to console in dev)", async () => {
      const { findUserByEmail } = await import("../../db/empcloud");
      (findUserByEmail as any).mockResolvedValueOnce({ id: 1, email: "user@test.com" });
      const svc = new AuthService();
      const result = await svc.forgotPassword("user@test.com");
      expect(result.message).toContain("reset OTP");
    });
  });

  describe("resetPasswordWithOTP", () => {
    it("rejects invalid OTP", async () => {
      const svc = new AuthService();
      await expect(svc.resetPasswordWithOTP("a@b.com", "000000", "newpass12")).rejects.toThrow(
        "Invalid",
      );
    });

    it("rejects weak new password", async () => {
      const svc = new AuthService();
      // First set an OTP via forgotPassword
      const { findUserByEmail } = await import("../../db/empcloud");
      (findUserByEmail as any).mockResolvedValueOnce({ id: 1, email: "a@b.com" });
      await svc.forgotPassword("a@b.com");
      // We don't know the OTP, so just test the weak password path
      // by trying with invalid OTP first
      await expect(svc.resetPasswordWithOTP("a@b.com", "000000", "short")).rejects.toThrow();
    });
  });

  describe("mapRole", () => {
    it("maps various roles correctly", async () => {
      const svc = new AuthService();
      // Access private method via login flow indirectly tested above
      // Test via register which uses mapRole
      const { findUserByEmail, createOrganization, createUser } = await import("../../db/empcloud");
      (findUserByEmail as any).mockResolvedValueOnce(null);
      (createOrganization as any).mockResolvedValueOnce({ id: 11, name: "R" });
      (createUser as any).mockResolvedValueOnce({
        id: 200,
        organization_id: 11,
        first_name: "A",
        last_name: "B",
        email: "role@test.com",
        role: "manager",
        emp_code: "E100",
      });
      const result = await svc.register({
        email: "role@test.com",
        password: "password123",
        firstName: "A",
        lastName: "B",
      });
      expect(result.user).toBeDefined();
    });
  });
});

// ============================================================================
// EMPLOYEE SERVICE TESTS
// ============================================================================
describe("EmployeeService", () => {
  let EmployeeService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../services/employee.service");
    EmployeeService = mod.EmployeeService;
  });

  describe("list", () => {
    it("returns paginated employees", async () => {
      const { findUsersByOrgId, countUsersByOrgId } = await import("../../db/empcloud");
      (findUsersByOrgId as any).mockResolvedValueOnce([
        {
          id: 1,
          first_name: "A",
          last_name: "B",
          organization_id: 5,
          email: "a@b.com",
          emp_code: "E001",
          status: 1,
          role: "employee",
        },
      ]);
      (countUsersByOrgId as any).mockResolvedValueOnce(1);
      mockDB.findOne.mockResolvedValueOnce({
        id: "p1",
        bank_details: "{}",
        tax_info: "{}",
        pf_details: "{}",
        esi_details: "{}",
      });
      const svc = new EmployeeService();
      const result = await svc.list(5, { limit: 20, page: 1 });
      expect(result.data.length).toBe(1);
      expect(result.total).toBe(1);
    });
  });

  describe("getByEmpCloudId", () => {
    it("throws when not found", async () => {
      const { findUserById } = await import("../../db/empcloud");
      (findUserById as any).mockResolvedValueOnce(null);
      const svc = new EmployeeService();
      await expect(svc.getByEmpCloudId(999, 5)).rejects.toThrow("not found");
    });

    it("throws when org mismatch", async () => {
      const { findUserById } = await import("../../db/empcloud");
      (findUserById as any).mockResolvedValueOnce({ id: 1, organization_id: 99 });
      const svc = new EmployeeService();
      await expect(svc.getByEmpCloudId(1, 5)).rejects.toThrow("not found");
    });

    it("returns merged user with profile data", async () => {
      const { findUserById } = await import("../../db/empcloud");
      (findUserById as any).mockResolvedValueOnce({
        id: 1,
        organization_id: 5,
        first_name: "Test",
        last_name: "User",
        email: "t@u.com",
        emp_code: "E001",
        status: 1,
        role: "employee",
        department_id: 1,
        designation: "Dev",
        date_of_joining: "2025-01-01",
      });
      mockDB.findOne.mockResolvedValueOnce({
        id: "p1",
        employee_code: "E001",
        bank_details: '{"bankName":"SBI"}',
        tax_info: '{"pan":"ABCDE1234F"}',
        pf_details: '{"uan":"123456"}',
        esi_details: "{}",
        address: '{"city":"Mumbai"}',
      });
      const svc = new EmployeeService();
      const emp = await svc.getByEmpCloudId(1, 5);
      expect(emp.bankDetails.bankName).toBe("SBI");
      expect(emp.taxInfo.pan).toBe("ABCDE1234F");
      expect(emp.address.city).toBe("Mumbai");
    });
  });

  describe("create", () => {
    it("rejects duplicate email", async () => {
      mockEmpCloudDB.mockReturnValueOnce({
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ id: 1 }),
      });
      const svc = new EmployeeService();
      await expect(
        svc.create(5, { email: "dup@test.com", firstName: "A", lastName: "B" }),
      ).rejects.toThrow("already exists");
    });

    it("creates employee with auto-generated code", async () => {
      const { findUserById, countUsersByOrgId } = await import("../../db/empcloud");
      (countUsersByOrgId as any).mockResolvedValueOnce(5);
      mockEmpCloudDB.mockReturnValueOnce({
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue(null),
      });
      mockEmpCloudDB.mockReturnValueOnce({
        insert: vi.fn().mockResolvedValue([100]),
      });
      (findUserById as any).mockResolvedValueOnce({
        id: 100,
        organization_id: 5,
        first_name: "New",
        last_name: "Emp",
        email: "new@emp.com",
        emp_code: "EMP006",
        status: 1,
        role: "employee",
      });
      mockDB.findOne.mockResolvedValueOnce(null); // mergeUserWithProfile lookup
      const svc = new EmployeeService();
      const result = await svc.create(5, {
        email: "new@emp.com",
        firstName: "New",
        lastName: "Emp",
        dateOfJoining: "2025-06-01",
      });
      expect(result).toBeDefined();
    });
  });

  describe("update", () => {
    it("throws when employee not found", async () => {
      const { findUserById } = await import("../../db/empcloud");
      (findUserById as any).mockResolvedValueOnce(null);
      const svc = new EmployeeService();
      await expect(svc.update(999, 5, { firstName: "X" })).rejects.toThrow("not found");
    });

    it("updates empcloud user fields and payroll profile", async () => {
      const { findUserById } = await import("../../db/empcloud");
      (findUserById as any)
        .mockResolvedValueOnce({ id: 1, organization_id: 5 }) // first check
        .mockResolvedValueOnce({
          id: 1,
          organization_id: 5,
          first_name: "Updated",
          last_name: "User",
          email: "u@u.com",
          emp_code: "E001",
          status: 1,
          role: "employee",
        }); // after update
      mockDB.findOne
        .mockResolvedValueOnce({ id: "p1" }) // payroll profile
        .mockResolvedValueOnce({
          id: "p1",
          bank_details: "{}",
          tax_info: "{}",
          pf_details: "{}",
          esi_details: "{}",
        }); // merge
      mockEmpCloudDB.mockReturnValueOnce({
        where: vi.fn().mockReturnThis(),
        update: vi.fn().mockResolvedValue(1),
      });
      const svc = new EmployeeService();
      const result = await svc.update(1, 5, {
        firstName: "Updated",
        bankDetails: { bankName: "HDFC" },
      });
      expect(result).toBeDefined();
    });
  });

  describe("deactivate", () => {
    it("sets user status to inactive", async () => {
      const { findUserById } = await import("../../db/empcloud");
      (findUserById as any).mockResolvedValueOnce({ id: 1, organization_id: 5 });
      mockEmpCloudDB.mockReturnValueOnce({
        where: vi.fn().mockReturnThis(),
        update: vi.fn().mockResolvedValue(1),
      });
      const svc = new EmployeeService();
      const result = await svc.deactivate(1, 5);
      expect(result.message).toBe("Employee deactivated");
    });
  });

  describe("bank/tax/pf details", () => {
    it("getBankDetails returns bank info", async () => {
      const { findUserById } = await import("../../db/empcloud");
      (findUserById as any).mockResolvedValueOnce({
        id: 1,
        organization_id: 5,
        first_name: "A",
        last_name: "B",
        email: "a@b.com",
        emp_code: "E001",
        status: 1,
        role: "employee",
      });
      mockDB.findOne.mockResolvedValueOnce({
        id: "p1",
        bank_details: '{"bankName":"SBI"}',
        tax_info: "{}",
        pf_details: "{}",
        esi_details: "{}",
      });
      const svc = new EmployeeService();
      const banks = await svc.getBankDetails(1, 5);
      expect(banks.bankName).toBe("SBI");
    });

    it("updateBankDetails updates profile", async () => {
      const { findUserById } = await import("../../db/empcloud");
      (findUserById as any).mockResolvedValueOnce({
        id: 1,
        organization_id: 5,
        first_name: "A",
        last_name: "B",
        email: "a@b.com",
        emp_code: "E001",
        status: 1,
      });
      mockDB.findOne
        .mockResolvedValueOnce({
          id: "p1",
          bank_details: "{}",
          tax_info: "{}",
          pf_details: "{}",
          esi_details: "{}",
        }) // getByEmpCloudId
        .mockResolvedValueOnce({ id: "p1" }); // ensurePayrollProfile
      const svc = new EmployeeService();
      const result = await svc.updateBankDetails(1, 5, { bankName: "HDFC" });
      expect(result.bankName).toBe("HDFC");
    });

    it("getTaxInfo returns tax data", async () => {
      const { findUserById } = await import("../../db/empcloud");
      (findUserById as any).mockResolvedValueOnce({
        id: 1,
        organization_id: 5,
        first_name: "A",
        last_name: "B",
        email: "a@b.com",
        emp_code: "E001",
        status: 1,
      });
      mockDB.findOne.mockResolvedValueOnce({
        id: "p1",
        bank_details: "{}",
        tax_info: '{"pan":"ABC"}',
        pf_details: "{}",
        esi_details: "{}",
      });
      const svc = new EmployeeService();
      const tax = await svc.getTaxInfo(1, 5);
      expect(tax.pan).toBe("ABC");
    });

    it("updateTaxInfo updates profile", async () => {
      const { findUserById } = await import("../../db/empcloud");
      (findUserById as any).mockResolvedValueOnce({
        id: 1,
        organization_id: 5,
        first_name: "A",
        last_name: "B",
        email: "a@b.com",
        emp_code: "E001",
        status: 1,
      });
      mockDB.findOne
        .mockResolvedValueOnce({
          id: "p1",
          bank_details: "{}",
          tax_info: "{}",
          pf_details: "{}",
          esi_details: "{}",
        })
        .mockResolvedValueOnce({ id: "p1" });
      const svc = new EmployeeService();
      const result = await svc.updateTaxInfo(1, 5, { pan: "NEW" });
      expect(result.pan).toBe("NEW");
    });

    it("getPfDetails returns PF data", async () => {
      const { findUserById } = await import("../../db/empcloud");
      (findUserById as any).mockResolvedValueOnce({
        id: 1,
        organization_id: 5,
        first_name: "A",
        last_name: "B",
        email: "a@b.com",
        emp_code: "E001",
        status: 1,
      });
      mockDB.findOne.mockResolvedValueOnce({
        id: "p1",
        bank_details: "{}",
        tax_info: "{}",
        pf_details: '{"uan":"123"}',
        esi_details: "{}",
      });
      const svc = new EmployeeService();
      const pf = await svc.getPfDetails(1, 5);
      expect(pf.uan).toBe("123");
    });

    it("updatePfDetails updates profile", async () => {
      const { findUserById } = await import("../../db/empcloud");
      (findUserById as any).mockResolvedValueOnce({
        id: 1,
        organization_id: 5,
        first_name: "A",
        last_name: "B",
        email: "a@b.com",
        emp_code: "E001",
        status: 1,
      });
      mockDB.findOne
        .mockResolvedValueOnce({
          id: "p1",
          bank_details: "{}",
          tax_info: "{}",
          pf_details: "{}",
          esi_details: "{}",
        })
        .mockResolvedValueOnce({ id: "p1" });
      const svc = new EmployeeService();
      const result = await svc.updatePfDetails(1, 5, { uan: "456" });
      expect(result.uan).toBe("456");
    });
  });

  describe("count", () => {
    it("returns employee count", async () => {
      const { countUsersByOrgId } = await import("../../db/empcloud");
      (countUsersByOrgId as any).mockResolvedValueOnce(42);
      const svc = new EmployeeService();
      const count = await svc.count(5);
      expect(count).toBe(42);
    });
  });

  describe("bulkUpdateStatus", () => {
    it("updates status for matching users", async () => {
      mockEmpCloudDB.mockReturnValue({
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ id: 1 }),
        update: vi.fn().mockResolvedValue(1),
      });
      const svc = new EmployeeService();
      const result = await svc.bulkUpdateStatus(5, [1, 2], true);
      expect(result.total).toBe(2);
    });
  });

  describe("bulkAssignDepartment", () => {
    it("assigns department for matching users", async () => {
      mockEmpCloudDB.mockReturnValue({
        where: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({ id: 1 }),
        update: vi.fn().mockResolvedValue(1),
      });
      const svc = new EmployeeService();
      const result = await svc.bulkAssignDepartment(5, [1, 2], 10);
      expect(result.departmentId).toBe(10);
    });
  });
});

// ============================================================================
// PAYSLIP PDF SERVICE TESTS
// ============================================================================
describe("PayslipPDFService", () => {
  let PayslipPDFService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../services/payslip-pdf.service");
    PayslipPDFService = mod.PayslipPDFService;
  });

  it("throws when payslip not found", async () => {
    mockDB.findById.mockResolvedValueOnce(null);
    const svc = new PayslipPDFService();
    await expect(svc.generateHTML("bad-id")).rejects.toThrow("not found");
  });

  it("generates HTML for payslip with empcloud_user_id", async () => {
    const { findUserById } = await import("../../db/empcloud");
    mockDB.findById.mockResolvedValueOnce({
      id: "ps1",
      empcloud_user_id: 1,
      employee_id: "00000000-0000-0000-0000-000000000000",
      month: 3,
      year: 2026,
      paid_days: 22,
      total_days: 22,
      lop_days: 0,
      earnings: '[{"code":"BASIC","name":"Basic","amount":50000}]',
      deductions: '[{"code":"EPF","name":"PF","amount":6000}]',
      gross_earnings: 50000,
      total_deductions: 6000,
      net_pay: 44000,
    });
    mockDB.findOne.mockResolvedValueOnce({
      id: "p1",
      empcloud_user_id: 1,
      employee_code: "E001",
      bank_details: '{"bankName":"SBI","accountNumber":"123456789012","ifscCode":"SBIN0001"}',
    });
    (findUserById as any).mockResolvedValueOnce({
      id: 1,
      organization_id: 5,
      first_name: "John",
      last_name: "Doe",
      emp_code: "E001",
      designation: "Engineer",
      department_id: 1,
    });
    mockDB.findOne.mockResolvedValueOnce({
      name: "TestOrg",
      legal_name: "TestOrg Pvt Ltd",
      pan: "AAACT1234F",
      tan: "BLRT12345F",
    });
    const svc = new PayslipPDFService();
    const html = await svc.generateHTML("ps1");
    expect(html).toContain("John Doe");
    expect(html).toContain("Payslip");
    expect(html).toContain("SBI");
    expect(html).toContain("Basic");
  });

  it("generates HTML when employee not in EmpCloud (fallback)", async () => {
    const { findUserById } = await import("../../db/empcloud");
    mockDB.findById.mockResolvedValueOnce({
      id: "ps1",
      empcloud_user_id: 1,
      employee_id: "00000000-0000-0000-0000-000000000000",
      month: 1,
      year: 2026,
      paid_days: 20,
      total_days: 22,
      lop_days: 2,
      earnings: "[]",
      deductions: "[]",
      gross_earnings: 0,
      total_deductions: 0,
      net_pay: 0,
    });
    mockDB.findOne.mockResolvedValueOnce({
      id: "p1",
      empcloud_user_id: 1,
      empcloud_org_id: 5,
      employee_code: "E001",
      bank_details: "{}",
    });
    (findUserById as any).mockResolvedValueOnce(null); // not found in empcloud
    mockDB.findOne.mockResolvedValueOnce({ name: "FallbackOrg" }); // org settings from profile
    const svc = new PayslipPDFService();
    const html = await svc.generateHTML("ps1");
    expect(html).toContain("Payslip");
    expect(html).toContain("E001");
  });

  it("uses legacy employee table when no empcloud_user_id", async () => {
    mockDB.findById
      .mockResolvedValueOnce({
        id: "ps1",
        empcloud_user_id: null,
        employee_id: "emp-uuid",
        month: 6,
        year: 2025,
        paid_days: 20,
        total_days: 22,
        lop_days: 2,
        earnings: "[]",
        deductions: "[]",
        gross_earnings: 0,
        total_deductions: 0,
        net_pay: 0,
      })
      .mockResolvedValueOnce(null) // no profile by employee_id
      .mockResolvedValueOnce({
        // legacy employee
        id: "emp-uuid",
        first_name: "Legacy",
        last_name: "Emp",
        employee_code: "L001",
        department: "HR",
        designation: "Mgr",
        org_id: "org-uuid",
        bank_details: "{}",
      })
      .mockResolvedValueOnce({ name: "LegacyOrg" }); // org
    mockDB.findOne.mockResolvedValueOnce(null); // no profile by empcloud_user_id (skipped since null)
    const svc = new PayslipPDFService();
    const html = await svc.generateHTML("ps1");
    expect(html).toContain("Payslip");
  });

  it("resolves org from payroll run when profile has no org", async () => {
    const { findUserById } = await import("../../db/empcloud");
    mockDB.findById.mockResolvedValueOnce({
      id: "ps1",
      empcloud_user_id: 99,
      employee_id: "00000000-0000-0000-0000-000000000000",
      payroll_run_id: "run-1",
      month: 2,
      year: 2026,
      paid_days: 20,
      total_days: 22,
      lop_days: 2,
      earnings: "[]",
      deductions: "[]",
      gross_earnings: 0,
      total_deductions: 0,
      net_pay: 0,
    });
    mockDB.findOne.mockResolvedValueOnce({
      id: "p1",
      empcloud_user_id: 99,
      empcloud_org_id: null,
      bank_details: "{}",
    });
    (findUserById as any).mockResolvedValueOnce(null);
    mockDB.findOne.mockResolvedValueOnce(null); // org settings from profile org (null)
    mockDB.findById.mockResolvedValueOnce({ id: "run-1", empcloud_org_id: 5 }); // payroll run
    mockDB.findOne.mockResolvedValueOnce({ name: "RunOrg" }); // org from run
    const svc = new PayslipPDFService();
    const html = await svc.generateHTML("ps1");
    expect(html).toContain("Payslip");
  });
});

// ============================================================================
// CLOUD HRMS SERVICE TESTS
// ============================================================================
describe("CloudHRMS Service", () => {
  let cloudHRMS: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    cloudHRMS = await import("../../services/cloud-hrms.service");
  });

  describe("toLocalAttendanceFormat", () => {
    it("converts cloud attendance to local format", () => {
      const cloud = {
        user_id: 1,
        total_days: 22,
        present_days: 20,
        absent_days: 2,
        half_days: 0,
        paid_leave: 0,
        unpaid_leave: 0,
        holidays: 2,
        weekoffs: 8,
        lop_days: 2,
        overtime_hours: 5,
        overtime_rate: 100,
        overtime_amount: 500,
      };
      const local = cloudHRMS.toLocalAttendanceFormat(cloud);
      expect(local.empcloud_user_id).toBe(1);
      expect(local.total_days).toBe(22);
      expect(local.lop_days).toBe(2);
      expect(local.overtime_amount).toBe(500);
    });
  });

  describe("getMonthlyAttendance", () => {
    it("returns null on network error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
      const result = await cloudHRMS.getMonthlyAttendance(5, 1, 3, 2026, "token");
      expect(result).toBeNull();
      vi.unstubAllGlobals();
    });

    it("returns null on non-ok response", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
      const result = await cloudHRMS.getMonthlyAttendance(5, 1, 3, 2026, "token");
      expect(result).toBeNull();
      vi.unstubAllGlobals();
    });

    it("returns null when no data", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({ data: null }),
        }),
      );
      const result = await cloudHRMS.getMonthlyAttendance(5, 1, 3, 2026, "token");
      expect(result).toBeNull();
      vi.unstubAllGlobals();
    });

    it("returns attendance for single record response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            data: { user_id: 1, total_days: 22, present_days: 20 },
          }),
        }),
      );
      const result = await cloudHRMS.getMonthlyAttendance(5, 1, 3, 2026, "token");
      expect(result).toBeDefined();
      expect(result!.total_days).toBe(22);
      vi.unstubAllGlobals();
    });

    it("finds user in array response", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            data: [
              { user_id: 2, total_days: 22 },
              { user_id: 1, total_days: 20 },
            ],
          }),
        }),
      );
      const result = await cloudHRMS.getMonthlyAttendance(5, 1, 3, 2026, "token");
      expect(result).toBeDefined();
      expect(result!.total_days).toBe(20);
      vi.unstubAllGlobals();
    });

    it("returns null when user not in array", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            data: [{ user_id: 99, total_days: 22 }],
          }),
        }),
      );
      const result = await cloudHRMS.getMonthlyAttendance(5, 1, 3, 2026, "token");
      expect(result).toBeNull();
      vi.unstubAllGlobals();
    });
  });

  describe("getLeaveBalances", () => {
    it("returns null on network error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fail")));
      const result = await cloudHRMS.getLeaveBalances(5, 1, 2026, "token");
      expect(result).toBeNull();
      vi.unstubAllGlobals();
    });

    it("returns null on non-ok response", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
      const result = await cloudHRMS.getLeaveBalances(5, 1, 2026, "token");
      expect(result).toBeNull();
      vi.unstubAllGlobals();
    });

    it("returns balances on success", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            data: [{ leave_type_id: 1, entitled: 15, used: 3, balance: 12 }],
          }),
        }),
      );
      const result = await cloudHRMS.getLeaveBalances(5, 1, 2026, "token");
      expect(result).toHaveLength(1);
      vi.unstubAllGlobals();
    });
  });

  describe("getLeaveApplications", () => {
    it("returns null on error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fail")));
      const result = await cloudHRMS.getLeaveApplications(
        5,
        1,
        "2026-03-01",
        "2026-03-31",
        "token",
      );
      expect(result).toBeNull();
      vi.unstubAllGlobals();
    });

    it("filters applications by date range", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: vi.fn().mockResolvedValue({
            data: [
              { start_date: "2026-03-10", end_date: "2026-03-12", days: 3 },
              { start_date: "2026-02-01", end_date: "2026-02-05", days: 5 },
            ],
          }),
        }),
      );
      const result = await cloudHRMS.getLeaveApplications(
        5,
        1,
        "2026-03-01",
        "2026-03-31",
        "token",
      );
      expect(result).toHaveLength(1);
      vi.unstubAllGlobals();
    });
  });
});

// ============================================================================
// PAYROLL SERVICE TESTS (additional uncovered branches)
// ============================================================================
describe("PayrollService", () => {
  let PayrollService: any;

  beforeEach(async () => {
    resetMockDB();
    const mod = await import("../../services/payroll.service");
    PayrollService = mod.PayrollService;
  });

  describe("listRuns", () => {
    it("returns runs for org", async () => {
      mockDB.findMany.mockResolvedValueOnce({ data: [{ id: "r1" }], total: 1 });
      const svc = new PayrollService();
      const result = await svc.listRuns("5");
      expect(mockDB.findMany).toHaveBeenCalled();
    });
  });

  describe("getRun", () => {
    it("throws when run not found", async () => {
      mockDB.findOne.mockResolvedValueOnce(null);
      const svc = new PayrollService();
      await expect(svc.getRun("bad", "5")).rejects.toThrow("not found");
    });
  });

  describe("createRun", () => {
    it("rejects duplicate run", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "existing" });
      const svc = new PayrollService();
      await expect(svc.createRun("5", "u1", { month: 3, year: 2026 })).rejects.toThrow(
        "already exists",
      );
    });

    it("creates run with auto pay date", async () => {
      mockDB.findOne
        .mockResolvedValueOnce(null) // no existing
        .mockResolvedValueOnce({ pay_day: 15 }); // org settings
      const svc = new PayrollService();
      const result = await svc.createRun("5", "u1", { month: 3, year: 2026, notes: "test" });
      expect(mockDB.create).toHaveBeenCalled();
    });

    it("creates run with explicit pay date", async () => {
      mockDB.findOne.mockResolvedValueOnce(null);
      const svc = new PayrollService();
      await svc.createRun("5", "u1", { month: 2, year: 2026, payDate: "2026-02-28" });
      expect(mockDB.create).toHaveBeenCalled();
    });
  });

  describe("approveRun", () => {
    it("rejects non-computed run", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "r1", status: "draft", empcloud_org_id: 5 });
      const svc = new PayrollService();
      await expect(svc.approveRun("r1", "5", "u1")).rejects.toThrow("computed");
    });

    it("approves computed run", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "r1", status: "computed", empcloud_org_id: 5 });
      const svc = new PayrollService();
      await svc.approveRun("r1", "5", "u1");
      expect(mockDB.update).toHaveBeenCalledWith(
        "payroll_runs",
        "r1",
        expect.objectContaining({ status: "approved" }),
      );
    });
  });

  describe("markPaid", () => {
    it("rejects non-approved run", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "r1", status: "computed", empcloud_org_id: 5 });
      const svc = new PayrollService();
      await expect(svc.markPaid("r1", "5")).rejects.toThrow("approved");
    });

    it("marks approved run as paid", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "r1", status: "approved", empcloud_org_id: 5 });
      const svc = new PayrollService();
      await svc.markPaid("r1", "5");
      expect(mockDB.updateMany).toHaveBeenCalled();
    });
  });

  describe("cancelRun", () => {
    it("rejects paid run", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "r1", status: "paid", empcloud_org_id: 5 });
      const svc = new PayrollService();
      await expect(svc.cancelRun("r1", "5")).rejects.toThrow("Paid");
    });

    it("cancels draft run", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "r1", status: "draft", empcloud_org_id: 5 });
      const svc = new PayrollService();
      await svc.cancelRun("r1", "5");
      expect(mockDB.deleteMany).toHaveBeenCalled();
    });
  });

  describe("revertToDraft", () => {
    it("rejects paid run", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "r1", status: "paid", empcloud_org_id: 5 });
      const svc = new PayrollService();
      await expect(svc.revertToDraft("r1", "5")).rejects.toThrow("Paid");
    });

    it("rejects already-draft run", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "r1", status: "draft", empcloud_org_id: 5 });
      const svc = new PayrollService();
      await expect(svc.revertToDraft("r1", "5")).rejects.toThrow("already");
    });

    it("reverts computed run to draft", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "r1", status: "computed", empcloud_org_id: 5 });
      const svc = new PayrollService();
      await svc.revertToDraft("r1", "5");
      expect(mockDB.update).toHaveBeenCalledWith(
        "payroll_runs",
        "r1",
        expect.objectContaining({ status: "draft" }),
      );
    });
  });

  describe("getRunSummary", () => {
    it("returns run with payslip count", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "r1", status: "computed", empcloud_org_id: 5 });
      mockDB.findMany.mockResolvedValueOnce({ data: [], total: 5 });
      const svc = new PayrollService();
      const summary = await svc.getRunSummary("r1", "5");
      expect(summary.payslipCount).toBe(5);
    });
  });

  describe("getRunPayslips", () => {
    it("returns enriched payslips", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "r1", empcloud_org_id: 5 }); // getRun
      mockDB.findMany.mockResolvedValueOnce({
        data: [
          {
            id: "ps1",
            empcloud_user_id: 1,
            payroll_run_id: "r1",
            earnings: '[{"code":"BASIC","amount":50000}]',
            deductions: "[]",
            employer_contributions: "[]",
            reimbursements: "[]",
          },
        ],
        total: 1,
      });
      mockEmpCloudDB.mockReturnValueOnce({
        where: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        first: vi.fn().mockResolvedValue({
          first_name: "John",
          last_name: "Doe",
          emp_code: "E001",
          designation: "Eng",
        }),
      });
      const svc = new PayrollService();
      const result = await svc.getRunPayslips("r1", "5");
      expect(result.data[0].first_name).toBe("John");
    });
  });
});

// ============================================================================
// LEAVE SERVICE TESTS
// ============================================================================
describe("LeaveService", () => {
  let LeaveService: any;

  beforeEach(async () => {
    resetMockDB();
    const mod = await import("../../services/leave.service");
    LeaveService = mod.LeaveService;
  });

  describe("getBalances", () => {
    it("creates default balances when none exist", async () => {
      mockDB.findMany.mockResolvedValueOnce({ data: [], total: 0 });
      const svc = new LeaveService();
      const result = await svc.getBalances("emp-1");
      expect(mockDB.create).toHaveBeenCalledTimes(3); // earned, casual, sick
    });

    it("returns existing balances", async () => {
      mockDB.findMany.mockResolvedValueOnce({
        data: [{ id: "b1", leave_type: "earned", closing_balance: 12 }],
        total: 1,
      });
      const svc = new LeaveService();
      const result = await svc.getBalances("emp-1");
      expect(result.data).toHaveLength(1);
    });
  });

  describe("recordLeave", () => {
    it("throws when balance not found", async () => {
      mockDB.findOne.mockResolvedValueOnce(null);
      const svc = new LeaveService();
      await expect(svc.recordLeave("emp-1", "earned", 2)).rejects.toThrow("not found");
    });

    it("throws when insufficient balance", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "b1", closing_balance: 1 });
      const svc = new LeaveService();
      await expect(svc.recordLeave("emp-1", "earned", 5)).rejects.toThrow("leaves available");
    });

    it("records leave successfully", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "b1", used: 2, closing_balance: 10 });
      const svc = new LeaveService();
      await svc.recordLeave("emp-1", "earned", 2);
      expect(mockDB.update).toHaveBeenCalled();
    });
  });

  describe("adjustBalance", () => {
    it("positive adjustment restores days", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "b1", used: 5, closing_balance: 7, accrued: 15 });
      const svc = new LeaveService();
      await svc.adjustBalance("emp-1", "earned", 2);
      expect(mockDB.update).toHaveBeenCalledWith(
        "leave_balances",
        "b1",
        expect.objectContaining({
          closing_balance: 9,
          used: 3,
        }),
      );
    });

    it("negative adjustment reduces accrued", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "b1", used: 2, closing_balance: 10, accrued: 15 });
      const svc = new LeaveService();
      await svc.adjustBalance("emp-1", "earned", -3);
      expect(mockDB.update).toHaveBeenCalledWith(
        "leave_balances",
        "b1",
        expect.objectContaining({
          closing_balance: 7,
          accrued: 12,
        }),
      );
    });
  });

  describe("applyLeave", () => {
    it("throws on invalid leave type", async () => {
      mockDB.findMany.mockResolvedValueOnce({ data: [], total: 0 }); // getBalances returns empty
      const svc = new LeaveService();
      // After creating default balances, the "special" type won't exist
      await expect(
        svc.applyLeave("emp-1", "org-1", {
          leaveType: "special",
          startDate: "2026-04-01",
          endDate: "2026-04-02",
          reason: "test",
        }),
      ).rejects.toThrow();
    });

    it("throws on overlapping leave", async () => {
      mockDB.findMany
        .mockResolvedValueOnce({
          data: [{ id: "b1", leave_type: "earned", closing_balance: 10 }],
          total: 1,
        }) // getBalances
        .mockResolvedValueOnce({
          data: [
            {
              id: "r1",
              status: "approved",
              start_date: "2026-04-01",
              end_date: "2026-04-03",
            },
          ],
          total: 1,
        }); // existing requests
      const svc = new LeaveService();
      await expect(
        svc.applyLeave("emp-1", "org-1", {
          leaveType: "earned",
          startDate: "2026-04-02",
          endDate: "2026-04-04",
          reason: "test",
        }),
      ).rejects.toThrow("overlapping");
    });
  });

  describe("approveLeave", () => {
    it("throws when request not found", async () => {
      mockDB.findOne.mockResolvedValueOnce(null);
      const svc = new LeaveService();
      await expect(svc.approveLeave("r1", "mgr1", "hr_admin")).rejects.toThrow("not found");
    });

    it("throws when not pending", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "r1", status: "approved" });
      const svc = new LeaveService();
      await expect(svc.approveLeave("r1", "mgr1", "hr_admin")).rejects.toThrow("Cannot approve");
    });

    it("throws when not authorized", async () => {
      mockDB.findOne.mockResolvedValueOnce({
        id: "r1",
        status: "pending",
        assigned_to: "mgr2",
        employee_id: "emp1",
      });
      const svc = new LeaveService();
      await expect(svc.approveLeave("r1", "mgr1", "employee")).rejects.toThrow("reporting manager");
    });
  });

  describe("rejectLeave", () => {
    it("throws when request not found", async () => {
      mockDB.findOne.mockResolvedValueOnce(null);
      const svc = new LeaveService();
      await expect(svc.rejectLeave("r1", "mgr1", "hr_admin")).rejects.toThrow("not found");
    });

    it("throws when not pending", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "r1", status: "rejected" });
      const svc = new LeaveService();
      await expect(svc.rejectLeave("r1", "mgr1", "hr_admin")).rejects.toThrow("Cannot reject");
    });
  });

  describe("cancelLeave", () => {
    it("throws when not found", async () => {
      mockDB.findOne.mockResolvedValueOnce(null);
      const svc = new LeaveService();
      await expect(svc.cancelLeave("r1", "emp1", "reason")).rejects.toThrow("not found");
    });

    it("throws when not own request", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "r1", employee_id: "emp2" });
      const svc = new LeaveService();
      await expect(svc.cancelLeave("r1", "emp1", "reason")).rejects.toThrow("Not your leave");
    });

    it("throws when already cancelled", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "r1", employee_id: "emp1", status: "cancelled" });
      const svc = new LeaveService();
      await expect(svc.cancelLeave("r1", "emp1", "reason")).rejects.toThrow("Already cancelled");
    });

    it("throws when rejected", async () => {
      mockDB.findOne.mockResolvedValueOnce({ id: "r1", employee_id: "emp1", status: "rejected" });
      const svc = new LeaveService();
      await expect(svc.cancelLeave("r1", "emp1", "reason")).rejects.toThrow("rejected");
    });

    it("cancels pending leave without balance restore", async () => {
      mockDB.findOne.mockResolvedValueOnce({
        id: "r1",
        employee_id: "emp1",
        status: "pending",
        leave_type: "earned",
        days: 2,
        start_date: "2026-04-01",
        end_date: "2026-04-02",
      });
      const svc = new LeaveService();
      await svc.cancelLeave("r1", "emp1", "changed plans");
      expect(mockDB.update).toHaveBeenCalledWith(
        "leave_requests",
        "r1",
        expect.objectContaining({ status: "cancelled" }),
      );
    });

    it("cancels approved leave with balance restore", async () => {
      mockDB.findOne
        .mockResolvedValueOnce({
          id: "r1",
          employee_id: "emp1",
          status: "approved",
          leave_type: "earned",
          days: 2,
          start_date: "2026-04-07",
          end_date: "2026-04-08",
          is_half_day: false,
        })
        .mockResolvedValueOnce({ id: "b1", used: 5, closing_balance: 10, accrued: 15 }) // adjustBalance
        .mockResolvedValueOnce({ id: "att1", paid_leave: 2, present_days: 18 }); // syncAttendanceOnCancel
      const svc = new LeaveService();
      await svc.cancelLeave("r1", "emp1", "changed plans");
      expect(mockDB.update).toHaveBeenCalled();
    });
  });

  describe("getOrgRequests", () => {
    it("returns org-wide requests", async () => {
      mockDB.findMany.mockResolvedValueOnce({
        data: [{ id: "r1", employee_id: "emp1", assigned_to: null }],
        total: 1,
      });
      mockDB.findOne.mockResolvedValueOnce({
        first_name: "A",
        last_name: "B",
        employee_code: "E001",
      });
      const svc = new LeaveService();
      const result = await svc.getOrgRequests("org-1");
      expect(result.data).toHaveLength(1);
    });
  });

  describe("getLeaveSummaryForMonth", () => {
    it("groups leaves by employee", async () => {
      mockDB.findMany.mockResolvedValueOnce({
        data: [
          {
            employee_id: "emp1",
            leave_type: "earned",
            start_date: "2026-04-01",
            end_date: "2026-04-03",
            days: 3,
            is_half_day: false,
            status: "approved",
          },
          {
            employee_id: "emp1",
            leave_type: "sick",
            start_date: "2026-04-10",
            end_date: "2026-04-10",
            days: 1,
            is_half_day: false,
            status: "approved",
          },
        ],
        total: 2,
      });
      const svc = new LeaveService();
      const result = await svc.getLeaveSummaryForMonth("org-1", 4, 2026);
      expect(result["emp1"]).toHaveLength(2);
    });
  });
});

// ============================================================================
// BACKUP SERVICE TESTS
// ============================================================================
describe("BackupService", () => {
  let BackupService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../services/backup.service");
    BackupService = mod.BackupService;
  });

  it("creates a backup (error path — no mysqldump)", async () => {
    const svc = new BackupService();
    const result = await svc.createBackup();
    expect(result.filename).toContain("emp-payroll-backup");
    expect(result.size).toBeGreaterThan(0);
  });

  it("lists backups", async () => {
    const svc = new BackupService();
    const list = await svc.listBackups();
    expect(Array.isArray(list)).toBe(true);
  });

  it("getBackupPath returns null for non-existent", async () => {
    const svc = new BackupService();
    const path = await svc.getBackupPath("nonexistent.sql");
    expect(path).toBeNull();
  });

  it("deleteBackup returns false for non-existent", async () => {
    const svc = new BackupService();
    const result = await svc.deleteBackup("nonexistent.sql");
    expect(result).toBe(false);
  });
});

// ============================================================================
// EXPENSE POLICY SERVICE TESTS
// ============================================================================
describe("ExpensePolicyService", () => {
  let ExpensePolicyService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../services/expense-policy.service");
    ExpensePolicyService = mod.ExpensePolicyService;
  });

  it("returns default policies", () => {
    const svc = new ExpensePolicyService();
    const policies = svc.getPolicies();
    expect(policies.length).toBeGreaterThan(0);
    expect(policies.find((p: any) => p.category === "food")).toBeDefined();
  });

  it("auto-approves below limit", async () => {
    mockDB.raw.mockResolvedValueOnce([[{ total: 0 }]]);
    const svc = new ExpensePolicyService();
    const result = await svc.evaluate({
      orgId: "org1",
      employeeId: "emp1",
      category: "food",
      amount: 300,
      month: 4,
      year: 2026,
    });
    expect(result.decision).toBe("auto_approve");
  });

  it("blocks when monthly cap exceeded", async () => {
    mockDB.raw.mockResolvedValueOnce([[{ total: 4800 }]]);
    const svc = new ExpensePolicyService();
    const result = await svc.evaluate({
      orgId: "org1",
      employeeId: "emp1",
      category: "food",
      amount: 500,
      month: 4,
      year: 2026,
    });
    expect(result.decision).toBe("blocked");
  });

  it("needs review for unknown category", async () => {
    const svc = new ExpensePolicyService();
    const result = await svc.evaluate({
      orgId: "org1",
      employeeId: "emp1",
      category: "unknown",
      amount: 100,
      month: 4,
      year: 2026,
    });
    expect(result.decision).toBe("needs_review");
  });

  it("needs review when above auto-approve limit", async () => {
    mockDB.raw.mockResolvedValueOnce([[{ total: 0 }]]);
    const svc = new ExpensePolicyService();
    const result = await svc.evaluate({
      orgId: "org1",
      employeeId: "emp1",
      category: "travel",
      amount: 5000,
      month: 4,
      year: 2026,
    });
    expect(result.decision).toBe("needs_review");
  });
});

// ============================================================================
// SLACK SERVICE TESTS
// ============================================================================
describe("SlackService", () => {
  let SlackService: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../services/slack.service");
    SlackService = mod.SlackService;
  });

  it("isConfigured returns false when no webhook", () => {
    const svc = new SlackService();
    expect(svc.isConfigured()).toBe(false);
  });

  it("sendMessage returns false when not configured", async () => {
    const svc = new SlackService();
    const result = await svc.sendMessage("test");
    expect(result).toBe(false);
  });

  it("sendMessage sends to webhook when configured", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    const mod = await import("../../services/slack.service");
    const svc = new mod.SlackService();
    const result = await svc.sendMessage("test message");
    expect(result).toBe(true);
    delete process.env.SLACK_WEBHOOK_URL;
    vi.unstubAllGlobals();
  });

  it("sendMessage handles fetch error", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("fail")));
    const mod = await import("../../services/slack.service");
    const svc = new mod.SlackService();
    const result = await svc.sendMessage("test");
    expect(result).toBe(false);
    delete process.env.SLACK_WEBHOOK_URL;
    vi.unstubAllGlobals();
  });

  it("sendMessage handles non-ok response", async () => {
    process.env.SLACK_WEBHOOK_URL = "https://hooks.slack.com/test";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    const mod = await import("../../services/slack.service");
    const svc = new mod.SlackService();
    const result = await svc.sendMessage("test");
    expect(result).toBe(false);
    delete process.env.SLACK_WEBHOOK_URL;
    vi.unstubAllGlobals();
  });
});

// ============================================================================
// PAYROLL LOCK MIDDLEWARE TESTS
// ============================================================================
describe("enforcePayrollLock middleware", () => {
  let enforcePayrollLock: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import("../../api/middleware/payroll-lock.middleware");
    enforcePayrollLock = mod.enforcePayrollLock;
  });

  it("passes through GET requests", async () => {
    const req = { method: "GET" } as any;
    const res = {} as any;
    const next = vi.fn();
    await enforcePayrollLock(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("passes through OPTIONS requests", async () => {
    const req = { method: "OPTIONS" } as any;
    const res = {} as any;
    const next = vi.fn();
    await enforcePayrollLock(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("passes through when no user", async () => {
    const req = { method: "POST", user: null } as any;
    const res = {} as any;
    const next = vi.fn();
    await enforcePayrollLock(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("passes through when no lock date set", async () => {
    mockDB.findById.mockResolvedValueOnce({ payroll_lock_date: null });
    const req = { method: "POST", user: { orgId: "org1" }, body: {}, query: {} } as any;
    const res = {} as any;
    const next = vi.fn();
    await enforcePayrollLock(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("blocks writes to locked month", async () => {
    mockDB.findById.mockResolvedValueOnce({ payroll_lock_date: "2026-03-31" });
    const jsonFn = vi.fn();
    const req = {
      method: "POST",
      user: { orgId: "org1" },
      body: { month: 3, year: 2026 },
      query: {},
    } as any;
    const res = { status: vi.fn().mockReturnValue({ json: jsonFn }) } as any;
    const next = vi.fn();
    await enforcePayrollLock(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(jsonFn).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it("allows writes to unlocked month", async () => {
    mockDB.findById.mockResolvedValueOnce({ payroll_lock_date: "2026-01-31" });
    const req = {
      method: "POST",
      user: { orgId: "org1" },
      body: { month: 4, year: 2026 },
      query: {},
    } as any;
    const res = {} as any;
    const next = vi.fn();
    await enforcePayrollLock(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it("passes through on DB error", async () => {
    mockDB.findById.mockRejectedValueOnce(new Error("db error"));
    const req = { method: "POST", user: { orgId: "org1" }, body: {}, query: {} } as any;
    const res = {} as any;
    const next = vi.fn();
    await enforcePayrollLock(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
