import { Router } from "express";
import { TaxDeclarationService } from "../../services/tax-declaration.service";
import { Form16Service } from "../../services/form16.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { validate, submitDeclarationSchema } from "../validators";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new TaxDeclarationService();

router.use(authenticate);

router.get(
  "/computation/:empId",
  wrap(async (req, res) => {
    const data = await svc.getComputation(param(req, "empId"), req.query.fy as string);
    res.json({ success: true, data });
  }),
);

router.post(
  "/computation/:empId/compute",
  wrap(async (req, res) => {
    const data = await svc.computeTax(param(req, "empId"));
    res.json({ success: true, data });
  }),
);

// --- Admin Tax Calculator ---
// Returns the employee's current values so the calculator can prefill the
// form. Does not write anything.
router.get(
  "/calculator/:empId/prefill",
  authorize("hr_admin", "hr_manager", "org_admin"),
  wrap(async (req, res) => {
    const data = await svc.getCalculatorPrefill(param(req, "empId"));
    res.json({ success: true, data });
  }),
);

// Runs computeIncomeTax with caller-supplied inputs. Does not persist --
// purely a what-if projection for HR. taxAlreadyPaid is sourced from real
// YTD payslip TDS inside the service so the "remaining" number is accurate.
router.post(
  "/calculator/simulate",
  authorize("hr_admin", "hr_manager", "org_admin"),
  wrap(async (req, res) => {
    const data = await svc.simulate(req.body);
    res.json({ success: true, data });
  }),
);

// Form-12B / prior-employer TDS. PUT-style upsert keyed by (employeeId, fy)
// so HR can capture mid-FY joiners' prior income+TDS and have the next
// payroll run net it out.
router.put(
  "/prior-employer-tds/:empId",
  authorize("hr_admin", "hr_manager", "org_admin"),
  wrap(async (req, res) => {
    const fy = String(req.body.financialYear || "").trim();
    if (!fy) {
      res.status(400).json({
        success: false,
        error: { code: "INVALID_FY", message: "financialYear is required (e.g. 2026-2027)" },
      });
      return;
    }
    const data = await svc.setPriorEmployerTds(param(req, "empId"), fy, {
      grossPaid: Number(req.body.grossPaid) || 0,
      tdsDeducted: Number(req.body.tdsDeducted) || 0,
      exemptionsClaimed: Number(req.body.exemptionsClaimed) || 0,
      deductionsClaimed: Number(req.body.deductionsClaimed) || 0,
      source: typeof req.body.source === "string" ? req.body.source : "",
    });
    res.json({ success: true, data });
  }),
);

// #398 — Org-wide pending declarations grouped by employee. Defined as a
// distinct path (not /declarations/...) so it never collides with the
// /declarations/:empId param route.
router.get(
  "/pending-declarations",
  authorize("hr_admin", "hr_manager", "org_admin"),
  wrap(async (req, res) => {
    const data = await svc.getOrgPendingDeclarations(
      req.user!.empcloudOrgId,
      req.query.fy as string,
    );
    res.json({ success: true, data });
  }),
);

router.get(
  "/declarations/:empId",
  wrap(async (req, res) => {
    const data = await svc.getDeclarations(param(req, "empId"), req.query.fy as string);
    res.json({ success: true, data });
  }),
);

router.post(
  "/declarations/:empId",
  validate(submitDeclarationSchema),
  wrap(async (req, res) => {
    const data = await svc.submitDeclarations(
      param(req, "empId"),
      req.body.financialYear,
      req.body.declarations,
    );
    res.status(201).json({ success: true, data });
  }),
);

router.put(
  "/declarations/:empId/:declId",
  wrap(async (req, res) => {
    const data = await svc.updateDeclaration(param(req, "empId"), param(req, "declId"), req.body);
    res.json({ success: true, data });
  }),
);

router.post(
  "/declarations/:empId/approve",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.approveDeclarations(
      param(req, "empId"),
      String(req.user!.empcloudUserId),
    );
    res.json({ success: true, data });
  }),
);

router.post(
  "/declarations/:empId/:declId/approve",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.approveOneDeclaration(
      param(req, "empId"),
      param(req, "declId"),
      String(req.user!.empcloudUserId),
    );
    res.json({ success: true, data });
  }),
);

router.get(
  "/regime/:empId",
  wrap(async (req, res) => {
    const data = await svc.getRegime(param(req, "empId"));
    res.json({ success: true, data });
  }),
);

router.put(
  "/regime/:empId",
  wrap(async (req, res) => {
    const data = await svc.updateRegime(param(req, "empId"), req.body.regime);
    res.json({ success: true, data });
  }),
);

router.get(
  "/form16/:empId",
  wrap(async (req, res) => {
    const form16Svc = new Form16Service();
    const html = await form16Svc.generateHTML(param(req, "empId"), req.query.fy as string);
    res.setHeader("Content-Type", "text/html");
    // #135 — allow inline onclick="window.print()" on the Print / Save as PDF button
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
    );
    res.send(html);
  }),
);

router.get(
  "/form12bb/:empId",
  wrap(async (_req, res) => {
    res.json({ success: true, data: { message: "Form 12BB generation pending" } });
  }),
);

export { router as taxRoutes };
