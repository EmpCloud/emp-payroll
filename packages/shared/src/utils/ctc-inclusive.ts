/** Split a monthly CTC budget into regular earnings and employer contributions. */
export function resolveCtcInclusiveComponents<
  T extends {
    code: string;
    type?: string;
    calculationType?: string;
    percentageOf?: string;
    monthlyAmount: number;
    annualAmount?: number;
  },
>(
  components: T[],
  monthlyCtc: number,
  employerCost: (components: T[], gross: number) => number,
  overrides: Record<string, number> = {},
  breakpoints: number[] = [],
) {
  if (!Number.isFinite(monthlyCtc) || monthlyCtc <= 0)
    throw new Error("CTC must be a positive amount before including employer contributions.");
  const regular = components.filter(
    (c) => (c.type === "earning" || !c.type) && !c.calculationType?.startsWith("per_"),
  );
  if (
    !regular.length ||
    regular.some((c) => !Number.isFinite(c.monthlyAmount) || c.monthlyAmount < 0)
  )
    throw new Error("CTC allocation requires valid regular earnings.");
  const flexible = regular.filter(
    (c) =>
      c.calculationType !== "fixed" &&
      c.calculationType !== "formula" &&
      !Object.prototype.hasOwnProperty.call(overrides, c.code),
  );
  const fixed = regular.filter((c) => !flexible.includes(c));
  const fixedTotal = fixed.reduce((sum, c) => sum + Number(c.monthlyAmount || 0), 0);
  const weight = flexible.reduce((sum, c) => sum + Number(c.monthlyAmount || 0), 0);
  const target = Math.round(monthlyCtc);
  const resolve = (gross: number) => {
    const result = components.map((c) => ({ ...c }));
    let allocated = 0;
    let cumulativeWeight = 0;
    flexible.forEach((c, index) => {
      cumulativeWeight += Number(c.monthlyAmount || 0);
      const amount =
        index === flexible.length - 1
          ? gross - fixedTotal - allocated
          : Math.round(((gross - fixedTotal) * cumulativeWeight) / weight) - allocated;
      const copy = result[components.indexOf(c)];
      copy.monthlyAmount = amount;
      copy.annualAmount = amount * 12;
      allocated += amount;
    });
    // Custom percentage deductions follow the reduced wage basis too. Repeat
    // for references to earlier deductions; fixed deductions stay unchanged.
    for (let pass = 0; pass < components.length; pass++) {
      result.forEach((copy, index) => {
        const original = components[index];
        if (copy.type !== "deduction" || copy.calculationType !== "percentage") return;
        const basis = (copy.percentageOf || "GROSS").toUpperCase();
        const grossBasis = basis === "CTC" || basis === "GROSS";
        const before = grossBasis
          ? fixedTotal + weight
          : Number(components.find((c) => c.code.toUpperCase() === basis)?.monthlyAmount || 0);
        const after = grossBasis
          ? gross
          : Number(result.find((c) => c.code.toUpperCase() === basis)?.monthlyAmount || 0);
        if (before > 0) {
          copy.monthlyAmount = Math.round((Number(original.monthlyAmount || 0) * after) / before);
          copy.annualAmount = copy.monthlyAmount * 12;
        }
      });
    }
    const cost = employerCost(result, gross);
    if (!Number.isFinite(cost) || cost < 0) throw new Error("Invalid employer contribution.");
    return {
      components: result,
      monthlyGross: gross,
      monthlyEmployerCost: cost,
      roundingAdjustment: target - gross - cost,
    };
  };
  // ESI eligibility creates a discontinuity; search each side separately.
  const boundaries = [
    Math.ceil(fixedTotal),
    ...breakpoints.map((p) => Math.floor(p) + 1).filter((p) => p > fixedTotal && p <= target),
    target + 1,
  ].sort((a, b) => a - b);
  if (fixedTotal <= target && weight > 0) {
    for (let index = boundaries.length - 2; index >= 0; index--) {
      let low = boundaries[index];
      let high = boundaries[index + 1] - 1;
      let best: ReturnType<typeof resolve> | undefined;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        const candidate = resolve(mid);
        if (candidate.roundingAdjustment >= 0) {
          best = candidate;
          low = mid + 1;
        } else high = mid - 1;
      }
      // Integer statutory rounding can skip a rupee. Never exceed the budget.
      if (best && best.roundingAdjustment <= 1) return best;
    }
  } else if (fixedTotal <= target && flexible.length === 0) {
    const result = resolve(fixedTotal);
    if (result.roundingAdjustment >= 0 && result.roundingAdjustment <= 1) return result;
  }
  throw new Error(
    "The fixed or pinned earnings and employer contributions do not fit within CTC. Increase CTC or adjust the salary structure.",
  );
}
