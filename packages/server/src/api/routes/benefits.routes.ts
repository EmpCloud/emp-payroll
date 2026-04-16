import { Router } from "express";
import { BenefitsService } from "../../services/benefits.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import {
  validate,
  createBenefitPlanSchema,
  updateBenefitPlanSchema,
  enrollBenefitSchema,
} from "../validators";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new BenefitsService();

router.use(authenticate);

// ---------------------------------------------------------------------------
// Admin Dashboard
// ---------------------------------------------------------------------------
router.get(
  "/dashboard",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.getDashboardStats(String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

// ---------------------------------------------------------------------------
// Benefit Plans
// ---------------------------------------------------------------------------
router.get(
  "/plans",
  wrap(async (req, res) => {
    const data = await svc.listPlans(String(req.user!.empcloudOrgId), {
      type: req.query.type as string,
      active: req.query.active === "true" ? true : req.query.active === "false" ? false : undefined,
    });
    res.json({
      success: true,
      data: data.data,
      meta: { total: data.total, page: data.page, limit: data.limit, totalPages: data.totalPages },
    });
  }),
);

router.get(
  "/plans/:id",
  wrap(async (req, res) => {
    const data = await svc.getPlan(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

router.post(
  "/plans",
  authorize("hr_admin"),
  validate(createBenefitPlanSchema),
  wrap(async (req, res) => {
    const data = await svc.createPlan(String(req.user!.empcloudOrgId), req.body);
    res.status(201).json({ success: true, data });
  }),
);

router.put(
  "/plans/:id",
  authorize("hr_admin"),
  validate(updateBenefitPlanSchema),
  wrap(async (req, res) => {
    const data = await svc.updatePlan(param(req, "id"), String(req.user!.empcloudOrgId), req.body);
    res.json({ success: true, data });
  }),
);

router.delete(
  "/plans/:id",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.deletePlan(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

// ---------------------------------------------------------------------------
// Employee Enrollments
// ---------------------------------------------------------------------------
router.post(
  "/enroll",
  authorize("hr_admin", "hr_manager"),
  validate(enrollBenefitSchema),
  wrap(async (req, res) => {
    const data = await svc.enrollEmployee(String(req.user!.empcloudOrgId), req.body);
    res.status(201).json({ success: true, data });
  }),
);

router.get(
  "/enrollments",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.listAllEnrollments(String(req.user!.empcloudOrgId), {
      status: req.query.status as string,
      planId: req.query.planId as string,
    });
    res.json({ success: true, data: data.data, meta: { total: data.total } });
  }),
);

router.get(
  "/employee/:empId",
  wrap(async (req, res) => {
    const data = await svc.listEmployeeBenefits(
      String(req.user!.empcloudOrgId),
      param(req, "empId"),
    );
    res.json({ success: true, data: data.data });
  }),
);

router.get(
  "/my",
  wrap(async (req, res) => {
    const data = await svc.listEmployeeBenefits(
      String(req.user!.empcloudOrgId),
      String(req.user!.empcloudUserId),
    );
    res.json({ success: true, data: data.data });
  }),
);

router.put(
  "/enrollments/:id",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.updateEnrollment(
      param(req, "id"),
      String(req.user!.empcloudOrgId),
      req.body,
    );
    res.json({ success: true, data });
  }),
);

router.post(
  "/enrollments/:id/cancel",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.cancelEnrollment(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

export { router as benefitsRoutes };
