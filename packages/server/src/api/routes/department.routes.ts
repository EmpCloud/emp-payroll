// ============================================================================
// DEPARTMENT ROUTES
// Thin CRUD over EmpCloud's organization_departments table, scoped to the
// caller's org. Used by:
//   - Employee Add form (Department dropdown, #48)
//   - Departments management page (side-nav entry, #48)
// ============================================================================

import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { wrap, param } from "../helpers";
import { getEmpCloudDB } from "../../db/empcloud";

const router = Router();

router.use(authenticate);

// GET /departments — list departments for caller's org
router.get(
  "/",
  wrap(async (req, res) => {
    const db = getEmpCloudDB();
    const orgId = Number(req.user!.empcloudOrgId);
    const rows = await db("organization_departments")
      .where({ organization_id: orgId, is_deleted: false })
      .select("id", "name", "created_at", "updated_at")
      .orderBy("name", "asc");
    const data = rows.map((r: any) => ({
      id: String(r.id),
      name: r.name,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
    res.json({ success: true, data });
  }),
);

// POST /departments — create a new department in caller's org
router.post(
  "/",
  authorize("hr_admin", "hr_manager", "org_admin"),
  wrap(async (req, res) => {
    const db = getEmpCloudDB();
    const orgId = Number(req.user!.empcloudOrgId);
    const name = (req.body?.name || "").toString().trim();
    if (!name) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "Department name is required" },
      });
    }
    const existing = await db("organization_departments")
      .where({ organization_id: orgId, name, is_deleted: false })
      .first();
    if (existing) {
      return res.status(409).json({
        success: false,
        error: { code: "DUPLICATE", message: "Department with this name already exists" },
      });
    }
    const [id] = await db("organization_departments").insert({
      name,
      organization_id: orgId,
      is_deleted: false,
      created_at: new Date(),
      updated_at: new Date(),
    });
    res.status(201).json({ success: true, data: { id: String(id), name } });
  }),
);

// DELETE /departments/:id — soft-delete a department in caller's org
router.delete(
  "/:id",
  authorize("hr_admin", "org_admin"),
  wrap(async (req, res) => {
    const db = getEmpCloudDB();
    const orgId = Number(req.user!.empcloudOrgId);
    const id = Number(param(req, "id"));
    await db("organization_departments")
      .where({ id, organization_id: orgId })
      .update({ is_deleted: true, updated_at: new Date() });
    res.json({ success: true, data: { message: "Department removed" } });
  }),
);

export { router as departmentRoutes };
