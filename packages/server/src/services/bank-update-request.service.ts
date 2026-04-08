import { getDB } from "../db/adapters";
import { AppError } from "../api/middleware/error.middleware";
import { v4 as uuidv4 } from "uuid";

export class BankUpdateRequestService {
  private db = getDB();

  async submit(
    empcloudUserId: number,
    empcloudOrgId: number,
    data: {
      currentDetails: any;
      requestedDetails: any;
      reason?: string;
    },
  ) {
    // Check for existing pending request
    const existing = await this.db.findOne<any>("bank_update_requests", {
      empcloud_user_id: empcloudUserId,
      status: "pending",
    });
    if (existing) {
      throw new AppError(
        400,
        "PENDING_EXISTS",
        "You already have a pending bank update request. Please wait for it to be reviewed.",
      );
    }

    return this.db.create("bank_update_requests", {
      id: uuidv4(),
      empcloud_user_id: empcloudUserId,
      empcloud_org_id: empcloudOrgId,
      current_details: JSON.stringify(data.currentDetails),
      requested_details: JSON.stringify(data.requestedDetails),
      reason: data.reason || null,
      status: "pending",
    });
  }

  async getMyRequests(empcloudUserId: number) {
    return this.db.findMany<any>("bank_update_requests", {
      filters: { empcloud_user_id: empcloudUserId },
      sort: { field: "created_at", order: "desc" },
      limit: 20,
    });
  }

  async getOrgRequests(empcloudOrgId: number, status?: string) {
    const filters: any = { empcloud_org_id: empcloudOrgId };
    if (status) filters.status = status;
    return this.db.findMany<any>("bank_update_requests", {
      filters,
      sort: { field: "created_at", order: "desc" },
      limit: 100,
    });
  }

  async approve(requestId: string, reviewerId: number) {
    const req = await this.db.findById<any>("bank_update_requests", requestId);
    if (!req) throw new AppError(404, "NOT_FOUND", "Request not found");
    if (req.status !== "pending")
      throw new AppError(400, "INVALID_STATUS", "Request is not pending");

    // Update the employee's bank details in payroll profile
    const profile = await this.db.findOne<any>("employee_payroll_profiles", {
      empcloud_user_id: req.empcloud_user_id,
    });
    if (profile) {
      const details =
        typeof req.requested_details === "string"
          ? req.requested_details
          : JSON.stringify(req.requested_details);
      await this.db.update("employee_payroll_profiles", profile.id, {
        bank_details: details,
      });
    }

    return this.db.update("bank_update_requests", requestId, {
      status: "approved",
      reviewed_by: reviewerId,
      reviewed_at: new Date(),
    });
  }

  async reject(requestId: string, reviewerId: number, remarks?: string) {
    const req = await this.db.findById<any>("bank_update_requests", requestId);
    if (!req) throw new AppError(404, "NOT_FOUND", "Request not found");
    if (req.status !== "pending")
      throw new AppError(400, "INVALID_STATUS", "Request is not pending");

    return this.db.update("bank_update_requests", requestId, {
      status: "rejected",
      reviewed_by: reviewerId,
      review_remarks: remarks || null,
      reviewed_at: new Date(),
    });
  }
}
