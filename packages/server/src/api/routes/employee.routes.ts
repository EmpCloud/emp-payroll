import { Router } from "express";
import { EmployeeService } from "../../services/employee.service";
import { ExportService } from "../../services/export.service";
import { createNote, getNotes, deleteNote } from "../../services/notes.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { validate, createEmployeeSchema, updateEmployeeSchema } from "../validators";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new EmployeeService();

router.use(authenticate);

// Helper: parse route :id as number (EmpCloud user ID)
const numParam = (req: any, name: string) => Number(param(req, name));

router.get(
  "/",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const { page, limit, sort, order, department } = req.query as any;
    const options: any = { page: Number(page) || 1, limit: Number(limit) || 20 };
    if (sort) options.sort = { field: sort, order: order || "asc" };
    if (department) options.filters = { ...options.filters, department };
    const result = await svc.list(req.user!.empcloudOrgId, options);
    res.json({ success: true, data: result });
  }),
);

// Static routes BEFORE /:id param routes
router.get(
  "/search",
  wrap(async (req, res) => {
    const q = (req.query.q || req.query.query || "") as string;
    if (!q || q.length < 2) {
      return res.json({ success: true, data: [] });
    }
    const data = await svc.search(req.user!.empcloudOrgId, q, Number(req.query.limit) || 20);
    res.json({ success: true, data });
  }),
);

router.get(
  "/export",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const exportSvc = new ExportService();
    const csv = await exportSvc.exportEmployeesCSV(String(req.user!.empcloudOrgId));
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=employees.csv");
    res.send(csv);
  }),
);

router.post(
  "/import",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const { employees } = req.body;
    if (!Array.isArray(employees) || employees.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "employees must be a non-empty array" },
      });
    }
    if (employees.length > 500) {
      return res.status(400).json({
        success: false,
        error: { code: "TOO_MANY", message: "Maximum 500 employees per import" },
      });
    }

    const results: { row: number; email: string; status: "created" | "error"; error?: string }[] =
      [];

    for (let i = 0; i < employees.length; i++) {
      const emp = employees[i];
      try {
        if (!emp.email || !emp.firstName || !emp.lastName) {
          results.push({
            row: i + 1,
            email: emp.email || "—",
            status: "error",
            error: "Missing required fields (email, firstName, lastName)",
          });
          continue;
        }
        await svc.create(req.user!.empcloudOrgId, emp);
        results.push({ row: i + 1, email: emp.email, status: "created" });
      } catch (err: any) {
        results.push({
          row: i + 1,
          email: emp.email || "—",
          status: "error",
          error: err.message || "Unknown error",
        });
      }
    }

    const created = results.filter((r) => r.status === "created").length;
    const errors = results.filter((r) => r.status === "error").length;
    res.json({ success: true, data: { total: employees.length, created, errors, results } });
  }),
);

// Download CSV template for import
router.get(
  "/import/template",
  authorize("hr_admin"),
  wrap(async (_req, res) => {
    const headers = [
      "firstName",
      "lastName",
      "email",
      "phone",
      "dateOfBirth",
      "gender",
      "dateOfJoining",
      "employeeCode",
      "designation",
      "department",
      "employmentType",
    ];
    const sample = [
      "John",
      "Doe",
      "john@company.com",
      "9876543210",
      "1990-01-15",
      "male",
      "2026-04-01",
      "",
      "Software Engineer",
      "Engineering",
      "full_time",
    ];
    const csv = [headers.join(","), sample.join(",")].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=employee_import_template.csv");
    res.send(csv);
  }),
);

// Bulk operations
router.post(
  "/bulk/status",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const { employeeIds, isActive } = req.body;
    if (!Array.isArray(employeeIds) || employeeIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "employeeIds must be a non-empty array" },
      });
    }
    const data = await svc.bulkUpdateStatus(req.user!.empcloudOrgId, employeeIds, isActive);
    res.json({ success: true, data });
  }),
);

router.post(
  "/bulk/department",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const { employeeIds, departmentId } = req.body;
    if (!Array.isArray(employeeIds) || !departmentId) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "employeeIds and departmentId required" },
      });
    }
    const data = await svc.bulkAssignDepartment(req.user!.empcloudOrgId, employeeIds, departmentId);
    res.json({ success: true, data });
  }),
);

router.get(
  "/:id",
  wrap(async (req, res) => {
    const data = await svc.getByEmpCloudId(numParam(req, "id"), req.user!.empcloudOrgId);
    res.json({ success: true, data });
  }),
);

router.post(
  "/",
  authorize("hr_admin", "hr_manager"),
  validate(createEmployeeSchema),
  wrap(async (req, res) => {
    const data = await svc.create(req.user!.empcloudOrgId, req.body);
    res.status(201).json({ success: true, data });
  }),
);

router.put(
  "/:id",
  authorize("hr_admin", "hr_manager"),
  validate(updateEmployeeSchema),
  wrap(async (req, res) => {
    const data = await svc.update(numParam(req, "id"), req.user!.empcloudOrgId, req.body);
    res.json({ success: true, data });
  }),
);

router.delete(
  "/:id",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.deactivate(numParam(req, "id"), req.user!.empcloudOrgId);
    res.json({ success: true, data });
  }),
);

router.get(
  "/:id/bank-details",
  wrap(async (req, res) => {
    const data = await svc.getBankDetails(numParam(req, "id"), req.user!.empcloudOrgId);
    res.json({ success: true, data });
  }),
);

router.put(
  "/:id/bank-details",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.updateBankDetails(
      numParam(req, "id"),
      req.user!.empcloudOrgId,
      req.body,
    );
    res.json({ success: true, data });
  }),
);

router.get(
  "/:id/tax-info",
  wrap(async (req, res) => {
    const data = await svc.getTaxInfo(numParam(req, "id"), req.user!.empcloudOrgId);
    res.json({ success: true, data });
  }),
);

router.put(
  "/:id/tax-info",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.updateTaxInfo(numParam(req, "id"), req.user!.empcloudOrgId, req.body);
    res.json({ success: true, data });
  }),
);

router.get(
  "/:id/pf-details",
  wrap(async (req, res) => {
    const data = await svc.getPfDetails(numParam(req, "id"), req.user!.empcloudOrgId);
    res.json({ success: true, data });
  }),
);

router.put(
  "/:id/pf-details",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.updatePfDetails(numParam(req, "id"), req.user!.empcloudOrgId, req.body);
    res.json({ success: true, data });
  }),
);

// Notes (still uses string IDs for payroll-internal tables)
router.get(
  "/:id/notes",
  wrap(async (req, res) => {
    const notes = await getNotes(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data: notes });
  }),
);

router.post(
  "/:id/notes",
  wrap(async (req, res) => {
    const data = await createNote({
      orgId: String(req.user!.empcloudOrgId),
      employeeId: param(req, "id"),
      authorId: String(req.user!.empcloudUserId),
      content: req.body.content,
      category: req.body.category,
      isPrivate: req.body.isPrivate,
    });
    res.status(201).json({ success: true, data });
  }),
);

router.delete(
  "/:id/notes/:noteId",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    await deleteNote(req.params.noteId as string, String(req.user!.empcloudOrgId));
    res.json({ success: true, data: { deleted: true } });
  }),
);

export { router as employeeRoutes };
