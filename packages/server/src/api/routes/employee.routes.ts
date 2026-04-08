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

// GET /employees/available-from-empcloud — List EmpCloud employees not yet in payroll
router.get(
  "/available-from-empcloud",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.listAvailableForImport(req.user!.empcloudOrgId);
    res.json({ success: true, data });
  }),
);

// POST /employees/import-from-empcloud — Import selected EmpCloud employees into payroll
router.post(
  "/import-from-empcloud",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const { user_ids } = req.body;
    if (!Array.isArray(user_ids) || user_ids.length === 0) {
      return res.status(400).json({ success: false, message: "user_ids[] required" });
    }

    const { getEmpCloudDB } = await import("../../db/empcloud");
    const { getDB } = await import("../../db/adapters/index");
    const empcloudDb = getEmpCloudDB();
    const payrollDb = getDB();
    const orgId = req.user!.empcloudOrgId;

    const results: { user_id: number; status: string; error?: string }[] = [];

    for (const userId of user_ids) {
      try {
        const user = await empcloudDb("users")
          .where({ id: userId, organization_id: orgId, status: 1 })
          .first();
        if (!user) {
          results.push({ user_id: userId, status: "skipped", error: "User not found" });
          continue;
        }

        // Create payroll profile
        const existing = await payrollDb.findOne<any>("employee_payroll_profiles", {
          empcloud_user_id: userId,
          empcloud_org_id: orgId,
        });
        if (!existing) {
          await payrollDb.create<any>("employee_payroll_profiles", {
            empcloud_user_id: userId,
            empcloud_org_id: orgId,
          });
        }

        // Create seat in EmpCloud
        const module = await empcloudDb("modules").where({ slug: "emp-payroll" }).first();
        if (module) {
          const seatExists = await empcloudDb("org_module_seats")
            .where({ organization_id: orgId, module_id: module.id, user_id: userId })
            .first();
          if (!seatExists) {
            const sub = await empcloudDb("org_subscriptions")
              .where({ organization_id: orgId, module_id: module.id })
              .whereIn("status", ["active", "trial"])
              .first();
            if (sub) {
              await empcloudDb("org_module_seats").insert({
                subscription_id: sub.id,
                organization_id: orgId,
                module_id: module.id,
                user_id: userId,
                assigned_by: req.user!.empcloudUserId || userId,
                assigned_at: new Date(),
              });
              await empcloudDb("org_subscriptions")
                .where({ id: sub.id })
                .increment("used_seats", 1);
            }
          }
        }

        results.push({ user_id: userId, status: "imported" });
      } catch (err: any) {
        results.push({ user_id: userId, status: "error", error: err.message });
      }
    }

    const imported = results.filter((r) => r.status === "imported").length;
    res.json({ success: true, data: { total: user_ids.length, imported, results } });
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
      const raw = employees[i];
      // Normalize keys: support both camelCase and "Spaced Header" formats from CSV exports
      const emp: any = {};
      for (const [key, value] of Object.entries(raw)) {
        emp[key] = value;
      }
      // Map common spaced/snake_case CSV headers to camelCase
      if (!emp.firstName) emp.firstName = emp["First Name"] || emp.first_name || "";
      if (!emp.lastName) emp.lastName = emp["Last Name"] || emp.last_name || "";
      if (!emp.email) emp.email = emp["Email"] || "";
      if (!emp.phone) emp.phone = emp["Phone"] || emp.contact_number || "";
      if (!emp.dateOfBirth)
        emp.dateOfBirth = emp["Date of Birth"] || emp.date_of_birth || "1990-01-01";
      if (!emp.gender) emp.gender = (emp["Gender"] || "other").toLowerCase();
      if (!emp.dateOfJoining)
        emp.dateOfJoining =
          emp["Date of Joining"] || emp.date_of_joining || new Date().toISOString().slice(0, 10);
      if (!emp.employeeCode) emp.employeeCode = emp["Employee Code"] || emp.employee_code || "";
      if (!emp.designation) emp.designation = emp["Designation"] || "Employee";
      if (!emp.department) emp.department = emp["Department"] || "General";
      if (!emp.employmentType)
        emp.employmentType = emp["Employment Type"] || emp.employment_type || "full_time";
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

// --- Bank Update Requests (admin view) — MUST be before /:id ---
import { BankUpdateRequestService } from "../../services/bank-update-request.service";
import { getEmpCloudDB } from "../../db/empcloud";
const bankReqSvc = new BankUpdateRequestService();

router.get(
  "/bank-update-requests",
  authorize("hr_admin", "hr_manager", "org_admin"),
  wrap(async (req, res) => {
    const result = await bankReqSvc.getOrgRequests(
      req.user!.empcloudOrgId,
      req.query.status as string,
    );
    const ecDb = getEmpCloudDB();
    const enriched = [];
    for (const r of result.data) {
      const parsed = {
        ...r,
        current_details:
          typeof r.current_details === "string" ? JSON.parse(r.current_details) : r.current_details,
        requested_details:
          typeof r.requested_details === "string"
            ? JSON.parse(r.requested_details)
            : r.requested_details,
      };
      const user = await ecDb("users").where({ id: r.empcloud_user_id }).first();
      enriched.push({
        ...parsed,
        employee_name: user ? `${user.first_name} ${user.last_name}` : "Unknown",
        emp_code: user?.emp_code || "",
      });
    }
    res.json({ success: true, data: { ...result, data: enriched } });
  }),
);

router.post(
  "/bank-update-requests/:id/approve",
  authorize("hr_admin", "hr_manager", "org_admin"),
  wrap(async (req, res) => {
    const data = await bankReqSvc.approve(param(req, "id"), req.user!.empcloudUserId);
    res.json({ success: true, data });
  }),
);

router.post(
  "/bank-update-requests/:id/reject",
  authorize("hr_admin", "hr_manager", "org_admin"),
  wrap(async (req, res) => {
    const data = await bankReqSvc.reject(
      param(req, "id"),
      req.user!.empcloudUserId,
      req.body.remarks,
    );
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

router.get(
  "/:id/esi-details",
  wrap(async (req, res) => {
    const data = await svc.getEsiDetails(numParam(req, "id"), req.user!.empcloudOrgId);
    res.json({ success: true, data });
  }),
);

router.put(
  "/:id/esi-details",
  authorize("hr_admin", "hr_manager", "org_admin"),
  wrap(async (req, res) => {
    const data = await svc.updateEsiDetails(numParam(req, "id"), req.user!.empcloudOrgId, req.body);
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
