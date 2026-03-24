import { Router } from "express";
import { PayEquityService } from "../../services/pay-equity.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { wrap } from "../helpers";

const router = Router();
const svc = new PayEquityService();

router.use(authenticate);
router.use(authorize("hr_admin"));

router.get(
  "/analysis",
  wrap(async (req, res) => {
    const data = await svc.analyzePayEquity(String(req.user!.empcloudOrgId), {
      dimension: req.query.dimension as string,
    });
    res.json({ success: true, data });
  }),
);

router.get(
  "/compliance-report",
  wrap(async (req, res) => {
    const data = await svc.generateComplianceReport(String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

export { router as payEquityRoutes };
