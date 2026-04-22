import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

export class BenefitsService {
  private db = getDB();

  // ---------------------------------------------------------------------------
  // Benefit Plans
  // ---------------------------------------------------------------------------

  async listPlans(orgId: string, filters?: { type?: string; active?: boolean }) {
    const where: Record<string, any> = { empcloud_org_id: Number(orgId) };
    if (filters?.type) where.type = filters.type;
    // #168 — deletePlan soft-deletes by setting is_active=false, but the
    // list was returning every row regardless. Deactivated plans kept
    // showing in the Benefits Plans table even though the admin had just
    // "deleted" them. Match the insurance-policies pattern (#99): hide
    // inactive rows by default; callers can still pass active=false to
    // see them.
    if (filters?.active !== undefined) {
      where.is_active = filters.active;
    } else {
      where.is_active = true;
    }
    return this.db.findMany<any>("benefit_plans", {
      filters: where,
      sort: { field: "created_at", order: "desc" },
    });
  }

  async getPlan(id: string, orgId: string) {
    const plan = await this.db.findOne<any>("benefit_plans", {
      id,
      empcloud_org_id: Number(orgId),
    });
    if (!plan) throw new AppError(404, "NOT_FOUND", "Benefit plan not found");
    return plan;
  }

  async createPlan(orgId: string, data: any) {
    return this.db.create("benefit_plans", {
      empcloud_org_id: Number(orgId),
      name: data.name,
      type: data.type,
      provider: data.provider || null,
      description: data.description || null,
      premium_amount: data.premiumAmount || 0,
      employer_contribution: data.employerContribution || 0,
      coverage_details: data.coverageDetails ? JSON.stringify(data.coverageDetails) : null,
      enrollment_period_start: data.enrollmentPeriodStart || null,
      enrollment_period_end: data.enrollmentPeriodEnd || null,
      is_active: true,
    });
  }

  async updatePlan(id: string, orgId: string, data: any) {
    await this.getPlan(id, orgId);
    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.provider !== undefined) updateData.provider = data.provider;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.premiumAmount !== undefined) updateData.premium_amount = data.premiumAmount;
    if (data.employerContribution !== undefined)
      updateData.employer_contribution = data.employerContribution;
    if (data.coverageDetails !== undefined)
      updateData.coverage_details = JSON.stringify(data.coverageDetails);
    if (data.enrollmentPeriodStart !== undefined)
      updateData.enrollment_period_start = data.enrollmentPeriodStart;
    if (data.enrollmentPeriodEnd !== undefined)
      updateData.enrollment_period_end = data.enrollmentPeriodEnd;
    if (data.isActive !== undefined) updateData.is_active = data.isActive;
    return this.db.update("benefit_plans", id, updateData);
  }

  async deletePlan(id: string, orgId: string) {
    await this.getPlan(id, orgId);
    await this.db.update("benefit_plans", id, { is_active: false });
    return { message: "Benefit plan deactivated" };
  }

  // ---------------------------------------------------------------------------
  // Employee Enrollments
  // ---------------------------------------------------------------------------

  async enrollEmployee(orgId: string, data: any) {
    // Verify plan exists and is active
    const plan = await this.getPlan(data.planId, orgId);
    if (!plan.is_active) {
      throw new AppError(400, "PLAN_INACTIVE", "Cannot enroll in an inactive plan");
    }

    // Check for existing active enrollment in same plan
    const existing = await this.db.findOne<any>("employee_benefits", {
      empcloud_org_id: Number(orgId),
      empcloud_user_id: Number(data.employeeId),
      plan_id: data.planId,
      status: "enrolled",
    });
    if (existing) {
      throw new AppError(409, "ALREADY_ENROLLED", "Employee is already enrolled in this plan");
    }

    const enrollment = await this.db.create<any>("employee_benefits", {
      empcloud_org_id: Number(orgId),
      empcloud_user_id: Number(data.employeeId),
      plan_id: data.planId,
      status: data.status || "pending",
      coverage_type: data.coverageType || "individual",
      start_date: data.startDate,
      end_date: data.endDate || null,
      premium_employee_share: data.premiumEmployeeShare || 0,
      premium_employer_share: data.premiumEmployerShare || plan.employer_contribution,
    });

    // Add dependents if provided
    if (data.dependents?.length) {
      for (const dep of data.dependents) {
        await this.db.create("benefit_dependents", {
          enrollment_id: enrollment.id,
          empcloud_org_id: Number(orgId),
          name: dep.name,
          relationship: dep.relationship,
          date_of_birth: dep.dateOfBirth || null,
        });
      }
    }

    return enrollment;
  }

  async listEmployeeBenefits(orgId: string, employeeId: string) {
    const enrollments = await this.db.findMany<any>("employee_benefits", {
      filters: {
        empcloud_org_id: Number(orgId),
        empcloud_user_id: Number(employeeId),
      },
      sort: { field: "created_at", order: "desc" },
    });

    // Enrich with plan details
    const data = [];
    for (const enrollment of enrollments.data) {
      const plan = await this.db.findById<any>("benefit_plans", enrollment.plan_id);
      const dependents = await this.db.findMany<any>("benefit_dependents", {
        filters: { enrollment_id: enrollment.id },
      });
      data.push({
        ...enrollment,
        plan,
        dependents: dependents.data,
      });
    }

    return { data, total: data.length, page: 1, limit: 100, totalPages: 1 };
  }

  async listAllEnrollments(orgId: string, filters?: { status?: string; planId?: string }) {
    const where: Record<string, any> = { empcloud_org_id: Number(orgId) };
    if (filters?.status) where.status = filters.status;
    if (filters?.planId) where.plan_id = filters.planId;
    return this.db.findMany<any>("employee_benefits", {
      filters: where,
      sort: { field: "created_at", order: "desc" },
      limit: 500,
    });
  }

  async updateEnrollment(id: string, orgId: string, data: any) {
    const enrollment = await this.db.findOne<any>("employee_benefits", {
      id,
      empcloud_org_id: Number(orgId),
    });
    if (!enrollment) throw new AppError(404, "NOT_FOUND", "Enrollment not found");

    const updateData: Record<string, any> = {};
    if (data.status !== undefined) updateData.status = data.status;
    if (data.coverageType !== undefined) updateData.coverage_type = data.coverageType;
    if (data.endDate !== undefined) updateData.end_date = data.endDate;
    if (data.premiumEmployeeShare !== undefined)
      updateData.premium_employee_share = data.premiumEmployeeShare;
    if (data.premiumEmployerShare !== undefined)
      updateData.premium_employer_share = data.premiumEmployerShare;

    return this.db.update("employee_benefits", id, updateData);
  }

  async cancelEnrollment(id: string, orgId: string) {
    const enrollment = await this.db.findOne<any>("employee_benefits", {
      id,
      empcloud_org_id: Number(orgId),
    });
    if (!enrollment) throw new AppError(404, "NOT_FOUND", "Enrollment not found");
    return this.db.update("employee_benefits", id, {
      status: "cancelled",
      end_date: new Date().toISOString().split("T")[0],
    });
  }

  // ---------------------------------------------------------------------------
  // Admin Dashboard Stats
  // ---------------------------------------------------------------------------

  async getDashboardStats(orgId: string) {
    const numOrgId = Number(orgId);

    const totalPlans = await this.db.count("benefit_plans", {
      empcloud_org_id: numOrgId,
      is_active: true,
    });

    const totalEnrolled = await this.db.count("employee_benefits", {
      empcloud_org_id: numOrgId,
      status: "enrolled",
    });

    const totalPending = await this.db.count("employee_benefits", {
      empcloud_org_id: numOrgId,
      status: "pending",
    });

    // Sum of employer contributions for active enrollments
    const enrollments = await this.db.findMany<any>("employee_benefits", {
      filters: { empcloud_org_id: numOrgId, status: "enrolled" },
      limit: 10000,
    });
    const totalEmployerCost = enrollments.data.reduce(
      (sum: number, e: any) => sum + Number(e.premium_employer_share || 0),
      0,
    );
    const totalEmployeeCost = enrollments.data.reduce(
      (sum: number, e: any) => sum + Number(e.premium_employee_share || 0),
      0,
    );

    // Plans breakdown by type
    const plans = await this.db.findMany<any>("benefit_plans", {
      filters: { empcloud_org_id: numOrgId, is_active: true },
      limit: 100,
    });
    const plansByType: Record<string, number> = {};
    for (const p of plans.data) {
      plansByType[p.type] = (plansByType[p.type] || 0) + 1;
    }

    return {
      totalPlans,
      totalEnrolled,
      totalPending,
      totalEmployerCost,
      totalEmployeeCost,
      totalCost: totalEmployerCost + totalEmployeeCost,
      plansByType,
    };
  }
}
