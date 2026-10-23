import { computeIndiaPF, type ComputeIndiaPFParams, type PFDetails } from "@emp-payroll/shared";
import { AppError } from "../../api/middleware/error.middleware";

const normalized = (code: unknown) =>
  String(code ?? "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
export function isEmployeePFCode(code: unknown): boolean {
  const value = normalized(code);
  return (
    value.includes("EPF") || value === "PF" || value.startsWith("PFE") || value.startsWith("PFC")
  );
}
export const isVPFCode = (code: unknown) => normalized(code) === "VPF";
const basicCodes = new Set(["BASIC", "BASICPAY", "BASICSALARY"]);
const daCodes = new Set(["DA", "DEARNESSALLOWANCE"]);
const retainingCodes = new Set(["RA", "RETAINING", "RETAININGALLOWANCE"]);

export function monthlyPFWages(components: any[]): number {
  return components.reduce(
    (sum, component) =>
      sum +
      (component.type !== "deduction" &&
      (basicCodes.has(normalized(component.code)) ||
        daCodes.has(normalized(component.code)) ||
        retainingCodes.has(normalized(component.code)))
        ? Number(component.monthlyAmount || 0)
        : 0),
    0,
  );
}

/** Use dated earned wages at the September boundary; aggregate LOP cannot locate them. */
export function computePayrollPF(input: {
  employeeId: string;
  month: number;
  year: number;
  components: any[];
  earnings: any[];
  pfDetails: Partial<PFDetails>;
  templateDeductions?: { code: string; amount: number }[];
  orgOverrides: ComputeIndiaPFParams["orgOverrides"];
  dateOfJoining?: string;
  dateOfExit?: string;
  hasDatedAttendance: boolean;
  lopByDate: Map<string, number>;
  unpaidDays: number;
}) {
  const { year, month, pfDetails } = input;
  const dateOfJoining = input.dateOfJoining?.slice(0, 10);
  const dateOfExit = input.dateOfExit?.slice(0, 10);
  const totalDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const end = `${year}-${String(month).padStart(2, "0")}-${totalDays}`;
  const activeStart = dateOfJoining && dateOfJoining > start ? dateOfJoining : start;
  const activeEnd = dateOfExit && dateOfExit < end ? dateOfExit : end;
  const monthlyWages = monthlyPFWages(input.components);
  const monthlyTemplateAmount = (match: (code: unknown) => boolean) =>
    input.components.reduce(
      (sum, component) =>
        sum +
        (component.type === "deduction" && match(component.code)
          ? Number(component.monthlyAmount || 0)
          : 0),
      0,
    );
  const templateVPF = monthlyTemplateAmount(isVPFCode);
  const profileVpfRate = typeof pfDetails.vpfRate === "number" ? pfDetails.vpfRate : undefined;
  const effectiveVpfRate =
    profileVpfRate ?? (monthlyWages > 0 ? (templateVPF / monthlyWages) * 100 : 0);
  const earned = (codes: Set<string>) =>
    input.earnings.reduce(
      (sum, line) => sum + (codes.has(normalized(line.code)) ? Number(line.amount || 0) : 0),
      0,
    );
  const params: ComputeIndiaPFParams = {
    employeeId: input.employeeId,
    month,
    year,
    basicSalary: earned(basicCodes),
    daAmount: earned(daCodes),
    retainingAllowance: earned(retainingCodes),
    monthlyWages,
    pfDetails,
    dateOfJoining,
    dateOfExit,
    orgOverrides: input.orgOverrides,
    isVoluntaryPF: effectiveVpfRate > 0,
    vpfRate: effectiveVpfRate,
  };
  if (
    !Number.isFinite(input.unpaidDays) ||
    input.unpaidDays < 0 ||
    input.unpaidDays > totalDays ||
    [...input.lopByDate.values()].some((loss) => !Number.isFinite(loss) || loss < 0 || loss > 1)
  ) {
    throw new AppError(
      409,
      "PF_ATTENDANCE_INVALID",
      "PF unpaid absence must be valid calendar-day fractions.",
    );
  }
  const initial = computeIndiaPF(params);
  if (initial.warnings.length) {
    throw new AppError(
      409,
      "PF_REVIEW_REQUIRED",
      `Employee ${input.employeeId}: ${initial.warnings.join(" ")}`,
    );
  }
  const membershipChangesThisMonth = [pfDetails.pfMembershipDate, pfDetails.epsMembershipDate].some(
    (date) => date != null && date.slice(0, 10) > activeStart && date.slice(0, 10) <= activeEnd,
  );
  if (
    initial.isCovered &&
    !input.hasDatedAttendance &&
    input.unpaidDays > 0 &&
    ((year === 2026 && month === 9) || membershipChangesThisMonth)
  ) {
    throw new AppError(
      409,
      "PF_DATED_ATTENDANCE_REQUIRED",
      `Employee ${input.employeeId}: dated attendance is required to allocate unpaid leave across the PF/EPS effective dates. Update attendance before computing payroll.`,
    );
  }
  if (input.hasDatedAttendance || input.unpaidDays === 0) {
    params.wagePeriods = [];
    for (let day = 1; day <= totalDays; day++) {
      const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (date < activeStart || date > activeEnd) continue;
      params.wagePeriods.push({
        startDate: date,
        endDate: date,
        wages: (monthlyWages / totalDays) * (1 - (input.lopByDate.get(date) ?? 0)),
      });
    }
  }
  const result = computeIndiaPF(params);
  const earnedWages =
    params.basicSalary + (params.daAmount ?? 0) + (params.retainingAllowance ?? 0);
  const templateEPF = input.templateDeductions
    ? input.templateDeductions.reduce(
        (sum, line) => sum + (isEmployeePFCode(line.code) ? Number(line.amount || 0) : 0),
        0,
      )
    : monthlyTemplateAmount(isEmployeePFCode) * (monthlyWages > 0 ? earnedWages / monthlyWages : 0);
  if (
    end >= "2026-09-17" &&
    !pfDetails.isOptedOut &&
    !pfDetails.exclusionReason &&
    result.isCovered &&
    Math.round(templateEPF) > result.employeeEPF
  ) {
    throw new AppError(
      409,
      "PF_REVIEW_REQUIRED",
      `Employee ${input.employeeId}: the salary template has a higher PF deduction than the statutory calculation. Confirm the existing higher-wage contribution arrangement or record the additional amount as VPF before processing payroll.`,
    );
  }
  // ECR NCP excludes days before membership and after exit. Fractions are kept
  // here for review by the exporter: EPFO requires whole days but publishes no
  // rounding rule authorising us to turn half-day absence into a full day.
  const pfMembershipDate = pfDetails.pfMembershipDate?.slice(0, 10);
  let memberStart =
    pfMembershipDate && pfMembershipDate > activeStart ? pfMembershipDate : activeStart;
  if (
    pfDetails.exclusionReason === "wage_ceiling" &&
    Number(pfDetails.membershipWages ?? monthlyWages) > 15000 &&
    Number(pfDetails.membershipWages ?? monthlyWages) <= 25000 &&
    memberStart < "2026-09-17"
  ) {
    memberStart = "2026-09-17";
  }
  result.ncpDays = !result.isCovered
    ? 0
    : input.hasDatedAttendance
      ? [...input.lopByDate].reduce(
          (sum, [date, loss]) => sum + (date >= memberStart && date <= activeEnd ? loss : 0),
          0,
        )
      : input.unpaidDays;
  return result;
}
