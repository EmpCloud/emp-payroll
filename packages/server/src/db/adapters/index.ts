// ============================================================================
// DATABASE FACTORY
// Reads DB_PROVIDER from environment and returns the correct adapter.
// Usage: const db = createDBAdapter();  await db.connect();
// ============================================================================

import { IDBAdapter } from "./interface";
import { KnexAdapter } from "./knex.adapter";
import { MongoAdapter } from "./mongo.adapter";

export type DBProvider = "mysql" | "postgres" | "mongodb";

export function createDBAdapter(provider?: DBProvider): IDBAdapter {
  const dbProvider = provider || (process.env.DB_PROVIDER as DBProvider) || "mysql";

  switch (dbProvider) {
    case "mysql":
      return new KnexAdapter({
        client: "mysql2",
        host: process.env.DB_HOST || "localhost",
        port: parseInt(process.env.DB_PORT || "3306"),
        user: process.env.DB_USER || "root",
        password: process.env.DB_PASSWORD || "",
        database: process.env.DB_NAME || "emp_payroll",
        pool: {
          min: parseInt(process.env.DB_POOL_MIN || "2"),
          max: parseInt(process.env.DB_POOL_MAX || "10"),
        },
      });

    case "postgres":
      return new KnexAdapter({
        client: "pg",
        host: process.env.DB_HOST || "localhost",
        port: parseInt(process.env.DB_PORT || "5432"),
        user: process.env.DB_USER || "postgres",
        password: process.env.DB_PASSWORD || "",
        database: process.env.DB_NAME || "emp_payroll",
        pool: {
          min: parseInt(process.env.DB_POOL_MIN || "2"),
          max: parseInt(process.env.DB_POOL_MAX || "10"),
        },
      });

    case "mongodb":
      return new MongoAdapter({
        uri: process.env.MONGO_URI || "mongodb://localhost:27017/emp_payroll",
      });

    default:
      throw new Error(
        `Unsupported DB_PROVIDER: "${dbProvider}". Use "mysql", "postgres", or "mongodb".`
      );
  }
}

// Singleton instance for the app
let dbInstance: IDBAdapter | null = null;

export function getDB(): IDBAdapter {
  if (!dbInstance) {
    dbInstance = createDBAdapter();
  }
  return dbInstance;
}

export async function initDB(): Promise<IDBAdapter> {
  const db = getDB();
  await db.connect();
  return db;
}

export async function closeDB(): Promise<void> {
  if (dbInstance) {
    await dbInstance.disconnect();
    dbInstance = null;
  }
}
