import { Router } from "express";
import { LoanService } from "../../services/loan.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new LoanService();

router.use(authenticate);

router.get("/", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const data = await svc.list(req.user!.orgId, {
    status: req.query.status as string,
    employeeId: req.query.employeeId as string,
  });
  res.json({ success: true, data });
}));

router.get("/employee/:empId", wrap(async (req, res) => {
  const data = await svc.getByEmployee(param(req, "empId"));
  res.json({ success: true, data });
}));

router.get("/employee/:empId/emi-total", wrap(async (req, res) => {
  const total = await svc.getActiveEMIs(param(req, "empId"));
  res.json({ success: true, data: { totalEMI: total } });
}));

router.post("/", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const data = await svc.create(req.user!.orgId, req.user!.userId, req.body);
  res.status(201).json({ success: true, data });
}));

router.post("/:id/payment", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const data = await svc.recordPayment(param(req, "id"), req.body.amount);
  res.json({ success: true, data });
}));

router.post("/:id/cancel", authorize("hr_admin"), wrap(async (req, res) => {
  const data = await svc.cancel(param(req, "id"));
  res.json({ success: true, data });
}));

export { router as loanRoutes };
