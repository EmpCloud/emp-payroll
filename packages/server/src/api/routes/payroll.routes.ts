import { Router } from "express";
import { PayrollService } from "../../services/payroll.service";
import { BankFileService } from "../../services/bank-file.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { validate, createPayrollRunSchema } from "../validators";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new PayrollService();

router.use(authenticate, authorize("hr_admin", "hr_manager"));

router.get("/", wrap(async (req, res) => {
  const data = await svc.listRuns(req.user!.orgId);
  res.json({ success: true, data });
}));

router.get("/:id", wrap(async (req, res) => {
  const data = await svc.getRun(param(req, "id"), req.user!.orgId);
  res.json({ success: true, data });
}));

router.post("/", validate(createPayrollRunSchema), wrap(async (req, res) => {
  const data = await svc.createRun(req.user!.orgId, req.user!.userId, req.body);
  res.status(201).json({ success: true, data });
}));

router.post("/:id/compute", wrap(async (req, res) => {
  const data = await svc.computePayroll(param(req, "id"), req.user!.orgId);
  res.json({ success: true, data });
}));

router.post("/:id/approve", authorize("hr_admin"), wrap(async (req, res) => {
  const data = await svc.approveRun(param(req, "id"), req.user!.orgId, req.user!.userId);
  res.json({ success: true, data });
}));

router.post("/:id/pay", authorize("hr_admin"), wrap(async (req, res) => {
  const data = await svc.markPaid(param(req, "id"), req.user!.orgId);
  res.json({ success: true, data });
}));

router.post("/:id/cancel", authorize("hr_admin"), wrap(async (req, res) => {
  const data = await svc.cancelRun(param(req, "id"), req.user!.orgId);
  res.json({ success: true, data });
}));

router.get("/:id/summary", wrap(async (req, res) => {
  const data = await svc.getRunSummary(param(req, "id"), req.user!.orgId);
  res.json({ success: true, data });
}));

router.get("/:id/payslips", wrap(async (req, res) => {
  const data = await svc.getRunPayslips(param(req, "id"));
  res.json({ success: true, data });
}));

router.post("/:id/send-payslips", wrap(async (_req, res) => {
  res.json({ success: true, data: { message: "Payslip emails queued" } });
}));

router.get("/:id/reports/pf", wrap(async (req, res) => {
  const payslips = await svc.getRunPayslips(param(req, "id"));
  res.json({ success: true, data: { report: "PF", payslips: payslips.total } });
}));

router.get("/:id/reports/esi", wrap(async (req, res) => {
  const payslips = await svc.getRunPayslips(param(req, "id"));
  res.json({ success: true, data: { report: "ESI", payslips: payslips.total } });
}));

router.get("/:id/reports/pt", wrap(async (req, res) => {
  const payslips = await svc.getRunPayslips(param(req, "id"));
  res.json({ success: true, data: { report: "PT", payslips: payslips.total } });
}));

router.get("/:id/reports/tds", wrap(async (req, res) => {
  const payslips = await svc.getRunPayslips(param(req, "id"));
  res.json({ success: true, data: { report: "TDS", payslips: payslips.total } });
}));

router.get("/:id/reports/bank-file", wrap(async (req, res) => {
  const bankSvc = new BankFileService();
  const file = await bankSvc.generateBankFile(param(req, "id"), req.user!.orgId);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename=${file.filename}`);
  res.send(file.content);
}));

export { router as payrollRoutes };
