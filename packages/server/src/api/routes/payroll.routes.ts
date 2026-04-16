import { Router } from "express";
import { PayrollService } from "../../services/payroll.service";
import { BankFileService } from "../../services/bank-file.service";
import { ReportsService } from "../../services/reports.service";
import { EmailService } from "../../services/email.service";
import { AccountingExportService } from "../../services/accounting-export.service";
import { GovtFormatsService } from "../../services/govt-formats.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { enforcePayrollLock } from "../middleware/payroll-lock.middleware";
import { validate, createPayrollRunSchema } from "../validators";
import { wrap, param } from "../helpers";
import { AppError } from "../middleware/error.middleware";

const router = Router();
const svc = new PayrollService();

router.use(authenticate, authorize("hr_admin", "hr_manager"), enforcePayrollLock);

router.get(
  "/",
  wrap(async (req, res) => {
    const data = await svc.listRuns(String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

router.get(
  "/:id",
  wrap(async (req, res) => {
    const data = await svc.getRun(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

router.post(
  "/",
  validate(createPayrollRunSchema),
  wrap(async (req, res) => {
    const data = await svc.createRun(
      String(req.user!.empcloudOrgId),
      String(req.user!.empcloudUserId),
      req.body,
    );
    res.status(201).json({ success: true, data });
  }),
);

router.post(
  "/:id/compute",
  wrap(async (req, res) => {
    // Forward the bearer token so Cloud HRMS proxy can authenticate
    const authToken = req.headers.authorization?.replace("Bearer ", "") || "";
    const data = await svc.computePayroll(
      param(req, "id"),
      String(req.user!.empcloudOrgId),
      authToken,
    );
    res.json({ success: true, data });
  }),
);

router.post(
  "/:id/approve",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.approveRun(
      param(req, "id"),
      String(req.user!.empcloudOrgId),
      String(req.user!.empcloudUserId),
    );
    res.json({ success: true, data });
  }),
);

router.post(
  "/:id/pay",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.markPaid(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

router.post(
  "/:id/cancel",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.cancelRun(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

router.post(
  "/:id/revert",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.revertToDraft(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

router.get(
  "/:id/summary",
  wrap(async (req, res) => {
    const data = await svc.getRunSummary(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

router.get(
  "/:id/payslips",
  wrap(async (req, res) => {
    const data = await svc.getRunPayslips(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

router.post(
  "/:id/send-payslips",
  wrap(async (req, res) => {
    // Verify run belongs to this org before sending
    await svc.getRun(param(req, "id"), String(req.user!.empcloudOrgId));
    const emailSvc = new EmailService();

    // Surface config issues up-front with a clear message instead of silently
    // failing every send and reporting "Sent 0 payslip emails (N failed)".
    if (!emailSvc.isConfigured()) {
      throw new AppError(
        503,
        "EMAIL_NOT_CONFIGURED",
        "Email provider is not configured on the server (SMTP host / user / password missing). Contact your admin to set SMTP_HOST, SMTP_USER and SMTP_PASSWORD.",
      );
    }

    const result = await emailSvc.sendPayslipsForRun(param(req, "id"));

    // If there were payslips but every single send failed, treat that as a
    // hard error rather than returning a cheerful success toast.
    if (result.sent === 0 && result.failed > 0) {
      throw new AppError(
        502,
        "EMAIL_SEND_FAILED",
        `Unable to send any payslip emails (${result.failed} failed). Check SMTP credentials and that employees have email addresses on file.`,
        { sent: [String(result.sent)], failed: [String(result.failed)] },
      );
    }

    res.json({
      success: true,
      data: {
        message:
          result.failed > 0
            ? `Sent ${result.sent} payslip emails (${result.failed} failed — check server logs)`
            : `Sent ${result.sent} payslip emails`,
        ...result,
      },
    });
  }),
);

router.get(
  "/:id/reports/pf",
  wrap(async (req, res) => {
    const rptSvc = new ReportsService();
    const file = await rptSvc.generatePFECR(param(req, "id"), String(req.user!.empcloudOrgId));
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename=${file.filename}`);
    res.send(file.content);
  }),
);

router.get(
  "/:id/reports/esi",
  wrap(async (req, res) => {
    const rptSvc = new ReportsService();
    const file = await rptSvc.generateESIReturn(param(req, "id"), String(req.user!.empcloudOrgId));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${file.filename}`);
    res.send(file.content);
  }),
);

router.get(
  "/:id/reports/pt",
  wrap(async (req, res) => {
    const rptSvc = new ReportsService();
    const file = await rptSvc.generatePTReturn(param(req, "id"), String(req.user!.empcloudOrgId));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${file.filename}`);
    res.send(file.content);
  }),
);

router.get(
  "/:id/reports/tds",
  wrap(async (req, res) => {
    const rptSvc = new ReportsService();
    const data = await rptSvc.generateTDSSummary(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

router.get(
  "/:id/reports/bank-file",
  wrap(async (req, res) => {
    const bankSvc = new BankFileService();
    const file = await bankSvc.generateBankFile(param(req, "id"), String(req.user!.empcloudOrgId));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${file.filename}`);
    res.send(file.content);
  }),
);

// Accounting exports
router.get(
  "/:id/export/journal-csv",
  wrap(async (req, res) => {
    const accSvc = new AccountingExportService();
    const file = await accSvc.exportJournalCSV(param(req, "id"), String(req.user!.empcloudOrgId));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${file.filename}`);
    res.send(file.content);
  }),
);

router.get(
  "/:id/export/tally-xml",
  wrap(async (req, res) => {
    const accSvc = new AccountingExportService();
    const file = await accSvc.exportTallyXML(param(req, "id"), String(req.user!.empcloudOrgId));
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Content-Disposition", `attachment; filename=${file.filename}`);
    res.send(file.content);
  }),
);

// Government portal formats
router.get(
  "/:id/reports/epfo",
  wrap(async (req, res) => {
    const govSvc = new GovtFormatsService();
    const file = await govSvc.generateEPFOFile(param(req, "id"), String(req.user!.empcloudOrgId));
    res.setHeader("Content-Type", "text/plain");
    res.setHeader("Content-Disposition", `attachment; filename=${file.filename}`);
    res.send(file.content);
  }),
);

router.get(
  "/:id/reports/esic",
  wrap(async (req, res) => {
    const govSvc = new GovtFormatsService();
    const file = await govSvc.generateESICReturn(param(req, "id"), String(req.user!.empcloudOrgId));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${file.filename}`);
    res.send(file.content);
  }),
);

router.get(
  "/reports/form24q",
  wrap(async (req, res) => {
    const govSvc = new GovtFormatsService();
    const file = await govSvc.generateForm24Q(String(req.user!.empcloudOrgId), {
      quarter: Number(req.query.quarter || 4) as any,
      financialYear: (req.query.fy || "2025-2026") as string,
    });
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename=${file.filename}`);
    res.send(file.content);
  }),
);

// Quarterly TDS challan (Form 26Q)
router.get(
  "/reports/tds-challan",
  wrap(async (req, res) => {
    const rptSvc = new ReportsService();
    const data = await rptSvc.generateTDSChallan(String(req.user!.empcloudOrgId), {
      quarter: Number(req.query.quarter || 4) as 1 | 2 | 3 | 4,
      financialYear: (req.query.fy || "2025-2026") as string,
    });
    res.json({ success: true, data });
  }),
);

export { router as payrollRoutes };
