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
