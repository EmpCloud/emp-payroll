import { Router } from "express";
import { LoanService } from "../../services/loan.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new LoanService();

router.use(authenticate);

router.get(
  "/",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const { status, employeeId, q, location_id, department_id, page, limit } = req.query as any;
    const data = await svc.list(String(req.user!.empcloudOrgId), {
      status: status as string,
      employeeId: employeeId as string,
      q: typeof q === "string" && q.trim() ? q.trim() : undefined,
      locationId: location_id ? Number(location_id) : undefined,
      departmentId: department_id ? Number(department_id) : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json({ success: true, data });
  }),
);

router.get(
  "/employee/:empId",
  wrap(async (req, res) => {
    const data = await svc.getByEmployee(param(req, "empId"));
    res.json({ success: true, data });
  }),
);

router.get(
  "/employee/:empId/emi-total",
  wrap(async (req, res) => {
    const total = await svc.getActiveEMIs(param(req, "empId"));
    res.json({ success: true, data: { totalEMI: total } });
  }),
);

router.post(
  "/",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.create(
      String(req.user!.empcloudOrgId),
      String(req.user!.empcloudUserId),
      req.body,
    );
    res.status(201).json({ success: true, data });
  }),
);

router.post(
  "/:id/payment",
  // #114 — Previously "hr_admin, hr_manager" only; org_admin / super_admin
  // hit 403 when clicking Pay EMI, which bubbled to the client as an
  // "Unknown error" toast. Align with the rest of the finance-facing
  // endpoints (GL export, etc.).
  authorize("hr_admin", "hr_manager", "org_admin", "super_admin"),
  wrap(async (req, res) => {
    // req.body may be undefined for bodyless POSTs; guard accordingly.
    const amount = req.body?.amount;
    const data = await svc.recordPayment(param(req, "id"), amount);
    res.json({ success: true, data });
  }),
);

router.post(
  "/:id/cancel",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.cancel(param(req, "id"));
    res.json({ success: true, data });
  }),
);

// Edit a loan/advance.
router.put(
  "/:id",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.update(param(req, "id"), String(req.user!.empcloudOrgId), req.body);
    res.json({ success: true, data });
  }),
);

// Permanently delete a loan/advance record.
router.delete(
  "/:id",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.delete(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

export { router as loanRoutes };
