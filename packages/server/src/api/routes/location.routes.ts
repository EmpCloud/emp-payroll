// Thin read proxy over EmpCloud's organization_locations, scoped to the
// caller's org. The payroll-side admin pages (Employees, Loans,
// Reimbursements, Tax Overview, Tax Declarations) drive their location
// filter dropdowns from this list. Read-only — locations are managed in
// EmpCloud HRMS.

import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { wrap } from "../helpers";
import { listOrgLocations } from "../../db/empcloud";

const router = Router();

router.use(authenticate);

router.get(
  "/",
  wrap(async (req, res) => {
    const orgId = Number(req.user!.empcloudOrgId);
    const rows = await listOrgLocations(orgId);
    const data = rows.map((r) => ({ id: String(r.id), name: r.name }));
    res.json({ success: true, data });
  }),
);

export { router as locationRoutes };
