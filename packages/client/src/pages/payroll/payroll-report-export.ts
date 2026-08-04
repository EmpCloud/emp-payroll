export function buildPayrollReportCsv(payslips: any[], run: any): string {
  const headers = [
    "Org",
    "Employee Code",
    "Name",
    "Location",
    "Department",
    "Monthly Gross",
    "Daily Gross",
    "Basic Salary",
    "House Rent Allowance",
    "Special Allowance",
    "Conveyance Allowance",
    "No of LOP",
    "LOP Amount Deducted",
    "No of Night Days",
    "Night Allowance",
    "No of Overtime",
    "Overtime Allowance",
    "Total Earnings",
    "Deductions Employee PF",
    "Deductions ESIC",
    "Deductions PT TAX",
    "Deductions TDS",
    "Final Net Pay",
  ];

  const parseItems = (items: any): any[] => {
    if (Array.isArray(items)) return items;
    if (typeof items !== "string") return [];
    try {
      const parsed = JSON.parse(items);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  const findAmt = (items: any, code: string): number => {
    const row = parseItems(items).find(
      (component: any) => String(component?.code || "").toUpperCase() === code,
    );
    return Number(row?.amount) || 0;
  };

  const findMeta = (items: any, code: string, key: string): number => {
    const row = parseItems(items).find(
      (component: any) => String(component?.code || "").toUpperCase() === code,
    );
    return Number(row?.meta?.[key]) || 0;
  };

  const fmtCount = (value: number): string => {
    if (!value) return "0";
    return value % 1 === 0 ? String(value) : value.toFixed(1);
  };
  const fmtMoney = (value: number): string => String(Math.round(Number(value) || 0));
  const csvCell = (value: unknown): string => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const rows = payslips.map((payslip: any) => {
    const monthlyGross = Number(payslip.monthly_gross) || 0;
    const totalDays = Number(payslip.total_days) || 31;
    const lopDays = Number(payslip.lop_days) || 0;

    return [
      payslip.organization_name || run?.organization_name || run?.org_name || "",
      payslip.employee_code || "",
      `${payslip.first_name || ""} ${payslip.last_name || ""}`.trim(),
      payslip.location || "",
      payslip.department || "",
      fmtMoney(monthlyGross),
      fmtMoney(totalDays > 0 ? monthlyGross / totalDays : 0),
      fmtMoney(findAmt(payslip.earnings, "BASIC")),
      fmtMoney(findAmt(payslip.earnings, "HRA")),
      fmtMoney(findAmt(payslip.earnings, "SA")),
      fmtMoney(findAmt(payslip.earnings, "CA")),
      fmtCount(lopDays),
      fmtMoney(totalDays > 0 ? (monthlyGross * lopDays) / totalDays : 0),
      fmtCount(findMeta(payslip.earnings, "NIGHT_ALLOW", "nights")),
      fmtMoney(findAmt(payslip.earnings, "NIGHT_ALLOW")),
      fmtCount(findMeta(payslip.earnings, "OVERTIME", "otDays")),
      fmtMoney(findAmt(payslip.earnings, "OVERTIME")),
      fmtMoney(payslip.gross_earnings),
      fmtMoney(findAmt(payslip.deductions, "EPF")),
      fmtMoney(findAmt(payslip.deductions, "ESI")),
      fmtMoney(findAmt(payslip.deductions, "PT")),
      fmtMoney(findAmt(payslip.deductions, "TDS")),
      fmtMoney(payslip.net_pay),
    ];
  });

  return (
    "\uFEFF" +
    [headers.map(csvCell).join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\n")
  );
}
