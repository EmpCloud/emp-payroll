import { Router } from "express";
import { CompensationBenchmarkService } from "../../services/compensation-benchmark.service";
import { authenticate, authorize } from "../middleware/auth.middleware";
import {
  validate,
  createBenchmarkSchema,
  updateBenchmarkSchema,
  importBenchmarksSchema,
} from "../validators";
import { wrap, param } from "../helpers";

const router = Router();
const svc = new CompensationBenchmarkService();

router.use(authenticate);
router.use(authorize("hr_admin", "hr_manager"));

// ---------------------------------------------------------------------------
// Benchmarks CRUD
// ---------------------------------------------------------------------------
router.get(
  "/",
  wrap(async (req, res) => {
    const data = await svc.listBenchmarks(String(req.user!.empcloudOrgId), {
      department: req.query.department as string,
      jobTitle: req.query.jobTitle as string,
    });
    res.json({ success: true, data: data.data, meta: { total: data.total } });
  }),
);

router.get(
  "/:id",
  wrap(async (req, res) => {
    const data = await svc.getBenchmark(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

router.post(
  "/",
  authorize("hr_admin"),
  validate(createBenchmarkSchema),
  wrap(async (req, res) => {
    const data = await svc.createBenchmark(String(req.user!.empcloudOrgId), req.body);
    res.status(201).json({ success: true, data });
  }),
);

router.put(
  "/:id",
  authorize("hr_admin"),
  validate(updateBenchmarkSchema),
  wrap(async (req, res) => {
    const data = await svc.updateBenchmark(
      param(req, "id"),
      String(req.user!.empcloudOrgId),
      req.body,
    );
    res.json({ success: true, data });
  }),
);

router.delete(
  "/:id",
  // #88 — hr_admin-only left org_admin / super_admin staring at a success-
  // looking click that secretly 403'd, so the benchmark "didn't disappear".
  authorize("hr_admin", "org_admin", "super_admin"),
  wrap(async (req, res) => {
    const data = await svc.deleteBenchmark(param(req, "id"), String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

// ---------------------------------------------------------------------------
// Bulk Import
// ---------------------------------------------------------------------------
router.post(
  "/import",
  authorize("hr_admin"),
  validate(importBenchmarksSchema),
  wrap(async (req, res) => {
    const data = await svc.importBenchmarks(String(req.user!.empcloudOrgId), req.body.benchmarks);
    res.status(201).json({ success: true, data });
  }),
);

// ---------------------------------------------------------------------------
// Compa-Ratio Report
// ---------------------------------------------------------------------------
router.get(
  "/reports/compa-ratio",
  wrap(async (req, res) => {
    const data = await svc.getCompaRatioReport(String(req.user!.empcloudOrgId));
    res.json({ success: true, data });
  }),
);

export { router as compensationBenchmarkRoutes };
