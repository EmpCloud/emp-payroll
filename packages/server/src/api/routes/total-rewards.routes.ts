import { Router } from "express";
import { TotalRewardsService } from "../../services/total-rewards.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new TotalRewardsService();

router.use(authenticate);

// Admin: generate statement for any employee
router.get(
  "/employee/:empId",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.generateStatement(
      String(req.user!.empcloudOrgId),
      param(req, "empId"),
      req.query.financialYear as string,
    );
    res.json({ success: true, data });
  }),
);

// Admin: generate HTML statement (for PDF)
router.get(
  "/employee/:empId/html",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const html = await svc.generateStatementHTML(
      String(req.user!.empcloudOrgId),
      param(req, "empId"),
      req.query.financialYear as string,
    );
    res.setHeader("Content-Type", "text/html");
    // #135 — allow inline onclick="window.print()" on the Print / Save as PDF button
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
    );
    res.send(html);
  }),
);

// Self-service: my total rewards
router.get(
  "/my",
  wrap(async (req, res) => {
    const data = await svc.generateStatement(
      String(req.user!.empcloudOrgId),
      String(req.user!.empcloudUserId),
      req.query.financialYear as string,
    );
    res.json({ success: true, data });
  }),
);

// Self-service: my total rewards HTML
router.get(
  "/my/html",
  wrap(async (req, res) => {
    const html = await svc.generateStatementHTML(
      String(req.user!.empcloudOrgId),
      String(req.user!.empcloudUserId),
      req.query.financialYear as string,
    );
    res.setHeader("Content-Type", "text/html");
    // #135 — allow inline onclick="window.print()" on the Print / Save as PDF button
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
    );
    res.send(html);
  }),
);

export { router as totalRewardsRoutes };
