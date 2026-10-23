import { getIndiaPFDueDate, type PFContribution } from "@emp-payroll/shared";
import type { IDBAdapter } from "../db/adapters/interface";
import { findEmployeeProfileByUserId, findUserById } from "../db/empcloud";
import { AppError } from "../api/middleware/error.middleware";

function parseObject(value: unknown): Record<string, any> {
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/** Both EPFO downloads use the amounts and wage bases frozen during payroll computation. */
export async function generatePFECRFile(db: IDBAdapter, runId: string, orgId: string) {
  const run = await db.findOne<any>("payroll_runs", {
    id: runId,
    empcloud_org_id: Number(orgId),
  });
  if (!run) throw new AppError(404, "NOT_FOUND", "Payroll run not found");

  const { data: payslips } = await db.findMany<any>("payslips", {
    filters: { payroll_run_id: runId },
    limit: 10000,
  });
  const lines: string[] = [];
  const seenUans = new Set<string>();
  let adminChargesEnabled = false;
  let hasContributingMember = false;
  const summary = {
    employeeCount: 0,
    employeeContributions: 0,
    employerEPF: 0,
    employerEPS: 0,
    adminCharges: 0,
    adminChargesDue: 0,
    edliCharges: 0,
  };

  for (const ps of payslips) {
    const employeeId = String(ps.empcloud_user_id || ps.employee_id);
    if (ps.pf_contribution == null) {
      throw new AppError(
        409,
        "PF_SNAPSHOT_MISSING",
        `PF wage details are not recorded for employee ${employeeId}. Review this historical payroll before filing; recalculate only an authorized draft run to capture its PF details.`,
      );
    }
    const snapshot = parseObject(ps.pf_contribution);
    const amountFields = [
      "pfWages",
      "epsWages",
      "edliWages",
      "employeeEPF",
      "employeeVPF",
      "totalEmployee",
      "employerEPF",
      "employerEPS",
      "adminCharges",
      "edliCharges",
    ];
    if (
      typeof snapshot.isCovered !== "boolean" ||
      snapshot.month !== run.month ||
      snapshot.year !== run.year ||
      String(snapshot.employeeId) !== employeeId ||
      amountFields.some(
        (key) =>
          typeof snapshot[key] !== "number" || !Number.isFinite(snapshot[key]) || snapshot[key] < 0,
      ) ||
      Math.abs(snapshot.totalEmployee - snapshot.employeeEPF - snapshot.employeeVPF) > 0.01
    ) {
      throw new AppError(
        409,
        "PF_SNAPSHOT_INVALID",
        `Recorded PF details for employee ${employeeId} need review before filing.`,
      );
    }
    const pf = snapshot as unknown as PFContribution;
    adminChargesEnabled ||= snapshot.adminChargesEnabled === true || pf.adminCharges > 0;
    if (!pf.isCovered) continue;
    hasContributingMember ||= pf.pfWages > 0;

    let employee: any;
    let taxInfo: Record<string, any>;
    let pfDetails: Record<string, any>;
    let uan: string;
    if (ps.empcloud_user_id) {
      employee = await findUserById(Number(ps.empcloud_user_id));
      if (!employee || Number(employee.organization_id) !== Number(orgId)) {
        throw new AppError(
          409,
          "PF_EMPLOYEE_MISSING",
          `Employee ${employeeId} cannot be resolved in this organization for PF filing.`,
        );
      }
      const profile = await db.findOne<any>("employee_payroll_profiles", {
        empcloud_user_id: Number(ps.empcloud_user_id),
        empcloud_org_id: Number(orgId),
      });
      taxInfo = parseObject(profile?.tax_info);
      pfDetails = parseObject(profile?.pf_details);
      uan = String(taxInfo.uan || pfDetails.uan || "").trim();
      if (!uan) {
        const statutoryProfile = await findEmployeeProfileByUserId(Number(ps.empcloud_user_id));
        uan = String(statutoryProfile?.uan_number || "").trim();
      }
    } else {
      employee = await db.findOne<any>("employees", { id: ps.employee_id, org_id: run.org_id });
      if (!employee) {
        throw new AppError(
          409,
          "PF_EMPLOYEE_MISSING",
          `Employee ${employeeId} cannot be resolved in this organization for PF filing.`,
        );
      }
      taxInfo = parseObject(employee.tax_info);
      pfDetails = parseObject(employee.pf_details);
      uan = String(taxInfo.uan || pfDetails.uan || "").trim();
    }
    if (!/^\d{12}$/.test(uan)) {
      throw new AppError(
        409,
        "PF_UAN_INVALID",
        `Enter a valid 12-digit UAN for employee ${employeeId} before generating the PF return.`,
      );
    }
    if (seenUans.has(uan)) {
      throw new AppError(
        409,
        "PF_UAN_DUPLICATE",
        `UAN ${uan} appears more than once in this payroll. Correct the employee records before filing.`,
      );
    }
    seenUans.add(uan);
    const name = `${employee.first_name || ""} ${employee.last_name || ""}`.trim();
    if (!name || /[#\r\n]/.test(name)) {
      throw new AppError(
        409,
        "PF_EMPLOYEE_NAME_INVALID",
        `Correct the name for employee ${employeeId} before generating the PF return.`,
      );
    }
    const gross = Number(pf.grossWages ?? ps.gross_earnings);
    const ncp = Number(
      snapshot.ncpDays ?? ps.lop_days ?? Math.max(0, Number(ps.total_days) - Number(ps.paid_days)),
    );
    if (!Number.isFinite(gross) || gross < 0) {
      throw new AppError(
        409,
        "PF_PAYSLIP_INVALID",
        `Recorded gross wages for employee ${employeeId} need review before filing.`,
      );
    }
    const monthDays = new Date(run.year, run.month, 0).getDate();
    if (!Number.isInteger(ncp) || ncp < 0 || ncp > monthDays) {
      throw new AppError(
        409,
        "PF_NCP_DAYS_INVALID",
        `Employee ${employeeId}: EPFO ECR requires whole non-contributing days between 0 and ${monthDays}. Review the dated attendance and EPFO guidance before filing; fractional days cannot be rounded automatically.`,
      );
    }
    lines.push(
      [
        uan,
        name.toUpperCase(),
        Math.round(gross),
        Math.round(pf.pfWages),
        Math.round(pf.epsWages),
        Math.round(pf.edliWages),
        Math.round(pf.totalEmployee),
        Math.round(pf.employerEPS),
        Math.round(pf.employerEPF),
        ncp,
        0,
      ].join("#~#"),
    );
    summary.employeeCount++;
    summary.employeeContributions += pf.totalEmployee;
    summary.employerEPF += pf.employerEPF;
    summary.employerEPS += pf.employerEPS;
    summary.adminCharges += pf.adminCharges;
    summary.edliCharges += pf.edliCharges;
  }

  summary.adminChargesDue = adminChargesEnabled
    ? Math.max(summary.adminCharges, hasContributingMember ? 500 : 75)
    : 0;

  const month = [
    "",
    "JAN",
    "FEB",
    "MAR",
    "APR",
    "MAY",
    "JUN",
    "JUL",
    "AUG",
    "SEP",
    "OCT",
    "NOV",
    "DEC",
  ][run.month];
  return {
    filename: `PF-ECR-${month}-${run.year}.txt`,
    content: lines.join("\n"),
    dueDate: getIndiaPFDueDate(run.year, run.month),
    summary,
  };
}
