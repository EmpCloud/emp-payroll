// ============================================================================
// EMP-PAYROLL SERVER ENTRY POINT
// ============================================================================

import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import compression from "compression";
import { config } from "./config";
import { initDB, closeDB } from "./db/adapters";
import { initEmpCloudDB, migrateEmpCloudDB, closeEmpCloudDB } from "./db/empcloud";
import { logger } from "./utils/logger";

// Route imports
import { authRoutes } from "./api/routes/auth.routes";
import { employeeRoutes } from "./api/routes/employee.routes";
import { salaryRoutes } from "./api/routes/salary.routes";
import { payrollRoutes } from "./api/routes/payroll.routes";
import { payslipRoutes } from "./api/routes/payslip.routes";
import { taxRoutes } from "./api/routes/tax.routes";
import { attendanceRoutes } from "./api/routes/attendance.routes";
import { orgRoutes } from "./api/routes/org.routes";
import { selfServiceRoutes } from "./api/routes/self-service.routes";
import { reimbursementRoutes } from "./api/routes/reimbursement.routes";
import { leaveRoutes } from "./api/routes/leave.routes";
import { loanRoutes } from "./api/routes/loan.routes";
import { errorHandler } from "./api/middleware/error.middleware";
import { apiDocsHandler, swaggerUIHandler } from "./api/docs";
import { authLimiter, apiLimiter } from "./api/middleware/rate-limit.middleware";
import { healthRoutes } from "./api/routes/health.routes";
import { uploadRoutes } from "./api/routes/upload.routes";
import { adjustmentRoutes } from "./api/routes/adjustment.routes";
import { webhookRoutes } from "./api/routes/webhook.routes";
import { userSyncRoutes } from "./api/routes/user-sync.routes";
import { announcementRoutes } from "./api/routes/announcement.routes";
import { exitRoutes } from "./api/routes/exit.routes";
import { benefitsRoutes } from "./api/routes/benefits.routes";
import { glAccountingRoutes } from "./api/routes/gl-accounting.routes";
import { payEquityRoutes } from "./api/routes/pay-equity.routes";
import { compensationBenchmarkRoutes } from "./api/routes/compensation-benchmark.routes";
import { totalRewardsRoutes } from "./api/routes/total-rewards.routes";
import { earnedWageRoutes } from "./api/routes/earned-wage.routes";
import { insuranceRoutes } from "./api/routes/insurance.routes";
import { globalPayrollRoutes } from "./api/routes/global-payroll.routes";
import { holidayRoutes } from "./api/routes/holiday.routes";
import { departmentRoutes } from "./api/routes/department.routes";
import path from "path";

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(helmet());
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      // Allow all origins if configured with "*"
      if (config.cors.origin === "*") return callback(null, true);
      // Allow empcloud.com subdomains (production & test)
      if (origin.endsWith(".empcloud.com") && origin.startsWith("https://")) {
        return callback(null, true);
      }
      // In development, allow all localhost and ngrok origins
      if (
        config.env === "development" &&
        (origin.startsWith("http://localhost") ||
          origin.startsWith("http://127.0.0.1") ||
          origin.endsWith(".ngrok-free.dev"))
      ) {
        return callback(null, true);
      }
      // Check against configured origins (comma-separated)
      const allowed = config.cors.origin.split(",").map((s) => s.trim());
      if (allowed.includes(origin)) return callback(null, true);
      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
  }),
);
app.use(compression());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan("combined", { stream: { write: (msg) => logger.info(msg.trim()) } }));

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.use("/health", healthRoutes);

// ---------------------------------------------------------------------------
// API Routes (v1)
// ---------------------------------------------------------------------------
const v1 = express.Router();
v1.use(apiLimiter);

v1.use("/auth", authLimiter, authRoutes);
v1.use("/organizations", orgRoutes);
v1.use("/employees", employeeRoutes);
v1.use("/salary-structures", salaryRoutes);
v1.use("/payroll", payrollRoutes);
v1.use("/payslips", payslipRoutes);
v1.use("/tax", taxRoutes);
v1.use("/attendance", attendanceRoutes);
v1.use("/self-service", selfServiceRoutes);
v1.use("/reimbursements", reimbursementRoutes);
v1.use("/leaves", leaveRoutes);
v1.use("/loans", loanRoutes);
v1.use("/uploads", uploadRoutes);
v1.use("/adjustments", adjustmentRoutes);
v1.use("/webhooks", webhookRoutes);
v1.use("/users", userSyncRoutes);
v1.use("/announcements", announcementRoutes);
v1.use("/exits", exitRoutes);
v1.use("/benefits", benefitsRoutes);
v1.use("/gl", glAccountingRoutes);
v1.use("/pay-equity", payEquityRoutes);
v1.use("/benchmarks", compensationBenchmarkRoutes);
v1.use("/total-rewards", totalRewardsRoutes);
v1.use("/earned-wage", earnedWageRoutes);
v1.use("/insurance", insuranceRoutes);
v1.use("/global", globalPayrollRoutes);
v1.use("/holidays", holidayRoutes);
v1.use("/departments", departmentRoutes);
v1.get("/docs/openapi.json", apiDocsHandler);
v1.get("/docs", swaggerUIHandler);

app.use("/api/v1", v1);

// Static file serving for uploads
app.use("/uploads", express.static(path.join(process.cwd(), "uploads")));

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------
async function start() {
  try {
    // Validate configuration
    const { validateConfig } = await import("./config/validate");
    validateConfig();

    // Initialize EmpCloud master database (users, orgs, auth)
    await initEmpCloudDB();
    await migrateEmpCloudDB();

    // Initialize payroll module database
    const db = await initDB();
    logger.info(`Payroll database connected (provider: ${config.db.provider})`);

    // Run migrations (safe — uses IF NOT EXISTS)
    await db.migrate();
    logger.info("Payroll database migrations applied");

    // Start server
    app.listen(config.port, config.host, () => {
      logger.info(`🚀 emp-payroll server running at http://${config.host}:${config.port}`);
      logger.info(`   Environment: ${config.env}`);
      logger.info(`   Country: ${config.payroll.country}`);
      logger.info(`   DB Provider: ${config.db.provider}`);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Graceful shutdown
const shutdown = async () => {
  logger.info("Shutting down...");
  await closeDB();
  await closeEmpCloudDB();
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start();

export { app };
