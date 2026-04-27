import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

export class EarnedWageService {
  private db = getDB();

  // ---------------------------------------------------------------------------
  // Settings
  // ---------------------------------------------------------------------------

  async getSettings(orgId: string) {
    const numOrgId = Number(orgId);
    let settings = await this.db.findOne<any>("earned_wage_settings", {
      empcloud_org_id: numOrgId,
    });

    // Return defaults if no settings exist yet
    if (!settings) {
      settings = {
        empcloud_org_id: numOrgId,
        is_enabled: false,
        max_percentage: 50,
        min_amount: 0,
        max_amount: 0,
        fee_percentage: 0,
        fee_flat: 0,
        auto_approve_below: 0,
        requires_manager_approval: true,
        cooldown_days: 7,
      };
    }

    return settings;
  }

  async updateSettings(orgId: string, data: any) {
    const numOrgId = Number(orgId);
    const existing = await this.db.findOne<any>("earned_wage_settings", {
      empcloud_org_id: numOrgId,
    });

    const updateData: Record<string, any> = {};
    if (data.isEnabled !== undefined) updateData.is_enabled = data.isEnabled;
    if (data.maxPercentage !== undefined) updateData.max_percentage = data.maxPercentage;
    if (data.minAmount !== undefined) updateData.min_amount = data.minAmount;
    if (data.maxAmount !== undefined) updateData.max_amount = data.maxAmount;
    if (data.feePercentage !== undefined) updateData.fee_percentage = data.feePercentage;
    if (data.feeFlat !== undefined) updateData.fee_flat = data.feeFlat;
    if (data.autoApproveBelow !== undefined) updateData.auto_approve_below = data.autoApproveBelow;
    if (data.requiresManagerApproval !== undefined)
      updateData.requires_manager_approval = data.requiresManagerApproval;
    if (data.cooldownDays !== undefined) updateData.cooldown_days = data.cooldownDays;

    if (existing) {
      return this.db.update("earned_wage_settings", existing.id, updateData);
    } else {
      return this.db.create("earned_wage_settings", {
        empcloud_org_id: numOrgId,
        ...updateData,
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Calculate Available
  // ---------------------------------------------------------------------------

  async calculateAvailable(orgId: string, employeeId: string) {
    const numOrgId = Number(orgId);
    const settings = await this.getSettings(orgId);

    if (!settings.is_enabled) {
      return {
        available: 0,
        earnedSoFar: 0,
        alreadyWithdrawn: 0,
        message: "Earned wage access is not enabled",
      };
    }

    // Get employee's current salary. Try the legacy salary_assignments
    // table first (UUID employee_id keyed), then fall back to
    // employee_salaries which is keyed on empcloud_user_id — the EmpCloud
    // integration writes to the latter, so without this fallback users
    // onboarded via the new flow always get "No salary assigned"
    // and "Unable to request advanced salary" (#208).
    let ctc: number | null = null;
    const salaryAssignment = await this.db
      .findOne<any>("salary_assignments", {
        employee_id: employeeId,
        org_id: numOrgId,
      })
      .catch(() => null);
    if (salaryAssignment) {
      ctc = Number(salaryAssignment.ctc);
    } else {
      const numericEmpId = Number(employeeId);
      if (Number.isFinite(numericEmpId) && numericEmpId > 0) {
        const empSalary = await this.db
          .findOne<any>("employee_salaries", {
            empcloud_user_id: numericEmpId,
            is_active: 1,
          })
          .catch(() => null);
        if (empSalary) ctc = Number(empSalary.ctc);
      }
    }

    if (!ctc || ctc <= 0) {
      return { available: 0, earnedSoFar: 0, alreadyWithdrawn: 0, message: "No salary assigned" };
    }

    const monthlySalary = ctc / 12;

    // Calculate days worked this month
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const dayOfMonth = now.getDate();

    // Earned salary so far = (monthlySalary / daysInMonth) * daysWorked
    const earnedSoFar = Math.floor((monthlySalary / daysInMonth) * dayOfMonth);

    // Max available based on percentage limit
    const maxByPercentage = Math.floor(earnedSoFar * (settings.max_percentage / 100));

    // Check already withdrawn this month
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59).toISOString();

    const existing = await this.db.findMany<any>("earned_wage_access_requests", {
      filters: { empcloud_org_id: numOrgId, employee_id: Number(employeeId) },
      limit: 1000,
    });

    // Sum of non-rejected requests this month
    const alreadyWithdrawn = existing.data
      .filter((r: any) => {
        const reqDate = new Date(r.requested_at);
        return (
          reqDate >= new Date(monthStart) &&
          reqDate <= new Date(monthEnd) &&
          r.status !== "rejected"
        );
      })
      .reduce((sum: number, r: any) => sum + Number(r.amount), 0);

    let available = Math.max(0, maxByPercentage - alreadyWithdrawn);

    // Apply min/max limits
    if (settings.max_amount > 0) {
      available = Math.min(available, Number(settings.max_amount) - alreadyWithdrawn);
    }
    if (available < Number(settings.min_amount)) {
      available = 0; // Below minimum threshold
    }

    return {
      available: Math.max(0, available),
      earnedSoFar,
      alreadyWithdrawn,
      monthlySalary: Math.round(monthlySalary),
      daysWorked: dayOfMonth,
      daysInMonth,
      maxPercentage: settings.max_percentage,
    };
  }

  // ---------------------------------------------------------------------------
  // Request Advance
  // ---------------------------------------------------------------------------

  async requestAdvance(orgId: string, employeeId: string, amount: number, reason?: string) {
    const numOrgId = Number(orgId);
    const settings = await this.getSettings(orgId);

    if (!settings.is_enabled) {
      throw new AppError(
        400,
        "EWA_DISABLED",
        "Earned wage access is not enabled for this organization",
      );
    }

    const availability = await this.calculateAvailable(orgId, employeeId);

    if (amount <= 0) {
      throw new AppError(400, "INVALID_AMOUNT", "Amount must be greater than zero");
    }

    if (amount > availability.available) {
      throw new AppError(
        400,
        "EXCEEDS_AVAILABLE",
        `Requested amount exceeds available balance of ${availability.available}`,
      );
    }

    if (Number(settings.min_amount) > 0 && amount < Number(settings.min_amount)) {
      throw new AppError(400, "BELOW_MINIMUM", `Minimum request amount is ${settings.min_amount}`);
    }

    // Check cooldown period
    const lastRequest = await this.db.findMany<any>("earned_wage_access_requests", {
      filters: { empcloud_org_id: numOrgId, employee_id: Number(employeeId) },
      sort: { field: "requested_at", order: "desc" },
      limit: 1,
    });

    if (lastRequest.data.length > 0 && settings.cooldown_days > 0) {
      const lastDate = new Date(lastRequest.data[0].requested_at);
      const cooldownEnd = new Date(
        lastDate.getTime() + settings.cooldown_days * 24 * 60 * 60 * 1000,
      );
      if (new Date() < cooldownEnd && lastRequest.data[0].status !== "rejected") {
        throw new AppError(
          400,
          "COOLDOWN_ACTIVE",
          `Please wait ${settings.cooldown_days} days between requests`,
        );
      }
    }

    // Calculate fee
    let feeAmount = Number(settings.fee_flat) || 0;
    if (Number(settings.fee_percentage) > 0) {
      feeAmount += Math.round((amount * Number(settings.fee_percentage)) / 100);
    }

    // Determine initial status
    let status = "pending";
    if (Number(settings.auto_approve_below) > 0 && amount <= Number(settings.auto_approve_below)) {
      status = "approved";
    }

    const request = await this.db.create("earned_wage_access_requests", {
      empcloud_org_id: numOrgId,
      employee_id: Number(employeeId),
      amount,
      currency: "INR",
      status,
      requested_at: new Date(),
      max_available: availability.available,
      fee_amount: feeAmount,
      reason: reason || null,
      approved_at: status === "approved" ? new Date() : null,
    });

    return request;
  }

  // ---------------------------------------------------------------------------
  // Approve / Reject
  // ---------------------------------------------------------------------------

  async approveRequest(orgId: string, requestId: string, approverUserId: string) {
    const numOrgId = Number(orgId);
    const request = await this.db.findOne<any>("earned_wage_access_requests", {
      id: requestId,
      empcloud_org_id: numOrgId,
    });

    if (!request) throw new AppError(404, "NOT_FOUND", "Request not found");
    if (request.status !== "pending") {
      throw new AppError(
        400,
        "INVALID_STATUS",
        `Cannot approve a request with status "${request.status}"`,
      );
    }

    return this.db.update("earned_wage_access_requests", requestId, {
      status: "approved",
      approved_by: Number(approverUserId),
      approved_at: new Date(),
    });
  }

  async rejectRequest(orgId: string, requestId: string, reason?: string) {
    const numOrgId = Number(orgId);
    const request = await this.db.findOne<any>("earned_wage_access_requests", {
      id: requestId,
      empcloud_org_id: numOrgId,
    });

    if (!request) throw new AppError(404, "NOT_FOUND", "Request not found");
    if (request.status !== "pending") {
      throw new AppError(
        400,
        "INVALID_STATUS",
        `Cannot reject a request with status "${request.status}"`,
      );
    }

    return this.db.update("earned_wage_access_requests", requestId, {
      status: "rejected",
      notes: reason || null,
    });
  }

  // ---------------------------------------------------------------------------
  // List / Query
  // ---------------------------------------------------------------------------

  async listRequests(orgId: string, filters?: { status?: string; employeeId?: string }) {
    const where: Record<string, any> = { empcloud_org_id: Number(orgId) };
    if (filters?.status) where.status = filters.status;
    if (filters?.employeeId) where.employee_id = Number(filters.employeeId);

    const result = await this.db.findMany<any>("earned_wage_access_requests", {
      filters: where,
      sort: { field: "requested_at", order: "desc" },
      limit: 200,
    });

    // Enrich with employee names
    const empIds = [...new Set(result.data.map((r: any) => String(r.employee_id)))];
    const empMap: Record<string, any> = {};
    for (const eid of empIds) {
      const emp = await this.db.findOne<any>("employees", { empcloud_user_id: Number(eid) });
      if (emp) empMap[eid] = emp;
    }

    return {
      ...result,
      data: result.data.map((r: any) => ({
        ...r,
        employee_name: empMap[String(r.employee_id)]
          ? `${empMap[String(r.employee_id)].first_name} ${empMap[String(r.employee_id)].last_name}`
          : `Employee #${r.employee_id}`,
        employee_code: empMap[String(r.employee_id)]?.employee_code || "",
      })),
    };
  }

  async getMyRequests(orgId: string, employeeId: string) {
    return this.db.findMany<any>("earned_wage_access_requests", {
      filters: {
        empcloud_org_id: Number(orgId),
        employee_id: Number(employeeId),
      },
      sort: { field: "requested_at", order: "desc" },
      limit: 50,
    });
  }

  // ---------------------------------------------------------------------------
  // Dashboard Stats
  // ---------------------------------------------------------------------------

  async getDashboard(orgId: string) {
    const numOrgId = Number(orgId);

    const totalPending = await this.db.count("earned_wage_access_requests", {
      empcloud_org_id: numOrgId,
      status: "pending",
    });

    const totalApproved = await this.db.count("earned_wage_access_requests", {
      empcloud_org_id: numOrgId,
      status: "approved",
    });

    const totalDisbursed = await this.db.count("earned_wage_access_requests", {
      empcloud_org_id: numOrgId,
      status: "disbursed",
    });

    // Sum disbursed amount
    const allApproved = await this.db.findMany<any>("earned_wage_access_requests", {
      filters: { empcloud_org_id: numOrgId },
      limit: 10000,
    });

    const totalDisbursedAmount = allApproved.data
      .filter((r: any) => r.status === "disbursed" || r.status === "approved")
      .reduce((sum: number, r: any) => sum + Number(r.amount), 0);

    const totalFees = allApproved.data
      .filter((r: any) => r.status !== "rejected")
      .reduce((sum: number, r: any) => sum + Number(r.fee_amount || 0), 0);

    const avgRequestAmount =
      allApproved.data.length > 0
        ? Math.round(
            allApproved.data.reduce((sum: number, r: any) => sum + Number(r.amount), 0) /
              allApproved.data.length,
          )
        : 0;

    return {
      totalPending,
      totalApproved,
      totalDisbursed,
      totalDisbursedAmount,
      totalFees,
      avgRequestAmount,
      totalRequests: allApproved.data.length,
    };
  }
}
