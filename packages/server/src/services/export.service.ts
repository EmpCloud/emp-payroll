import { getDB } from "../db/adapters";

export class ExportService {
  private db = getDB();

  async exportEmployeesCSV(orgId: string): Promise<string> {
    const result = await this.db.findMany<any>("employees", {
      filters: { org_id: orgId, is_active: true },
      limit: 10000,
    });

    const headers = [
      "Employee Code", "First Name", "Last Name", "Email", "Phone",
      "Department", "Designation", "Date of Joining", "Employment Type",
      "Gender", "Date of Birth", "PAN", "PF Number", "Bank Name",
      "Account Number", "IFSC",
    ];

    const rows = result.data.map((emp: any) => {
      const bank = typeof emp.bank_details === "string" ? JSON.parse(emp.bank_details) : emp.bank_details || {};
      const tax = typeof emp.tax_info === "string" ? JSON.parse(emp.tax_info) : emp.tax_info || {};
      const pf = typeof emp.pf_details === "string" ? JSON.parse(emp.pf_details) : emp.pf_details || {};
      return [
        emp.employee_code, emp.first_name, emp.last_name, emp.email, emp.phone || "",
        emp.department, emp.designation, emp.date_of_joining, emp.employment_type,
        emp.gender, emp.date_of_birth, tax.pan || "", pf.pfNumber || "",
        bank.bankName || "", bank.accountNumber || "", bank.ifscCode || "",
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
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
      // Get all runs for org, then all payslips
      const runs = await this.db.findMany<any>("payroll_runs", {
        filters: { org_id: orgId },
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

    // Get employee names
    const empIds = [...new Set(payslips.map((p: any) => p.employee_id))];
    const empMap: Record<string, any> = {};
    for (const empId of empIds) {
      const emp = await this.db.findById<any>("employees", empId);
      if (emp) empMap[empId] = emp;
    }

    const headers = [
      "Month", "Year", "Employee Code", "Employee Name", "Email",
      "Paid Days", "Total Days", "LOP Days",
      "Gross Earnings", "Total Deductions", "Net Pay", "Status",
    ];

    const rows = payslips.map((ps: any) => {
      const emp = empMap[ps.employee_id] || {};
      return [
        ps.month, ps.year, emp.employee_code || "", `${emp.first_name || ""} ${emp.last_name || ""}`,
        emp.email || "", ps.paid_days, ps.total_days, ps.lop_days,
        ps.gross_earnings, ps.total_deductions, ps.net_pay, ps.status,
      ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",");
    });

    return [headers.join(","), ...rows].join("\n");
  }
}
