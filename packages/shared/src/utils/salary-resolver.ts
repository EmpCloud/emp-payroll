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

export type ResolverCalcType =
  | "fixed"
  | "percentage"
  | "formula"
  | "balance"
  | "per_night"
  | "per_night_daily"
  | "per_night_pct"
  | "per_ot"
  | "per_ot_daily";

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
  type: "earning" | "deduction" | "reimbursement";
  monthlyAmount: number;
  annualAmount: number;
  // Carried through so the payroll engine (and the override redistribution
  // below) can recompute components: calculationType + percentageOf identify
  // which earnings are % of gross; rate carries the per-night/OT rate.
  calculationType?: ResolverCalcType;
  percentageOf?: string;
  rate?: number;
}

export interface ResolveOptions {
  /** Round each monthly amount to the nearest integer. Default: true. */
  round?: boolean;
  /**
   * Per-employee pinned component amounts (code → fixed monthly ₹). Pinned
   * components take the fixed amount; the remaining gross is redistributed
   * among the non-pinned "% of gross" earnings by their relative ratio, so
   * total gross stays exact. See applySalaryOverrides.
   */
  overrides?: Record<string, number>;
}

export class SalaryResolverError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "SalaryResolverError";
  }
}

export interface ResolverWarning {
  code: string;
  message: string;
  /** Component code the warning is about (when applicable). */
  component?: string;
}

/**
 * Soft post-resolution checks. These are advisory, not blocking --
 * the structure still resolves and saves, but the warning surfaces
 * on the API response so HR sees the issue immediately. Currently
 * checks two things HR commonly gets wrong:
 *
 *   - HRA basis: in Indian payroll convention HRA is typically 40-50%
 *     of BASIC (metro / non-metro). Configuring HRA as a % of CTC --
 *     a common mistake -- inflates HRA above Basic and reduces the
 *     tax-exempt portion (HRA exemption is capped at 50% of basic).
 *     Warn when resolved HRA > Basic.
 *
 *   - Components sum vs CTC: the per-component `monthlyAmount` should
 *     sum to roughly (CTC ÷ 12). When the sum is way off (e.g. 10×
 *     out because of a unit confusion at structure save time), all
 *     downstream payroll math goes wrong. Warn on a > 1 ₹/month gap.
 */
export function checkResolvedComponents(
  resolved: ResolvedComponent[],
  ctcAnnual: number,
): ResolverWarning[] {
  const warnings: ResolverWarning[] = [];
  const earnings = resolved.filter((c) => c.type === "earning");
  const basic = earnings.find((c) => c.code.toUpperCase() === "BASIC");
  const hra = earnings.find((c) => c.code.toUpperCase() === "HRA");
  if (basic && hra && hra.monthlyAmount > basic.monthlyAmount) {
    warnings.push({
      code: "HRA_EXCEEDS_BASIC",
      component: "HRA",
      message:
        `HRA (₹${Math.round(hra.monthlyAmount)}/month) is greater than Basic ` +
        `(₹${Math.round(basic.monthlyAmount)}/month). Standard Indian payroll convention is ` +
        `HRA = 40-50% of Basic; configuring HRA as a percent of CTC inflates it and reduces ` +
        `the tax-exempt portion (HRA exemption is capped at 50% of Basic for metro / 40% for ` +
        `non-metro). Consider re-basing HRA on Basic.`,
    });
  }
  const monthlyCTC = ctcAnnual / 12;
  const earningsSum = earnings.reduce((s, c) => s + c.monthlyAmount, 0);
  if (Math.abs(earningsSum - monthlyCTC) > 1 && monthlyCTC > 0) {
    warnings.push({
      code: "COMPONENTS_SUM_MISMATCH",
      message:
        `Component monthly amounts sum to ₹${Math.round(earningsSum)}, but CTC ÷ 12 = ` +
        `₹${Math.round(monthlyCTC)}. A gap this large usually means CTC was entered with the ` +
        `wrong unit (annual vs monthly) or a structure component is missing.`,
    });
  }
  return warnings;
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
 *
 * Returns BOTH earnings and deductions (and reimbursements) defined on the
 * structure. The original implementation filtered to earnings only --
 * deductions configured on the salary structure (e.g. canteen, welfare
 * fund, professional development levy) were silently dropped from the
 * output, which meant they were also missing from `employee_salaries.components`
 * when salary was assigned, and therefore never deducted in payroll
 * compute even though HR added them on the structure.
 *
 * Resolution rules:
 *   - earnings: as before -- fixed / percentage / balance, balance must
 *     be unique and absorbs the remainder of monthly CTC after fixed and
 *     percentage components are settled.
 *   - deductions / reimbursements: NEVER counted toward the gross-vs-CTC
 *     overflow check (they're not part of the CTC; they reduce / supplement
 *     the gross at payroll time). Resolved as:
 *       * fixed -> value as monthly amount
 *       * percentage of CTC / GROSS -> against monthly CTC
 *       * percentage of another component -> resolved after pass 2
 *     `balance` calc-type is rejected for non-earnings (validateComponents
 *     already checks this).
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
  const nonEarnings = components.filter((c) => c.type !== "earning");
  const resolved = new Map<string, number>(); // code → monthly amount

  // Pass 1: percentages of CTC and fixed amounts. Run for ALL components
  // (earnings AND non-earnings) so deductions like "12% of CTC" or fixed
  // ₹500 canteen charges resolve in the same pipeline.
  //
  // `per_night*` / `per_ot*` components materialize to 0 here -- they're
  // variable earnings paid at payroll time (rate × nights/OT-days, or
  // daily_salary × multiplier × nights/OT-days), so they don't contribute
  // to monthly gross or the CTC math. The rate / multiplier is preserved
  // on the output ResolvedComponent so the payroll engine can recompute
  // the actual amount per run.
  for (const c of components) {
    if (c.calculationType === "fixed" || c.calculationType === "formula") {
      resolved.set(c.code, c.value || 0);
    } else if (
      c.calculationType === "per_night" ||
      c.calculationType === "per_night_daily" ||
      c.calculationType === "per_night_pct" ||
      c.calculationType === "per_ot" ||
      c.calculationType === "per_ot_daily"
    ) {
      resolved.set(c.code, 0);
    } else if (c.calculationType === "percentage") {
      const ref = (c.percentageOf || "").toUpperCase();
      if (ref === "CTC" || ref === "GROSS") {
        resolved.set(c.code, (monthlyCTC * c.value) / 100);
      }
    }
  }

  // Pass 2: percentages that reference another component (e.g. HRA = 50%
  // of BASIC, or PF = 12% of BASIC). Loop until stable to allow chains
  // (deductions that reference earnings are common -- PF, ESI when stored
  // as structure components rather than computed by the statutory engine).
  for (let iter = 0; iter < components.length + 1; iter++) {
    let progressed = false;
    for (const c of components) {
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

  // Any unresolved non-balance component is a bad reference (cycle or
  // unknown code). Apply this check across earnings AND non-earnings now.
  const unresolved = components.filter(
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

  // Pass 3: balance row absorbs the remainder of monthly CTC. The
  // overflow check uses ONLY earnings -- deductions/reimbursements live
  // outside the gross-vs-CTC math. Without this distinction a structure
  // with a fixed ₹500/month canteen deduction + Basic 40% CTC would have
  // its 500 wrongly counted as "allocated" against the CTC.
  const balanceRow = earnings.find((c) => c.calculationType === "balance");
  const earningsAllocated = earnings.reduce((s, c) => s + (resolved.get(c.code) ?? 0), 0);
  if (earningsAllocated > monthlyCTC + 0.5) {
    throw new SalaryResolverError(
      "BALANCE_UNDERFLOW",
      `Components exceed CTC: allocated ${Math.round(earningsAllocated)}/month vs CTC ${Math.round(
        monthlyCTC,
      )}/month. Reduce other components or increase CTC.`,
    );
  }
  if (balanceRow) {
    resolved.set(balanceRow.code, monthlyCTC - earningsAllocated);
  }

  // Preserve input order in the output. Emit earnings first, then
  // deductions/reimbursements -- this matches what payroll.service expects
  // when iterating componentList (it branches on `type` per row anyway,
  // but earnings-first reads more naturally on the payslip).
  const orderedOutput = [...earnings, ...nonEarnings];
  const result = orderedOutput.map((c) => {
    const monthly = resolved.get(c.code) ?? 0;
    const monthlyAmount = round ? Math.round(monthly) : monthly;
    const out: ResolvedComponent = {
      code: c.code,
      name: c.name || c.code,
      type: c.type,
      monthlyAmount,
      annualAmount: monthlyAmount * 12,
      // Carry the calc metadata on every row so override redistribution and
      // the payroll engine can tell which earnings are "% of gross".
      calculationType: c.calculationType,
      percentageOf: c.percentageOf,
    };
    // For the *_daily variants the `rate` field carries the multiplier
    // (e.g. 2 for double-pay); for per_night/per_ot it's the flat rate.
    if (
      c.calculationType === "per_night" ||
      c.calculationType === "per_night_daily" ||
      c.calculationType === "per_night_pct" ||
      c.calculationType === "per_ot" ||
      c.calculationType === "per_ot_daily"
    ) {
      out.rate = c.value || 0;
    }
    return out;
  });

  // Per-employee overrides: pin the given components and redistribute the
  // remaining gross across the non-pinned "% of gross" earnings.
  if (opts.overrides && Object.keys(opts.overrides).length) {
    applySalaryOverrides(result, monthlyCTC, opts.overrides);
  }
  return result;
}

const DYNAMIC_CALC = new Set([
  "per_night",
  "per_night_daily",
  "per_night_pct",
  "per_ot",
  "per_ot_daily",
]);

/**
 * Earnings that FLEX to keep gross exact when other components are pinned —
 * any earning that isn't a hard `fixed` amount or a variable per-night/OT rate.
 * This covers % of gross, % of another component, and `balance` alike, so
 * redistribution works no matter how the structure defines HRA / Special
 * Allowance (a component doesn't have to be "% of gross" to absorb the change).
 */
function isRedistributableEarning(c: { type: string; calculationType?: string }): boolean {
  return (
    c.type === "earning" &&
    c.calculationType !== "fixed" &&
    !DYNAMIC_CALC.has(c.calculationType || "")
  );
}

/**
 * Apply per-employee pinned amounts to resolved components (mutates in place).
 *
 * Pinned components take their fixed monthly amount; the remaining gross (gross
 * minus every non-redistributable earning — pins + fixed earnings) is split
 * across the non-pinned "% of gross" earnings by their ORIGINAL ratio, so total
 * earnings still equal gross exactly. Deductions / reimbursements / dynamic
 * (per-night/OT) earnings are untouched.
 *
 * e.g. gross 50,000, Basic 60% / HRA 24% / SA 11% / Conv 5%, override
 * { BASIC: 40000 } → HRA 6,000, SA 2,750, Conv 1,250 (sum 50,000).
 */
export function applySalaryOverrides<
  T extends {
    code: string;
    type: string;
    calculationType?: string;
    percentageOf?: string;
    monthlyAmount: number;
    annualAmount?: number;
  },
>(components: T[], grossMonthly: number, overrides: Record<string, number>): T[] {
  const keys = Object.keys(overrides || {});
  if (!keys.length) return components;

  const original = new Map(components.map((c) => [c.code, c.monthlyAmount]));
  const pinned = new Set(keys);

  for (const c of components) {
    if (pinned.has(c.code)) c.monthlyAmount = Math.max(0, Math.round(overrides[c.code] || 0));
  }

  const redistributable = components.filter(
    (c) => !pinned.has(c.code) && isRedistributableEarning(c),
  );
  const consumed = components
    .filter((c) => c.type === "earning" && !redistributable.includes(c))
    .reduce((s, c) => s + c.monthlyAmount, 0);
  const remaining = grossMonthly - consumed;
  const totalWeight = redistributable.reduce((s, c) => s + (original.get(c.code) || 0), 0);

  if (redistributable.length && totalWeight > 0 && remaining >= 0) {
    let allocated = 0;
    redistributable.forEach((c, i) => {
      if (i === redistributable.length - 1) {
        c.monthlyAmount = Math.round(remaining - allocated); // last row absorbs rounding
      } else {
        const amt = Math.round((remaining * (original.get(c.code) || 0)) / totalWeight);
        c.monthlyAmount = amt;
        allocated += amt;
      }
    });
  }

  for (const c of components) {
    if (c.annualAmount !== undefined) c.annualAmount = c.monthlyAmount * 12;
  }
  return components;
}

/**
 * Validate per-employee overrides against a structure's resolved components.
 * Throws SalaryResolverError. Pinned codes must exist as earnings, amounts must
 * be non-negative, pins + fixed earnings must not exceed gross, and if there's
 * no "% of gross" earning left to absorb the balance they must equal gross.
 */
export function validateOverrides(
  resolved: ResolvedComponent[],
  grossMonthly: number,
  overrides: Record<string, number>,
): void {
  const keys = Object.keys(overrides || {});
  if (!keys.length) return;
  const byCode = new Map(resolved.map((c) => [c.code, c]));

  let pinnedSum = 0;
  for (const code of keys) {
    const c = byCode.get(code);
    if (!c)
      throw new SalaryResolverError(
        "UNKNOWN_OVERRIDE",
        `Override references unknown component "${code}".`,
      );
    if (c.type !== "earning")
      throw new SalaryResolverError(
        "OVERRIDE_NOT_EARNING",
        `Only earnings can be pinned; "${code}" is a ${c.type}.`,
      );
    const amt = Number(overrides[code]);
    if (!Number.isFinite(amt) || amt < 0)
      throw new SalaryResolverError(
        "OVERRIDE_NEGATIVE",
        `Override for "${code}" must be a non-negative number.`,
      );
    pinnedSum += amt;
  }

  const dynamic = new Set([
    "per_night",
    "per_night_daily",
    "per_night_pct",
    "per_ot",
    "per_ot_daily",
  ]);
  const fixedSum = resolved
    .filter(
      (c) =>
        c.type === "earning" &&
        !keys.includes(c.code) &&
        !isRedistributableEarning(c) &&
        !dynamic.has(c.calculationType || ""),
    )
    .reduce((s, c) => s + c.monthlyAmount, 0);
  const hasRedistributable = resolved.some(
    (c) => !keys.includes(c.code) && isRedistributableEarning(c),
  );

  if (pinnedSum + fixedSum > grossMonthly + 1) {
    throw new SalaryResolverError(
      "OVERRIDE_EXCEEDS_GROSS",
      `Pinned amounts (₹${Math.round(pinnedSum)}) plus fixed earnings exceed monthly gross (₹${Math.round(grossMonthly)}).`,
    );
  }
  if (!hasRedistributable && Math.abs(pinnedSum + fixedSum - grossMonthly) > 1) {
    throw new SalaryResolverError(
      "OVERRIDE_SUM_MISMATCH",
      `No "% of gross" earning left to absorb the balance, so pinned + fixed earnings must equal gross (₹${Math.round(grossMonthly)}); got ₹${Math.round(pinnedSum + fixedSum)}.`,
    );
  }
}
