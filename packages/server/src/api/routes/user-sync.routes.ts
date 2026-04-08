// =============================================================================
// EMP PAYROLL — User Sync Routes (called by EmpCloud)
// =============================================================================

import { Router, Request, Response } from "express";
import { config } from "../../config/index";

const router = Router();

// API key authentication middleware
function requireApiKey(req: Request, res: Response, next: Function) {
  const expectedKey = process.env.MODULE_SYNC_API_KEY || process.env.EMPCLOUD_API_KEY || "";
  // Skip auth if no key is configured (dev mode)
  if (!expectedKey) return next();
  const apiKey = req.headers["x-api-key"] as string;
  if (!apiKey || apiKey !== expectedKey) {
    return res.status(401).json({ success: false, message: "Invalid API key" });
  }
  next();
}

router.use(requireApiKey);

// POST /api/v1/users/sync — Create/update payroll profile from EmpCloud
router.post("/sync", async (req: Request, res: Response) => {
  try {
    const { empcloud_user_id, organization_id, email, first_name, last_name } = req.body;

    if (!empcloud_user_id || !organization_id || !email) {
      return res
        .status(400)
        .json({ success: false, message: "empcloud_user_id, organization_id, and email required" });
    }

    // Payroll uses empcloud DB directly — user already exists there
    // Just ensure a local payroll profile exists
    const { getDB } = await import("../../db/adapters/index");
    const payrollDb = getDB();

    const existing = await payrollDb.findOne<any>("employee_payroll_profiles", {
      empcloud_user_id,
      empcloud_org_id: organization_id,
    });

    if (existing) {
      return res.json({
        success: true,
        message: "Profile already exists",
        data: { id: existing.id },
      });
    }

    const created = await payrollDb.create<any>("employee_payroll_profiles", {
      empcloud_user_id,
      empcloud_org_id: organization_id,
      created_at: new Date(),
      updated_at: new Date(),
    });
    const id = created.id;

    // Notify EmpCloud about the seat
    try {
      const empcloudUrl = config.cloudHrms.apiUrl || "http://localhost:3000/api/v1";
      const syncApiKey = process.env.MODULE_SYNC_API_KEY || process.env.EMPCLOUD_API_KEY || "";
      await fetch(`${empcloudUrl}/subscriptions/seat-webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": syncApiKey },
        body: JSON.stringify({
          module_slug: "emp-payroll",
          empcloud_user_id,
          organization_id,
          action: "added",
        }),
        signal: AbortSignal.timeout(5000),
      });
    } catch (err: any) {
      console.error("Failed to notify EmpCloud:", err.message);
    }

    return res.status(201).json({ success: true, message: "Profile created", data: { id } });
  } catch (error: any) {
    console.error("User sync error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

// DELETE /api/v1/users/sync/:empcloudUserId — Remove payroll profile
router.delete("/sync/:empcloudUserId", async (req: Request, res: Response) => {
  try {
    const empcloudUserId = Number(req.params.empcloudUserId);

    const { getDB } = await import("../../db/adapters/index");
    const payrollDb = getDB();

    const profile = await payrollDb.findOne<any>("employee_payroll_profiles", {
      empcloud_user_id: empcloudUserId,
    });

    if (!profile) {
      return res.status(404).json({ success: false, message: "Payroll profile not found" });
    }

    // Soft delete — mark as inactive
    await payrollDb.update("employee_payroll_profiles", profile.id, {
      is_active: false,
      updated_at: new Date(),
    });

    // No webhook callback here — EmpCloud already handles seat removal
    // when it calls this DELETE endpoint. Webhook only fires when users
    // are removed directly inside Payroll (not via EmpCloud sync).

    return res.json({ success: true, message: "Profile deactivated" });
  } catch (error: any) {
    console.error("User unsync error:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
});

export { router as userSyncRoutes };
