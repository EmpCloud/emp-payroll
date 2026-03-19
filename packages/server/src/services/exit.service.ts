import { v4 as uuid } from "uuid";
import { getDB } from "../db/adapters";
import { getEmpCloudDB, findUserById } from "../db/empcloud";

export interface InitiateExitInput {
  orgId: number;
  employeeId: number;
  exitType: "resignation" | "termination" | "retirement" | "end_of_contract" | "mutual_separation";
  resignationDate?: string;
  lastWorkingDate?: string;
  reason?: string;
  initiatedBy: number;
}

export async function initiateExit(input: InitiateExitInput) {
  const db = getDB();
  const id = uuid();

  await db.create("employee_exits", {
    id,
    org_id: input.orgId,
    employee_id: input.employeeId,
    exit_type: input.exitType,
    resignation_date: input.resignationDate || new Date().toISOString().slice(0, 10),
    last_working_date: input.lastWorkingDate || null,
    reason: input.reason || null,
    status: "initiated",
    initiated_by: input.initiatedBy,
  });

  return { id };
}

export async function listExits(orgId: number, status?: string) {
  const db = getDB();
  let query = `SELECT * FROM employee_exits WHERE org_id = ?`;
  const params: any[] = [orgId];

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }

  query += ` ORDER BY created_at DESC`;

  const result = await db.raw<any>(query, params);
  const exits = Array.isArray(result)
    ? Array.isArray(result[0])
      ? result[0]
      : result
    : result.rows || [];

  // Enrich with employee names from EmpCloud
  try {
    const ecDb = getEmpCloudDB();
    for (const exit of exits) {
      if (exit.employee_id) {
        const emp = await ecDb("users")
          .where({ id: Number(exit.employee_id) })
          .select("first_name", "last_name", "email", "emp_code", "designation", "department_id")
          .first();
        exit.employee_name = emp ? `${emp.first_name} ${emp.last_name}` : "Unknown";
        exit.employee_email = emp?.email || null;
        exit.employee_code = emp?.emp_code || null;
        exit.employee_designation = emp?.designation || null;
      }
    }
  } catch {
    // EmpCloud may not be available
  }

  return exits;
}

export async function getExit(id: string, orgId: number) {
  const db = getDB();
  const result = await db.raw<any>(`SELECT * FROM employee_exits WHERE id = ? AND org_id = ?`, [
    id,
    orgId,
  ]);
  const rows = Array.isArray(result)
    ? Array.isArray(result[0])
      ? result[0]
      : result
    : result.rows || [];
  const exit = rows[0] || null;

  if (exit) {
    try {
      const ecDb = getEmpCloudDB();
      const emp = await ecDb("users")
        .where({ id: Number(exit.employee_id) })
        .first();
      exit.employee_name = emp ? `${emp.first_name} ${emp.last_name}` : "Unknown";
      exit.employee_email = emp?.email || null;
      exit.employee_code = emp?.emp_code || null;
      exit.employee_designation = emp?.designation || null;
    } catch {
      // fallback
    }
  }

  return exit;
}

export async function updateExit(id: string, orgId: number, data: Record<string, any>) {
  const db = getDB();
  const updates: Record<string, any> = {};

  const allowed = [
    "status",
    "last_working_date",
    "exit_interview_notes",
    "reason",
    "notice_served",
    "handover_complete",
    "assets_returned",
    "access_revoked",
    "fnf_calculated",
    "fnf_paid",
    "experience_letter_issued",
    "relieving_letter_issued",
    "pending_salary",
    "leave_encashment",
    "gratuity",
    "bonus_due",
    "deductions",
    "fnf_total",
  ];

  for (const key of allowed) {
    if (data[key] !== undefined) {
      // Convert boolean fields
      if (typeof data[key] === "boolean") {
        updates[key] = data[key] ? 1 : 0;
      } else {
        updates[key] = data[key];
      }
    }
  }

  if (Object.keys(updates).length === 0) return false;
  updates.updated_at = new Date();

  const count = await db.updateMany("employee_exits", { id, org_id: orgId }, updates);

  // If status is "completed", deactivate the employee in EmpCloud
  if (data.status === "completed") {
    try {
      const exit = await getExit(id, orgId);
      if (exit) {
        const ecDb = getEmpCloudDB();
        await ecDb("users")
          .where({ id: Number(exit.employee_id) })
          .update({
            status: 0,
            date_of_exit: exit.last_working_date || new Date().toISOString().slice(0, 10),
            updated_at: new Date(),
          });
      }
    } catch {
      // non-critical
    }
  }

  return count > 0;
}

export async function calculateFnF(id: string, orgId: number) {
  const exit = await getExit(id, orgId);
  if (!exit) return null;

  const db = getDB();

  // Get employee salary
  const salaryResult = await db.raw<any>(
    `SELECT * FROM employee_salary_assignments WHERE empcloud_user_id = ? AND is_active = 1 LIMIT 1`,
    [exit.employee_id],
  );
  const salaryRows = Array.isArray(salaryResult)
    ? Array.isArray(salaryResult[0])
      ? salaryResult[0]
      : salaryResult
    : salaryResult.rows || [];
  const salary = salaryRows[0];

  if (!salary) {
    return {
      pending_salary: 0,
      leave_encashment: 0,
      gratuity: 0,
      bonus_due: 0,
      deductions: 0,
      fnf_total: 0,
    };
  }

  const monthlySalary = Number(salary.gross_salary) / 12;
  const dailySalary = monthlySalary / 30;

  // Pending salary (assume 15 days pending)
  const pendingSalary = Math.round(dailySalary * 15);

  // Leave encashment (check leave balance)
  let leaveBalance = 0;
  try {
    const lbResult = await db.raw<any>(
      `SELECT SUM(total - used) as balance FROM leave_balances WHERE employee_id = ? AND org_id = ?`,
      [exit.employee_id, orgId],
    );
    const lbRows = Array.isArray(lbResult)
      ? Array.isArray(lbResult[0])
        ? lbResult[0]
        : lbResult
      : lbResult.rows || [];
    leaveBalance = Number(lbRows[0]?.balance || 0);
  } catch {
    // table may not exist
  }
  const leaveEncashment = Math.round(dailySalary * Math.max(0, leaveBalance));

  // Gratuity (if > 5 years service)
  let gratuity = 0;
  try {
    const emp = await findUserById(exit.employee_id);
    if (emp?.date_of_joining) {
      const years = (Date.now() - new Date(emp.date_of_joining).getTime()) / (365.25 * 86400000);
      if (years >= 5) {
        const basicMonthly = monthlySalary * 0.4; // approximate basic
        gratuity = Math.round((15 * basicMonthly * Math.floor(years)) / 26);
      }
    }
  } catch {
    // non-critical
  }

  const fnf = {
    pending_salary: pendingSalary,
    leave_encashment: leaveEncashment,
    gratuity,
    bonus_due: 0,
    deductions: 0,
    fnf_total: pendingSalary + leaveEncashment + gratuity,
  };

  // Save to exit record
  await updateExit(id, orgId, { ...fnf, fnf_calculated: true, status: "fnf_pending" });

  return fnf;
}
