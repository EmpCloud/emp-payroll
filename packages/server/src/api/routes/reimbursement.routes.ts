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
    const data = await svc.list(String(req.user!.empcloudOrgId), {
      status: req.query.status as string,
      employeeId: req.query.employeeId as string,
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

export { router as reimbursementRoutes };
