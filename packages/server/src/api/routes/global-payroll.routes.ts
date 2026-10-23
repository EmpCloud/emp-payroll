import { Router } from "express";
import { createHash } from "node:crypto";
import { GlobalPayrollService } from "../../services/global-payroll.service";
import { UaePayrollService } from "../../services/uae/uae-payroll.service";
import {
  recalculateUaeSchema,
  exportUaeWpsSchema,
  uaePaymentSchema,
  uaeRevisionSchema,
  uaeUnlockSchema,
  uaeLiabilityQuerySchema,
} from "../validators/uae-payroll";
import { UAE_BANK_FORMATS } from "../../services/uae/uae-bank-exports";
import { UaeGratuityReportService } from "../../services/uae/uae-gratuity-report.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import {
  validate,
  addGlobalEmployeeSchema,
  updateGlobalEmployeeSchema,
  createGlobalPayrollRunSchema,
  submitContractorInvoiceSchema,
  updateComplianceItemSchema,
} from "../validators";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new GlobalPayrollService();
const uae = new UaePayrollService();
const payslipCsp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-hashes' 'sha256-${createHash("sha256").update("window.print()").digest("base64")}'; frame-ancestors 'none'; base-uri 'none'`;

router.use(authenticate);

router.get(
  "/my-payslips",
  wrap(async (req, res) => {
    const data = await uae.myPayslips(
      String(req.user!.empcloudOrgId),
      String(req.user!.empcloudUserId),
    );
    res.json({ success: true, data });
  }),
);
router.get(
  "/my-payslips/:itemId",
  wrap(async (req, res) => {
    const html = await uae.myPayslip(
      String(req.user!.empcloudOrgId),
      String(req.user!.empcloudUserId),
      param(req, "itemId"),
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", payslipCsp);
    res.type("html").send(html);
  }),
);

// ---------------------------------------------------------------------------
// Dashboard & Analytics
// ---------------------------------------------------------------------------
router.get(
  "/dashboard",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.getGlobalDashboard(String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

router.get(
  "/cost-analysis",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.getCostAnalysis(String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

// ---------------------------------------------------------------------------
// Countries
// ---------------------------------------------------------------------------
router.get(
  "/countries",
  wrap(async (req, res) => {
    const data = await svc.listCountries({
      region: req.query.region as string,
      isActive: req.query.isActive as string,
    });
    res.json({
      success: true,
      data: data.data,
      meta: { total: data.total, page: data.page, limit: data.limit, totalPages: data.totalPages },
    });
  }),
);

router.get(
  "/countries/:id",
  wrap(async (req, res) => {
    const data = await svc.getCountry(param(req, "id"));
    res.json({ success: true, data });
  }),
);

// ---------------------------------------------------------------------------
// Global Employees
// ---------------------------------------------------------------------------
router.post(
  "/employees",
  authorize("hr_admin", "hr_manager"),
  validate(addGlobalEmployeeSchema),
  wrap(async (req, res) => {
    const data = await svc.addGlobalEmployee(String(req.user!.empcloudOrgId), req.body);
    res.status(201).json({ success: true, data });
  }),
);

router.get(
  "/employees",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.listGlobalEmployees(String(req.user!.empcloudOrgId), {
      countryId: req.query.countryId as string,
      employmentType: req.query.employmentType as string,
      status: req.query.status as string,
      search: req.query.search as string,
    });
    res.json({
      success: true,
      data: data.data,
      meta: { total: data.total, page: data.page, limit: data.limit, totalPages: data.totalPages },
    });
  }),
);

router.get(
  "/employees/:id",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.getGlobalEmployee(String(req.user!.empcloudOrgId), param(req, "id"));
    res.json({ success: true, data });
  }),
);

router.put(
  "/employees/:id",
  authorize("hr_admin", "hr_manager"),
  validate(updateGlobalEmployeeSchema),
  wrap(async (req, res) => {
    const data = await svc.updateGlobalEmployee(
      String(req.user!.empcloudOrgId),
      param(req, "id"),
      req.body,
    );
    res.json({ success: true, data });
  }),
);

router.post(
  "/employees/:id/terminate",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.terminateGlobalEmployee(
      String(req.user!.empcloudOrgId),
      param(req, "id"),
      req.body.reason,
    );
    res.json({ success: true, data });
  }),
);

// ---------------------------------------------------------------------------
// Global Payroll Runs
// ---------------------------------------------------------------------------
router.post(
  "/payroll-runs",
  authorize("hr_admin", "hr_manager"),
  validate(createGlobalPayrollRunSchema),
  wrap(async (req, res) => {
    const data = await svc.createPayrollRun(
      String(req.user!.empcloudOrgId),
      req.body.countryId,
      req.body.month,
      req.body.year,
      req.body.uaeInputs,
      req.body.uaeEmployer,
      String(req.user!.empcloudUserId),
      req.body.uaeSchedule,
    );
    res.status(201).json({ success: true, data });
  }),
);

router.get(
  "/payroll-runs",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.listPayrollRuns(String(req.user!.empcloudOrgId), {
      countryId: req.query.countryId as string,
      status: req.query.status as string,
      year: req.query.year ? Number(req.query.year) : undefined,
    });
    res.json({
      success: true,
      data: data.data,
      meta: { total: data.total, page: data.page, limit: data.limit, totalPages: data.totalPages },
    });
  }),
);

router.get(
  "/payroll-runs/:id",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.getPayrollRun(String(req.user!.empcloudOrgId), param(req, "id"));
    res.json({ success: true, data });
  }),
);

router.post(
  "/payroll-runs/:id/approve",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.approvePayrollRun(
      String(req.user!.empcloudOrgId),
      param(req, "id"),
      String(req.user!.empcloudUserId),
      req.body?.expectedRevision,
    );
    res.json({ success: true, data });
  }),
);

router.post(
  "/payroll-runs/:id/paid",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.markPayrollRunPaid(String(req.user!.empcloudOrgId), param(req, "id"));
    res.json({ success: true, data });
  }),
);

router.post(
  "/payroll-runs/:id/uae/recalculate",
  authorize("hr_admin", "hr_manager"),
  validate(recalculateUaeSchema),
  wrap(async (req, res) => {
    const data = await uae.recalculate(
      String(req.user!.empcloudOrgId),
      param(req, "id"),
      req.body.uaeInputs,
      String(req.user!.empcloudUserId),
      req.body.uaeSchedule,
      req.body.expectedRevision,
    );
    res.json({ success: true, data });
  }),
);

router.get(
  "/payroll-runs/:id/uae/payslips/:itemId",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const html = await uae.payslip(
      String(req.user!.empcloudOrgId),
      param(req, "id"),
      param(req, "itemId"),
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Security-Policy", payslipCsp);
    res.type("html").send(html);
  }),
);

router.post(
  "/payroll-runs/:id/uae/wps",
  authorize("hr_admin"),
  validate(exportUaeWpsSchema),
  wrap(async (req, res) => {
    const file = await uae.exportWps(
      String(req.user!.empcloudOrgId),
      param(req, "id"),
      req.body,
      String(req.user!.empcloudUserId),
    );
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Disposition", `attachment; filename="${file.filename}"`);
    res.type(file.contentType).send(file.content);
  }),
);

router.post(
  "/payroll-runs/:id/uae/payments",
  authorize("hr_admin"),
  validate(uaePaymentSchema),
  wrap(async (req, res) => {
    const data = await uae.recordPayment(
      String(req.user!.empcloudOrgId),
      param(req, "id"),
      req.body,
      String(req.user!.empcloudUserId),
    );
    res.json({ success: true, data });
  }),
);

router.get("/uae/bank-formats", authorize("hr_admin", "hr_manager"), (_req, res) => {
  res.json({ success: true, data: UAE_BANK_FORMATS });
});
router.get(
  "/uae/gratuity-liability",
  authorize("hr_admin", "hr_manager"),
  validate(uaeLiabilityQuerySchema),
  wrap(async (req, res) => {
    const data = await new UaeGratuityReportService().report(
      String(req.user!.empcloudOrgId),
      Number(req.query.month),
      Number(req.query.year),
    );
    res.json({ success: true, data });
  }),
);
router.post(
  "/payroll-runs/:id/uae/lock",
  authorize("hr_admin", "hr_manager"),
  validate(uaeRevisionSchema),
  wrap(async (req, res) => {
    const data = await uae.lock(
      String(req.user!.empcloudOrgId),
      param(req, "id"),
      req.body.expectedRevision,
      String(req.user!.empcloudUserId),
    );
    res.json({ success: true, data });
  }),
);
router.post(
  "/payroll-runs/:id/uae/unlock",
  authorize("hr_admin"),
  validate(uaeUnlockSchema),
  wrap(async (req, res) => {
    const data = await uae.unlock(
      String(req.user!.empcloudOrgId),
      param(req, "id"),
      req.body.expectedRevision,
      req.body.reason,
      String(req.user!.empcloudUserId),
    );
    res.json({ success: true, data });
  }),
);

// ---------------------------------------------------------------------------
// Contractor Invoices
// ---------------------------------------------------------------------------
router.post(
  "/invoices",
  authorize("hr_admin", "hr_manager"),
  validate(submitContractorInvoiceSchema),
  wrap(async (req, res) => {
    const data = await svc.submitContractorInvoice(
      String(req.user!.empcloudOrgId),
      req.body.globalEmployeeId,
      req.body,
    );
    res.status(201).json({ success: true, data });
  }),
);

router.get(
  "/invoices",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.listContractorInvoices(String(req.user!.empcloudOrgId), {
      status: req.query.status as string,
      employeeId: req.query.employeeId as string,
    });
    res.json({
      success: true,
      data: data.data,
      meta: { total: data.total, page: data.page, limit: data.limit, totalPages: data.totalPages },
    });
  }),
);

router.post(
  "/invoices/:id/approve",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.approveContractorInvoice(
      String(req.user!.empcloudOrgId),
      param(req, "id"),
      String(req.user!.empcloudUserId),
    );
    res.json({ success: true, data });
  }),
);

router.post(
  "/invoices/:id/reject",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.rejectContractorInvoice(
      String(req.user!.empcloudOrgId),
      param(req, "id"),
    );
    res.json({ success: true, data });
  }),
);

router.post(
  "/invoices/:id/paid",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.markInvoicePaid(String(req.user!.empcloudOrgId), param(req, "id"));
    res.json({ success: true, data });
  }),
);

// ---------------------------------------------------------------------------
// Compliance
// ---------------------------------------------------------------------------
router.get(
  "/compliance/:empId",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.getComplianceChecklist(
      String(req.user!.empcloudOrgId),
      param(req, "empId"),
    );
    res.json({ success: true, data });
  }),
);

router.put(
  "/compliance/:itemId",
  authorize("hr_admin", "hr_manager"),
  validate(updateComplianceItemSchema),
  wrap(async (req, res) => {
    const data = await svc.updateChecklistItem(
      String(req.user!.empcloudOrgId),
      param(req, "itemId"),
      req.body.completed,
      String(req.user!.empcloudUserId),
    );
    res.json({ success: true, data });
  }),
);

router.post(
  "/compliance/:empId/items",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.addChecklistItem(
      String(req.user!.empcloudOrgId),
      param(req, "empId"),
      req.body,
    );
    res.status(201).json({ success: true, data });
  }),
);

export { router as globalPayrollRoutes };
