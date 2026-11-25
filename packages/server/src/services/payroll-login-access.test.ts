import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ permissions: vi.fn(), user: vi.fn(), org: vi.fn() }));
vi.mock("../db/adapters", () => ({
  getDB: () => ({ findOne: vi.fn().mockResolvedValue({ id: "profile" }) }),
}));
vi.mock("../db/empcloud", () => ({
  API_KEY_PREFIX: "empc_",
  findUserByEmail: mocks.user,
  findUserById: mocks.user,
  findOrgById: mocks.org,
  resolveUserPermissions: mocks.permissions,
  getUserDepartmentName: vi.fn(),
}));
vi.mock("bcryptjs", () => ({ default: { compare: vi.fn().mockResolvedValue(true) } }));
vi.mock("../config", () => ({
  config: { jwt: { secret: "test-secret", accessExpiry: "15m", refreshExpiry: "7d" } },
}));
import jwt from "jsonwebtoken";
import { AuthService } from "./auth.service";
const user = {
  id: 1,
  organization_id: 2,
  role: "hr_admin",
  status: 1,
  password: "hash",
  email: "hr@example.com",
};
beforeEach(() => {
  mocks.user.mockResolvedValue(user);
  mocks.org.mockResolvedValue({ id: 2, is_active: true, name: "Org" });
  mocks.permissions.mockReset();
});
describe("payroll login access", () => {
  it("rejects password and SSO login when no payroll permission is granted", async () => {
    mocks.permissions.mockResolvedValue(["employees:view"]);
    const service = new AuthService();
    await expect(service.login(user.email, "password")).rejects.toMatchObject({
      statusCode: 403,
      code: "PAYROLL_ACCESS_DENIED",
    });
    const token = jwt.sign({ sub: "1", permissions: ["payroll:view_all"] }, "test-secret");
    await expect(service.ssoLogin(token)).rejects.toMatchObject({
      statusCode: 403,
      code: "PAYROLL_ACCESS_DENIED",
    });
  });
  it("allows an explicitly granted payroll permission", async () => {
    mocks.permissions.mockResolvedValue(["payroll:view_own"]);
    const result = await new AuthService().login(user.email, "password");
    expect(result.tokens.accessToken).toBeTruthy();
  });
});

import { authenticate } from "../api/middleware/auth.middleware";

describe("existing payroll sessions", () => {
  it("rejects a token after payroll access is revoked", async () => {
    mocks.permissions.mockResolvedValue([]);
    const token = jwt.sign(
      { empcloudUserId: 1, empcloudOrgId: 2, role: "hr_admin", permissions: ["payroll:view_all"] },
      "test-secret",
    );
    const result = await new Promise<any>((resolve) =>
      authenticate(
        { headers: { authorization: `Bearer ${token}` }, query: {} } as any,
        {} as any,
        resolve,
      ),
    );
    expect(result).toMatchObject({ statusCode: 403, code: "PAYROLL_ACCESS_DENIED" });
  });
});
