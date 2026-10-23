import { computeIndiaPF, type ComputeIndiaPFParams } from "@emp-payroll/shared";

interface PreviewComponent {
  code: string;
  type?: string;
  monthlyAmount: number;
}

export function computePFPreview(
  input: Pick<
    ComputeIndiaPFParams,
    "employeeId" | "year" | "month" | "pfDetails" | "orgOverrides" | "dateOfJoining" | "dateOfExit"
  > & { components: PreviewComponent[] },
) {
  const normalized = (code: string) => code.toUpperCase().replace(/[^A-Z]/g, "");
  const amount = (codes: string[]) =>
    input.components.reduce(
      (sum, component) =>
        sum +
        (component.type !== "deduction" && codes.includes(normalized(component.code))
          ? Number(component.monthlyAmount) || 0
          : 0),
      0,
    );
  const basicSalary = amount(["BASIC", "BASICPAY", "BASICSALARY"]);
  const daAmount = amount(["DA", "DEARNESSALLOWANCE"]);
  const retainingAllowance = amount(["RA", "RETAINING", "RETAININGALLOWANCE"]);
  const monthlyWages = basicSalary + daAmount + retainingAllowance;
  const templateAmount = (match: (code: string) => boolean) =>
    input.components.reduce(
      (sum, component) =>
        sum +
        (component.type === "deduction" && match(normalized(component.code))
          ? Number(component.monthlyAmount) || 0
          : 0),
      0,
    );
  const templateVPF = templateAmount((code) => code === "VPF");
  const details = input.pfDetails || {};
  const vpfRate =
    typeof details.vpfRate === "number"
      ? details.vpfRate
      : monthlyWages > 0
        ? (templateVPF / monthlyWages) * 100
        : 0;
  const days = new Date(Date.UTC(input.year, input.month, 0)).getUTCDate();
  const start = `${input.year}-${String(input.month).padStart(2, "0")}-01`;
  const end = `${input.year}-${String(input.month).padStart(2, "0")}-${days}`;
  const result = computeIndiaPF({
    ...input,
    basicSalary,
    daAmount,
    retainingAllowance,
    monthlyWages,
    contributionRate:
      details.contributionRate == null ? undefined : Number(details.contributionRate),
    isVoluntaryPF: vpfRate > 0,
    vpfRate,
    // Full-month wages keep their daily rate when membership or employment starts mid-month.
    wagePeriods: [{ startDate: start, endDate: end, wages: monthlyWages }],
  });
  const activeStart =
    input.dateOfJoining && input.dateOfJoining > start ? input.dateOfJoining : start;
  const activeEnd = input.dateOfExit && input.dateOfExit < end ? input.dateOfExit : end;
  const activeFraction =
    Math.max(0, (Date.parse(activeEnd) - Date.parse(activeStart)) / 86_400_000 + 1) / days;
  const templateEPF =
    templateAmount(
      (code) =>
        code.includes("EPF") || code === "PF" || code.startsWith("PFE") || code.startsWith("PFC"),
    ) * activeFraction;
  if (
    end >= "2026-09-17" &&
    !details.isOptedOut &&
    !details.exclusionReason &&
    result.isCovered &&
    Math.round(templateEPF) > result.employeeEPF
  ) {
    result.warnings.push(
      "The salary template has a higher PF deduction. Confirm the higher-wage contribution arrangement or record the additional amount as VPF before payroll.",
    );
  }
  return result;
}
