import { Router } from "express";
import { GLAccountingService } from "../../services/gl-accounting.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import { validate, createGLMappingSchema, generateJournalSchema } from "../validators";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new GLAccountingService();

router.use(authenticate);
router.use(authorize("hr_admin"));

// ---------------------------------------------------------------------------
// GL Mappings
// ---------------------------------------------------------------------------
router.get(
  "/mappings",
  wrap(async (req, res) => {
    const data = await svc.listMappings(String(req.user!.empcloudOrgId));
    res.json({ success: true, data: data.data, meta: { total: data.total } });
  }),
);

router.post(
  "/mappings",
  validate(createGLMappingSchema),
  wrap(async (req, res) => {
    const data = await svc.createMapping(String(req.user!.empcloudOrgId), req.body);
    res.status(201).json({ success: true, data });
  }),
);

router.put(
  "/mappings/:id",
  wrap(async (req, res) => {
    const data = await svc.updateMapping(
      param(req, "id"),
      String(req.user!.empcloudOrgId),
      req.body,
    );
    res.json({ success: true, data });
  }),
);

router.delete(
  "/mappings/:id",
  wrap(async (req, res) => {
    const data = await svc.deleteMapping(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

// ---------------------------------------------------------------------------
// Journal Entries
// ---------------------------------------------------------------------------
router.get(
  "/journals",
  wrap(async (req, res) => {
    const data = await svc.listJournalEntries(String(req.user!.empcloudOrgId));
    res.json({ success: true, data: data.data, meta: { total: data.total } });
  }),
);

router.get(
  "/journals/:id",
  wrap(async (req, res) => {
    const data = await svc.getJournalEntry(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

router.post(
  "/journals/generate",
  validate(generateJournalSchema),
  wrap(async (req, res) => {
    const data = await svc.generateJournalEntry(
      String(req.user!.empcloudOrgId),
      req.body.payrollRunId,
    );
    res.status(201).json({ success: true, data });
  }),
);

router.put(
  "/journals/:id/status",
  wrap(async (req, res) => {
    const data = await svc.updateJournalStatus(
      param(req, "id"),
      String(req.user!.empcloudOrgId),
      req.body.status,
    );
    res.json({ success: true, data });
  }),
);

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------
router.get(
  "/journals/:id/export/tally",
  wrap(async (req, res) => {
    const data = await svc.exportTallyFormat(param(req, "id"), String(req.user!.empcloudOrgId));
    res.setHeader("Content-Type", "application/xml");
    res.setHeader("Content-Disposition", `attachment; filename="${data.filename}"`);
    res.send(data.content);
  }),
);

router.get(
  "/journals/:id/export/quickbooks",
  wrap(async (req, res) => {
    const data = await svc.exportQuickBooksFormat(
      param(req, "id"),
      String(req.user!.empcloudOrgId),
    );
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${data.filename}"`);
    res.send(data.content);
  }),
);

router.get(
  "/journals/:id/export/zoho",
  wrap(async (req, res) => {
    const data = await svc.exportZohoFormat(param(req, "id"), String(req.user!.empcloudOrgId));
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="${data.filename}"`);
    res.send(data.content);
  }),
);

export { router as glAccountingRoutes };
