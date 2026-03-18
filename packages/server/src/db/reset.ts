import { initDB, closeDB } from "./adapters";
import { logger } from "../utils/logger";

async function run() {
  const db = await initDB();
  logger.info("Rolling back migrations...");
  await db.rollback();
  logger.info("Running migrations...");
  await db.migrate();
  logger.info("Running seeds...");
  await db.seed();
  logger.info("Database reset complete");
  await closeDB();
  process.exit(0);
}

run().catch((err) => {
  logger.error("Reset failed:", err);
  process.exit(1);
});
