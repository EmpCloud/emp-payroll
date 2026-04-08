// NOTE: When USE_CLOUD_HRMS=true, payroll computation fetches attendance/leave
// data from EMP Cloud's HRMS APIs (via cloud-hrms.service.ts).
// These local routes remain as a fallback and for backward compatibility.

import { Router } from "express";
import { AttendanceService } from "../../services/attendance.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { validate, importAttendanceSchema } from "../validators";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new AttendanceService();

router.use(authenticate);

router.get(
  "/summary/bulk",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const { month, year } = req.query as any;
    const data = await svc.bulkSummary(
      String(req.user!.empcloudOrgId),
      Number(month),
      Number(year),
    );
    res.json({ success: true, data });
  }),
);

router.get(
  "/summary/:empId",
  wrap(async (req, res) => {
    const { month, year } = req.query as any;
    const data = await svc.getSummary(
      param(req, "empId"),
      Number(month) || undefined,
      Number(year) || undefined,
    );
    res.json({ success: true, data });
  }),
);

router.post(
  "/import",
  authorize("hr_admin", "hr_manager"),
  validate(importAttendanceSchema),
  wrap(async (req, res) => {
    const data = await svc.importRecords(
      String(req.user!.empcloudOrgId),
      req.body.month,
      req.body.year,
      req.body.records,
    );
    res.json({ success: true, data });
  }),
);

router.post(
  "/sync",
  authorize("hr_admin"),
  wrap(async (_req, res) => {
    res.json({ success: true, data: { message: "EmpMonitor sync — integration pending" } });
  }),
);

router.get(
  "/lop/:empId",
  wrap(async (req, res) => {
    const { month, year } = req.query as any;
    const data = await svc.getLopDays(param(req, "empId"), Number(month), Number(year));
    res.json({ success: true, data });
  }),
);

router.put(
  "/lop/:empId",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.overrideLop(
      param(req, "empId"),
      req.body.month,
      req.body.year,
      req.body.lopDays,
    );
    res.json({ success: true, data });
  }),
);

router.get(
  "/overtime/:empId",
  wrap(async (req, res) => {
    const { month, year, monthlyBasic } = req.query as any;
    const data = await svc.computeOvertimePay(
      param(req, "empId"),
      Number(month),
      Number(year),
      Number(monthlyBasic) || 0,
    );
    res.json({ success: true, data });
  }),
);

export { router as attendanceRoutes };
