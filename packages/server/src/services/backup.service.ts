import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import { config } from "../config";
import { logger } from "../utils/logger";

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(process.cwd(), "backups");

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * Database backup and restore service.
 * Uses mysqldump for MySQL, pg_dump for PostgreSQL.
 */
export class BackupService {
  async createBackup(): Promise<{ filename: string; path: string; size: number; createdAt: string }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `emp-payroll-backup-${timestamp}.sql`;
    const filePath = path.join(BACKUP_DIR, filename);

    const provider = config.db.provider;
    const { host, port, user, password, database } = config.db as any;

    try {
      if (provider === "mysql") {
        const cmd = `mysqldump -h ${host} -P ${port} -u ${user} -p${password} ${database} --single-transaction --routines --triggers > "${filePath}"`;
        execSync(cmd, { stdio: "pipe" });
      } else if (provider === "postgres") {
        const cmd = `PGPASSWORD=${password} pg_dump -h ${host} -p ${port} -U ${user} -d ${database} -F p -f "${filePath}"`;
        execSync(cmd, { stdio: "pipe" });
      } else {
        // For MongoDB or unsupported, create a metadata file
        fs.writeFileSync(filePath, JSON.stringify({
          provider,
          timestamp: new Date().toISOString(),
          message: `Backup not supported for ${provider}. Use native tools.`,
        }));
      }

      const stats = fs.statSync(filePath);
      logger.info(`Backup created: ${filename} (${(stats.size / 1024 / 1024).toFixed(2)} MB)`);

      return {
        filename,
        path: filePath,
        size: stats.size,
        createdAt: new Date().toISOString(),
      };
    } catch (error: any) {
      logger.error("Backup failed:", error.message);
      // Create a fallback metadata file
      const meta = {
        error: error.message,
        hint: "Ensure mysqldump/pg_dump is installed and accessible",
        provider,
        timestamp: new Date().toISOString(),
      };
      fs.writeFileSync(filePath, JSON.stringify(meta, null, 2));
      return {
        filename,
        path: filePath,
        size: Buffer.byteLength(JSON.stringify(meta)),
        createdAt: new Date().toISOString(),
      };
    }
  }

  async listBackups(): Promise<{ filename: string; size: number; createdAt: string }[]> {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => f.startsWith("emp-payroll-backup"))
      .sort()
      .reverse();

    return files.map((filename) => {
      const stats = fs.statSync(path.join(BACKUP_DIR, filename));
      return {
        filename,
        size: stats.size,
        createdAt: stats.mtime.toISOString(),
      };
    });
  }

  async getBackupPath(filename: string): Promise<string | null> {
    const filePath = path.join(BACKUP_DIR, path.basename(filename));
    if (!fs.existsSync(filePath)) return null;
    return filePath;
  }

  async deleteBackup(filename: string): Promise<boolean> {
    const filePath = path.join(BACKUP_DIR, path.basename(filename));
    if (!fs.existsSync(filePath)) return false;
    fs.unlinkSync(filePath);
    return true;
  }
}
