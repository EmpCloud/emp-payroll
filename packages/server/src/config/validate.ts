import { config } from "./index";
import { logger } from "../utils/logger";

export function validateConfig(): void {
  const warnings: string[] = [];
  const errors: string[] = [];

  // JWT secret
  if (config.jwt.secret === "change-this-in-production" && config.env === "production") {
    errors.push("JWT_SECRET must be changed from default in production");
  }
  if (config.jwt.secret.length < 16) {
    warnings.push("JWT_SECRET should be at least 16 characters");
  }

  // Database
  if (!config.db.host) errors.push("DB_HOST is required");
  if (!config.db.name) errors.push("DB_NAME is required");
  if (config.env === "production" && !config.db.password) {
    errors.push("DB_PASSWORD is required in production");
  }

  // CORS
  if (config.env === "production" && config.cors.origin === "*") {
    errors.push("CORS_ORIGIN must not be '*' in production");
  }
  if (config.env === "production" && config.cors.origin.includes("localhost")) {
    warnings.push("CORS_ORIGIN contains localhost — change for production");
  }

  // Log results
  if (warnings.length > 0) {
    for (const w of warnings) logger.warn(`Config warning: ${w}`);
  }
  if (errors.length > 0) {
    for (const e of errors) logger.error(`Config error: ${e}`);
    if (config.env === "production") {
      throw new Error(`Configuration errors:\n${errors.join("\n")}`);
    }
  }

  logger.info(`Config validated (${warnings.length} warnings, ${errors.length} errors)`);
}
