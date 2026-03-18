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

router.get("/", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const { page, limit, sort, order, department } = req.query as any;
  const options: any = { page: Number(page) || 1, limit: Number(limit) || 20 };
  if (sort) options.sort = { field: sort, order: order || "asc" };
  if (department) options.filters = { ...options.filters, department };
  const result = await svc.list(req.user!.orgId, options);
  res.json({ success: true, data: result });
}));

// Static routes BEFORE /:id param routes
router.get("/export", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const exportSvc = new ExportService();
  const csv = await exportSvc.exportEmployeesCSV(req.user!.orgId);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=employees.csv");
  res.send(csv);
}));

router.post("/import", authorize("hr_admin"), wrap(async (_req, res) => {
  res.json({ success: true, data: { message: "Bulk import — use CSV upload endpoint" } });
}));

router.get("/:id", wrap(async (req, res) => {
  const data = await svc.getById(param(req, "id"), req.user!.orgId);
  res.json({ success: true, data });
}));

router.post("/", authorize("hr_admin", "hr_manager"), validate(createEmployeeSchema), wrap(async (req, res) => {
  const data = await svc.create(req.user!.orgId, req.body);
  res.status(201).json({ success: true, data });
}));

router.put("/:id", authorize("hr_admin", "hr_manager"), validate(updateEmployeeSchema), wrap(async (req, res) => {
  const data = await svc.update(param(req, "id"), req.user!.orgId, req.body);
  res.json({ success: true, data });
}));

router.delete("/:id", authorize("hr_admin"), wrap(async (req, res) => {
  const data = await svc.deactivate(param(req, "id"), req.user!.orgId);
  res.json({ success: true, data });
}));

router.get("/:id/bank-details", wrap(async (req, res) => {
  const data = await svc.getBankDetails(param(req, "id"), req.user!.orgId);
  res.json({ success: true, data });
}));

router.put("/:id/bank-details", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const data = await svc.updateBankDetails(param(req, "id"), req.user!.orgId, req.body);
  res.json({ success: true, data });
}));

router.get("/:id/tax-info", wrap(async (req, res) => {
  const data = await svc.getTaxInfo(param(req, "id"), req.user!.orgId);
  res.json({ success: true, data });
}));

router.put("/:id/tax-info", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const data = await svc.updateTaxInfo(param(req, "id"), req.user!.orgId, req.body);
  res.json({ success: true, data });
}));

router.get("/:id/pf-details", wrap(async (req, res) => {
  const data = await svc.getPfDetails(param(req, "id"), req.user!.orgId);
  res.json({ success: true, data });
}));

router.put("/:id/pf-details", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const data = await svc.updatePfDetails(param(req, "id"), req.user!.orgId, req.body);
  res.json({ success: true, data });
}));

// Notes
router.get("/:id/notes", wrap(async (req, res) => {
  const notes = await getNotes(param(req, "id"), req.user!.orgId);
  res.json({ success: true, data: notes });
}));

router.post("/:id/notes", wrap(async (req, res) => {
  const data = await createNote({
    orgId: req.user!.orgId,
    employeeId: param(req, "id"),
    authorId: req.user!.userId,
    content: req.body.content,
    category: req.body.category,
    isPrivate: req.body.isPrivate,
  });
  res.status(201).json({ success: true, data });
}));

router.delete("/:id/notes/:noteId", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  await deleteNote(req.params.noteId as string, req.user!.orgId);
  res.json({ success: true, data: { deleted: true } });
}));

export { router as employeeRoutes };
