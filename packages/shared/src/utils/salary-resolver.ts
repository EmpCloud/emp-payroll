/**
 * Resolves a salary structure's component definitions into concrete monthly
 * amounts for a given annual CTC. Used by both the server (assignment, payroll)
 * and the client (salary preview UI) so the math stays in one place.
 *
 * Calculation types:
 *   - "fixed"      → monthly amount = value
 *   - "percentage" → monthly amount = (base × value) / 100, where base is
 *                    monthly equivalent of CTC / GROSS / <other component code>
 *   - "balance"    → monthly amount = (CTC/12) − sum(other earnings)
 *                    Exactly one earning may be marked as balance per structure.
 *   - "formula"    → not yet implemented; treated as fixed(value).
 *
 * Resolution order: fixed and percentage components are resolved first (in two
 * passes to allow percentage-of-percentage chains), then the balance row
 * absorbs the remainder of monthly gross.
 */

export type ResolverCalcType = "fixed" | "percentage" | "formula" | "balance";

export interface ResolverComponent {
  code: string;
  name?: string;
  type: "earning" | "deduction" | "reimbursement";
  calculationType: ResolverCalcType;
  value: number;
  percentageOf?: string;
}

export interface ResolvedComponent {
  code: string;
  name: string;
  monthlyAmount: number;
  annualAmount: number;
}

export interface ResolveOptions {
  /** Round each monthly amount to the nearest integer. Default: true. */
  round?: boolean;
}

export class SalaryResolverError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SalaryResolverError";
  }
}

/**
 * Validate a list of component definitions for a structure. Throws on invalid
 * configuration; safe to call from UI before saving.
 */
export function validateComponents(components: ResolverComponent[]): void {
  const balanceEarnings = components.filter(
    (c) => c.type === "earning" && c.calculationType === "balance",
  );
  if (balanceEarnings.length > 1) {
    throw new SalaryResolverError(
      "MULTIPLE_BALANCE",
      `Only one component may use Balance calculation; found ${balanceEarnings.length}.`,
    );
  }
  for (const c of components) {
    if (c.calculationType === "balance" && c.type !== "earning") {
      throw new SalaryResolverError(
        "BALANCE_NOT_EARNING",
        `Component "${c.code}" uses Balance but is not an earning.`,
      );
    }
    if (c.calculationType === "percentage") {
      if (!c.percentageOf) {
        throw new SalaryResolverError(
          "MISSING_PERCENTAGE_OF",
          `Component "${c.code}" is percentage-based but has no "% Of" reference.`,
        );
      }
      if (c.value < 0 || c.value > 100) {
        throw new SalaryResolverError(
          "PERCENTAGE_OUT_OF_RANGE",
          `Component "${c.code}" percentage must be between 0 and 100.`,
        );
      }
    }
  }
}

/**
 * Resolve component definitions into monthly amounts for a given annual CTC.
 * Only earnings are returned (deductions/reimbursements are computed elsewhere
 * during payroll). Throws if the structure is invalid or balance underflows.
 */
export function resolveSalaryComponents(
  components: ResolverComponent[],
  ctcAnnual: number,
  opts: ResolveOptions = {},
): ResolvedComponent[] {
  const round = opts.round !== false;
  if (!Number.isFinite(ctcAnnual) || ctcAnnual <= 0) {
    throw new SalaryResolverError("INVALID_CTC", "CTC must be a positive number.");
  }
  validateComponents(components);

  const monthlyCTC = ctcAnnual / 12;
  const earnings = components.filter((c) => c.type === "earning");
  const resolved = new Map<string, number>(); // code → monthly amount

  // Pass 1: percentages of CTC and fixed amounts.
  for (const c of earnings) {
    if (c.calculationType === "fixed" || c.calculationType === "formula") {
      resolved.set(c.code, c.value || 0);
    } else if (c.calculationType === "percentage") {
      const ref = (c.percentageOf || "").toUpperCase();
      if (ref === "CTC" || ref === "GROSS") {
        resolved.set(c.code, (monthlyCTC * c.value) / 100);
      }
    }
  }

  // Pass 2: percentages that reference another component (e.g. HRA = 50% of BASIC).
  // Loop until stable to allow chains. Bail after N iterations to detect cycles.
  for (let iter = 0; iter < earnings.length + 1; iter++) {
    let progressed = false;
    for (const c of earnings) {
      if (resolved.has(c.code)) continue;
      if (c.calculationType !== "percentage") continue;
      const ref = (c.percentageOf || "").toUpperCase();
      const baseMonthly = resolved.get(ref);
      if (baseMonthly !== undefined) {
        resolved.set(c.code, (baseMonthly * c.value) / 100);
        progressed = true;
      }
    }
    if (!progressed) break;
  }

  // Any unresolved non-balance earning is a bad reference (cycle or unknown code).
  const unresolved = earnings.filter(
    (c) => !resolved.has(c.code) && c.calculationType !== "balance",
  );
  if (unresolved.length) {
    throw new SalaryResolverError(
      "UNRESOLVED_REFERENCE",
      `Could not resolve component(s): ${unresolved
        .map((c) => `${c.code} (% Of "${c.percentageOf}")`)
        .join(", ")}. Check for missing or circular references.`,
    );
  }

  // Pass 3: balance row absorbs the remainder.
  const balanceRow = earnings.find((c) => c.calculationType === "balance");
  if (balanceRow) {
    const allocated = Array.from(resolved.values()).reduce((s, v) => s + v, 0);
    const remainder = monthlyCTC - allocated;
    if (remainder < 0) {
      throw new SalaryResolverError(
        "BALANCE_UNDERFLOW",
        `Components exceed CTC: allocated ${Math.round(allocated)}/month vs CTC ${Math.round(
          monthlyCTC,
        )}/month. Reduce other components or increase CTC.`,
      );
    }
    resolved.set(balanceRow.code, remainder);
  }

  // Preserve input order in the output.
  return earnings.map((c) => {
    const monthly = resolved.get(c.code) ?? 0;
    const monthlyAmount = round ? Math.round(monthly) : monthly;
    return {
      code: c.code,
      name: c.name || c.code,
      monthlyAmount,
      annualAmount: monthlyAmount * 12,
    };
  });
}
