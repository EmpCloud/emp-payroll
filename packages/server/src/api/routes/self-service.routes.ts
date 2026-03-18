import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { wrap, param } from "../helpers";
import { EmployeeService } from "../../services/employee.service";
import { SalaryService } from "../../services/salary.service";
import { PayslipService } from "../../services/payslip.service";
import { TaxDeclarationService } from "../../services/tax-declaration.service";
import { PayslipPDFService } from "../../services/payslip-pdf.service";

const router = Router();
const empSvc = new EmployeeService();
const salSvc = new SalaryService();
const psSvc = new PayslipService();
const taxSvc = new TaxDeclarationService();

router.use(authenticate);

// --- Dashboard ---
router.get("/dashboard", wrap(async (req, res) => {
  const user = req.user!;
  const employee = await empSvc.getById(user.userId, user.orgId);
  const salary = await salSvc.getEmployeeSalary(user.userId).catch(() => null);
  const payslips = await psSvc.getByEmployee(user.userId);
  const latestPayslip = payslips.data[0] || null;

  res.json({
    success: true,
    data: {
      employee,
      currentSalary: salary,
      latestPayslip,
      payslipCount: payslips.total,
    },
  });
}));

// --- My Payslips ---
router.get("/payslips", wrap(async (req, res) => {
  const data = await psSvc.getByEmployee(req.user!.userId);
  res.json({ success: true, data });
}));

router.get("/payslips/:id/pdf", wrap(async (req, res) => {
  const pdfSvc = new PayslipPDFService();
  const html = await pdfSvc.generateHTML(param(req, "id"));
  res.setHeader("Content-Type", "text/html");
  res.send(html);
}));

router.get("/payslips/ytd", wrap(async (req, res) => {
  const payslips = await psSvc.getByEmployee(req.user!.userId);
  let ytdGross = 0, ytdDeductions = 0, ytdNet = 0;
  for (const ps of payslips.data) {
    ytdGross += Number(ps.gross_earnings);
    ytdDeductions += Number(ps.total_deductions);
    ytdNet += Number(ps.net_pay);
  }
  res.json({ success: true, data: { ytdGross, ytdDeductions, ytdNet, payslipCount: payslips.total } });
}));

// --- My Salary ---
router.get("/salary", wrap(async (req, res) => {
  const data = await salSvc.getEmployeeSalary(req.user!.userId);
  res.json({ success: true, data });
}));

router.get("/salary/ctc", wrap(async (req, res) => {
  const salary = await salSvc.getEmployeeSalary(req.user!.userId);
  res.json({ success: true, data: { ctc: salary.ctc, components: salary.components } });
}));

// --- Tax ---
router.get("/tax/computation", wrap(async (req, res) => {
  const data = await taxSvc.getComputation(req.user!.userId);
  res.json({ success: true, data });
}));

router.get("/tax/regime", wrap(async (req, res) => {
  const data = await taxSvc.getRegime(req.user!.userId);
  res.json({ success: true, data });
}));

router.put("/tax/regime", wrap(async (req, res) => {
  const data = await taxSvc.updateRegime(req.user!.userId, req.body.regime);
  res.json({ success: true, data });
}));

router.get("/tax/declarations", wrap(async (req, res) => {
  const data = await taxSvc.getDeclarations(req.user!.userId);
  res.json({ success: true, data });
}));

router.post("/tax/declarations", wrap(async (req, res) => {
  const data = await taxSvc.submitDeclarations(req.user!.userId, req.body.financialYear, req.body.declarations);
  res.status(201).json({ success: true, data });
}));

router.post("/tax/declarations/:id/proof", wrap(async (_req, res) => {
  res.json({ success: true, data: { message: "Proof upload — file storage integration pending" } });
}));

router.get("/tax/form16", wrap(async (_req, res) => {
  res.json({ success: true, data: { message: "Form 16 generation pending" } });
}));

// --- Reimbursements ---
router.get("/reimbursements", wrap(async (req, res) => {
  // Placeholder — reimbursement service not yet built
  res.json({ success: true, data: { data: [], total: 0 } });
}));

router.post("/reimbursements", wrap(async (_req, res) => {
  res.json({ success: true, data: { message: "Reimbursement submission pending" } });
}));

// --- Profile / Bank ---
router.get("/profile", wrap(async (req, res) => {
  const data = await empSvc.getById(req.user!.userId, req.user!.orgId);
  res.json({ success: true, data });
}));

router.put("/profile/bank-details", wrap(async (req, res) => {
  const data = await empSvc.updateBankDetails(req.user!.userId, req.user!.orgId, req.body);
  res.json({ success: true, data });
}));

export { router as selfServiceRoutes };
