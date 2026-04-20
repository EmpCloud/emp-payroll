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

  const bankDetails = profile
    ? typeof profile.bank_details === "string"
      ? JSON.parse(profile.bank_details || "{}")
      : profile.bank_details
    : {};
  const taxInfo = profile
    ? typeof profile.tax_info === "string"
      ? JSON.parse(profile.tax_info || "{}")
      : profile.tax_info
    : {};
  const pfDetails = profile
    ? typeof profile.pf_details === "string"
      ? JSON.parse(profile.pf_details || "{}")
      : profile.pf_details
    : {};
  const esiDetails = profile
    ? typeof profile.esi_details === "string"
      ? JSON.parse(profile.esi_details || "{}")
      : profile.esi_details
    : {};
  const address = profile
    ? typeof profile.address === "string"
      ? JSON.parse(profile.address || "null")
      : profile.address
    : null;

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
    employee_code: profile?.employee_code || ecUser.emp_code,
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
    createdAt: ecUser.created_at,
    updatedAt: ecUser.updated_at,
  };
}

export class EmployeeService {
  private payrollDb = getDB();

  /**
   * List employees in an org — only shows employees with a payroll seat.
   * Fetches seated users from EmpCloud, enriches with payroll data.
   */
  async list(empcloudOrgId: number, options?: QueryOptions) {
    const limit = options?.limit || 20;
    const page = options?.page || 1;
    const offset = (page - 1) * limit;

    const users = await findSeatedUsersForModule(empcloudOrgId, "emp-payroll", { limit, offset });
    const total = await countSeatedUsersForModule(empcloudOrgId, "emp-payroll");

    const data = await Promise.all(users.map((u) => mergeUserWithProfile(u, this.payrollDb)));

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
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
