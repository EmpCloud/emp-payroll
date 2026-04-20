import { Router } from "express";
import { authenticate } from "../middleware/auth.middleware";
import { wrap, param } from "../helpers";
import {
  validate,
  selfUpdateBankDetailsSchema,
  bankUpdateRequestSchema,
  submitDeclarationSchema,
} from "../validators";
import { EmployeeService } from "../../services/employee.service";
import { SalaryService } from "../../services/salary.service";
import { PayslipService } from "../../services/payslip.service";
import { TaxDeclarationService } from "../../services/tax-declaration.service";
import { PayslipPDFService } from "../../services/payslip-pdf.service";
import { Form16Service } from "../../services/form16.service";
import { ReimbursementService } from "../../services/reimbursement.service";

const router = Router();
const empSvc = new EmployeeService();
const salSvc = new SalaryService();
const psSvc = new PayslipService();
const taxSvc = new TaxDeclarationService();

router.use(authenticate);

// Helper: get string ID for payroll-internal services (temporary compatibility)
const uid = (req: any) => String(req.user!.empcloudUserId);
const oid = (req: any) => String(req.user!.empcloudOrgId);

// --- Dashboard ---
router.get(
  "/dashboard",
  wrap(async (req, res) => {
    const employee = await empSvc.getByEmpCloudId(
      req.user!.empcloudUserId,
      req.user!.empcloudOrgId,
    );
    const salary = await salSvc.getEmployeeSalary(uid(req)).catch(() => null);
    const payslips = await psSvc.getByEmployee(uid(req));
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
  }),
);

// --- My Payslips ---
router.get(
  "/payslips",
  wrap(async (req, res) => {
    const data = await psSvc.getByEmployee(uid(req));
    res.json({ success: true, data });
  }),
);

router.get(
  "/payslips/:id/pdf",
  wrap(async (req, res) => {
    const pdfSvc = new PayslipPDFService();
    const html = await pdfSvc.generateHTML(param(req, "id"));
    res.setHeader("Content-Type", "text/html");
    // #135 — allow inline onclick="window.print()" on the Print / Save as PDF button
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
    );
    res.send(html);
  }),
);

router.get(
  "/payslips/ytd",
  wrap(async (req, res) => {
    const payslips = await psSvc.getByEmployee(uid(req));
    let ytdGross = 0,
      ytdDeductions = 0,
      ytdNet = 0;
    for (const ps of payslips.data) {
      ytdGross += Number(ps.gross_earnings);
      ytdDeductions += Number(ps.total_deductions);
      ytdNet += Number(ps.net_pay);
    }
    res.json({
      success: true,
      data: { ytdGross, ytdDeductions, ytdNet, payslipCount: payslips.total },
    });
  }),
);

// --- My Salary ---
router.get(
  "/salary",
  wrap(async (req, res) => {
    const data = await salSvc.getEmployeeSalary(uid(req)).catch(() => null);
    res.json({ success: true, data });
  }),
);

router.get(
  "/salary/ctc",
  wrap(async (req, res) => {
    const salary = await salSvc.getEmployeeSalary(uid(req)).catch(() => null);
    res.json({
      success: true,
      data: salary ? { ctc: salary.ctc, components: salary.components } : null,
    });
  }),
);

// --- Tax ---
router.get(
  "/tax/computation",
  wrap(async (req, res) => {
    const data = await taxSvc.getComputation(uid(req));
    res.json({ success: true, data });
  }),
);

router.get(
  "/tax/regime",
  wrap(async (req, res) => {
    const data = await taxSvc.getRegime(uid(req));
    res.json({ success: true, data });
  }),
);

router.put(
  "/tax/regime",
  wrap(async (req, res) => {
    const data = await taxSvc.updateRegime(uid(req), req.body.regime);
    res.json({ success: true, data });
  }),
);

router.get(
  "/tax/declarations",
  wrap(async (req, res) => {
    const data = await taxSvc.getDeclarations(uid(req));
    res.json({ success: true, data });
  }),
);

router.post(
  "/tax/declarations",
  validate(submitDeclarationSchema),
  wrap(async (req, res) => {
    const data = await taxSvc.submitDeclarations(
      uid(req),
      req.body.financialYear,
      req.body.declarations,
    );
    res.status(201).json({ success: true, data });
  }),
);

router.post(
  "/tax/declarations/:id/proof",
  wrap(async (_req, res) => {
    res.json({
      success: true,
      data: { message: "Proof upload — file storage integration pending" },
    });
  }),
);

router.get(
  "/tax/form16",
  wrap(async (req, res) => {
    const form16Svc = new Form16Service();
    const html = await form16Svc.generateHTML(uid(req), req.query.fy as string);
    res.setHeader("Content-Type", "text/html");
    // #135 — allow inline scripts so the Print / Save as PDF button's
    // onclick="window.print()" handler actually fires. Helmet's default
    // CSP blocks inline event handlers otherwise.
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
    );
    res.send(html);
  }),
);

// --- Reimbursements ---
const reimbSvc = new ReimbursementService();

router.get(
  "/reimbursements",
  wrap(async (req, res) => {
    const data = await reimbSvc.getByEmployee(uid(req));
    res.json({ success: true, data });
  }),
);

router.post(
  "/reimbursements",
  wrap(async (req, res) => {
    const data = await reimbSvc.submit(uid(req), req.body);
    res.status(201).json({ success: true, data });
  }),
);

// --- Profile / Bank ---
router.get(
  "/profile",
  wrap(async (req, res) => {
    const data = await empSvc.getByEmpCloudId(req.user!.empcloudUserId, req.user!.empcloudOrgId);
    res.json({ success: true, data });
  }),
);

router.put(
  "/profile/bank-details",
  validate(selfUpdateBankDetailsSchema),
  wrap(async (req, res) => {
    const data = await empSvc.updateBankDetails(
      req.user!.empcloudUserId,
      req.user!.empcloudOrgId,
      req.body,
    );
    res.json({ success: true, data });
  }),
);

// --- Bank Update Requests (employee submits, admin approves) ---
import { BankUpdateRequestService } from "../../services/bank-update-request.service";
const bankReqSvc = new BankUpdateRequestService();

router.post(
  "/bank-update-request",
  validate(bankUpdateRequestSchema),
  wrap(async (req, res) => {
    const data = await bankReqSvc.submit(req.user!.empcloudUserId, req.user!.empcloudOrgId, {
      currentDetails: req.body.currentDetails,
      requestedDetails: req.body.requestedDetails,
      reason: req.body.reason,
    });
    res.status(201).json({ success: true, data });
  }),
);

router.get(
  "/bank-update-requests",
  wrap(async (req, res) => {
    const data = await bankReqSvc.getMyRequests(req.user!.empcloudUserId);
    res.json({ success: true, data });
  }),
);

export { router as selfServiceRoutes };
