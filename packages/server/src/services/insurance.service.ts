import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";

export class InsuranceService {
  private db = getDB();

  // ---------------------------------------------------------------------------
  // Policies
  // ---------------------------------------------------------------------------

  async listPolicies(orgId: string, filters?: { type?: string; status?: string }) {
    const where: Record<string, any> = { empcloud_org_id: Number(orgId) };
    if (filters?.type) where.type = filters.type;
    if (filters?.status) {
      where.status = filters.status;
    } else {
      // #99 — deletePolicy sets status to "cancelled" (soft delete), but the
      // default list was showing every row regardless of status, so the item
      // the admin just deleted kept showing in the UI. Filter cancelled rows
      // out of the default list; callers can still pass status=cancelled to
      // see them.
      where.status = { op: "!=", value: "cancelled" };
    }
    return this.db.findMany<any>("insurance_policies", {
      filters: where,
      sort: { field: "created_at", order: "desc" },
    });
  }

  async getPolicy(id: string, orgId: string) {
    const policy = await this.db.findOne<any>("insurance_policies", {
      id,
      empcloud_org_id: Number(orgId),
    });
    if (!policy) throw new AppError(404, "NOT_FOUND", "Insurance policy not found");
    return policy;
  }

  async createPolicy(orgId: string, data: any) {
    return this.db.create("insurance_policies", {
      empcloud_org_id: Number(orgId),
      name: data.name,
      policy_number: data.policyNumber || null,
      provider: data.provider,
      type: data.type,
      premium_total: data.premiumTotal || 0,
      premium_per_employee: data.premiumPerEmployee || 0,
      coverage_amount: data.coverageAmount || 0,
      start_date: data.startDate,
      end_date: data.endDate || null,
      renewal_date: data.renewalDate || null,
      status: "active",
      document_url: data.documentUrl || null,
      terms: data.terms || null,
    });
  }

  async updatePolicy(id: string, orgId: string, data: any) {
    await this.getPolicy(id, orgId);
    const updateData: Record<string, any> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.policyNumber !== undefined) updateData.policy_number = data.policyNumber;
    if (data.provider !== undefined) updateData.provider = data.provider;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.premiumTotal !== undefined) updateData.premium_total = data.premiumTotal;
    if (data.premiumPerEmployee !== undefined)
      updateData.premium_per_employee = data.premiumPerEmployee;
    if (data.coverageAmount !== undefined) updateData.coverage_amount = data.coverageAmount;
    if (data.startDate !== undefined) updateData.start_date = data.startDate;
    if (data.endDate !== undefined) updateData.end_date = data.endDate;
    if (data.renewalDate !== undefined) updateData.renewal_date = data.renewalDate;
    if (data.status !== undefined) updateData.status = data.status;
    if (data.documentUrl !== undefined) updateData.document_url = data.documentUrl;
    if (data.terms !== undefined) updateData.terms = data.terms;
    return this.db.update("insurance_policies", id, updateData);
  }

  async deletePolicy(id: string, orgId: string) {
    await this.getPolicy(id, orgId);
    return this.db.update("insurance_policies", id, { status: "cancelled" });
  }

  // ---------------------------------------------------------------------------
  // Employee Enrollment
  // ---------------------------------------------------------------------------

  async enrollEmployee(orgId: string, data: any) {
    const numOrgId = Number(orgId);
    const policy = await this.getPolicy(data.policyId, orgId);
    if (policy.status !== "active") {
      throw new AppError(400, "POLICY_INACTIVE", "Cannot enroll in an inactive policy");
    }

    // Check duplicate enrollment
    const existing = await this.db.findOne<any>("employee_insurance", {
      empcloud_org_id: numOrgId,
      policy_id: data.policyId,
      employee_id: Number(data.employeeId),
      status: "active",
    });
    if (existing) {
      throw new AppError(409, "ALREADY_ENROLLED", "Employee is already enrolled in this policy");
    }

    return this.db.create("employee_insurance", {
      empcloud_org_id: numOrgId,
      policy_id: data.policyId,
      employee_id: Number(data.employeeId),
      status: "active",
      sum_insured: data.sumInsured || policy.coverage_amount,
      premium_share: data.premiumShare || 0,
      nominee_name: data.nomineeName || null,
      nominee_relationship: data.nomineeRelationship || null,
      enrolled_at: new Date().toISOString().split("T")[0],
    });
  }

  async listEnrollments(
    orgId: string,
    filters?: { policyId?: string; employeeId?: string; status?: string },
  ) {
    const where: Record<string, any> = { empcloud_org_id: Number(orgId) };
    if (filters?.policyId) where.policy_id = filters.policyId;
    if (filters?.employeeId) where.employee_id = Number(filters.employeeId);
    if (filters?.status) where.status = filters.status;

    const result = await this.db.findMany<any>("employee_insurance", {
      filters: where,
      sort: { field: "created_at", order: "desc" },
      limit: 500,
    });

    // Enrich with policy names and employee names
    const policyIds = [...new Set(result.data.map((e: any) => e.policy_id))];
    const policyMap: Record<string, any> = {};
    for (const pid of policyIds) {
      const policy = await this.db.findById<any>("insurance_policies", pid as string);
      if (policy) policyMap[pid as string] = policy;
    }

    const empIds = [...new Set(result.data.map((e: any) => String(e.employee_id)))];
    const empMap: Record<string, any> = {};
    for (const eid of empIds) {
      const emp = await this.db.findOne<any>("employees", { empcloud_user_id: Number(eid) });
      if (emp) empMap[eid] = emp;
    }

    return {
      ...result,
      data: result.data.map((e: any) => ({
        ...e,
        policy_name: policyMap[e.policy_id]?.name || "Unknown",
        policy_type: policyMap[e.policy_id]?.type || "",
        employee_name: empMap[String(e.employee_id)]
          ? `${empMap[String(e.employee_id)].first_name} ${empMap[String(e.employee_id)].last_name}`
          : `Employee #${e.employee_id}`,
      })),
    };
  }

  async getMyInsurance(orgId: string, employeeId: string) {
    const enrollments = await this.db.findMany<any>("employee_insurance", {
      filters: {
        empcloud_org_id: Number(orgId),
        employee_id: Number(employeeId),
      },
      sort: { field: "created_at", order: "desc" },
    });

    // Enrich with policy details
    const data = [];
    for (const enrollment of enrollments.data) {
      const policy = await this.db.findById<any>("insurance_policies", enrollment.policy_id);
      data.push({ ...enrollment, policy });
    }

    return { data, total: data.length, page: 1, limit: 100, totalPages: 1 };
  }

  async updateEnrollment(id: string, orgId: string, data: any) {
    const enrollment = await this.db.findOne<any>("employee_insurance", {
      id,
      empcloud_org_id: Number(orgId),
    });
    if (!enrollment) throw new AppError(404, "NOT_FOUND", "Enrollment not found");

    const updateData: Record<string, any> = {};
    if (data.status !== undefined) updateData.status = data.status;
    if (data.sumInsured !== undefined) updateData.sum_insured = data.sumInsured;
    if (data.premiumShare !== undefined) updateData.premium_share = data.premiumShare;
    if (data.nomineeName !== undefined) updateData.nominee_name = data.nomineeName;
    if (data.nomineeRelationship !== undefined)
      updateData.nominee_relationship = data.nomineeRelationship;

    return this.db.update("employee_insurance", id, updateData);
  }

  async cancelEnrollment(id: string, orgId: string) {
    const enrollment = await this.db.findOne<any>("employee_insurance", {
      id,
      empcloud_org_id: Number(orgId),
    });
    if (!enrollment) throw new AppError(404, "NOT_FOUND", "Enrollment not found");
    return this.db.update("employee_insurance", id, { status: "inactive" });
  }

  // ---------------------------------------------------------------------------
  // Claims
  // ---------------------------------------------------------------------------

  async submitClaim(orgId: string, employeeId: string, data: any) {
    const numOrgId = Number(orgId);

    // Verify employee is enrolled in the policy
    const enrollment = await this.db.findOne<any>("employee_insurance", {
      empcloud_org_id: numOrgId,
      policy_id: data.policyId,
      employee_id: Number(employeeId),
      status: "active",
    });
    if (!enrollment) {
      throw new AppError(400, "NOT_ENROLLED", "You are not enrolled in this insurance policy");
    }

    // Generate claim number: CLM-YYYY-NNNN
    const year = new Date().getFullYear();
    const existingClaims = await this.db.count("insurance_claims", {
      empcloud_org_id: numOrgId,
    });
    const claimNumber = `CLM-${year}-${String(existingClaims + 1).padStart(4, "0")}`;

    return this.db.create("insurance_claims", {
      empcloud_org_id: numOrgId,
      policy_id: data.policyId,
      employee_id: Number(employeeId),
      claim_number: claimNumber,
      claim_type: data.claimType,
      amount_claimed: data.amountClaimed,
      status: "submitted",
      description: data.description || null,
      documents: data.documents ? JSON.stringify(data.documents) : null,
      submitted_at: new Date(),
      notes: data.notes || null,
    });
  }

  async listClaims(
    orgId: string,
    filters?: { status?: string; employeeId?: string; policyId?: string },
  ) {
    const where: Record<string, any> = { empcloud_org_id: Number(orgId) };
    if (filters?.status) where.status = filters.status;
    if (filters?.employeeId) where.employee_id = Number(filters.employeeId);
    if (filters?.policyId) where.policy_id = filters.policyId;

    const result = await this.db.findMany<any>("insurance_claims", {
      filters: where,
      sort: { field: "submitted_at", order: "desc" },
      limit: 200,
    });

    // Enrich with employee names
    const empIds = [...new Set(result.data.map((c: any) => String(c.employee_id)))];
    const empMap: Record<string, any> = {};
    for (const eid of empIds) {
      const emp = await this.db.findOne<any>("employees", { empcloud_user_id: Number(eid) });
      if (emp) empMap[eid] = emp;
    }

    return {
      ...result,
      data: result.data.map((c: any) => ({
        ...c,
        documents: typeof c.documents === "string" ? JSON.parse(c.documents) : c.documents,
        employee_name: empMap[String(c.employee_id)]
          ? `${empMap[String(c.employee_id)].first_name} ${empMap[String(c.employee_id)].last_name}`
          : `Employee #${c.employee_id}`,
      })),
    };
  }

  async getMyClaims(orgId: string, employeeId: string) {
    const result = await this.db.findMany<any>("insurance_claims", {
      filters: {
        empcloud_org_id: Number(orgId),
        employee_id: Number(employeeId),
      },
      sort: { field: "submitted_at", order: "desc" },
      limit: 50,
    });

    // Enrich with policy names
    const policyIds = [...new Set(result.data.map((c: any) => c.policy_id))];
    const policyMap: Record<string, any> = {};
    for (const pid of policyIds) {
      const policy = await this.db.findById<any>("insurance_policies", pid as string);
      if (policy) policyMap[pid as string] = policy;
    }

    return {
      ...result,
      data: result.data.map((c: any) => ({
        ...c,
        documents: typeof c.documents === "string" ? JSON.parse(c.documents) : c.documents,
        policy_name: policyMap[c.policy_id]?.name || "Unknown",
      })),
    };
  }

  async reviewClaim(
    orgId: string,
    claimId: string,
    reviewerUserId: string,
    action: "approve" | "reject",
    data?: {
      amountApproved?: number;
      rejectionReason?: string;
      notes?: string;
    },
  ) {
    const claim = await this.db.findOne<any>("insurance_claims", {
      id: claimId,
      empcloud_org_id: Number(orgId),
    });
    if (!claim) throw new AppError(404, "NOT_FOUND", "Claim not found");
    if (claim.status !== "submitted" && claim.status !== "under_review") {
      throw new AppError(
        400,
        "INVALID_STATUS",
        `Cannot ${action} a claim with status "${claim.status}"`,
      );
    }

    if (action === "approve") {
      return this.db.update("insurance_claims", claimId, {
        status: "approved",
        amount_approved: data?.amountApproved || claim.amount_claimed,
        reviewed_by: Number(reviewerUserId),
        reviewed_at: new Date(),
        notes: data?.notes || null,
      });
    } else {
      return this.db.update("insurance_claims", claimId, {
        status: "rejected",
        reviewed_by: Number(reviewerUserId),
        reviewed_at: new Date(),
        rejection_reason: data?.rejectionReason || null,
        notes: data?.notes || null,
      });
    }
  }

  async settleClaim(orgId: string, claimId: string) {
    const claim = await this.db.findOne<any>("insurance_claims", {
      id: claimId,
      empcloud_org_id: Number(orgId),
    });
    if (!claim) throw new AppError(404, "NOT_FOUND", "Claim not found");
    if (claim.status !== "approved") {
      throw new AppError(400, "INVALID_STATUS", "Only approved claims can be settled");
    }

    return this.db.update("insurance_claims", claimId, {
      status: "settled",
      settled_at: new Date(),
    });
  }

  // ---------------------------------------------------------------------------
  // Dashboard Stats
  // ---------------------------------------------------------------------------

  async getDashboardStats(orgId: string) {
    const numOrgId = Number(orgId);

    const totalPolicies = await this.db.count("insurance_policies", {
      empcloud_org_id: numOrgId,
      status: "active",
    });

    const totalEnrollments = await this.db.count("employee_insurance", {
      empcloud_org_id: numOrgId,
      status: "active",
    });

    const pendingClaims = await this.db.count("insurance_claims", {
      empcloud_org_id: numOrgId,
      status: "submitted",
    });

    const underReviewClaims = await this.db.count("insurance_claims", {
      empcloud_org_id: numOrgId,
      status: "under_review",
    });

    // Claims stats
    const allClaims = await this.db.findMany<any>("insurance_claims", {
      filters: { empcloud_org_id: numOrgId },
      limit: 10000,
    });

    const totalClaimsAmount = allClaims.data.reduce(
      (sum: number, c: any) => sum + Number(c.amount_claimed),
      0,
    );
    const totalApprovedAmount = allClaims.data
      .filter((c: any) => c.status === "approved" || c.status === "settled")
      .reduce((sum: number, c: any) => sum + Number(c.amount_approved || 0), 0);

    // Policies by type
    const policies = await this.db.findMany<any>("insurance_policies", {
      filters: { empcloud_org_id: numOrgId, status: "active" },
      limit: 100,
    });
    const policiesByType: Record<string, number> = {};
    for (const p of policies.data) {
      policiesByType[p.type] = (policiesByType[p.type] || 0) + 1;
    }

    return {
      totalPolicies,
      totalEnrollments,
      pendingClaims,
      underReviewClaims,
      totalClaims: allClaims.data.length,
      totalClaimsAmount,
      totalApprovedAmount,
      policiesByType,
    };
  }
}
