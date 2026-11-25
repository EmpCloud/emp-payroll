import { describe, expect, it, vi } from "vitest";
import { requirePermission } from "./auth.middleware";

describe("payroll permission enforcement", () => {
  it("denies an HR admin with no permissions", () => {
    const next = vi.fn();
    requirePermission("payroll:view_all")(
      { user: { role: "hr_admin", permissions: [] } } as any,
      {} as any,
      next,
    );
    expect(next.mock.calls[0][0]).toMatchObject({ statusCode: 403 });
  });
});
