import { Router } from "express";
import { ReimbursementService } from "../../services/reimbursement.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new ReimbursementService();

router.use(authenticate);

// Admin: list all reimbursements
router.get(
  "/",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const { status, employeeId, q, location_id, department_id, page, limit } = req.query as any;
    const data = await svc.list(String(req.user!.empcloudOrgId), {
      status: status as string,
      employeeId: employeeId as string,
      q: typeof q === "string" && q.trim() ? q.trim() : undefined,
      locationId: location_id ? Number(location_id) : undefined,
      departmentId: department_id ? Number(department_id) : undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
    res.json({ success: true, data });
  }),
);

// Admin: file a reimbursement on behalf of an employee. The body is the
// same as self-service submit() with one extra field -- employeeId, the
// EmpCloud user id of the employee the claim belongs to. submit()
// already accepts a numeric EmpCloud id and resolves it through
// resolveEmployeeRow(), so no new service method is needed.
router.post(
  "/admin",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const { employeeId, category, description, amount, expenseDate } = req.body ?? {};
    if (!employeeId) {
      return res
        .status(400)
        .json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "employeeId is required" },
        });
    }
    const data = await svc.submit(String(employeeId), {
      category,
      description,
      amount: typeof amount === "number" ? amount : Number(amount),
      expenseDate,
    });
    res.json({ success: true, data });
  }),
);

// Admin: approve
router.post(
  "/:id/approve",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    // Body is optional -- the UI calls approve with no payload, so axios
    // sends no Content-Type and express.json() leaves req.body undefined.
    // Reading .amount off undefined was crashing every approve in prod.
    const data = await svc.approve(
      param(req, "id"),
      String(req.user!.empcloudUserId),
      req.body?.amount,
    );
    res.json({ success: true, data });
  }),
);

// Admin: reject
router.post(
  "/:id/reject",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.reject(param(req, "id"), String(req.user!.empcloudUserId));
    res.json({ success: true, data });
  }),
);

// Admin: mark paid
router.post(
  "/:id/pay",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.markPaid(param(req, "id"), req.body?.month, req.body?.year);
    res.json({ success: true, data });
  }),
);

// Admin: edit a claim. Allowed for pending / approved only -- paid
// claims are locked because they're tied to a payslip's REIMB line.
router.patch(
  "/:id",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const { category, description, amount, expenseDate } = req.body ?? {};
    const data = await svc.update(param(req, "id"), {
      category,
      description,
      amount:
        amount !== undefined && amount !== null
          ? typeof amount === "number"
            ? amount
            : Number(amount)
          : undefined,
      expenseDate,
    });
    res.json({ success: true, data });
  }),
);

// Admin: delete a claim outright. Refuses paid claims -- the run must
// be deleted first to revert the claim back to approved.
router.delete(
  "/:id",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.remove(param(req, "id"));
    res.json({ success: true, data });
  }),
);

export { router as reimbursementRoutes };
