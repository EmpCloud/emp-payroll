import { initDB, closeDB } from "./adapters";
import { logger } from "../utils/logger";

async function run() {
  const db = await initDB();
  logger.info("Running migrations...");
  await db.migrate();
  logger.info("Migrations complete");
  await closeDB();
  process.exit(0);
}

run().catch((err) => {
  logger.error("Migration failed:", err);
  process.exit(1);
});
