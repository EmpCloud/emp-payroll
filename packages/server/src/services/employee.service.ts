import { getDB } from "../db/adapters";
import { QueryOptions } from "../db/adapters/interface";
import { AppError } from "../api/middleware/error.middleware";
import bcrypt from "bcryptjs";

export class EmployeeService {
  private db = getDB();

  async list(orgId: string, options?: QueryOptions) {
    return this.db.findMany<any>("employees", {
      ...options,
      filters: { ...options?.filters, org_id: orgId, is_active: true },
    });
  }

  async getById(id: string, orgId: string) {
    const emp = await this.db.findOne<any>("employees", { id, org_id: orgId });
    if (!emp) throw new AppError(404, "NOT_FOUND", "Employee not found");
    const { password_hash, ...data } = emp;
    return data;
  }

  async create(orgId: string, data: any) {
    const existing = await this.db.findOne<any>("employees", { email: data.email });
    if (existing) throw new AppError(409, "EMAIL_EXISTS", "Employee with this email already exists");

    const codeExists = await this.db.findOne<any>("employees", {
      org_id: orgId,
      employee_code: data.employeeCode,
    });
    if (codeExists) throw new AppError(409, "CODE_EXISTS", "Employee code already in use");

    const defaultPassword = await bcrypt.hash("Welcome@123", 12);

    const employee = await this.db.create<any>("employees", {
      org_id: orgId,
      employee_code: data.employeeCode,
      first_name: data.firstName,
      last_name: data.lastName,
      email: data.email,
      phone: data.phone || null,
      date_of_birth: data.dateOfBirth,
      gender: data.gender,
      date_of_joining: data.dateOfJoining,
      employment_type: data.employmentType || "full_time",
      department: data.department,
      designation: data.designation,
      reporting_manager_id: data.reportingManagerId || null,
      bank_details: JSON.stringify(data.bankDetails),
      tax_info: JSON.stringify(data.taxInfo),
      pf_details: JSON.stringify(data.pfDetails),
      role: "employee",
      password_hash: defaultPassword,
      is_active: true,
    });

    const { password_hash, ...result } = employee;
    return result;
  }

  async update(id: string, orgId: string, data: any) {
    await this.getById(id, orgId); // throws if not found

    const updates: any = {};
    if (data.firstName) updates.first_name = data.firstName;
    if (data.lastName) updates.last_name = data.lastName;
    if (data.phone !== undefined) updates.phone = data.phone;
    if (data.department) updates.department = data.department;
    if (data.designation) updates.designation = data.designation;
    if (data.reportingManagerId !== undefined) updates.reporting_manager_id = data.reportingManagerId;
    if (data.address) updates.address = JSON.stringify(data.address);

    const updated = await this.db.update<any>("employees", id, updates);
    const { password_hash, ...result } = updated;
    return result;
  }

  async deactivate(id: string, orgId: string) {
    await this.getById(id, orgId);
    await this.db.update("employees", id, {
      is_active: false,
      date_of_exit: new Date().toISOString().slice(0, 10),
    });
    return { message: "Employee deactivated" };
  }

  async getBankDetails(id: string, orgId: string) {
    const emp = await this.getById(id, orgId);
    return typeof emp.bank_details === "string" ? JSON.parse(emp.bank_details) : emp.bank_details;
  }

  async updateBankDetails(id: string, orgId: string, bankDetails: any) {
    await this.getById(id, orgId);
    await this.db.update("employees", id, { bank_details: JSON.stringify(bankDetails) });
    return bankDetails;
  }

  async getTaxInfo(id: string, orgId: string) {
    const emp = await this.getById(id, orgId);
    return typeof emp.tax_info === "string" ? JSON.parse(emp.tax_info) : emp.tax_info;
  }

  async updateTaxInfo(id: string, orgId: string, taxInfo: any) {
    await this.getById(id, orgId);
    await this.db.update("employees", id, { tax_info: JSON.stringify(taxInfo) });
    return taxInfo;
  }

  async getPfDetails(id: string, orgId: string) {
    const emp = await this.getById(id, orgId);
    return typeof emp.pf_details === "string" ? JSON.parse(emp.pf_details) : emp.pf_details;
  }

  async updatePfDetails(id: string, orgId: string, pfDetails: any) {
    await this.getById(id, orgId);
    await this.db.update("employees", id, { pf_details: JSON.stringify(pfDetails) });
    return pfDetails;
  }

  async count(orgId: string) {
    return this.db.count("employees", { org_id: orgId, is_active: true });
  }
}
