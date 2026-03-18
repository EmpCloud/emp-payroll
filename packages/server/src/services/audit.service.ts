import { getDB } from "../db/adapters";
import { v4 as uuidv4 } from "uuid";

export class AuditService {
  private db = getDB();

  async log(params: {
    orgId: string;
    userId: string;
    action: string;
    entityType: string;
    entityId?: string;
    oldValue?: any;
    newValue?: any;
    ipAddress?: string;
  }) {
    return this.db.create("audit_logs", {
      id: uuidv4(),
      org_id: params.orgId,
      user_id: params.userId,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId || null,
      old_value: params.oldValue ? JSON.stringify(params.oldValue) : null,
      new_value: params.newValue ? JSON.stringify(params.newValue) : null,
      ip_address: params.ipAddress || null,
      created_at: new Date(),
    });
  }

  async getRecent(orgId: string, limit: number = 20) {
    return this.db.findMany<any>("audit_logs", {
      filters: { org_id: orgId },
      sort: { field: "created_at", order: "desc" },
      limit,
    });
  }
}
