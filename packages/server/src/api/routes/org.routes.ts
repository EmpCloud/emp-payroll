import { Router } from "express";
import { OrgService } from "../../services/org.service";
import { AuditService } from "../../services/audit.service";
import { EmailTemplateService } from "../../services/email-template.service";
import { NotificationService } from "../../services/notification.service";
import { BackupService } from "../../services/backup.service";
import { CustomFieldsService } from "../../services/custom-fields.service";
import { ExpensePolicyService } from "../../services/expense-policy.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { validate, createOrgSchema } from "../validators";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new OrgService();

router.use(authenticate);

router.get("/", authorize("super_admin", "hr_admin"), wrap(async (_req, res) => {
  const data = await svc.list();
  res.json({ success: true, data });
}));

router.get("/:id", wrap(async (req, res) => {
  const data = await svc.getById(param(req, "id"));
  res.json({ success: true, data });
}));

router.post("/", authorize("super_admin", "hr_admin"), validate(createOrgSchema), wrap(async (req, res) => {
  const data = await svc.create(req.body);
  res.status(201).json({ success: true, data });
}));

router.put("/:id", authorize("hr_admin"), wrap(async (req, res) => {
  const data = await svc.update(param(req, "id"), req.body);
  res.json({ success: true, data });
}));

router.get("/:id/settings", wrap(async (req, res) => {
  const data = await svc.getSettings(param(req, "id"));
  res.json({ success: true, data });
}));

router.put("/:id/settings", authorize("hr_admin"), wrap(async (req, res) => {
  const data = await svc.updateSettings(param(req, "id"), req.body);
  res.json({ success: true, data });
}));

// Payroll lock period
router.get("/:id/payroll-lock", authorize("hr_admin"), wrap(async (req, res) => {
  const org = await svc.getById(param(req, "id"));
  res.json({ success: true, data: { lockDate: org.payroll_lock_date } });
}));

router.post("/:id/payroll-lock", authorize("hr_admin"), wrap(async (req, res) => {
  const lockDate = req.body.lockDate; // YYYY-MM-DD
  if (!lockDate) {
    return res.status(400).json({ success: false, error: { code: "MISSING_DATE", message: "lockDate is required (YYYY-MM-DD)" } });
  }
  await svc.update(param(req, "id"), { payrollLockDate: lockDate });
  res.json({ success: true, data: { message: `Payroll locked up to ${lockDate}`, lockDate } });
}));

router.delete("/:id/payroll-lock", authorize("hr_admin"), wrap(async (req, res) => {
  await svc.update(param(req, "id"), { payrollLockDate: null });
  res.json({ success: true, data: { message: "Payroll lock removed" } });
}));

router.get("/:id/activity", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const auditSvc = new AuditService();
  const data = await auditSvc.getRecent(param(req, "id"), Number(req.query.limit) || 20);
  res.json({ success: true, data });
}));

// Notifications
router.post("/:id/notify/declaration-reminder", authorize("hr_admin"), wrap(async (req, res) => {
  const notifSvc = new NotificationService();
  const data = await notifSvc.sendDeclarationReminders(param(req, "id"), {
    financialYear: req.body.financialYear,
    deadlineDate: req.body.deadlineDate,
  });
  res.json({ success: true, data });
}));

// Email templates
router.get("/:id/email-templates", authorize("hr_admin"), wrap(async (_req, res) => {
  const tmplSvc = new EmailTemplateService();
  const templates = tmplSvc.listTemplates();
  res.json({ success: true, data: templates });
}));

router.get("/:id/email-templates/:name/preview", authorize("hr_admin"), wrap(async (req, res) => {
  const tmplSvc = new EmailTemplateService();
  const preview = await tmplSvc.preview(req.params.name as string, param(req, "id"));
  res.json({ success: true, data: preview });
}));

router.get("/:id/email-templates/:name/preview-html", authorize("hr_admin"), wrap(async (req, res) => {
  const tmplSvc = new EmailTemplateService();
  const preview = await tmplSvc.preview(req.params.name as string, param(req, "id"));
  res.setHeader("Content-Type", "text/html");
  res.send(preview.body);
}));

// Backups
router.post("/:id/backups", authorize("hr_admin"), wrap(async (_req, res) => {
  const backupSvc = new BackupService();
  const data = await backupSvc.createBackup();
  res.json({ success: true, data });
}));

router.get("/:id/backups", authorize("hr_admin"), wrap(async (_req, res) => {
  const backupSvc = new BackupService();
  const data = await backupSvc.listBackups();
  res.json({ success: true, data });
}));

router.get("/:id/backups/:filename/download", authorize("hr_admin"), wrap(async (req, res) => {
  const backupSvc = new BackupService();
  const filePath = await backupSvc.getBackupPath(req.params.filename as string);
  if (!filePath) return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Backup not found" } });
  res.download(filePath);
}));

router.delete("/:id/backups/:filename", authorize("hr_admin"), wrap(async (req, res) => {
  const backupSvc = new BackupService();
  const deleted = await backupSvc.deleteBackup(req.params.filename as string);
  res.json({ success: true, data: { deleted } });
}));

// Custom fields
router.get("/:id/custom-fields", wrap(async (req, res) => {
  const cfSvc = new CustomFieldsService();
  const data = await cfSvc.getDefinitions(param(req, "id"));
  res.json({ success: true, data });
}));

router.post("/:id/custom-fields", authorize("hr_admin"), wrap(async (req, res) => {
  const cfSvc = new CustomFieldsService();
  const data = await cfSvc.defineField(param(req, "id"), req.body);
  res.status(201).json({ success: true, data });
}));

router.delete("/:id/custom-fields/:fieldId", authorize("hr_admin"), wrap(async (req, res) => {
  const cfSvc = new CustomFieldsService();
  const deleted = await cfSvc.deleteDefinition(param(req, "id"), req.params.fieldId as string);
  res.json({ success: true, data: { deleted } });
}));

// Custom field values for employee
router.get("/:id/employees/:empId/custom-fields", wrap(async (req, res) => {
  const cfSvc = new CustomFieldsService();
  const data = await cfSvc.getValues(req.params.empId as string);
  res.json({ success: true, data });
}));

router.put("/:id/employees/:empId/custom-fields", wrap(async (req, res) => {
  const cfSvc = new CustomFieldsService();
  const data = await cfSvc.setValues(req.params.empId as string, req.body);
  res.json({ success: true, data });
}));

// Expense policies
router.get("/:id/expense-policies", wrap(async (_req, res) => {
  const policySvc = new ExpensePolicyService();
  res.json({ success: true, data: policySvc.getPolicies() });
}));

router.post("/:id/expense-policies/evaluate", wrap(async (req, res) => {
  const policySvc = new ExpensePolicyService();
  const data = await policySvc.evaluate({
    orgId: param(req, "id"),
    employeeId: req.body.employeeId,
    category: req.body.category,
    amount: req.body.amount,
    month: req.body.month || new Date().getMonth() + 1,
    year: req.body.year || new Date().getFullYear(),
  });
  res.json({ success: true, data });
}));

export { router as orgRoutes };
