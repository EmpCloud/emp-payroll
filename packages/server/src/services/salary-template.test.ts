import { describe, expect, it, vi } from "vitest";
const findOne = vi.hoisted(() => vi.fn());
vi.mock("../db/adapters", () => ({ getDB: () => ({ findOne }) }));
import { EmployeeService } from "./employee.service";

describe("salary template", () => {
  it("exports annual CTC and leaves unassigned salaries blank", async () => {
    const service = new EmployeeService();
    vi.spyOn(service, "list").mockResolvedValue({
      data: [
        { id: 1, first_name: "A", employee_code: "E1", ctc: 999 },
        { id: 2, first_name: "B", employee_code: "E2", ctc: null },
      ],
      total: 2,
      page: 1,
      limit: 100,
      totalPages: 1,
    });
    findOne.mockResolvedValueOnce({ ctc: 1200000 }).mockResolvedValueOnce(null);
    const result = await service.salaryTemplate(42, 1);
    expect(result.data.map((employee) => employee.annualCtc)).toEqual([1200000, null]);
    expect(service.list).toHaveBeenCalledWith(42, { page: 1, limit: 100 });
  });
});
