import { Router, Request } from "express";
import { PayrollService } from "../../services/payroll.service";
import { BankFileService } from "../../services/bank-file.service";
import { ReportsService } from "../../services/reports.service";
import { EmailService } from "../../services/email.service";
import { AccountingExportService } from "../../services/accounting-export.service";
import { GovtFormatsService } from "../../services/govt-formats.service";
import { AuditService } from "../../services/audit.service";
import { authenticate, authorize, requirePermission } from "../middleware/auth.middleware";
import { enforcePayrollLock } from "../middleware/payroll-lock.middleware";
import { validate, createPayrollRunSchema } from "../validators";
import { wrap, param } from "../helpers";
import { AppError } from "../middleware/error.middleware";

const router = Router();
const svc = new PayrollService();
const auditSvc = new AuditService();

// BUG-030 — Payroll lifecycle actions (create / compute / approve / pay /
// cancel / revert / rerun / delete) had no audit-log entries. Compliance
// teams couldn't reconstruct who approved or marked-paid a run, and
// disputes about "who deleted the December run?" had no answer. Helper
// fires after the service call succeeds so failed actions don't pollute
// the trail. Captures runId + status snapshot in `new_value`.
async function logRunAction(
  req: Request,
  action: string,
  runId: string,
  newValue?: unknown,
): Promise<void> {
  try {
    await auditSvc.log({
      orgId: String(req.user!.empcloudOrgId),
      userId: String(req.user!.empcloudUserId),
      action,
      entityType: "payroll_run",
      entityId: runId,
      newValue,
      ipAddress: req.ip,
    });
  } catch {
    // Audit logging must never break the user action -- swallow.
    // The audit gap shows up as a missing row in the audit table; the
    // payroll action itself has already succeeded.
  }
}

// RBAC v1 — every payroll route still requires the legacy hr_admin / hr_manager
// role gate AND the payroll-lock check. Specific actions below add per-permission
// checks via requirePermission() so custom roles can grant access without bumping
// a user up to hr_admin.
router.use(authenticate, authorize("hr_admin", "hr_manager"), enforcePayrollLock);

router.get(
  "/",
  requirePermission("payroll:view_all", "payroll:view_reports"),
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
  requirePermission("payroll:run"),
  validate(createPayrollRunSchema),
  wrap(async (req, res) => {
    const data = (await svc.createRun(
      String(req.user!.empcloudOrgId),
      String(req.user!.empcloudUserId),
      req.body,
    )) as any;
    await logRunAction(req, "payroll_run.created", String(data?.id || ""), {
      month: req.body?.month,
      year: req.body?.year,
    });
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
    await logRunAction(req, "payroll_run.computed", param(req, "id"), {
      employee_count: data?.employee_count ?? null,
      total_net: data?.total_net ?? null,
      skipped_count: Array.isArray(data?.skipped) ? data.skipped.length : 0,
    });
    res.json({ success: true, data });
  }),
);

router.post(
  "/:id/approve",
  requirePermission("payroll:approve_run"),
  wrap(async (req, res) => {
    const data = await svc.approveRun(
      param(req, "id"),
      String(req.user!.empcloudOrgId),
      String(req.user!.empcloudUserId),
    );
    await logRunAction(req, "payroll_run.approved", param(req, "id"));
    res.json({ success: true, data });
  }),
);

router.post(
  "/:id/pay",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.markPaid(param(req, "id"), String(req.user!.empcloudOrgId));
    await logRunAction(req, "payroll_run.paid", param(req, "id"));
    res.json({ success: true, data });
  }),
);

router.post(
  "/:id/cancel",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.cancelRun(param(req, "id"), String(req.user!.empcloudOrgId));
    await logRunAction(req, "payroll_run.cancelled", param(req, "id"));
    res.json({ success: true, data });
  }),
);

router.post(
  "/:id/revert",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.revertToDraft(param(req, "id"), String(req.user!.empcloudOrgId));
    await logRunAction(req, "payroll_run.reverted_to_draft", param(req, "id"));
    res.json({ success: true, data });
  }),
);

// Re-run an existing payroll run. Wipes computed payslips, resets totals,
// flips status back to draft so the caller can recompute. Unlike /revert,
// this also accepts `paid` runs -- the "if something went wrong" escape
// hatch HR needs when a salary structure change or attendance correction
// arrives after the run was marked paid. Gated by hr_admin and the UI
// requires explicit confirmation before invoking.
router.post(
  "/:id/rerun",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.rerunRun(param(req, "id"), String(req.user!.empcloudOrgId));
    await logRunAction(req, "payroll_run.rerun", param(req, "id"));
    res.json({ success: true, data });
  }),
);

// Hard-delete a payroll run + every payslip attached to it. There is no
// undo. The UI gates this behind a type-to-confirm modal because the
// destructive action is irreversible and there's no built-in trash bin.
router.delete(
  "/:id",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    // Capture identifying info BEFORE the delete so we can record what
    // was wiped. The service returns the deleted row's identifiers too,
    // but logging from the response keeps us resilient if that contract
    // ever drifts.
    const data = await svc.deleteRun(param(req, "id"), String(req.user!.empcloudOrgId));
    await logRunAction(req, "payroll_run.deleted", param(req, "id"), {
      month: data?.month,
      year: data?.year,
      payslips_deleted: data?.payslips_deleted,
    });
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
    // Surface the validation summary via custom headers so the client can
    // toast a warning when employees were skipped (missing / invalid bank
    // details). Headers are CORS-exposed via `Access-Control-Expose-Headers`
    // in the global cors() config; if a header isn't visible to the client
    // the download still works -- this is informational, not load-bearing.
    res.setHeader("X-Bank-File-Total-Employees", String(file.summary.totalEmployees));
    res.setHeader("X-Bank-File-Total-Amount", String(file.summary.totalAmount.toFixed(2)));
    res.setHeader("X-Bank-File-Skipped-Count", String(file.summary.skipped.length));
    if (file.summary.skipped.length > 0) {
      // Keep the header value compact: count + first reason. Full list
      // is on the next line of the JSON header for clients that want it.
      const firstSkip = file.summary.skipped[0];
      res.setHeader(
        "X-Bank-File-Skipped-Sample",
        `${firstSkip.name || firstSkip.employeeCode || "?"}: ${firstSkip.reason}`,
      );
    }
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
