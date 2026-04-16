// NOTE: When USE_CLOUD_HRMS=true, payroll computation fetches attendance/leave
// data from EMP Cloud's HRMS APIs (via cloud-hrms.service.ts).
// These local routes remain as a fallback and for backward compatibility.

import { Router } from "express";
import { LeaveService } from "../../services/leave.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { wrap, param } from "../helpers";
import { validate, applyLeaveSchema } from "../validators";

const router = Router();
const svc = new LeaveService();

router.use(authenticate);

// ---- Employee Self-Service ----

// Apply for leave (auto-routes to reporting manager)
router.post(
  "/apply",
  validate(applyLeaveSchema),
  wrap(async (req, res) => {
    const data = await svc.applyLeave(
      String(req.user!.empcloudUserId),
      String(req.user!.empcloudOrgId),
      req.body,
    );
    res.status(201).json({ success: true, data });
  }),
);

// My leave requests
router.get(
  "/my-requests",
  wrap(async (req, res) => {
    const data = await svc.getMyRequests(
      String(req.user!.empcloudUserId),
      req.query.status as string,
    );
    res.json({ success: true, data });
  }),
);

// My leave balance
router.get(
  "/my-balance",
  wrap(async (req, res) => {
    const data = await svc.getBalances(String(req.user!.empcloudUserId), req.query.fy as string);
    res.json({ success: true, data });
  }),
);

// Active leave types for the caller's org — drives the Apply Leave dropdown
// (#12). EmpCloud stores codes like CL / SL / EL; the client used to hardcode
// casual / sick / earned, so every apply-leave attempt 400'd.
router.get(
  "/types",
  wrap(async (req, res) => {
    const data = await svc.listLeaveTypes(String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

// Cancel leave (employee — immediate)
router.post(
  "/:id/cancel",
  wrap(async (req, res) => {
    const data = await svc.cancelLeave(
      param(req, "id"),
      String(req.user!.empcloudUserId),
      req.body.reason || "",
    );
    res.json({ success: true, data });
  }),
);

// ---- Manager: Team leaves (direct reports per org chart) ----

// Get leaves assigned to me (my direct reports)
router.get(
  "/team",
  wrap(async (req, res) => {
    const data = await svc.getTeamRequests(
      String(req.user!.empcloudUserId),
      req.query.status as string,
    );
    res.json({ success: true, data });
  }),
);

// Approve leave (must be assigned manager or HR admin)
router.post(
  "/:id/approve",
  wrap(async (req, res) => {
    const data = await svc.approveLeave(
      param(req, "id"),
      String(req.user!.empcloudUserId),
      req.user!.role,
      req.body.remarks,
    );
    res.json({ success: true, data });
  }),
);

// Reject leave (must be assigned manager or HR admin)
router.post(
  "/:id/reject",
  wrap(async (req, res) => {
    const data = await svc.rejectLeave(
      param(req, "id"),
      String(req.user!.empcloudUserId),
      req.user!.role,
      req.body.remarks,
    );
    res.json({ success: true, data });
  }),
);

// ---- HR Admin: Org-wide view ----

// All org leave requests (HR admin/manager only)
router.get(
  "/requests",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.getOrgRequests(
      String(req.user!.empcloudOrgId),
      req.query.status as string,
    );
    res.json({ success: true, data });
  }),
);

// Leave summary for attendance sync
router.get(
  "/attendance-sync",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    if (!month || !year) throw new Error("month and year required");
    const data = await svc.getLeaveSummaryForMonth(String(req.user!.empcloudOrgId), month, year);
    res.json({ success: true, data });
  }),
);

// Org-wide balances
router.get(
  "/",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.getOrgBalances(String(req.user!.empcloudOrgId), req.query.fy as string);
    res.json({ success: true, data });
  }),
);

// Employee balance
router.get(
  "/employee/:empId",
  wrap(async (req, res) => {
    const data = await svc.getBalances(param(req, "empId"), req.query.fy as string);
    res.json({ success: true, data });
  }),
);

// Record leave (admin)
router.post(
  "/employee/:empId/record",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.recordLeave(param(req, "empId"), req.body.leaveType, req.body.days);
    res.json({ success: true, data });
  }),
);

// Adjust balance (admin)
router.post(
  "/employee/:empId/adjust",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.adjustBalance(
      param(req, "empId"),
      req.body.leaveType,
      req.body.adjustment,
    );
    res.json({ success: true, data });
  }),
);

export { router as leaveRoutes };
