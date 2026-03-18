import { getDB } from "../db/adapters";

/**
 * Expense policy engine for automatic approval of reimbursements.
 * Rules:
 * - Auto-approve below a threshold (configurable per category)
 * - Enforce per-category monthly caps
 * - Flag high-value claims for manager review
 */

interface PolicyRule {
  category: string;
  autoApproveLimit: number;   // Auto-approve if amount <= this
  monthlyCapPerEmployee: number; // Max total per month per employee
  requiresReceipt: boolean;
}

const DEFAULT_POLICIES: PolicyRule[] = [
  { category: "food", autoApproveLimit: 500, monthlyCapPerEmployee: 5000, requiresReceipt: false },
  { category: "travel", autoApproveLimit: 2000, monthlyCapPerEmployee: 15000, requiresReceipt: true },
  { category: "medical", autoApproveLimit: 1000, monthlyCapPerEmployee: 10000, requiresReceipt: true },
  { category: "equipment", autoApproveLimit: 0, monthlyCapPerEmployee: 50000, requiresReceipt: true },
  { category: "internet", autoApproveLimit: 1500, monthlyCapPerEmployee: 1500, requiresReceipt: true },
  { category: "books", autoApproveLimit: 2000, monthlyCapPerEmployee: 5000, requiresReceipt: false },
  { category: "other", autoApproveLimit: 0, monthlyCapPerEmployee: 10000, requiresReceipt: true },
];

export class ExpensePolicyService {
  private db = getDB();

  getPolicies(): PolicyRule[] {
    return DEFAULT_POLICIES;
  }

  /**
   * Evaluate a reimbursement claim against policies.
   * Returns whether it should be auto-approved, flagged, or blocked.
   */
  async evaluate(params: {
    orgId: string;
    employeeId: string;
    category: string;
    amount: number;
    month: number;
    year: number;
  }): Promise<{
    decision: "auto_approve" | "needs_review" | "blocked";
    reason: string;
    policy: PolicyRule | null;
  }> {
    const policy = DEFAULT_POLICIES.find((p) => p.category === params.category);
    if (!policy) {
      return { decision: "needs_review", reason: "No policy defined for this category", policy: null };
    }

    // Check monthly cap
    const monthlyTotal = await this.getMonthlyTotal(params.employeeId, params.category, params.month, params.year);
    if (monthlyTotal + params.amount > policy.monthlyCapPerEmployee) {
      return {
        decision: "blocked",
        reason: `Monthly cap exceeded. Limit: ${policy.monthlyCapPerEmployee}, Already claimed: ${monthlyTotal}, Requested: ${params.amount}`,
        policy,
      };
    }

    // Check auto-approve limit
    if (params.amount <= policy.autoApproveLimit) {
      return { decision: "auto_approve", reason: `Amount within auto-approve limit (${policy.autoApproveLimit})`, policy };
    }

    return { decision: "needs_review", reason: `Amount exceeds auto-approve limit (${policy.autoApproveLimit})`, policy };
  }

  private async getMonthlyTotal(employeeId: string, category: string, month: number, year: number): Promise<number> {
    try {
      const result = await this.db.raw<any>(
        `SELECT COALESCE(SUM(amount), 0) as total FROM reimbursements
         WHERE employee_id = ? AND category = ? AND MONTH(created_at) = ? AND YEAR(created_at) = ?
         AND status != 'rejected'`,
        [employeeId, category, month, year]
      );
      const rows = Array.isArray(result) ? (Array.isArray(result[0]) ? result[0] : result) : result.rows || [];
      return Number(rows[0]?.total || 0);
    } catch {
      return 0;
    }
  }
}
