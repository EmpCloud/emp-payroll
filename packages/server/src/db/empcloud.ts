// ============================================================================
// EMPCLOUD DATABASE CONNECTION
// Separate Knex connection to the EmpCloud master database.
// Used for authentication, user lookups, and org data.
// ============================================================================

import knex from "knex";
import type { Knex } from "knex";
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
 * Find a user by employee code, scoped to an org. emp_code is what HR
 * sees in the directory and what the bulk-CSV upload expects in the
 * "Employee ID" column (e.g. "EMP/BHI/2025/23"). It's a string and
 * Number(it) is NaN, which used to crash the bulk-assign flow with
 * "Unknown column 'NaN' in 'where clause'".
 */
export async function findUserByEmpCode(
  empCode: string,
  orgId: number,
): Promise<EmpCloudUser | null> {
  const db = getEmpCloudDB();
  const user = await db("users")
    .where({ emp_code: empCode, organization_id: orgId, status: 1 })
    .first();
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
 * Statutory IDs (PAN, Aadhar, passport) live on EmpCloud's
 * `employee_profiles` table — separate from the `users` row but tied to
 * it via `user_id`. emp-payroll needs them so PAN/Aadhar entered in the
 * EmpCloud profile show up on the payroll-side My Profile (#251).
 *
 * Returns null when the row doesn't exist (employee never opened their
 * EmpCloud profile / hasn't filled it in yet) so the caller can fall
 * through to whatever the payroll DB has.
 */
export interface EmpCloudEmployeeProfile {
  pan_number: string | null;
  aadhar_number: string | null;
  // EmpCloud migration 050 added this column — coalesce missing values to
  // null so older EmpCloud DBs that haven't run the migration yet still
  // work (the column won't be selected in the catch path below either).
  uan_number: string | null;
  passport_number: string | null;
}

export async function findEmployeeProfileByUserId(
  userId: number,
): Promise<EmpCloudEmployeeProfile | null> {
  const db = getEmpCloudDB();
  try {
    const row = await db("employee_profiles")
      .where({ user_id: userId })
      .select("pan_number", "aadhar_number", "uan_number", "passport_number")
      .first();
    return row || null;
  } catch {
    // Either the table or the new uan_number column may not exist on older
    // EmpCloud schemas. Degrade gracefully — caller falls back to whatever
    // the payroll DB has.
    return null;
  }
}

/**
 * Find users in an organization. By default returns active users (status=1)
 * only — backwards compatible with every existing caller.
 *
 * When `periodStart` is supplied (YYYY-MM-DD), the query also includes users
 * who are no longer active (status<>1) but whose `date_of_exit` is on or after
 * that date. This is the "exit overlaps the pay period" case: emp-exit flips
 * users to inactive the moment HR records the exit, even if the actual last
 * day is weeks away — so payroll's user-fetch must look at WHEN they worked,
 * not just whether the row is currently active. The existing per-row
 * `doe < monthStart` skip in computePayroll then correctly filters out the
 * employees whose exit was genuinely before the period.
 */
export async function findUsersByOrgId(
  orgId: number,
  options?: { limit?: number; offset?: number; periodStart?: string },
): Promise<EmpCloudUser[]> {
  const db = getEmpCloudDB();
  let query = db("users").where("organization_id", orgId);
  if (options?.periodStart) {
    query = query.where(function (this: any) {
      this.where("status", 1).orWhere(function (this: any) {
        this.whereNotNull("date_of_exit").andWhere("date_of_exit", ">=", options.periodStart);
      });
    });
  } else {
    query = query.where("status", 1);
  }
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
 * Optional WHERE-clause filters that the seated-users queries below honour.
 * Pushing q / location_id / department_id into the SQL means admin list
 * pages (employees, loans, reimbursements, tax overview, tax declarations)
 * can stop fetching all rows just to .filter() in the browser.
 */
export interface SeatedUserFilters {
  q?: string;
  locationId?: number;
  departmentId?: number;
}

function applySeatedUserFilters(query: any, filters?: SeatedUserFilters) {
  if (!filters) return query;
  if (filters.locationId) query = query.where("u.location_id", filters.locationId);
  if (filters.departmentId) query = query.where("u.department_id", filters.departmentId);
  if (filters.q) {
    const like = `%${filters.q}%`;
    query = query.where(function (this: any) {
      this.where("u.first_name", "like", like)
        .orWhere("u.last_name", "like", like)
        .orWhere("u.email", "like", like)
        .orWhere("u.emp_code", "like", like)
        .orWhere("u.designation", "like", like)
        .orWhereRaw("CONCAT(u.first_name, ' ', u.last_name) LIKE ?", [like]);
    });
  }
  return query;
}

/**
 * Apply the "active OR exit-overlaps-period" filter common to seated queries.
 * Defaults to active-only when `periodStart` is omitted — preserves the legacy
 * behaviour. See findUsersByOrgId for the rationale.
 */
function applySeatedActivityFilter(query: any, periodStart?: string) {
  if (periodStart) {
    return query.where(function (this: any) {
      this.where("u.status", 1).orWhere(function (this: any) {
        this.whereNotNull("u.date_of_exit").andWhere("u.date_of_exit", ">=", periodStart);
      });
    });
  }
  return query.where("u.status", 1);
}

/**
 * Find users who have a seat for a specific module (via org_module_seats).
 * Returns only employees assigned to this module.
 *
 * `periodStart` (YYYY-MM-DD) widens the result to include recently-exited
 * employees whose last working day is on/after that date — used by payroll
 * compute, attendance import, and the admin list so HR can still complete the
 * final-month payroll for someone the emp-exit module has already flipped to
 * inactive.
 */
export async function findSeatedUsersForModule(
  orgId: number,
  moduleSlug: string,
  options?: {
    limit?: number;
    offset?: number;
    filters?: SeatedUserFilters;
    periodStart?: string;
  },
): Promise<EmpCloudUser[]> {
  const db = getEmpCloudDB();
  let query = db("users as u")
    .join("org_module_seats as s", "u.id", "s.user_id")
    .join("modules as m", "s.module_id", "m.id")
    .where({ "u.organization_id": orgId, "m.slug": moduleSlug })
    .select("u.*")
    .orderBy("u.first_name", "asc");
  query = applySeatedActivityFilter(query, options?.periodStart);
  query = applySeatedUserFilters(query, options?.filters);
  if (options?.limit) query = query.limit(options.limit);
  if (options?.offset) query = query.offset(options.offset);
  return query;
}

/**
 * Count seated users for a specific module. Mirrors findSeatedUsersForModule:
 * pass `periodStart` to widen the result the same way (active + recently
 * exited) so the paginated total matches the visible list.
 */
export async function countSeatedUsersForModule(
  orgId: number,
  moduleSlug: string,
  filters?: SeatedUserFilters,
  options?: { periodStart?: string },
): Promise<number> {
  const db = getEmpCloudDB();
  let query = db("users as u")
    .join("org_module_seats as s", "u.id", "s.user_id")
    .join("modules as m", "s.module_id", "m.id")
    .where({ "u.organization_id": orgId, "m.slug": moduleSlug });
  query = applySeatedActivityFilter(query, options?.periodStart);
  query = applySeatedUserFilters(query, filters);
  const [{ count }] = await query.count("* as count");
  return Number(count);
}

/**
 * Find seated EmpCloud user IDs whose location_id / department_id / search
 * text matches. Used by services that store FK data in the payroll DB
 * (loans, reimbursements) and need to scope queries to a subset of users.
 */
export async function findSeatedUserIdsForFilters(
  orgId: number,
  moduleSlug: string,
  filters: SeatedUserFilters,
): Promise<number[]> {
  if (!filters.q && !filters.locationId && !filters.departmentId) return [];
  const db = getEmpCloudDB();
  let query = db("users as u")
    .join("org_module_seats as s", "u.id", "s.user_id")
    .join("modules as m", "s.module_id", "m.id")
    .where({ "u.organization_id": orgId, "u.status": 1, "m.slug": moduleSlug })
    .select("u.id");
  query = applySeatedUserFilters(query, filters);
  const rows = await query;
  return rows.map((r: any) => Number(r.id));
}

export interface EmpCloudLocation {
  id: number;
  name: string;
  organization_id: number;
}

/**
 * List active locations for an org (best-effort). Older EmpCloud schemas
 * without `organization_locations` return [] so callers still render.
 */
export async function listOrgLocations(orgId: number): Promise<EmpCloudLocation[]> {
  const db = getEmpCloudDB();
  try {
    return await db("organization_locations")
      .where({ organization_id: orgId })
      .select("id", "name", "organization_id")
      .orderBy("name", "asc");
  } catch {
    return [];
  }
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
