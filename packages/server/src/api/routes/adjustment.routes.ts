import { Router } from "express";
import { AdjustmentService } from "../../services/adjustment.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new AdjustmentService();

router.use(authenticate, authorize("hr_admin", "hr_manager"));

router.get("/", wrap(async (req, res) => {
  const { employeeId, status, type } = req.query as any;
  const data = await svc.list(req.user!.orgId, { employeeId, status, type });
  res.json({ success: true, data });
}));

router.post("/", wrap(async (req, res) => {
  const data = await svc.create({
    orgId: req.user!.orgId,
    employeeId: req.body.employeeId,
    type: req.body.type,
    description: req.body.description,
    amount: req.body.amount,
    isTaxable: req.body.isTaxable,
    isRecurring: req.body.isRecurring,
    recurringMonths: req.body.recurringMonths,
    effectiveMonth: req.body.effectiveMonth,
    createdBy: req.user!.userId,
  });
  res.status(201).json({ success: true, data });
}));

router.get("/employee/:empId", wrap(async (req, res) => {
  const data = await svc.list(req.user!.orgId, { employeeId: param(req, "empId") });
  res.json({ success: true, data });
}));

router.get("/employee/:empId/pending", wrap(async (req, res) => {
  const data = await svc.getPendingForRun(req.user!.orgId, param(req, "empId"));
  res.json({ success: true, data });
}));

router.post("/:id/cancel", wrap(async (req, res) => {
  const data = await svc.cancel(param(req, "id"), req.user!.orgId);
  res.json({ success: true, data });
}));

export { router as adjustmentRoutes };
