import { getDB } from "../db/adapters";
import { getEmpCloudDB } from "../db/empcloud";
import { EmployeeService } from "./employee.service";

export class ExportService {
  private db = getDB();

  async exportEmployeesCSV(orgId: string): Promise<string> {
    const empSvc = new EmployeeService();
    const result = await empSvc.list(Number(orgId), { limit: 10000 });

    const headers = [
      "Employee Code",
      "First Name",
      "Last Name",
      "Email",
      "Phone",
      "Department",
      "Designation",
      "Date of Joining",
      "Employment Type",
      "Gender",
      "Date of Birth",
      "PAN",
      "PF Number",
      "Bank Name",
      "Account Number",
      "IFSC",
    ];

    const rows = result.data.map((emp: any) => {
      const bank = emp.bankDetails || emp.bank_details || {};
      const tax = emp.taxInfo || emp.tax_info || {};
      const pf = emp.pfDetails || emp.pf_details || {};
      return [
        emp.employee_code || emp.empCode || emp.emp_code || "",
        emp.first_name || emp.firstName || "",
        emp.last_name || emp.lastName || "",
        emp.email || "",
        emp.phone || emp.contactNumber || emp.contact_number || "",
        emp.department || "",
        emp.designation || "",
        emp.date_of_joining || emp.dateOfJoining || "",
        emp.employment_type || emp.employmentType || "",
        emp.gender || "",
        emp.date_of_birth || emp.dateOfBirth || "",
        tax.pan || "",
        pf.pfNumber || "",
        bank.bankName || "",
        bank.accountNumber || "",
        bank.ifscCode || "",
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",");
    });

    return [headers.join(","), ...rows].join("\n");
  }

  async exportPayslipsCSV(orgId: string, runId?: string): Promise<string> {
    let payslips: any[];

    if (runId) {
      const result = await this.db.findMany<any>("payslips", {
        filters: { payroll_run_id: runId },
        limit: 10000,
      });
      payslips = result.data;
    } else {
      const runs = await this.db.findMany<any>("payroll_runs", {
        filters: { empcloud_org_id: Number(orgId) },
        limit: 100,
      });
      const runIds = runs.data.map((r: any) => r.id);
      if (runIds.length === 0) return "No payslips found";
      const result = await this.db.findMany<any>("payslips", {
        filters: { payroll_run_id: runIds },
        limit: 10000,
      });
      payslips = result.data;
    }

    // Get employee names from EmpCloud
    const ecDb = getEmpCloudDB();
    const userIds = [...new Set(payslips.map((p: any) => p.empcloud_user_id).filter(Boolean))];
    const empMap: Record<number, any> = {};
    if (userIds.length > 0) {
      const users = await ecDb("users")
        .whereIn("id", userIds)
        .select("id", "first_name", "last_name", "emp_code", "email");
      for (const u of users) empMap[u.id] = u;
    }

    const headers = [
      "Month",
      "Year",
      "Employee Code",
      "Employee Name",
      "Email",
      "Paid Days",
      "Total Days",
      "LOP Days",
      "Gross Earnings",
      "Total Deductions",
      "Net Pay",
      "Status",
    ];

    const rows = payslips.map((ps: any) => {
      const emp = empMap[ps.empcloud_user_id] || {};
      return [
        ps.month,
        ps.year,
        emp.emp_code || "",
        `${emp.first_name || ""} ${emp.last_name || ""}`.trim(),
        emp.email || "",
        ps.paid_days,
        ps.total_days,
        ps.lop_days,
        ps.gross_earnings,
        ps.total_deductions,
        ps.net_pay,
        ps.status,
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",");
    });

    return [headers.join(","), ...rows].join("\n");
  }
}
