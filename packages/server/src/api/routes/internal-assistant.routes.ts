import crypto from "crypto";
import { Router, Request, Response, NextFunction } from "express";
import { AppError } from "../middleware/error.middleware";
import { InternalAssistantService } from "../../services/internal-assistant.service";

const router = Router();
const service = new InternalAssistantService();

function timingSafeEqual(value: unknown, expected: string): boolean {
  const a = Buffer.from(String(value || ""));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireInternalService(req: Request, _res: Response, next: NextFunction) {
  const expected = process.env.INTERNAL_SERVICE_SECRET || "";
  if (
    !expected ||
    req.headers["x-internal-service"] !== "empcloud-dashboard" ||
    !timingSafeEqual(req.headers["x-internal-secret"], expected)
  ) {
    return next(new AppError(401, "UNAUTHORIZED", "Internal service authentication required"));
  }
  next();
}

router.use(requireInternalService);

function organizationId(req: Request): number {
  const value = Number(req.query.organization_id);
  if (!Number.isInteger(value) || value <= 0)
    throw new AppError(400, "VALIDATION_ERROR", "organization_id is required");
  return value;
}

router.get("/employees/:employeeId/salary", async (req, res, next) => {
  try {
    res.json({
      success: true,
      data: await service.getSalary(organizationId(req), Number(req.params.employeeId)),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/employees/:employeeId/net-pay", async (req, res, next) => {
  try {
    const month = Number(req.query.month);
    const year = Number(req.query.year);
    if (!Number.isInteger(month) || month < 1 || month > 12 || !Number.isInteger(year))
      throw new AppError(400, "VALIDATION_ERROR", "Valid month and year are required");
    res.json({
      success: true,
      data: await service.getNetPay(
        organizationId(req),
        Number(req.params.employeeId),
        month,
        year,
      ),
    });
  } catch (error) {
    next(error);
  }
});

router.get("/payroll-runs/totals", async (req, res, next) => {
  try {
    const runId = typeof req.query.run_id === "string" ? req.query.run_id : undefined;
    const month = req.query.month ? Number(req.query.month) : undefined;
    const year = req.query.year ? Number(req.query.year) : undefined;
    if (!runId && (!month || !year))
      throw new AppError(400, "VALIDATION_ERROR", "run_id or month and year are required");
    res.json({
      success: true,
      data: await service.getRunTotals(organizationId(req), { runId, month, year }),
    });
  } catch (error) {
    next(error);
  }
});

export { router as internalAssistantRoutes };
