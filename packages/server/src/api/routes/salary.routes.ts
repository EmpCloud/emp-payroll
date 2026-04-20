import { Router } from "express";
import { SalaryService } from "../../services/salary.service";
import { SalaryHistoryService } from "../../services/salary-history.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import {
  validate,
  createSalaryStructureSchema,
  assignSalarySchema,
  bulkSalaryAssignSchema,
} from "../validators";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new SalaryService();

router.use(authenticate);

// #106 — These routes were restricted to hr_admin / hr_manager; org_admin
// and super_admin 403'd when clicking Edit Salary Structure, which the
// client surfaced as a generic "Failed to save" toast. Widen the allow-list
// to match the other finance-facing routes.
const STRUCTURE_EDIT_ROLES = ["hr_admin", "hr_manager", "org_admin", "super_admin"] as const;

router.get(
  "/",
  authorize(...STRUCTURE_EDIT_ROLES),
  wrap(async (req, res) => {
    const data = await svc.listStructures(String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

router.get(
  "/:id",
  wrap(async (req, res) => {
    const data = await svc.getStructure(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

router.post(
  "/",
  authorize(...STRUCTURE_EDIT_ROLES),
  validate(createSalaryStructureSchema),
  wrap(async (req, res) => {
    const data = await svc.createStructure(String(req.user!.empcloudOrgId), req.body);
    res.status(201).json({ success: true, data });
  }),
);

router.put(
  "/:id",
  authorize(...STRUCTURE_EDIT_ROLES),
  wrap(async (req, res) => {
    const data = await svc.updateStructure(
      param(req, "id"),
      String(req.user!.empcloudOrgId),
      req.body,
    );
    res.json({ success: true, data });
  }),
);

router.delete(
  "/:id",
  authorize(...STRUCTURE_EDIT_ROLES),
  wrap(async (req, res) => {
    const data = await svc.deleteStructure(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

router.post(
  "/:id/duplicate",
  authorize(...STRUCTURE_EDIT_ROLES),
  wrap(async (req, res) => {
    const data = await svc.duplicateStructure(
      param(req, "id"),
      String(req.user!.empcloudOrgId),
      typeof req.body?.name === "string" ? req.body.name : undefined,
    );
    res.status(201).json({ success: true, data });
  }),
);

router.get(
  "/:id/components",
  wrap(async (req, res) => {
    const data = await svc.getComponents(param(req, "id"));
    res.json({ success: true, data });
  }),
);

router.post(
  "/:id/components",
  authorize(...STRUCTURE_EDIT_ROLES),
  wrap(async (req, res) => {
    const data = await svc.addComponent(param(req, "id"), req.body);
    res.status(201).json({ success: true, data });
  }),
);

router.put(
  "/:id/components/:cid",
  authorize(...STRUCTURE_EDIT_ROLES),
  wrap(async (req, res) => {
    const data = await svc.updateComponent(param(req, "id"), param(req, "cid"), req.body);
    res.json({ success: true, data });
  }),
);

router.post(
  "/assign",
  authorize("hr_admin", "hr_manager"),
  validate(assignSalarySchema),
  wrap(async (req, res) => {
    const data = await svc.assignToEmployee(req.body);
    res.status(201).json({ success: true, data });
  }),
);

router.get(
  "/employee/:empId",
  wrap(async (req, res) => {
    const data = await svc.getEmployeeSalary(param(req, "empId"));
    res.json({ success: true, data });
  }),
);

router.post(
  "/employee/:empId/revision",
  authorize(...STRUCTURE_EDIT_ROLES),
  wrap(async (req, res) => {
    const data = await svc.salaryRevision(param(req, "empId"), req.body);
    res.status(201).json({ success: true, data });
  }),
);

router.get(
  "/employee/:empId/history",
  wrap(async (req, res) => {
    const historySvc = new SalaryHistoryService();
    const data = await historySvc.getHistory(param(req, "empId"));
    res.json({ success: true, data });
  }),
);

router.post(
  "/employee/:empId/arrears",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.computeArrears(param(req, "empId"), String(req.user!.empcloudOrgId), {
      oldMonthlyCTC: req.body.oldMonthlyCTC,
      newMonthlyCTC: req.body.newMonthlyCTC,
      effectiveFrom: req.body.effectiveFrom,
    });
    res.json({ success: true, data });
  }),
);

router.post(
  "/bulk-assign",
  authorize(...STRUCTURE_EDIT_ROLES),
  validate(bulkSalaryAssignSchema),
  wrap(async (req, res) => {
    const { employeeIds, ...salaryData } = req.body;
    const data = await svc.bulkAssignSalary(employeeIds, salaryData);
    res.json({ success: true, data });
  }),
);

export { router as salaryRoutes };
