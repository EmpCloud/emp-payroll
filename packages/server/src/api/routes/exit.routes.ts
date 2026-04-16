import { Router } from "express";
import {
  initiateExit,
  listExits,
  getExit,
  updateExit,
  calculateFnF,
} from "../../services/exit.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { wrap } from "../helpers";

const router = Router();
router.use(authenticate);

// List all exits
router.get(
  "/",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const status = req.query.status as string | undefined;
    const data = await listExits(req.user!.empcloudOrgId, status);
    res.json({ success: true, data });
  }),
);

// Get single exit
router.get(
  "/:id",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await getExit(String(req.params.id), req.user!.empcloudOrgId);
    if (!data)
      return res
        .status(404)
        .json({ success: false, error: { code: "NOT_FOUND", message: "Exit record not found" } });
    res.json({ success: true, data });
  }),
);

// Initiate exit
router.post(
  "/",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    // Accept both camelCase (primary) and snake_case keys so form submissions
    // from any client naming convention work. Fixes #28 — the Initiate Exit
    // form was rejecting valid payloads because different UI components
    // (search results + native <select>) mix snake_case and camelCase.
    const body = req.body || {};
    const employeeId = body.employeeId ?? body.employee_id;
    const exitType = body.exitType ?? body.exit_type;
    const resignationDate = body.resignationDate ?? body.resignation_date;
    const lastWorkingDate = body.lastWorkingDate ?? body.last_working_date;
    const reason = body.reason;
    if (!employeeId || !exitType) {
      return res.status(400).json({
        success: false,
        error: { code: "INVALID_INPUT", message: "employeeId and exitType are required" },
      });
    }
    const data = await initiateExit({
      orgId: req.user!.empcloudOrgId,
      employeeId: Number(employeeId),
      exitType,
      resignationDate,
      lastWorkingDate,
      reason,
      initiatedBy: req.user!.empcloudUserId,
    });
    res.status(201).json({ success: true, data });
  }),
);

// Update exit (checklist items, status, FnF amounts)
router.put(
  "/:id",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const updated = await updateExit(String(req.params.id), req.user!.empcloudOrgId, req.body);
    if (!updated)
      return res
        .status(404)
        .json({ success: false, error: { code: "NOT_FOUND", message: "Exit record not found" } });
    res.json({ success: true, data: { updated: true } });
  }),
);

// Calculate FnF
router.post(
  "/:id/calculate-fnf",
  authorize("hr_admin"),
  wrap(async (req, res) => {
    const data = await calculateFnF(String(req.params.id), req.user!.empcloudOrgId);
    if (!data)
      return res
        .status(404)
        .json({ success: false, error: { code: "NOT_FOUND", message: "Exit record not found" } });
    res.json({ success: true, data });
  }),
);

export { router as exitRoutes };
