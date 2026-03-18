import dotenv from "dotenv";
dotenv.config();

export const config = {
  env: process.env.NODE_ENV || "development",
  port: parseInt(process.env.PORT || "4000"),
  host: process.env.HOST || "0.0.0.0",

  // Database
  db: {
    provider: process.env.DB_PROVIDER || "mysql",
    host: process.env.DB_HOST || "localhost",
    port: parseInt(process.env.DB_PORT || "3306"),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    name: process.env.DB_NAME || "emp_payroll",
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
  },

  // Email (payslip delivery)
  email: {
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
} as const;
