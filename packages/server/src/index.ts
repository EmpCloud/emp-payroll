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

const app = express();

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------
app.use(helmet());
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, etc.)
    if (!origin) return callback(null, true);
    // In development, allow all localhost origins
    if (config.env === "development" && (origin.startsWith("http://localhost") || origin.startsWith("http://127.0.0.1"))) {
      return callback(null, true);
    }
    // In production, check against configured origin
    if (origin === config.cors.origin) return callback(null, true);
    callback(new Error("Not allowed by CORS"));
  },
  credentials: true,
}));
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
v1.get("/docs/openapi.json", apiDocsHandler);
v1.get("/docs", swaggerUIHandler);

app.use("/api/v1", v1);

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

    // Initialize database
    const db = await initDB();
    logger.info(`Database connected (provider: ${config.db.provider})`);

    // Run migrations in development
    if (config.env === "development") {
      await db.migrate();
      logger.info("Database migrations applied");
    }

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
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

start();

export { app };
