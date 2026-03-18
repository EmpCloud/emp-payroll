import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

const DEFAULT_LEAVE_POLICY = [
  { leaveType: "earned", annual: 15, carryForward: true },
  { leaveType: "casual", annual: 7, carryForward: false },
  { leaveType: "sick", annual: 7, carryForward: false },
];

export class LeaveService {
  private db = getDB();

  async getBalances(employeeId: string, financialYear?: string) {
    const fy = financialYear || this.currentFY();
    const result = await this.db.findMany<any>("leave_balances", {
      filters: { employee_id: employeeId, financial_year: fy },
    });

    // If no balances exist, create defaults
    if (result.data.length === 0) {
      const balances = [];
      for (const policy of DEFAULT_LEAVE_POLICY) {
        const balance = await this.db.create("leave_balances", {
          employee_id: employeeId,
          leave_type: policy.leaveType,
          financial_year: fy,
          opening_balance: 0,
          accrued: policy.annual,
          used: 0,
          lapsed: 0,
          closing_balance: policy.annual,
        });
        balances.push(balance);
      }
      return { data: balances, total: balances.length, page: 1, limit: 20, totalPages: 1 };
    }

    return result;
  }

  async getOrgBalances(orgId: string, financialYear?: string) {
    const fy = financialYear || this.currentFY();
    const employees = await this.db.findMany<any>("employees", {
      filters: { org_id: orgId, is_active: true },
      limit: 1000,
    });

    const results = [];
    for (const emp of employees.data) {
      const balances = await this.getBalances(emp.id, fy);
      results.push({
        employeeId: emp.id,
        employeeName: `${emp.first_name} ${emp.last_name}`,
        employeeCode: emp.employee_code,
        department: emp.department,
        balances: balances.data,
      });
    }
    return results;
  }

  async recordLeave(employeeId: string, leaveType: string, days: number, fy?: string) {
    const financialYear = fy || this.currentFY();
    const balance = await this.db.findOne<any>("leave_balances", {
      employee_id: employeeId,
      leave_type: leaveType,
      financial_year: financialYear,
    });

    if (!balance) throw new AppError(404, "NOT_FOUND", "Leave balance not found");
    if (Number(balance.closing_balance) < days) {
      throw new AppError(400, "INSUFFICIENT_BALANCE", `Only ${balance.closing_balance} ${leaveType} leaves available`);
    }

    return this.db.update("leave_balances", balance.id, {
      used: Number(balance.used) + days,
      closing_balance: Number(balance.closing_balance) - days,
    });
  }

  async adjustBalance(employeeId: string, leaveType: string, adjustment: number, fy?: string) {
    const financialYear = fy || this.currentFY();
    const balance = await this.db.findOne<any>("leave_balances", {
      employee_id: employeeId,
      leave_type: leaveType,
      financial_year: financialYear,
    });

    if (!balance) throw new AppError(404, "NOT_FOUND", "Leave balance not found");
    return this.db.update("leave_balances", balance.id, {
      accrued: Number(balance.accrued) + adjustment,
      closing_balance: Number(balance.closing_balance) + adjustment,
    });
  }

  private currentFY(): string {
    const now = new Date();
    const year = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return `${year}-${year + 1}`;
  }
}
