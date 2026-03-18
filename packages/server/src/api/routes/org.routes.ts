import { Router } from "express";
import { OrgService } from "../../services/org.service";
import { AuditService } from "../../services/audit.service";
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

router.get("/:id/activity", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const auditSvc = new AuditService();
  const data = await auditSvc.getRecent(param(req, "id"), Number(req.query.limit) || 20);
  res.json({ success: true, data });
}));

export { router as orgRoutes };
