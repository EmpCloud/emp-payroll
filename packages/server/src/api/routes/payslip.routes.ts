import { Router } from "express";
import { PayslipService } from "../../services/payslip.service";
import { ExportService } from "../../services/export.service";
import { PayslipPDFService } from "../../services/payslip-pdf.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new PayslipService();

router.use(authenticate);

router.get(
  "/",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.list(String(req.user!.empcloudOrgId), {
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 200,
      month: req.query.month ? Number(req.query.month) : undefined,
      year: req.query.year ? Number(req.query.year) : undefined,
    });
    res.json({ success: true, data });
  }),
);

// Static routes BEFORE /:id
router.get(
  "/export/csv",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const exportSvc = new ExportService();
    const csv = await exportSvc.exportPayslipsCSV(
      String(req.user!.empcloudOrgId),
      req.query.runId as string,
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", "attachment; filename=payslips.csv");
    res.send(csv);
  }),
);

router.get(
  "/employee/:empId",
  wrap(async (req, res) => {
    const data = await svc.getByEmployee(param(req, "empId"));
    res.json({ success: true, data });
  }),
);

router.get(
  "/:id",
  wrap(async (req, res) => {
    const data = await svc.getById(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

router.get(
  "/:id/pdf",
  wrap(async (req, res) => {
    const pdfSvc = new PayslipPDFService();
    const html = await pdfSvc.generateHTML(param(req, "id"));
    res.setHeader("Content-Type", "text/html");
    // Allow inline scripts for print/download buttons on this standalone HTML page
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
    );
    res.send(html);
  }),
);

router.post(
  "/:id/dispute",
  wrap(async (req, res) => {
    const data = await svc.dispute(
      param(req, "id"),
      String(req.user!.empcloudUserId),
      req.body.reason,
    );
    res.json({ success: true, data });
  }),
);

router.post(
  "/:id/resolve",
  authorize("hr_admin", "hr_manager"),
  wrap(async (req, res) => {
    const data = await svc.resolveDispute(param(req, "id"), req.body.resolution);
    res.json({ success: true, data });
  }),
);

export { router as payslipRoutes };
