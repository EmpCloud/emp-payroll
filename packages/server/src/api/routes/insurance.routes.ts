import { Router } from "express";
import { InsuranceService } from "../../services/insurance.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import {
  validate,
  createInsurancePolicySchema,
  updateInsurancePolicySchema,
  enrollInsuranceSchema,
  submitInsuranceClaimSchema,
  reviewInsuranceClaimSchema,
} from "../validators";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new InsuranceService();

router.use(authenticate);

// ---------------------------------------------------------------------------
// Dashboard
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
// Policies (CRUD)
// ---------------------------------------------------------------------------
router.get(
  "/policies",
  wrap(async (req, res) => {
    const data = await svc.listPolicies(String(req.user!.empcloudOrgId), {
      type: req.query.type as string,
      status: req.query.status as string,
    });
    res.json({
      success: true,
      data: data.data,
      meta: { total: data.total, page: data.page, limit: data.limit, totalPages: data.totalPages },
    });
  }),
);

router.get(
  "/policies/:id",
  wrap(async (req, res) => {
    const data = await svc.getPolicy(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

router.post(
  "/policies",
  authorize("hr_admin"),
  validate(createInsurancePolicySchema),
  wrap(async (req, res) => {
    const data = await svc.createPolicy(String(req.user!.empcloudOrgId), req.body);
    res.status(201).json({ success: true, data });
  }),
);

router.put(
  "/policies/:id",
  authorize("hr_admin"),
  validate(updateInsurancePolicySchema),
  wrap(async (req, res) => {
    const data = await svc.updatePolicy(
      param(req, "id"),
      String(req.user!.empcloudOrgId),
      req.body,
    );
    res.json({ success: true, data });
  }),
);

router.delete(
  "/policies/:id",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.deletePolicy(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

// ---------------------------------------------------------------------------
// Enrollments
// ---------------------------------------------------------------------------
router.post(
  "/enroll",
  authorize("hr_admin", "hr_manager"),
  validate(enrollInsuranceSchema),
  wrap(async (req, res) => {
    const data = await svc.enrollEmployee(String(req.user!.empcloudOrgId), req.body);
    res.status(201).json({ success: true, data });
  }),
);

router.get(
  "/enrollments",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.listEnrollments(String(req.user!.empcloudOrgId), {
      policyId: req.query.policyId as string,
      employeeId: req.query.employeeId as string,
      status: req.query.status as string,
    });
    res.json({ success: true, data: data.data, meta: { total: data.total } });
  }),
);

router.get(
  "/my",
  wrap(async (req, res) => {
    const data = await svc.getMyInsurance(
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

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------
router.post(
  "/claims",
  validate(submitInsuranceClaimSchema),
  wrap(async (req, res) => {
    const data = await svc.submitClaim(
      String(req.user!.empcloudOrgId),
      String(req.user!.empcloudUserId),
      req.body,
    );
    res.status(201).json({ success: true, data });
  }),
);

router.get(
  "/claims",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.listClaims(String(req.user!.empcloudOrgId), {
      status: req.query.status as string,
      employeeId: req.query.employeeId as string,
      policyId: req.query.policyId as string,
    });
    res.json({ success: true, data: data.data, meta: { total: data.total } });
  }),
);

router.get(
  "/my-claims",
  wrap(async (req, res) => {
    const data = await svc.getMyClaims(
      String(req.user!.empcloudOrgId),
      String(req.user!.empcloudUserId),
    );
    res.json({ success: true, data: data.data, meta: { total: data.total } });
  }),
);

router.post(
  "/claims/:id/approve",
  authorize("hr_admin", "hr_manager"),
  validate(reviewInsuranceClaimSchema),
  wrap(async (req, res) => {
    const data = await svc.reviewClaim(
      String(req.user!.empcloudOrgId),
      param(req, "id"),
      String(req.user!.empcloudUserId),
      "approve",
      { amountApproved: req.body.amountApproved, notes: req.body.notes },
    );
    res.json({ success: true, data });
  }),
);

router.post(
  "/claims/:id/reject",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.reviewClaim(
      String(req.user!.empcloudOrgId),
      param(req, "id"),
      String(req.user!.empcloudUserId),
      "reject",
      { rejectionReason: req.body.rejectionReason, notes: req.body.notes },
    );
    res.json({ success: true, data });
  }),
);

router.post(
  "/claims/:id/settle",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await svc.settleClaim(String(req.user!.empcloudOrgId), param(req, "id"));
    res.json({ success: true, data });
  }),
);

export { router as insuranceRoutes };
