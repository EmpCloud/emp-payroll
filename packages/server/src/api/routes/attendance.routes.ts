import { Router } from "express";
import { AttendanceService } from "../../services/attendance.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { validate, importAttendanceSchema } from "../validators";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new AttendanceService();

router.use(authenticate);

router.get("/summary/:empId", wrap(async (req, res) => {
  const { month, year } = req.query as any;
  const data = await svc.getSummary(param(req, "empId"), Number(month) || undefined, Number(year) || undefined);
  res.json({ success: true, data });
}));

router.get("/summary/bulk", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const { month, year } = req.query as any;
  const data = await svc.bulkSummary(req.user!.orgId, Number(month), Number(year));
  res.json({ success: true, data });
}));

router.post("/import", authorize("hr_admin", "hr_manager"), validate(importAttendanceSchema), wrap(async (req, res) => {
  const data = await svc.importRecords(req.user!.orgId, req.body.month, req.body.year, req.body.records);
  res.json({ success: true, data });
}));

router.post("/sync", authorize("hr_admin"), wrap(async (_req, res) => {
  res.json({ success: true, data: { message: "EmpMonitor sync — integration pending" } });
}));

router.get("/lop/:empId", wrap(async (req, res) => {
  const { month, year } = req.query as any;
  const data = await svc.getLopDays(param(req, "empId"), Number(month), Number(year));
  res.json({ success: true, data });
}));

router.put("/lop/:empId", authorize("hr_admin", "hr_manager"), wrap(async (req, res) => {
  const data = await svc.overrideLop(param(req, "empId"), req.body.month, req.body.year, req.body.lopDays);
  res.json({ success: true, data });
}));

export { router as attendanceRoutes };
