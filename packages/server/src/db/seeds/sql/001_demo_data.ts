import { Knex } from "knex";
import { v4 as uuidv4 } from "uuid";
import bcrypt from "bcryptjs";

export async function seed(knex: Knex): Promise<void> {
  // Clear existing data (reverse FK order)
  await knex("audit_logs").del();
  for (const t of ["employee_notes", "employee_documents", "payroll_adjustments", "leave_balances", "loans"]) {
    try { await knex(t).del(); } catch { /* table may not exist */ }
  }
  await knex("reimbursements").del();
  await knex("attendance_summaries").del();
  await knex("tax_declarations").del();
  await knex("tax_computations").del();
  await knex("payslips").del();
  await knex("payroll_runs").del();
  await knex("employee_salaries").del();
  await knex("salary_components").del();
  await knex("salary_structures").del();
  await knex("employees").del();
  await knex("organizations").del();

  // -----------------------------------------------------------------------
  // Organization
  // -----------------------------------------------------------------------
  const orgId = uuidv4();
  await knex("organizations").insert({
    id: orgId,
    name: "TechNova Solutions",
    legal_name: "TechNova Solutions Pvt. Ltd.",
    pan: "AABCT1234F",
    tan: "BLRT12345A",
    gstin: "29AABCT1234F1ZP",
    pf_establishment_code: "BGBNG0012345",
    esi_establishment_code: "53001234560001",
    pt_registration_number: "PTKA0012345",
    registered_address: JSON.stringify({
      line1: "42, 3rd Cross, HSR Layout",
      line2: "Sector 2",
      city: "Bengaluru",
      state: "Karnataka",
      pincode: "560102",
    }),
    pay_frequency: "monthly",
    financial_year_start: 4,
    currency: "INR",
    country: "IN",
    state: "KA",
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  });

  // -----------------------------------------------------------------------
  // Salary Structure
  // -----------------------------------------------------------------------
  const structureId = uuidv4();
  await knex("salary_structures").insert({
    id: structureId,
    org_id: orgId,
    name: "Standard CTC Structure",
    description: "Default salary structure for all employees with Basic, HRA, SA, PF, ESI components",
    is_default: true,
    is_active: true,
    created_at: new Date(),
    updated_at: new Date(),
  });

  const componentDefs = [
    { code: "BASIC", name: "Basic Salary", type: "earning", calc: "percentage", value: 40, pOf: "CTC", taxable: true, statutory: true, sort: 1 },
    { code: "HRA", name: "House Rent Allowance", type: "earning", calc: "percentage", value: 50, pOf: "BASIC", taxable: true, statutory: false, sort: 2 },
    { code: "SA", name: "Special Allowance", type: "earning", calc: "fixed", value: 0, pOf: null, taxable: true, statutory: false, sort: 3 },
    { code: "LTA", name: "Leave Travel Allowance", type: "reimbursement", calc: "fixed", value: 0, pOf: null, taxable: false, statutory: false, sort: 4 },
    { code: "EPF", name: "Employee PF", type: "deduction", calc: "percentage", value: 12, pOf: "BASIC", taxable: false, statutory: true, sort: 10 },
    { code: "PT", name: "Professional Tax", type: "deduction", calc: "fixed", value: 200, pOf: null, taxable: false, statutory: true, sort: 11 },
  ];

  const componentIds: Record<string, string> = {};
  for (const c of componentDefs) {
    const cId = uuidv4();
    componentIds[c.code] = cId;
    await knex("salary_components").insert({
      id: cId,
      structure_id: structureId,
      name: c.name,
      code: c.code,
      type: c.type,
      calculation_type: c.calc,
      value: c.value,
      percentage_of: c.pOf,
      formula: null,
      is_taxable: c.taxable,
      is_statutory: c.statutory,
      is_proratable: true,
      is_active: true,
      sort_order: c.sort,
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  // -----------------------------------------------------------------------
  // Employees (10 demo employees)
  // -----------------------------------------------------------------------
  const password = await bcrypt.hash("Welcome@123", 12);

  const employees = [
    { code: "TN-001", first: "Ananya", last: "Gupta", email: "ananya@technova.in", gender: "female", dob: "1990-05-15", doj: "2022-01-10", dept: "Engineering", desig: "Tech Lead", role: "hr_admin", ctc: 2400000 },
    { code: "TN-002", first: "Rahul", last: "Sharma", email: "rahul@technova.in", gender: "male", dob: "1992-08-22", doj: "2022-03-01", dept: "Engineering", desig: "Senior Developer", role: "employee", ctc: 1800000 },
    { code: "TN-003", first: "Priya", last: "Patel", email: "priya@technova.in", gender: "female", dob: "1995-11-03", doj: "2023-06-15", dept: "Engineering", desig: "Developer", role: "employee", ctc: 1200000 },
    { code: "TN-004", first: "Vikram", last: "Singh", email: "vikram@technova.in", gender: "male", dob: "1988-02-14", doj: "2021-09-01", dept: "Product", desig: "Product Manager", role: "hr_manager", ctc: 2000000 },
    { code: "TN-005", first: "Sneha", last: "Reddy", email: "sneha@technova.in", gender: "female", dob: "1994-07-28", doj: "2023-01-09", dept: "Design", desig: "UI/UX Designer", role: "employee", ctc: 1400000 },
    { code: "TN-006", first: "Arjun", last: "Nair", email: "arjun@technova.in", gender: "male", dob: "1991-12-10", doj: "2022-07-11", dept: "Engineering", desig: "DevOps Engineer", role: "employee", ctc: 1600000 },
    { code: "TN-007", first: "Meera", last: "Krishnan", email: "meera@technova.in", gender: "female", dob: "1993-04-05", doj: "2023-04-01", dept: "HR", desig: "HR Executive", role: "hr_manager", ctc: 1000000 },
    { code: "TN-008", first: "Karthik", last: "Iyer", email: "karthik@technova.in", gender: "male", dob: "1989-09-18", doj: "2021-06-01", dept: "Engineering", desig: "Architect", role: "employee", ctc: 3000000 },
    { code: "TN-009", first: "Divya", last: "Menon", email: "divya@technova.in", gender: "female", dob: "1996-01-25", doj: "2024-01-15", dept: "Marketing", desig: "Marketing Manager", role: "employee", ctc: 1100000 },
    { code: "TN-010", first: "Aditya", last: "Joshi", email: "aditya@technova.in", gender: "male", dob: "1997-06-30", doj: "2024-07-01", dept: "Engineering", desig: "Junior Developer", role: "employee", ctc: 700000 },
  ];

  const empIds: string[] = [];

  for (const emp of employees) {
    const empId = uuidv4();
    empIds.push(empId);

    await knex("employees").insert({
      id: empId,
      org_id: orgId,
      employee_code: emp.code,
      first_name: emp.first,
      last_name: emp.last,
      email: emp.email,
      phone: `+91 ${Math.floor(7000000000 + Math.random() * 2999999999)}`,
      date_of_birth: emp.dob,
      gender: emp.gender,
      date_of_joining: emp.doj,
      employment_type: "full_time",
      department: emp.dept,
      designation: emp.desig,
      reporting_manager_id: null,
      address: JSON.stringify({ line1: "Bengaluru, Karnataka", pincode: "560001" }),
      bank_details: JSON.stringify({
        accountNumber: `${Math.floor(10000000000 + Math.random() * 89999999999)}`,
        ifscCode: "SBIN0001234",
        bankName: "State Bank of India",
        branchName: "HSR Layout Branch",
      }),
      tax_info: JSON.stringify({
        pan: `ABCPD${1000 + employees.indexOf(emp)}E`,
        regime: emp.ctc > 1500000 ? "old" : "new",
        uan: `1001${Math.floor(1000000 + Math.random() * 9000000)}`,
      }),
      pf_details: JSON.stringify({
        pfNumber: `BGBNG/00123/000${employees.indexOf(emp) + 1}`,
        isOptedOut: false,
        contributionRate: 12,
      }),
      role: emp.role,
      password_hash: password,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Assign salary
    const annualBasic = Math.round(emp.ctc * 0.40);
    const monthlyBasic = Math.round(annualBasic / 12);
    const monthlyHRA = Math.round(monthlyBasic * 0.50);
    const monthlyEPF = Math.round(monthlyBasic * 0.12);
    const monthlyPT = 200;
    const monthlySA = Math.round(emp.ctc / 12 - monthlyBasic - monthlyHRA - monthlyEPF);

    const salaryComponents = [
      { code: "BASIC", monthlyAmount: monthlyBasic, annualAmount: monthlyBasic * 12 },
      { code: "HRA", monthlyAmount: monthlyHRA, annualAmount: monthlyHRA * 12 },
      { code: "SA", monthlyAmount: monthlySA, annualAmount: monthlySA * 12 },
    ];

    const grossMonthly = monthlyBasic + monthlyHRA + monthlySA;
    const grossAnnual = grossMonthly * 12;

    await knex("employee_salaries").insert({
      id: uuidv4(),
      employee_id: empId,
      structure_id: structureId,
      ctc: emp.ctc,
      gross_salary: grossAnnual,
      net_salary: grossAnnual - (monthlyEPF * 12) - (monthlyPT * 12),
      components: JSON.stringify(salaryComponents),
      effective_from: emp.doj,
      is_active: true,
      created_at: new Date(),
      updated_at: new Date(),
    });

    // Attendance for last 3 months
    const now = new Date();
    for (let m = 0; m < 3; m++) {
      const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
      const month = d.getMonth() + 1;
      const year = d.getFullYear();
      const totalDays = new Date(year, month, 0).getDate();
      const weekends = Math.floor(totalDays / 7) * 2;
      const holidays = 1;
      const workingDays = totalDays - weekends - holidays;
      const lopDays = Math.random() < 0.2 ? Math.floor(Math.random() * 3) : 0;

      await knex("attendance_summaries").insert({
        id: uuidv4(),
        employee_id: empId,
        month,
        year,
        total_days: totalDays,
        present_days: workingDays - lopDays,
        absent_days: lopDays,
        half_days: 0,
        paid_leave: 0,
        unpaid_leave: lopDays,
        holidays,
        weekoffs: weekends,
        lop_days: lopDays,
        overtime_hours: 0,
        created_at: new Date(),
        updated_at: new Date(),
      });
    }
  }

  // -----------------------------------------------------------------------
  // Payroll Run for last month
  // -----------------------------------------------------------------------
  const lastMonth = new Date();
  lastMonth.setMonth(lastMonth.getMonth() - 1);
  const runMonth = lastMonth.getMonth() + 1;
  const runYear = lastMonth.getFullYear();
  const monthNames = ["", "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December"];

  const runId = uuidv4();
  let totalGross = 0;
  let totalDeductions = 0;
  let totalNet = 0;

  await knex("payroll_runs").insert({
    id: runId,
    org_id: orgId,
    name: `${monthNames[runMonth]} ${runYear} Payroll`,
    month: runMonth,
    year: runYear,
    pay_date: `${runYear}-${String(runMonth).padStart(2, "0")}-28`,
    status: "paid",
    processed_by: empIds[0],
    approved_by: empIds[0],
    approved_at: new Date(),
    notes: "Regular monthly payroll",
    created_at: new Date(),
    updated_at: new Date(),
  });

  // Create payslips for all employees
  for (let i = 0; i < employees.length; i++) {
    const emp = employees[i];
    const empId = empIds[i];

    const monthlyBasic = Math.round(emp.ctc * 0.40 / 12);
    const monthlyHRA = Math.round(monthlyBasic * 0.50);
    const monthlyEPF = Math.round(Math.min(monthlyBasic, 15000) * 0.12);
    const monthlySA = Math.round(emp.ctc / 12 - monthlyBasic - monthlyHRA - monthlyEPF);
    const grossEarnings = monthlyBasic + monthlyHRA + monthlySA;
    const pt = 200;
    const netPay = grossEarnings - monthlyEPF - pt;

    totalGross += grossEarnings;
    totalDeductions += monthlyEPF + pt;
    totalNet += netPay;

    await knex("payslips").insert({
      id: uuidv4(),
      payroll_run_id: runId,
      employee_id: empId,
      month: runMonth,
      year: runYear,
      paid_days: 30,
      total_days: 30,
      lop_days: 0,
      earnings: JSON.stringify([
        { code: "BASIC", name: "Basic Salary", amount: monthlyBasic },
        { code: "HRA", name: "House Rent Allowance", amount: monthlyHRA },
        { code: "SA", name: "Special Allowance", amount: monthlySA },
      ]),
      deductions: JSON.stringify([
        { code: "EPF", name: "Employee PF", amount: monthlyEPF },
        { code: "PT", name: "Professional Tax", amount: pt },
      ]),
      employer_contributions: JSON.stringify([
        { code: "EPF_ER", name: "Employer PF", amount: monthlyEPF },
      ]),
      reimbursements: JSON.stringify([]),
      gross_earnings: grossEarnings,
      total_deductions: monthlyEPF + pt,
      net_pay: netPay,
      total_employer_cost: grossEarnings + monthlyEPF,
      status: "paid",
      created_at: new Date(),
      updated_at: new Date(),
    });
  }

  // Update run totals
  await knex("payroll_runs").where({ id: runId }).update({
    total_gross: totalGross,
    total_deductions: totalDeductions,
    total_net: totalNet,
    total_employer_contributions: totalDeductions,
    employee_count: employees.length,
  });

  console.log("✅ Seed data created:");
  console.log(`   Organization: TechNova Solutions (${orgId})`);
  console.log(`   Employees: ${employees.length}`);
  console.log(`   Salary Structure: Standard CTC Structure`);
  console.log(`   Payroll Run: ${monthNames[runMonth]} ${runYear} (paid)`);
  console.log(`   Login: ananya@technova.in / Welcome@123`);
}
