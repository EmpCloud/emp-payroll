import { Router } from "express";
import { LeaveService } from "../../services/leave.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new LeaveService();

router.use(authenticate);

// ---- Employee Self-Service ----

// Apply for leave
router.post("/apply", wrap(async (req, res) => {
  const data = await svc.applyLeave(req.user!.userId, req.user!.orgId, req.body);
  res.status(201).json({ success: true, data });
}));

// My leave requests
router.get("/my-requests", wrap(async (req, res) => {
  const data = await svc.getMyRequests(req.user!.userId, req.query.status as string);
  res.json({ success: true, data });
}));

// My leave balance
router.get("/my-balance", wrap(async (req, res) => {
  const data = await svc.getBalances(req.user!.userId, req.query.fy as string);
  res.json({ success: true, data });
}));

// Cancel my leave
router.post("/:id/cancel", wrap(async (req, res) => {
  const data = await svc.cancelLeave(param(req, "id"), req.user!.userId);
  res.json({ success: true, data });
}));

// ---- Admin / HR Manager ----

// Org-wide leave requests
router.get("/requests", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const data = await svc.getOrgRequests(req.user!.orgId, req.query.status as string);
  res.json({ success: true, data });
}));

// Approve leave
router.post("/:id/approve", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const data = await svc.approveLeave(param(req, "id"), req.user!.userId, req.body.remarks);
  res.json({ success: true, data });
}));

// Reject leave
router.post("/:id/reject", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const data = await svc.rejectLeave(param(req, "id"), req.user!.userId, req.body.remarks);
  res.json({ success: true, data });
}));

// Org-wide balances
router.get("/", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const data = await svc.getOrgBalances(req.user!.orgId, req.query.fy as string);
  res.json({ success: true, data });
}));

// Employee balance
router.get("/employee/:empId", wrap(async (req, res) => {
  const data = await svc.getBalances(param(req, "empId"), req.query.fy as string);
  res.json({ success: true, data });
}));

// Record leave (admin)
router.post("/employee/:empId/record", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const data = await svc.recordLeave(param(req, "empId"), req.body.leaveType, req.body.days);
  res.json({ success: true, data });
}));

// Adjust balance (admin)
router.post("/employee/:empId/adjust", authorize("hr_admin"), wrap(async (req, res) => {
  const data = await svc.adjustBalance(param(req, "empId"), req.body.leaveType, req.body.adjustment);
  res.json({ success: true, data });
}));

export { router as leaveRoutes };
