import {
  ESI_EMPLOYEE_RATE,
  ESI_EMPLOYER_RATE,
  ESI_WAGE_CEILING,
  resolveCtcInclusiveComponents,
} from "@emp-payroll/shared";
import { computePFPreview } from "./pf-preview";

type PFInput = Parameters<typeof computePFPreview>[0];

export function previewESI(gross: number, eligible: boolean, ceiling?: number | null) {
  const covered = eligible && gross <= (ceiling && ceiling > 0 ? ceiling : ESI_WAGE_CEILING);
  return {
    employee: covered ? Math.round((gross * ESI_EMPLOYEE_RATE) / 100) : 0,
    employer: covered ? Math.round((gross * ESI_EMPLOYER_RATE) / 100) : 0,
  };
}

export function allocateCtcPreview<
  T extends {
    code: string;
    type?: string;
    monthlyAmount: number;
    calculationType?: string;
    annualAmount?: number;
  },
>(
  components: T[],
  monthlyCtc: number,
  input: Omit<PFInput, "components" | "dateOfJoining" | "dateOfExit">,
  esiEligible: boolean,
  esiCeiling?: number | null,
  overrides: Record<string, number> = {},
) {
  return resolveCtcInclusiveComponents(
    components,
    monthlyCtc,
    (candidate, gross) =>
      computePFPreview({ ...input, components: candidate }).totalEmployer +
      previewESI(gross, esiEligible, esiCeiling).employer,
    overrides,
    [esiCeiling && esiCeiling > 0 ? esiCeiling : ESI_WAGE_CEILING],
  );
}
