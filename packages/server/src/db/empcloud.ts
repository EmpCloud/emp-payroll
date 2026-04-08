// ============================================================================
// EMPCLOUD DATABASE CONNECTION
// Separate Knex connection to the EmpCloud master database.
// Used for authentication, user lookups, and org data.
// ============================================================================

import knex, { Knex } from "knex";
import { config } from "../config";
import { logger } from "../utils/logger";

let empcloudDb: Knex | null = null;

/**
 * Initialize the EmpCloud database connection.
 * Call this once at server startup.
 */
export async function initEmpCloudDB(): Promise<Knex> {
  if (empcloudDb) return empcloudDb;

  const { empcloudDb: dbConfig } = config;

  empcloudDb = knex({
    client: "mysql2",
    connection: {
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.name,
    },
    pool: { min: 2, max: 10 },
  });

  // Verify connection
  await empcloudDb.raw("SELECT 1");
  logger.info(`EmpCloud database connected (${dbConfig.host}:${dbConfig.port}/${dbConfig.name})`);

  return empcloudDb;
}

/**
 * Get the EmpCloud Knex instance. Throws if not initialized.
 */
export function getEmpCloudDB(): Knex {
  if (!empcloudDb) {
    throw new Error("EmpCloud database not initialized. Call initEmpCloudDB() first.");
  }
  return empcloudDb;
}

/**
 * Run the EmpCloud schema migration (creates tables if they don't exist).
 */
export async function migrateEmpCloudDB(): Promise<void> {
  const db = getEmpCloudDB();
  const { up } = await import("./empcloud-schema");
  await up(db);
  logger.info("EmpCloud schema migration applied");
}

/**
 * Close the EmpCloud database connection.
 */
export async function closeEmpCloudDB(): Promise<void> {
  if (empcloudDb) {
    await empcloudDb.destroy();
    empcloudDb = null;
  }
}

// ---------------------------------------------------------------------------
// Query helpers for common EmpCloud lookups
// ---------------------------------------------------------------------------

export interface EmpCloudUser {
  id: number;
  organization_id: number;
  first_name: string;
  last_name: string;
  email: string;
  password: string | null;
  emp_code: string | null;
  contact_number: string | null;
  date_of_birth: string | null;
  gender: string | null;
  date_of_joining: string | null;
  date_of_exit: string | null;
  designation: string | null;
  department_id: number | null;
  location_id: number | null;
  reporting_manager_id: number | null;
  employment_type: string;
  role: string;
  status: number;
  created_at: Date;
  updated_at: Date;
}

export interface EmpCloudOrganization {
  id: number;
  name: string;
  legal_name: string | null;
  email: string | null;
  contact_number: string | null;
  timezone: string | null;
  country: string;
  state: string | null;
  city: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface EmpCloudDepartment {
  id: number;
  name: string;
  organization_id: number;
}

/**
 * Find a user by email (active users only).
 */
export async function findUserByEmail(email: string): Promise<EmpCloudUser | null> {
  const db = getEmpCloudDB();
  const user = await db("users").where({ email, status: 1 }).first();
  return user || null;
}

/**
 * Find a user by ID.
 */
export async function findUserById(id: number): Promise<EmpCloudUser | null> {
  const db = getEmpCloudDB();
  const user = await db("users").where({ id }).first();
  return user || null;
}

/**
 * Find an organization by ID.
 */
export async function findOrgById(id: number): Promise<EmpCloudOrganization | null> {
  const db = getEmpCloudDB();
  const org = await db("organizations").where({ id }).first();
  return org || null;
}

/**
 * Get the department name for a user.
 */
export async function getUserDepartmentName(departmentId: number | null): Promise<string | null> {
  if (!departmentId) return null;
  const db = getEmpCloudDB();
  const dept = await db("organization_departments").where({ id: departmentId }).first();
  return dept?.name || null;
}

/**
 * Find all users in an organization (active only).
 */
export async function findUsersByOrgId(
  orgId: number,
  options?: { limit?: number; offset?: number },
): Promise<EmpCloudUser[]> {
  const db = getEmpCloudDB();
  let query = db("users").where({ organization_id: orgId, status: 1 });
  if (options?.limit) query = query.limit(options.limit);
  if (options?.offset) query = query.offset(options.offset);
  return query;
}

/**
 * Count active users in an organization.
 */
export async function countUsersByOrgId(orgId: number): Promise<number> {
  const db = getEmpCloudDB();
  const [{ count }] = await db("users")
    .where({ organization_id: orgId, status: 1 })
    .count("* as count");
  return Number(count);
}

/**
 * Find users who have a seat for a specific module (via org_module_seats).
 * Returns only employees assigned to this module.
 */
export async function findSeatedUsersForModule(
  orgId: number,
  moduleSlug: string,
  options?: { limit?: number; offset?: number },
): Promise<EmpCloudUser[]> {
  const db = getEmpCloudDB();
  let query = db("users as u")
    .join("org_module_seats as s", "u.id", "s.user_id")
    .join("modules as m", "s.module_id", "m.id")
    .where({ "u.organization_id": orgId, "u.status": 1, "m.slug": moduleSlug })
    .select("u.*");
  if (options?.limit) query = query.limit(options.limit);
  if (options?.offset) query = query.offset(options.offset);
  return query;
}

/**
 * Count seated users for a specific module.
 */
export async function countSeatedUsersForModule(
  orgId: number,
  moduleSlug: string,
): Promise<number> {
  const db = getEmpCloudDB();
  const [{ count }] = await db("users as u")
    .join("org_module_seats as s", "u.id", "s.user_id")
    .join("modules as m", "s.module_id", "m.id")
    .where({ "u.organization_id": orgId, "u.status": 1, "m.slug": moduleSlug })
    .count("* as count");
  return Number(count);
}

/**
 * Find users who do NOT have a seat for a specific module (available for import).
 */
export async function findUnseatedUsersForModule(
  orgId: number,
  moduleSlug: string,
): Promise<EmpCloudUser[]> {
  const db = getEmpCloudDB();
  const moduleRow = await db("modules").where({ slug: moduleSlug }).first();
  if (!moduleRow) return [];

  return db("users")
    .where({ organization_id: orgId, status: 1 })
    .whereNotIn("id", function () {
      this.select("user_id")
        .from("org_module_seats")
        .where({ module_id: moduleRow.id, organization_id: orgId });
    })
    .whereNot("role", "super_admin");
}

/**
 * Update user password in EmpCloud.
 */
export async function updateUserPassword(userId: number, passwordHash: string): Promise<void> {
  const db = getEmpCloudDB();
  await db("users").where({ id: userId }).update({
    password: passwordHash,
    updated_at: new Date(),
  });
}

/**
 * Create a new user in EmpCloud.
 */
export async function createUser(data: {
  organization_id: number;
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  role?: string;
  emp_code?: string;
  designation?: string;
  department_id?: number;
  date_of_joining?: string;
}): Promise<EmpCloudUser> {
  const db = getEmpCloudDB();
  const [id] = await db("users").insert({
    organization_id: data.organization_id,
    first_name: data.first_name,
    last_name: data.last_name,
    email: data.email,
    password: data.password,
    role: data.role || "employee",
    emp_code: data.emp_code || null,
    designation: data.designation || null,
    department_id: data.department_id || null,
    date_of_joining: data.date_of_joining || new Date().toISOString().slice(0, 10),
    status: 1,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return findUserById(id) as Promise<EmpCloudUser>;
}

/**
 * Create a new organization in EmpCloud.
 */
export async function createOrganization(data: {
  name: string;
  legal_name?: string;
  email?: string;
  country?: string;
  state?: string;
  timezone?: string;
}): Promise<EmpCloudOrganization> {
  const db = getEmpCloudDB();
  const [id] = await db("organizations").insert({
    name: data.name,
    legal_name: data.legal_name || data.name,
    email: data.email || null,
    country: data.country || "IN",
    state: data.state || null,
    timezone: data.timezone || null,
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  });
  return findOrgById(id) as Promise<EmpCloudOrganization>;
}
