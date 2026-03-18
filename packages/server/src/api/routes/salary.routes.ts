import { Router } from "express";
import { SalaryService } from "../../services/salary.service";
import { SalaryHistoryService } from "../../services/salary-history.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { validate, createSalaryStructureSchema, assignSalarySchema } from "../validators";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new SalaryService();

router.use(authenticate);

router.get("/", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const data = await svc.listStructures(req.user!.orgId);
  res.json({ success: true, data });
}));

router.get("/:id", wrap(async (req, res) => {
  const data = await svc.getStructure(param(req, "id"), req.user!.orgId);
  res.json({ success: true, data });
}));

router.post("/", authorize("hr_admin"), validate(createSalaryStructureSchema), wrap(async (req, res) => {
  const data = await svc.createStructure(req.user!.orgId, req.body);
  res.status(201).json({ success: true, data });
}));

router.put("/:id", authorize("hr_admin"), wrap(async (req, res) => {
  const data = await svc.updateStructure(param(req, "id"), req.user!.orgId, req.body);
  res.json({ success: true, data });
}));

router.delete("/:id", authorize("hr_admin"), wrap(async (req, res) => {
  const data = await svc.deleteStructure(param(req, "id"), req.user!.orgId);
  res.json({ success: true, data });
}));

router.get("/:id/components", wrap(async (req, res) => {
  const data = await svc.getComponents(param(req, "id"));
  res.json({ success: true, data });
}));

router.post("/:id/components", authorize("hr_admin"), wrap(async (req, res) => {
  const data = await svc.addComponent(param(req, "id"), req.body);
  res.status(201).json({ success: true, data });
}));

router.put("/:id/components/:cid", authorize("hr_admin"), wrap(async (req, res) => {
  const data = await svc.updateComponent(param(req, "id"), param(req, "cid"), req.body);
  res.json({ success: true, data });
}));

router.post("/assign", authorize("hr_admin", "hr_manager"), validate(assignSalarySchema), wrap(async (req, res) => {
  const data = await svc.assignToEmployee(req.body);
  res.status(201).json({ success: true, data });
}));

router.get("/employee/:empId", wrap(async (req, res) => {
  const data = await svc.getEmployeeSalary(param(req, "empId"));
  res.json({ success: true, data });
}));

router.post("/employee/:empId/revision", authorize("hr_admin"), wrap(async (req, res) => {
  const data = await svc.salaryRevision(param(req, "empId"), req.body);
  res.status(201).json({ success: true, data });
}));

router.get("/employee/:empId/history", wrap(async (req, res) => {
  const historySvc = new SalaryHistoryService();
  const data = await historySvc.getHistory(param(req, "empId"));
  res.json({ success: true, data });
}));

export { router as salaryRoutes };
