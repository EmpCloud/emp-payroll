import { Router } from "express";
import { LeaveService } from "../../services/leave.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new LeaveService();

router.use(authenticate);

// Admin: org-wide leave balances
router.get("/", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const data = await svc.getOrgBalances(req.user!.orgId, req.query.fy as string);
  res.json({ success: true, data });
}));

// Get employee leave balance
router.get("/employee/:empId", wrap(async (req, res) => {
  const data = await svc.getBalances(param(req, "empId"), req.query.fy as string);
  res.json({ success: true, data });
}));

// Record leave
router.post("/employee/:empId/record", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const data = await svc.recordLeave(param(req, "empId"), req.body.leaveType, req.body.days);
  res.json({ success: true, data });
}));

// Adjust balance
router.post("/employee/:empId/adjust", authorize("hr_admin"), wrap(async (req, res) => {
  const data = await svc.adjustBalance(param(req, "empId"), req.body.leaveType, req.body.adjustment);
  res.json({ success: true, data });
}));

export { router as leaveRoutes };
