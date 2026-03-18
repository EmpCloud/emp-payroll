import { initDB, closeDB } from "./adapters";
import { logger } from "../utils/logger";

async function run() {
  const db = await initDB();
  logger.info("Running seeds...");
  await db.seed();
  logger.info("Seeds complete");
  await closeDB();
  process.exit(0);
}

run().catch((err) => {
  logger.error("Seed failed:", err);
  process.exit(1);
});
