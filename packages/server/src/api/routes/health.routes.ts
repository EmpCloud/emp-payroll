import { Router, Request, Response } from "express";
import { getDB } from "../../db/adapters";
import { config } from "../../config";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString(), version: "0.1.0" });
});

router.get("/detailed", async (_req: Request, res: Response) => {
  const start = Date.now();
  const checks: Record<string, any> = {};

  // Database check
  try {
    const db = getDB();
    const dbStart = Date.now();
    await db.raw("SELECT 1");
    checks.database = { status: "ok", latency: `${Date.now() - dbStart}ms`, provider: config.db.provider };
  } catch (err: any) {
    checks.database = { status: "error", message: err.message };
  }

  // Memory
  const mem = process.memoryUsage();
  checks.memory = {
    rss: `${Math.round(mem.rss / 1024 / 1024)}MB`,
    heapUsed: `${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
  };

  // Uptime
  checks.uptime = {
    process: `${Math.round(process.uptime())}s`,
    formatted: formatUptime(process.uptime()),
  };

  // Counts
  try {
    const db = getDB();
    const [empCount, runCount, payslipCount] = await Promise.all([
      db.count("employees"),
      db.count("payroll_runs"),
      db.count("payslips"),
    ]);
    checks.data = { employees: empCount, payrollRuns: runCount, payslips: payslipCount };
  } catch {
    checks.data = { status: "unavailable" };
  }

  const allOk = Object.values(checks).every((c: any) => c.status !== "error");

  res.json({
    status: allOk ? "healthy" : "degraded",
    timestamp: new Date().toISOString(),
    responseTime: `${Date.now() - start}ms`,
    version: "0.1.0",
    environment: config.env,
    checks,
  });
});

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(" ");
}

export { router as healthRoutes };
