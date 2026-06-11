// ============================================================================
// EMPLOYEE SERVICE — Dual-DB model
// User identity comes from EmpCloud. Payroll-specific data from payroll DB.
// ============================================================================

import { getDB } from "../db/adapters";
import { QueryOptions } from "../db/adapters/interface";
import { AppError } from "../api/middleware/error.middleware";
import {
  findUserById,
  findUsersByOrgId,
  countUsersByOrgId,
  findSeatedUsersForModule,
  countSeatedUsersForModule,
  findUnseatedUsersForModule,
  getUserDepartmentName,
  getEmpCloudDB,
  findEmployeeProfileByUserId,
  EmpCloudUser,
} from "../db/empcloud";
import { v4 as uuidv4 } from "uuid";

/**
 * Merges EmpCloud user data with payroll profile data into a unified shape.
 */
async function mergeUserWithProfile(ecUser: EmpCloudUser, payrollDb: any): Promise<any> {
  const departmentName = await getUserDepartmentName(ecUser.department_id);

  // Look up payroll profile
  const profile = await (payrollDb as any).findOne("employee_payroll_profiles", {
    empcloud_user_id: ecUser.id,
  });

  // Normalise the JSON-ish columns. They may arrive as:
  //   - a JSON string (older rows / mysql JSON column read as text)
  //   - an already-parsed object (knex JSON binding)
  //   - null (column was never written)
  //   - undefined (whole `profile` row missing)
  // Any of those must end up as a plain object so downstream `.foo` lookups
  // don't crash. Fall back to {} for nullish AND non-object values.
  const parseJsonish = (v: unknown): Record<string, any> => {
    if (v == null) return {};
    if (typeof v === "string") {
      try {
        return JSON.parse(v || "{}") || {};
      } catch {
        return {};
      }
    }
    return typeof v === "object" ? (v as Record<string, any>) : {};
  };
  const bankDetails = parseJsonish(profile?.bank_details);
  const taxInfo = parseJsonish(profile?.tax_info);

  // PAN / Aadhar / UAN are entered on EmpCloud's profile screen
  // (employee_profiles table). The payroll-side tax_info JSON may have
  // been written by an HR admin via the payroll detail page, but if the
  // employee filled their statutory IDs in EmpCloud first, the payroll
  // merge previously ignored them and surfaced "—" on the My Profile
  // screen. Fall through to the EmpCloud employee_profiles row when
  // tax_info is missing the field (#251).
  const ecStatutory = await findEmployeeProfileByUserId(ecUser.id);
  if (ecStatutory) {
    if (!taxInfo.pan && ecStatutory.pan_number) taxInfo.pan = ecStatutory.pan_number;
    if (!taxInfo.aadhar && ecStatutory.aadhar_number) taxInfo.aadhar = ecStatutory.aadhar_number;
    if (!taxInfo.uan && ecStatutory.uan_number) taxInfo.uan = ecStatutory.uan_number;
  }
  const pfDetails = parseJsonish(profile?.pf_details);
  const esiDetails = parseJsonish(profile?.esi_details);

  // BUG (May retest) — Tax Overview was rendering ₹0 for every employee
  // because /employees never included a `ctc` field. The page key'd off
  // `e.ctc`, never found a value, and fell through to "—" everywhere.
  // Pull the active salary row here so the merged employee shape carries
  // CTC + the structure name -- the Tax Overview, dashboard cards, and
  // the employee detail page all benefit without an extra API round-trip.
  const activeSalary = await (payrollDb as any).findOne("employee_salaries", {
    empcloud_user_id: ecUser.id,
    is_active: true,
  });
  const ctc = activeSalary?.gross_salary != null ? Number(activeSalary.gross_salary) : null;
  const salaryStructureName = activeSalary?.structure_name || null;

  // Look up the location name from EmpCloud's organization_locations so
  // the attendance dashboard / payroll list pages can show + filter by
  // location without an extra API round-trip per employee. Best-effort:
  // older EmpCloud schemas without the table are tolerated by treating
  // the lookup as null. ecUser.location_id is the FK.
  let locationName: string | null = null;
  if (ecUser.location_id) {
    try {
      const ecDb = getEmpCloudDB();
      const loc = await ecDb("organization_locations")
        .where({ id: ecUser.location_id })
        .select("name")
        .first();
      locationName = loc?.name || null;
    } catch {
      locationName = null;
    }
  }
  // Address can legitimately be null (no address on file) — preserve that
  // instead of normalising to {}.
  const address =
    profile?.address == null
      ? null
      : typeof profile.address === "string"
        ? (() => {
            try {
              return JSON.parse(profile.address);
            } catch {
              return null;
            }
          })()
        : profile.address;

  return {
    // EmpCloud identity (id = empcloudUserId for backward compat)
    id: ecUser.id,
    empcloudUserId: ecUser.id,
    empcloudOrgId: ecUser.organization_id,
    first_name: ecUser.first_name,
    last_name: ecUser.last_name,
    firstName: ecUser.first_name,
    lastName: ecUser.last_name,
    email: ecUser.email,
    emp_code: ecUser.emp_code,
    empCode: ecUser.emp_code,
    // BUG-16: HRMS emp_code is the single source of truth for an employee's
    // code (per the architecture rules). The payroll profile used to carry its
    // own employee_code which could drift — e.g. Aarav Mehta showed "123" in
    // payroll vs "EMP0435" in HRMS. Always prefer the HRMS value; only fall
    // back to the (legacy) payroll-side code when HRMS genuinely has none.
    employee_code: ecUser.emp_code || profile?.employee_code || null,
    contactNumber: ecUser.contact_number,
    contact_number: ecUser.contact_number,
    phone: ecUser.contact_number,
    dateOfBirth: ecUser.date_of_birth,
    date_of_birth: ecUser.date_of_birth,
    gender: ecUser.gender,
    dateOfJoining: ecUser.date_of_joining,
    date_of_joining: ecUser.date_of_joining,
    dateOfExit: ecUser.date_of_exit,
    designation: ecUser.designation,
    department: departmentName,
    departmentId: ecUser.department_id,
    department_id: ecUser.department_id,
    locationId: ecUser.location_id,
    location_id: ecUser.location_id,
    location: locationName,
    location_name: locationName,
    reportingManagerId: ecUser.reporting_manager_id,
    reporting_manager_id: ecUser.reporting_manager_id,
    employmentType: ecUser.employment_type,
    employment_type: ecUser.employment_type,
    role: ecUser.role,
    status: ecUser.status,
    // Payroll profile (may be null if not yet created)
    payrollProfileId: profile?.id || null,
    address,
    bankDetails,
    bank_details: bankDetails,
    taxInfo,
    tax_info: taxInfo,
    pfDetails,
    pf_details: pfDetails,
    esiDetails,
    esi_details: esiDetails,
    isActive: ecUser.status === 1,
    is_active: ecUser.status === 1,
    // Active salary (null when no `employee_salaries` row with is_active=1).
    // Consumers can use `ctc > 0` to differentiate "salary not yet assigned"
    // from "salary set to zero". `salaryStructureName` is the friendly
    // structure label HR picked when assigning -- handy for list views.
    ctc,
    salaryStructureName,
    createdAt: ecUser.created_at,
    updatedAt: ecUser.updated_at,
  };
}

export class EmployeeService {
  private payrollDb = getDB();

  /**
   * List employees in an org — only shows employees with a payroll seat.
   * Fetches seated users from EmpCloud, enriches with payroll data.
   *
   * `options.filters` honours `q` (free-text), `location_id`,
   * `department_id`. They are pushed into the SQL JOIN so the page +
   * limit pagination is applied AFTER filtering -- not before.
   */
  async list(empcloudOrgId: number, options?: QueryOptions) {
    const limit = options?.limit || 20;
    const page = options?.page || 1;
    const offset = (page - 1) * limit;

    const f = options?.filters || {};
    const seatedFilters = {
      q: typeof f.q === "string" && f.q.trim() ? f.q.trim() : undefined,
      locationId: f.location_id != null ? Number(f.location_id) || undefined : undefined,
      departmentId: f.department_id != null ? Number(f.department_id) || undefined : undefined,
    };

    // Include recently-exited employees (DOE within the last 90 days) so HR
    // can still see + complete the final payroll for someone emp-exit has
    // already marked inactive. The list rows carry `is_active` so the UI can
    // badge them as exited; the period-aware filter is purely additive.
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const users = await findSeatedUsersForModule(empcloudOrgId, "emp-payroll", {
      limit,
      offset,
      filters: seatedFilters,
      periodStart: ninetyDaysAgo,
    });
    const total = await countSeatedUsersForModule(empcloudOrgId, "emp-payroll", seatedFilters, {
      periodStart: ninetyDaysAgo,
    });

    const data = await Promise.all(users.map((u) => mergeUserWithProfile(u, this.payrollDb)));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  /**
   * List EmpCloud employees who are NOT yet assigned to payroll (available for import).
   */
  async listAvailableForImport(empcloudOrgId: number) {
    const users = await findUnseatedUsersForModule(empcloudOrgId, "emp-payroll");
    return users.map((u: any) => ({
      id: u.id,
      first_name: u.first_name,
      last_name: u.last_name,
      email: u.email,
      emp_code: u.emp_code,
      designation: u.designation,
      role: u.role,
    }));
  }

  /**
   * Search employees by name, email, code, etc.
   */
  async search(empcloudOrgId: number, query: string, limit = 20) {
    const db = getEmpCloudDB();
    const q = `%${query}%`;
    const rows = await db("users")
      .where("organization_id", empcloudOrgId)
      .where("status", 1)
      .where(function (this: any) {
        this.where("first_name", "like", q)
          .orWhere("last_name", "like", q)
          .orWhere("email", "like", q)
          .orWhere("emp_code", "like", q)
          .orWhere("designation", "like", q)
          .orWhereRaw("CONCAT(first_name, ' ', last_name) LIKE ?", [q]);
      })
      .select(
        "id",
        "emp_code",
        "first_name",
        "last_name",
        "email",
        "designation",
        "department_id",
        "status",
      )
      .orderBy("first_name")
      .limit(limit);

    // Enrich with department names. Returns snake_case to match the rest of
    // the employee API shape — the header search bar navigates on `emp.id`
    // and displays `emp.first_name` / `emp.last_name` etc, so camelCase here
    // was landing users on /employees/undefined (issue #23).
    const results = await Promise.all(
      rows.map(async (r: any) => ({
        id: r.id,
        emp_code: r.emp_code,
        employee_code: r.emp_code, // some UIs still read this legacy key
        first_name: r.first_name,
        last_name: r.last_name,
        email: r.email,
        designation: r.designation,
        department: await getUserDepartmentName(r.department_id),
        is_active: r.status === 1,
      })),
    );

    return results;
  }

  /**
   * Get a single employee by EmpCloud user ID.
   */
  async getByEmpCloudId(empcloudUserId: number, empcloudOrgId: number) {
    const ecUser = await findUserById(empcloudUserId);
    if (!ecUser || ecUser.organization_id !== empcloudOrgId) {
      throw new AppError(404, "NOT_FOUND", "Employee not found");
    }
    return mergeUserWithProfile(ecUser, this.payrollDb);
  }

  /**
   * Create a new employee — creates user in EmpCloud + payroll profile.
   */
  async create(empcloudOrgId: number, data: any) {
    const db = getEmpCloudDB();

    // Check email uniqueness in EmpCloud
    const existing = await db("users").where({ email: data.email }).first();
    if (existing)
      throw new AppError(409, "EMAIL_EXISTS", "Employee with this email already exists");

    // Auto-generate emp code if not provided
    let empCode = data.employeeCode;
    if (!empCode) {
      const count = await countUsersByOrgId(empcloudOrgId);
      empCode = `EMP${String(count + 1).padStart(3, "0")}`;
    }

    // #102 — employee_code must be unique within the org.
    const codeClash = await db("users")
      .where({ organization_id: empcloudOrgId, emp_code: empCode })
      .first();
    if (codeClash) {
      throw new AppError(
        409,
        "EMPLOYEE_CODE_EXISTS",
        `Employee code "${empCode}" is already in use — employee codes must be unique within the organization.`,
      );
    }

    // #101 / #102 — PAN, PF and bank account numbers must be unique per org.
    // They live in JSON blobs on employee_payroll_profiles so we scan the
    // org's existing profiles for collisions. Skip checks when the incoming
    // value is empty (new hires may not have provided these yet).
    const incomingPan = (data.taxInfo?.pan || "").trim();
    const incomingPf = (data.pfDetails?.pfNumber || data.pfDetails?.pf_number || "").trim();
    const incomingAcct = (
      data.bankDetails?.accountNumber ||
      data.bankDetails?.account_number ||
      ""
    ).trim();
    if (incomingPan || incomingPf || incomingAcct) {
      const profiles = await this.payrollDb.findMany<any>("employee_payroll_profiles", {
        filters: { empcloud_org_id: empcloudOrgId },
        limit: 10000,
      });
      for (const p of profiles.data) {
        const parseJson = (v: any) => {
          if (!v) return {};
          if (typeof v === "string") {
            try {
              return JSON.parse(v);
            } catch {
              return {};
            }
          }
          return v;
        };
        const tax = parseJson(p.tax_info);
        const pf = parseJson(p.pf_details);
        const bank = parseJson(p.bank_details);
        if (incomingPan && (tax.pan || "").trim().toUpperCase() === incomingPan.toUpperCase()) {
          throw new AppError(
            409,
            "PAN_EXISTS",
            `PAN "${incomingPan}" is already registered to another employee.`,
          );
        }
        const existingPf = (pf.pfNumber || pf.pf_number || "").trim();
        if (incomingPf && existingPf === incomingPf) {
          throw new AppError(
            409,
            "PF_EXISTS",
            `PF number "${incomingPf}" is already registered to another employee.`,
          );
        }
        const existingAcct = (bank.accountNumber || bank.account_number || "").trim();
        if (incomingAcct && existingAcct === incomingAcct) {
          throw new AppError(
            409,
            "BANK_ACCOUNT_EXISTS",
            `Bank account "${incomingAcct}" is already registered to another employee.`,
          );
        }
      }
    }

    // Create user in EmpCloud
    const bcryptModule = await import("bcryptjs");
    const bcrypt = bcryptModule.default || bcryptModule;
    const defaultPassword = await bcrypt.hash("Welcome@123", 12);

    const [userId] = await db("users").insert({
      organization_id: empcloudOrgId,
      first_name: data.firstName,
      last_name: data.lastName,
      email: data.email,
      password: defaultPassword,
      emp_code: empCode,
      contact_number: data.phone || null,
      date_of_birth: data.dateOfBirth || null,
      gender: data.gender || null,
      date_of_joining: data.dateOfJoining || new Date().toISOString().slice(0, 10),
      designation: data.designation || null,
      department_id: data.departmentId || null,
      location_id: data.locationId || null,
      reporting_manager_id: data.reportingManagerId || null,
      employment_type: data.employmentType || "full_time",
      role: "employee",
      status: 1,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Create payroll profile
    await this.payrollDb.create<any>("employee_payroll_profiles", {
      id: uuidv4(),
      empcloud_user_id: userId,
      empcloud_org_id: empcloudOrgId,
      employee_code: empCode,
      bank_details: JSON.stringify(data.bankDetails || {}),
      tax_info: JSON.stringify(data.taxInfo || {}),
      pf_details: JSON.stringify(data.pfDetails || {}),
      esi_details: JSON.stringify(data.esiDetails || {}),
      is_active: true,
    });

    // Seat the new user on the emp-payroll module so the Payroll Employees
    // list (which filters on org_module_seats via findSeatedUsersForModule)
    // actually shows them. Without this the user exists in EmpCloud and has
    // a payroll profile, but is invisible to every list in this module —
    // which is exactly what #7 reported. Same logic as the
    // /employees/import-from-empcloud route already uses.
    try {
      const module = await db("modules").where({ slug: "emp-payroll" }).first();
      if (module) {
        const sub = await db("org_subscriptions")
          .where({ organization_id: empcloudOrgId, module_id: module.id })
          .whereIn("status", ["active", "trial"])
          .first();
        if (sub) {
          const seatExists = await db("org_module_seats")
            .where({ organization_id: empcloudOrgId, module_id: module.id, user_id: userId })
            .first();
          if (!seatExists) {
            await db("org_module_seats").insert({
              subscription_id: sub.id,
              organization_id: empcloudOrgId,
              module_id: module.id,
              user_id: userId,
              assigned_by: userId, // no caller context here; self-assigned is fine for audit
              assigned_at: new Date(),
            });
            await db("org_subscriptions").where({ id: sub.id }).increment("used_seats", 1);
          }
        }
      }
    } catch {
      // Don't fail the whole create over a seat hiccup; the employee still
      // exists in EmpCloud. The list returning empty for them will be a
      // visible signal in dev, and we'll already have logged above.
    }

    const ecUser = await findUserById(userId);
    return mergeUserWithProfile(ecUser!, this.payrollDb);
  }

  /**
   * Update employee — updates EmpCloud user + payroll profile as appropriate.
   */
  async update(empcloudUserId: number, empcloudOrgId: number, data: any) {
    const ecUser = await findUserById(empcloudUserId);
    if (!ecUser || ecUser.organization_id !== empcloudOrgId) {
      throw new AppError(404, "NOT_FOUND", "Employee not found");
    }

    const db = getEmpCloudDB();

    // Update EmpCloud user fields
    const ecUpdates: any = {};
    if (data.firstName) ecUpdates.first_name = data.firstName;
    if (data.lastName) ecUpdates.last_name = data.lastName;
    if (data.phone !== undefined) ecUpdates.contact_number = data.phone;
    if (data.designation) ecUpdates.designation = data.designation;
    if (data.departmentId !== undefined) ecUpdates.department_id = data.departmentId;
    // #291 — the EmployeeDetailPage edit modal sends `department` as the
    // department NAME (its <select> options use `value: d.name`). The schema
    // accepts that field but the service was only writing `departmentId`,
    // so the name was passed validation and then silently dropped — the
    // toast said "Employee updated" but the department never changed.
    // Resolve the name to an id here so existing callers keep working.
    if (
      data.departmentId === undefined &&
      typeof data.department === "string" &&
      data.department.trim()
    ) {
      const dept = await db("organization_departments")
        .where({ organization_id: empcloudOrgId })
        .where("name", data.department.trim())
        .first();
      if (dept) ecUpdates.department_id = dept.id;
    }
    if (data.locationId !== undefined) ecUpdates.location_id = data.locationId;
    if (data.reportingManagerId !== undefined)
      ecUpdates.reporting_manager_id = data.reportingManagerId;

    if (Object.keys(ecUpdates).length > 0) {
      ecUpdates.updated_at = new Date();
      await db("users").where({ id: empcloudUserId }).update(ecUpdates);
    }

    // Update payroll profile fields
    const profile = await this.payrollDb.findOne<any>("employee_payroll_profiles", {
      empcloud_user_id: empcloudUserId,
    });

    if (profile) {
      const profileUpdates: any = {};
      if (data.address) profileUpdates.address = JSON.stringify(data.address);
      if (data.bankDetails) profileUpdates.bank_details = JSON.stringify(data.bankDetails);
      if (data.taxInfo) profileUpdates.tax_info = JSON.stringify(data.taxInfo);
      if (data.pfDetails) profileUpdates.pf_details = JSON.stringify(data.pfDetails);
      if (data.esiDetails) profileUpdates.esi_details = JSON.stringify(data.esiDetails);

      if (Object.keys(profileUpdates).length > 0) {
        await this.payrollDb.update("employee_payroll_profiles", profile.id, profileUpdates);
      }
    }

    // Sync PAN / UAN to EmpCloud's `employee_profiles` so the HR profile page
    // reflects what was entered on the payroll side. The two systems keep
    // these identifiers in SEPARATE stores (payroll `tax_info.pan/uan` vs
    // EmpCloud `employee_profiles.pan_number/uan_number`); without this a PAN
    // added in payroll never surfaced in EmpCloud.
    if (
      data.taxInfo &&
      (typeof data.taxInfo.pan === "string" || typeof data.taxInfo.uan === "string")
    ) {
      const sync: Record<string, unknown> = { updated_at: new Date() };
      if (typeof data.taxInfo.pan === "string") {
        sync.pan_number = data.taxInfo.pan.trim().toUpperCase() || null;
      }
      if (typeof data.taxInfo.uan === "string") {
        sync.uan_number = data.taxInfo.uan.trim() || null;
      }
      const ecProfile = await db("employee_profiles")
        .where({ user_id: empcloudUserId, organization_id: empcloudOrgId })
        .first();
      if (ecProfile) {
        await db("employee_profiles").where({ id: ecProfile.id }).update(sync);
      } else {
        await db("employee_profiles").insert({
          organization_id: empcloudOrgId,
          user_id: empcloudUserId,
          created_at: new Date(),
          ...sync,
        });
      }
    }

    const updatedUser = await findUserById(empcloudUserId);
    return mergeUserWithProfile(updatedUser!, this.payrollDb);
  }

  /**
   * Deactivate employee — sets status to inactive in EmpCloud.
   */
  async deactivate(empcloudUserId: number, empcloudOrgId: number) {
    const ecUser = await findUserById(empcloudUserId);
    if (!ecUser || ecUser.organization_id !== empcloudOrgId) {
      throw new AppError(404, "NOT_FOUND", "Employee not found");
    }

    const db = getEmpCloudDB();
    await db("users")
      .where({ id: empcloudUserId })
      .update({
        status: 2,
        date_of_exit: new Date().toISOString().slice(0, 10),
        updated_at: new Date(),
      });

    return { message: "Employee deactivated" };
  }

  /**
   * Get bank details from payroll profile.
   */
  async getBankDetails(empcloudUserId: number, empcloudOrgId: number) {
    const emp = await this.getByEmpCloudId(empcloudUserId, empcloudOrgId);
    return emp.bankDetails;
  }

  /**
   * Update bank details in payroll profile.
   */
  async updateBankDetails(empcloudUserId: number, empcloudOrgId: number, bankDetails: any) {
    await this.getByEmpCloudId(empcloudUserId, empcloudOrgId);
    const profile = await this.ensurePayrollProfile(empcloudUserId, empcloudOrgId);
    await this.payrollDb.update("employee_payroll_profiles", profile.id, {
      bank_details: JSON.stringify(bankDetails),
    });
    return bankDetails;
  }

  /**
   * Get tax info from payroll profile.
   */
  async getTaxInfo(empcloudUserId: number, empcloudOrgId: number) {
    const emp = await this.getByEmpCloudId(empcloudUserId, empcloudOrgId);
    return emp.taxInfo;
  }

  /**
   * Update tax info in payroll profile.
   */
  async updateTaxInfo(empcloudUserId: number, empcloudOrgId: number, taxInfo: any) {
    await this.getByEmpCloudId(empcloudUserId, empcloudOrgId);
    const profile = await this.ensurePayrollProfile(empcloudUserId, empcloudOrgId);
    await this.payrollDb.update("employee_payroll_profiles", profile.id, {
      tax_info: JSON.stringify(taxInfo),
    });
    return taxInfo;
  }

  /**
   * Get PF details from payroll profile.
   */
  async getPfDetails(empcloudUserId: number, empcloudOrgId: number) {
    const emp = await this.getByEmpCloudId(empcloudUserId, empcloudOrgId);
    return emp.pfDetails;
  }

  /**
   * Update PF details in payroll profile.
   */
  async updatePfDetails(empcloudUserId: number, empcloudOrgId: number, pfDetails: any) {
    await this.getByEmpCloudId(empcloudUserId, empcloudOrgId);
    const profile = await this.ensurePayrollProfile(empcloudUserId, empcloudOrgId);
    await this.payrollDb.update("employee_payroll_profiles", profile.id, {
      pf_details: JSON.stringify(pfDetails),
    });
    return pfDetails;
  }

  /**
   * Get ESI details from payroll profile.
   */
  async getEsiDetails(empcloudUserId: number, empcloudOrgId: number) {
    const emp = await this.getByEmpCloudId(empcloudUserId, empcloudOrgId);
    return emp.esiDetails;
  }

  /**
   * Update ESI details in payroll profile.
   */
  async updateEsiDetails(empcloudUserId: number, empcloudOrgId: number, esiDetails: any) {
    await this.getByEmpCloudId(empcloudUserId, empcloudOrgId);
    const profile = await this.ensurePayrollProfile(empcloudUserId, empcloudOrgId);
    await this.payrollDb.update("employee_payroll_profiles", profile.id, {
      esi_details: JSON.stringify(esiDetails),
    });
    return esiDetails;
  }

  /**
   * Count active employees in org.
   */
  async count(empcloudOrgId: number) {
    return countUsersByOrgId(empcloudOrgId);
  }

  /**
   * Bulk update status in EmpCloud.
   */
  async bulkUpdateStatus(empcloudOrgId: number, empcloudUserIds: number[], isActive: boolean) {
    const db = getEmpCloudDB();
    let updated = 0;
    for (const userId of empcloudUserIds) {
      const user = await db("users").where({ id: userId, organization_id: empcloudOrgId }).first();
      if (user) {
        await db("users")
          .where({ id: userId })
          .update({
            status: isActive ? 1 : 2,
            updated_at: new Date(),
          });
        updated++;
      }
    }
    return { updated, total: empcloudUserIds.length };
  }

  /**
   * Bulk assign department in EmpCloud.
   */
  async bulkAssignDepartment(
    empcloudOrgId: number,
    empcloudUserIds: number[],
    departmentId: number,
  ) {
    const db = getEmpCloudDB();
    let updated = 0;
    for (const userId of empcloudUserIds) {
      const user = await db("users").where({ id: userId, organization_id: empcloudOrgId }).first();
      if (user) {
        await db("users").where({ id: userId }).update({
          department_id: departmentId,
          updated_at: new Date(),
        });
        updated++;
      }
    }
    return { updated, departmentId };
  }

  /**
   * Bulk update existing employees across both stores (EmpCloud user fields +
   * payroll profile JSON). Driven by the Bulk Update CSV importer.
   *
   * Each row is matched to an employee by `key.empCode` (preferred) or, when
   * no code is given, `key.email`. Identity / contact / statutory data is then
   * applied with READ-MERGE-WRITE semantics: only the keys present in the row
   * are touched, so a partial CSV never clobbers fields it didn't include.
   *
   * The batch is fault-tolerant — a bad row (unmatched, invalid PAN/IFSC, …)
   * is recorded in `results` and skipped without aborting the rest.
   */
  async bulkUpdate(
    empcloudOrgId: number,
    updates: Array<{
      key: { empCode?: string; email?: string };
      user?: Record<string, any>;
      taxInfo?: Record<string, any>;
      bankDetails?: Record<string, any>;
      pfDetails?: Record<string, any>;
      esiDetails?: Record<string, any>;
    }>,
  ) {
    const db = getEmpCloudDB();
    const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
    const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
    const GENDERS = new Set(["male", "female", "other"]);

    const parseJsonish = (v: unknown): Record<string, any> => {
      if (v == null) return {};
      if (typeof v === "string") {
        try {
          return JSON.parse(v || "{}") || {};
        } catch {
          return {};
        }
      }
      return typeof v === "object" ? (v as Record<string, any>) : {};
    };

    const results: Array<{ key: string; status: "updated" | "error"; error?: string }> = [];
    let updated = 0;
    let failed = 0;

    for (const row of updates) {
      // Build a richer display label that combines the name (when the CSV
      // row supplied one) with the lookup key, so the failure messages on
      // the modal show "Gajendra Dewangan / GLB/BAN/2026/2/2055" instead of
      // a bare emp_code that HR has to cross-reference manually. The CSV
      // row's First/Last Name cells are the only name we have when the
      // lookup itself fails, so we read them upfront.
      const u0 = row.user || {};
      const csvName = [u0.firstName, u0.lastName].filter(Boolean).join(" ").trim();
      const lookupKey = row.key?.empCode || row.key?.email || "(no key)";
      const keyLabel = csvName ? `${csvName} / ${lookupKey}` : lookupKey;
      try {
        // --- Resolve the employee (code first, then email) ---
        // BUG-Bulk-StatusFilter — the lookup used to require status=1
        // ("active"). The Download Employees export, however, dumps every
        // employee regardless of status, so a round-trip (download → tiny
        // edit → re-upload) failed every inactive row with "No active
        // employee found". Drop the status filter — if the row exists at
        // all in this org we accept the update (HR legitimately wants to
        // edit exited / pending employees: final bank details for FnF,
        // updated phone numbers etc.). Hard-deleted users still fail as
        // before since they don't exist at all.
        let ecUser: any = null;
        if (row.key?.empCode) {
          ecUser = await db("users")
            .where({ organization_id: empcloudOrgId, emp_code: row.key.empCode })
            .first();
        }
        if (!ecUser && row.key?.email) {
          ecUser = await db("users")
            .where({ organization_id: empcloudOrgId, email: row.key.email })
            .first();
        }
        if (!ecUser) {
          failed++;
          const by = row.key?.empCode ? "Employee Code" : "Email";
          results.push({
            key: keyLabel,
            status: "error",
            error: `No employee found for ${by} "${lookupKey}"`,
          });
          continue;
        }

        // --- Validate the statutory fields up front; skip the whole row on a
        // hard format error so we never persist garbage the payroll/bank-file
        // generators would later choke on. ---
        const pan = row.taxInfo?.pan ? String(row.taxInfo.pan).trim().toUpperCase() : undefined;
        if (pan && !PAN_RE.test(pan)) {
          failed++;
          results.push({
            key: keyLabel,
            status: "error",
            error: `Invalid PAN "${pan}" — expected format ABCDE1234F`,
          });
          continue;
        }
        const ifsc = row.bankDetails?.ifscCode
          ? String(row.bankDetails.ifscCode).trim().toUpperCase()
          : undefined;
        if (ifsc && !IFSC_RE.test(ifsc)) {
          failed++;
          results.push({
            key: keyLabel,
            status: "error",
            error: `Invalid IFSC "${ifsc}" — expected 11 characters like HDFC0001234`,
          });
          continue;
        }
        const gender = row.user?.gender ? String(row.user.gender).trim().toLowerCase() : undefined;
        if (gender && !GENDERS.has(gender)) {
          failed++;
          results.push({
            key: keyLabel,
            status: "error",
            error: `Invalid gender "${gender}" — use male, female, or other`,
          });
          continue;
        }

        // --- EmpCloud user fields ---
        const u = row.user || {};
        const ecUpdates: Record<string, any> = {};
        if (u.firstName) ecUpdates.first_name = String(u.firstName).trim();
        if (u.lastName) ecUpdates.last_name = String(u.lastName).trim();
        if (u.email) ecUpdates.email = String(u.email).trim();
        if (u.phone !== undefined) ecUpdates.contact_number = String(u.phone).trim();
        if (u.designation) ecUpdates.designation = String(u.designation).trim();
        if (u.dateOfJoining) ecUpdates.date_of_joining = String(u.dateOfJoining).trim();
        if (u.dateOfBirth) ecUpdates.date_of_birth = String(u.dateOfBirth).trim();
        if (gender) ecUpdates.gender = gender;
        // Department is supplied by NAME; resolve to the org's department id.
        if (typeof u.department === "string" && u.department.trim()) {
          const dept = await db("organization_departments")
            .where({ organization_id: empcloudOrgId })
            .where("name", u.department.trim())
            .first();
          if (dept) ecUpdates.department_id = dept.id;
        }
        // Same pattern for Location — exported as the human-readable name in
        // the CSV (Globussoft - Bhilai / Bangalore), resolved to
        // organization_locations.id on import. Unknown location names are
        // silently dropped (matches the Department behavior) instead of
        // failing the whole row — HR commonly mistypes the name and we'd
        // rather let the rest of the row succeed than abort.
        if (typeof u.location === "string" && u.location.trim()) {
          try {
            const loc = await db("organization_locations")
              .where({ organization_id: empcloudOrgId })
              .where("name", u.location.trim())
              .first();
            if (loc) ecUpdates.location_id = loc.id;
          } catch {
            /* organization_locations table absent on older empcloud schemas — ignore */
          }
        }
        if (Object.keys(ecUpdates).length > 0) {
          ecUpdates.updated_at = new Date();
          await db("users").where({ id: ecUser.id }).update(ecUpdates);
        }

        // --- Payroll profile JSON (read-merge-write) ---
        const profile = await this.ensurePayrollProfile(ecUser.id, empcloudOrgId);
        const profileUpdates: Record<string, any> = {};

        if (row.bankDetails && Object.keys(row.bankDetails).length) {
          const merged = { ...parseJsonish(profile.bank_details), ...row.bankDetails };
          if (ifsc) merged.ifscCode = ifsc;
          profileUpdates.bank_details = JSON.stringify(merged);
        }
        if (row.taxInfo && Object.keys(row.taxInfo).length) {
          const merged = { ...parseJsonish(profile.tax_info), ...row.taxInfo };
          if (pan) merged.pan = pan;
          profileUpdates.tax_info = JSON.stringify(merged);
        }
        if (row.pfDetails && Object.keys(row.pfDetails).length) {
          profileUpdates.pf_details = JSON.stringify({
            ...parseJsonish(profile.pf_details),
            ...row.pfDetails,
          });
        }
        if (row.esiDetails && Object.keys(row.esiDetails).length) {
          profileUpdates.esi_details = JSON.stringify({
            ...parseJsonish(profile.esi_details),
            ...row.esiDetails,
          });
        }
        if (Object.keys(profileUpdates).length > 0) {
          await this.payrollDb.update("employee_payroll_profiles", profile.id, profileUpdates);
        }

        // --- Mirror PAN / UAN into EmpCloud's employee_profiles so the HR
        // profile screen stays in sync (same behaviour as update()). ---
        const uan = row.pfDetails?.uan;
        if (pan || (typeof uan === "string" && uan.trim())) {
          const sync: Record<string, unknown> = { updated_at: new Date() };
          if (pan) sync.pan_number = pan;
          if (typeof uan === "string" && uan.trim()) sync.uan_number = uan.trim();
          const ecProfile = await db("employee_profiles")
            .where({ user_id: ecUser.id, organization_id: empcloudOrgId })
            .first();
          if (ecProfile) {
            await db("employee_profiles").where({ id: ecProfile.id }).update(sync);
          } else {
            await db("employee_profiles").insert({
              organization_id: empcloudOrgId,
              user_id: ecUser.id,
              created_at: new Date(),
              ...sync,
            });
          }
        }

        updated++;
        results.push({ key: keyLabel, status: "updated" });
      } catch (err: any) {
        failed++;
        results.push({ key: keyLabel, status: "error", error: err?.message || "Update failed" });
      }
    }

    return { total: updates.length, updated, failed, results };
  }

  // -----------------------------------------------------------------------
  // Internal helpers
  // -----------------------------------------------------------------------

  private async ensurePayrollProfile(empcloudUserId: number, empcloudOrgId: number): Promise<any> {
    let profile = await this.payrollDb.findOne<any>("employee_payroll_profiles", {
      empcloud_user_id: empcloudUserId,
    });
    if (profile) return profile;

    try {
      const ecUser = await findUserById(empcloudUserId);
      return await this.payrollDb.create<any>("employee_payroll_profiles", {
        id: uuidv4(),
        empcloud_user_id: empcloudUserId,
        empcloud_org_id: empcloudOrgId,
        employee_code: ecUser?.emp_code || null,
        bank_details: JSON.stringify({}),
        tax_info: JSON.stringify({ pan: "", regime: "new" }),
        pf_details: JSON.stringify({}),
        esi_details: JSON.stringify({}),
        is_active: true,
      });
    } catch (err: any) {
      // Race condition: another request created it first — re-fetch
      if (err.code === "ER_DUP_ENTRY" || err.errno === 1062) {
        profile = await this.payrollDb.findOne<any>("employee_payroll_profiles", {
          empcloud_user_id: empcloudUserId,
        });
        if (profile) return profile;
      }
      throw err;
    }
  }
}
