import dotenv from "dotenv";
import path from "path";
import fs from "fs";
dotenv.config({ path: path.resolve(process.cwd(), "../../.env") });

export const config = {
  env: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "4000"),
  host: process.env.HOST || "0.0.0.0",

  // Payroll module database (payroll-specific tables only)
  db: {
    provider: process.env.DB_PROVIDER || "mysql",
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3306"),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    name: process.env.DB_NAME || "emp_payroll",
  },

  // EmpCloud master database (users, organizations, auth — shared across modules)
  empcloudDb: {
    host: process.env.EMPCLOUD_DB_HOST || process.env.DB_HOST || "localhost",
    port: parseInt(process.env.EMPCLOUD_DB_PORT || process.env.DB_PORT || "3306"),
    user: process.env.EMPCLOUD_DB_USER || process.env.DB_USER || "root",
    password: process.env.EMPCLOUD_DB_PASSWORD || process.env.DB_PASSWORD || "",
    name: process.env.EMPCLOUD_DB_NAME || "empcloud",
  },

  // MongoDB (when DB_PROVIDER=mongodb)
  mongo: {
    uri: process.env.MONGO_URI || "mongodb://localhost:27017/emp_payroll",
  },

  // Redis (for queues, caching)
  redis: {
    host: process.env.REDIS_HOST || "localhost",
    port: parseInt(process.env.REDIS_PORT || "6379"),
    password: process.env.REDIS_PASSWORD || undefined,
  },

  // JWT
  jwt: {
    secret: process.env.JWT_SECRET || "change-this-in-production",
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || "15m",
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || "7d",
    // RS256 public key from EMP Cloud — used to verify SSO tokens
    // Reads from file path if EMPCLOUD_PUBLIC_KEY points to a .pem file, otherwise uses raw value
    empcloudPublicKey: (() => {
      const val = process.env.EMPCLOUD_PUBLIC_KEY || "";
      if (val && (val.endsWith(".pem") || val.endsWith(".pub"))) {
        try {
          return fs.readFileSync(path.resolve(process.cwd(), val), "utf-8");
        } catch {
          return "";
        }
      }
      return val;
    })(),
  },

  // Email (payslip delivery)
  // Provider preference: SendGrid when SENDGRID_API_KEY is set, else SMTP
  // (nodemailer). Keeping the SMTP block lets local-dev / on-prem stays
  // working without a SendGrid account.
  email: {
    sendgridApiKey: process.env.SENDGRID_API_KEY || "",
    fromEmail: process.env.EMAIL_FROM_EMAIL || process.env.SMTP_FROM || "payroll@empcloud.com",
    fromName: process.env.EMAIL_FROM_NAME || "EMP Payroll",
    // SMTP fallback (used only when SENDGRID_API_KEY is empty)
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: parseInt(process.env.SMTP_PORT || "587"),
    user: process.env.SMTP_USER || "",
    password: process.env.SMTP_PASSWORD || "",
    from: process.env.SMTP_FROM || "payroll@empcloud.com",
  },

  // CORS
  cors: {
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
  },

  // India Payroll
  payroll: {
    country: process.env.PAYROLL_COUNTRY || "IN",
    defaultPayFrequency: process.env.PAY_FREQUENCY || "monthly",
    financialYearStartMonth: 4, // April
  },

  // Cloud HRMS integration — when enabled, payroll computation fetches
  // attendance/leave data from EMP Cloud's HRMS APIs instead of local DB.
  cloudHrms: {
    enabled: process.env.USE_CLOUD_HRMS === "true",
    apiUrl: process.env.EMPCLOUD_API_URL || "http://localhost:3000/api/v1",
  },
} as const;
