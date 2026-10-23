import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db/adapters", () => ({ getDB: vi.fn() }));
vi.mock("../db/empcloud", () => ({ getEmpCloudDB: vi.fn() }));

import { getDB } from "../db/adapters";
import { getEmpCloudDB } from "../db/empcloud";
import { EmployeeService } from "./employee.service";

describe("Employee PF detail updates", () => {
  beforeEach(() => vi.clearAllMocks());

  it("preserves membership history when an older client edits only the PF number", async () => {
    const db = {
      findOne: vi.fn().mockResolvedValue({ id: "profile-12" }),
      update: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(getDB).mockReturnValue(db as any);
    const service = new EmployeeService();
    const existing = {
      uan: "123456789012",
      pfNumber: "old",
      pfMembershipDate: "2026-09-17",
      isEpsMember: false,
      epsExclusionReason: "ineligible",
      membershipWages: 20000,
    };
    vi.spyOn(service, "getByEmpCloudId").mockResolvedValue({ pfDetails: existing });

    const updated = await service.updatePfDetails(12, 1, { pfNumber: "new" });

    expect(updated).toEqual({ ...existing, pfNumber: "new" });
    expect(db.update).toHaveBeenCalledWith("employee_payroll_profiles", "profile-12", {
      pf_details: JSON.stringify({ ...existing, pfNumber: "new" }),
    });
  });

  it("rejects invalid bulk membership rows before updating either database", async () => {
    const update = vi.fn();
    vi.mocked(getDB).mockReturnValue({ update } as any);
    const empcloud = vi.fn();
    vi.mocked(getEmpCloudDB).mockReturnValue(empcloud as any);
    const service = new EmployeeService();
    const result = await service.bulkUpdate(1, [
      {
        key: { empCode: "EMP012" },
        pfDetails: { pfMembershipDate: "2026-02-30" },
      },
    ]);
    expect(result.failed).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.results[0].error).toContain("pfMembershipDate");
    expect(empcloud).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });
});
