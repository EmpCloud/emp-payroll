// =============================================================================
// EMP PAYROLL — Middleware, Error, Rate Limit, API Key, Payroll Lock Unit Tests
// =============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import jwt from "jsonwebtoken";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("../utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../config", () => ({
  config: {
    jwt: { secret: "test-secret-payroll" },
    db: { host: "localhost", port: 3306, user: "root", password: "", name: "emp_payroll" },
  },
}));

const mockFindById = vi.fn();
vi.mock("../db/adapters", () => ({
  getDB: () => ({ findById: mockFindById }),
  createDBAdapter: vi.fn(),
  initDB: vi.fn(),
  closeDB: vi.fn(),
}));

vi.mock("../services/apikey.service", () => ({
  ApiKeyService: vi.fn().mockImplementation(() => ({
    validate: vi.fn().mockResolvedValue(null),
  })),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------
import { authenticate, authorize, AuthPayload } from "../api/middleware/auth.middleware";
import { AppError, errorHandler } from "../api/middleware/error.middleware";
import { rateLimit } from "../api/middleware/rate-limit.middleware";
import { enforcePayrollLock } from "../api/middleware/payroll-lock.middleware";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mockReq(overrides: any = {}): any {
  return {
    headers: {},
    params: {},
    query: {},
    body: {},
    method: "GET",
    ip: "127.0.0.1",
    ...overrides,
  };
}

function mockRes(): any {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res;
}

// =============================================================================
// Auth Middleware
// =============================================================================
describe("Payroll Auth Middleware", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("authenticate()", () => {
    it("rejects when no Authorization header or query token", () => {
      const req = mockReq();
      const next = vi.fn();
      authenticate(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401, code: "UNAUTHORIZED" }),
      );
    });

    it("rejects with non-Bearer header", () => {
      const req = mockReq({ headers: { authorization: "Basic abc" } });
      const next = vi.fn();
      authenticate(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it("decodes valid JWT from header", () => {
      const payload: AuthPayload = {
        empcloudUserId: 1,
        empcloudOrgId: 1,
        payrollProfileId: "uuid-1",
        role: "hr_admin",
        email: "hr@test.com",
        firstName: "HR",
        lastName: "Admin",
        orgName: "Test",
      };
      const token = jwt.sign(payload, "test-secret-payroll");
      const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
      const next = vi.fn();

      authenticate(req, mockRes(), next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user).toMatchObject({ empcloudUserId: 1, role: "hr_admin" });
    });

    it("decodes valid JWT from query param", () => {
      const payload = {
        empcloudUserId: 2,
        empcloudOrgId: 1,
        payrollProfileId: null,
        role: "employee",
        email: "e@t.com",
        firstName: "E",
        lastName: "M",
        orgName: "T",
      };
      const token = jwt.sign(payload, "test-secret-payroll");
      const req = mockReq({ query: { token } });
      const next = vi.fn();

      authenticate(req, mockRes(), next);

      expect(next).toHaveBeenCalledWith();
      expect(req.user.empcloudUserId).toBe(2);
    });

    it("rejects expired token with TOKEN_EXPIRED code", () => {
      const token = jwt.sign({ sub: "1" }, "test-secret-payroll", { expiresIn: "0s" });
      const req = mockReq({ headers: { authorization: `Bearer ${token}` } });
      const next = vi.fn();

      // jwt.verify on an expired token will throw synchronously
      // We need a tiny delay for the token to actually expire
      setTimeout(() => {
        authenticate(req, mockRes(), next);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: "TOKEN_EXPIRED" }));
      }, 10);
    });

    it("rejects tampered/invalid token", () => {
      const req = mockReq({ headers: { authorization: "Bearer not.a.valid.token" } });
      const next = vi.fn();
      authenticate(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: "INVALID_TOKEN" }));
    });
  });

  describe("authorize()", () => {
    it("rejects when no user attached", () => {
      const mw = authorize("hr_admin");
      const req = mockReq();
      const next = vi.fn();
      mw(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
    });

    it("rejects when role not in allowed list", () => {
      const mw = authorize("hr_admin");
      const req = mockReq({ user: { role: "employee" } });
      const next = vi.fn();
      mw(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
    });

    it("allows when role matches", () => {
      const mw = authorize("hr_admin");
      const req = mockReq({ user: { role: "hr_admin" } });
      const next = vi.fn();
      mw(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it("auto-grants org_admin when hr_admin is in allowed roles", () => {
      const mw = authorize("hr_admin");
      const req = mockReq({ user: { role: "org_admin" } });
      const next = vi.fn();
      mw(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith();
    });

    it("passes when no roles specified (any authenticated user)", () => {
      const mw = authorize();
      const req = mockReq({ user: { role: "employee" } });
      const next = vi.fn();
      mw(req, mockRes(), next);
      expect(next).toHaveBeenCalledWith();
    });
  });
});

// =============================================================================
// Error Handler
// =============================================================================
describe("Payroll Error Handler", () => {
  it("handles AppError with correct status and JSON envelope", () => {
    const err = new AppError(422, "VALIDATION", "Invalid data");
    const res = mockRes();
    errorHandler(err, mockReq(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: "VALIDATION" }),
      }),
    );
  });

  it("handles unknown errors as 500", () => {
    const err = new Error("kaboom");
    const res = mockRes();
    errorHandler(err, mockReq(), res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: "INTERNAL_ERROR" }),
      }),
    );
  });

  it("AppError stores statusCode, code, and details", () => {
    const err = new AppError(400, "BAD", "bad input", { name: ["required"] });
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe("BAD");
    expect(err.details).toEqual({ name: ["required"] });
    expect(err instanceof Error).toBe(true);
  });
});

// =============================================================================
// Rate Limit Middleware
// =============================================================================
describe("Payroll Rate Limit Middleware", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips rate limiting when RATE_LIMIT_DISABLED=true", () => {
    const original = process.env.RATE_LIMIT_DISABLED;
    process.env.RATE_LIMIT_DISABLED = "true";

    const limiter = rateLimit({ windowMs: 1000, max: 1 });
    const req = mockReq({ ip: "skip-test" });
    const res = mockRes();
    const next = vi.fn();

    limiter(req, res, next);
    expect(next).toHaveBeenCalled();

    process.env.RATE_LIMIT_DISABLED = original;
  });

  it("allows requests within limit", () => {
    const original = process.env.RATE_LIMIT_DISABLED;
    delete process.env.RATE_LIMIT_DISABLED;

    const limiter = rateLimit({ windowMs: 60000, max: 5 });
    const req = mockReq({ ip: "rate-test-1" });
    const res = mockRes();
    const next = vi.fn();

    limiter(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Limit", 5);
    expect(res.setHeader).toHaveBeenCalledWith("X-RateLimit-Remaining", 4);

    process.env.RATE_LIMIT_DISABLED = original;
  });

  it("rejects when exceeding max requests", () => {
    const original = process.env.RATE_LIMIT_DISABLED;
    delete process.env.RATE_LIMIT_DISABLED;

    const limiter = rateLimit({ windowMs: 60000, max: 2 });
    const uniqueIp = `rate-test-exceed-${Date.now()}`;

    // Make 3 requests — third should be rejected
    for (let i = 0; i < 3; i++) {
      const req = mockReq({ ip: uniqueIp });
      const res = mockRes();
      const next = vi.fn();
      limiter(req, res, next);

      if (i < 2) {
        expect(next).toHaveBeenCalled();
      } else {
        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith(
          expect.objectContaining({
            success: false,
            error: expect.objectContaining({ code: "RATE_LIMIT_EXCEEDED" }),
          }),
        );
      }
    }

    process.env.RATE_LIMIT_DISABLED = original;
  });

  it("supports custom keyFn", () => {
    const original = process.env.RATE_LIMIT_DISABLED;
    delete process.env.RATE_LIMIT_DISABLED;

    const limiter = rateLimit({
      windowMs: 60000,
      max: 10,
      keyFn: (req) => (req as any).user?.id || "anon",
    });
    const req = mockReq({ user: { id: "custom-key-user" } });
    const res = mockRes();
    const next = vi.fn();

    limiter(req, res, next);
    expect(next).toHaveBeenCalled();

    process.env.RATE_LIMIT_DISABLED = original;
  });
});

// =============================================================================
// Payroll Lock Middleware
// =============================================================================
describe("Payroll Lock Middleware", () => {
  beforeEach(() => vi.clearAllMocks());

  it("skips GET requests", async () => {
    const req = mockReq({ method: "GET" });
    const next = vi.fn();
    await enforcePayrollLock(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("skips HEAD and OPTIONS requests", async () => {
    for (const method of ["HEAD", "OPTIONS"]) {
      const req = mockReq({ method });
      const next = vi.fn();
      await enforcePayrollLock(req, mockRes(), next);
      expect(next).toHaveBeenCalled();
    }
  });

  it("skips when no user", async () => {
    const req = mockReq({ method: "POST" });
    const next = vi.fn();
    await enforcePayrollLock(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("skips when org has no lock date", async () => {
    mockFindById.mockResolvedValue({ id: "1" });
    const req = mockReq({ method: "POST", user: { orgId: "1" } });
    const next = vi.fn();
    await enforcePayrollLock(req, mockRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("blocks writes to locked month", async () => {
    mockFindById.mockResolvedValue({ id: "1", payroll_lock_date: "2026-03-31" });
    const req = mockReq({ method: "POST", user: { orgId: "1" }, body: { month: 3, year: 2026 } });
    const res = mockRes();
    const next = vi.fn();

    await enforcePayrollLock(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.objectContaining({ code: "PAYROLL_LOCKED" }) }),
    );
  });

  it("allows writes to unlocked month", async () => {
    mockFindById.mockResolvedValue({ id: "1", payroll_lock_date: "2026-01-31" });
    const req = mockReq({ method: "POST", user: { orgId: "1" }, body: { month: 4, year: 2026 } });
    const next = vi.fn();

    await enforcePayrollLock(req, mockRes(), next);

    expect(next).toHaveBeenCalled();
  });

  it("continues on DB error", async () => {
    mockFindById.mockRejectedValue(new Error("DB down"));
    const req = mockReq({ method: "POST", user: { orgId: "1" }, body: { month: 1, year: 2026 } });
    const next = vi.fn();

    await enforcePayrollLock(req, mockRes(), next);

    expect(next).toHaveBeenCalled();
  });
});
