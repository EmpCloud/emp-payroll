import { describe, it, expect } from "vitest";
import {
  resolveSalaryComponents,
  validateComponents,
  SalaryResolverError,
  type ResolverComponent,
} from "@emp-payroll/shared";

const earning = (
  code: string,
  calc: ResolverComponent["calculationType"],
  value: number,
  percentageOf?: string,
): ResolverComponent => ({
  code,
  name: code,
  type: "earning",
  calculationType: calc,
  value,
  percentageOf,
});

describe("resolveSalaryComponents", () => {
  it("resolves Basic 40% / HRA 50% of Basic / SA balance for ₹12L CTC", () => {
    const result = resolveSalaryComponents(
      [
        earning("BASIC", "percentage", 40, "CTC"),
        earning("HRA", "percentage", 50, "BASIC"),
        earning("SA", "balance", 0),
      ],
      1_200_000,
    );
    const basic = result.find((c) => c.code === "BASIC")!;
    const hra = result.find((c) => c.code === "HRA")!;
    const sa = result.find((c) => c.code === "SA")!;
    expect(basic.monthlyAmount).toBe(40_000); // 100k * 40%
    expect(hra.monthlyAmount).toBe(20_000); // 40k * 50%
    expect(sa.monthlyAmount).toBe(40_000); // 100k - 40k - 20k
    const gross = result.reduce((s, c) => s + c.monthlyAmount, 0);
    expect(gross).toBe(100_000);
  });

  it("balance absorbs remainder when fixed conveyance + medical are present", () => {
    const result = resolveSalaryComponents(
      [
        earning("BASIC", "percentage", 40, "CTC"),
        earning("HRA", "percentage", 50, "BASIC"),
        earning("CONV", "fixed", 1_600),
        earning("MED", "fixed", 1_250),
        earning("SA", "balance", 0),
      ],
      600_000, // 50k/month
    );
    const sa = result.find((c) => c.code === "SA")!;
    // Basic 20k, HRA 10k, Conv 1600, Med 1250 → SA = 50000 - 32850 = 17150
    expect(sa.monthlyAmount).toBe(17_150);
  });

  it("rejects more than one balance row", () => {
    expect(() =>
      validateComponents([
        earning("BASIC", "percentage", 40, "CTC"),
        earning("SA", "balance", 0),
        earning("OTHER", "balance", 0),
      ]),
    ).toThrow(SalaryResolverError);
  });

  it("rejects balance on a deduction", () => {
    expect(() =>
      validateComponents([
        { ...earning("BASIC", "fixed", 10000), type: "earning" },
        { ...earning("WELFARE", "balance", 0), type: "deduction" },
      ]),
    ).toThrow(/balance/i);
  });

  it("throws BALANCE_UNDERFLOW when fixed components exceed CTC", () => {
    expect(() =>
      resolveSalaryComponents(
        [earning("BASIC", "fixed", 60_000), earning("SA", "balance", 0)],
        600_000, // 50k/month, but BASIC alone is 60k
      ),
    ).toThrow(/exceed CTC/i);
  });

  it("throws on percentage with missing percentageOf", () => {
    expect(() =>
      validateComponents([{ ...earning("HRA", "percentage", 50), percentageOf: undefined }]),
    ).toThrow(/% Of/);
  });

  it("throws on circular percentage reference", () => {
    expect(() =>
      resolveSalaryComponents(
        [earning("A", "percentage", 50, "B"), earning("B", "percentage", 50, "A")],
        1_200_000,
      ),
    ).toThrow(/circular|Could not resolve/i);
  });

  it("works without a balance row (pure declarative structure)", () => {
    const result = resolveSalaryComponents(
      [earning("BASIC", "percentage", 50, "CTC"), earning("HRA", "percentage", 40, "BASIC")],
      1_200_000,
    );
    expect(result.find((c) => c.code === "BASIC")!.monthlyAmount).toBe(50_000);
    expect(result.find((c) => c.code === "HRA")!.monthlyAmount).toBe(20_000);
  });

  it("ignores deductions in earnings sum (they're computed elsewhere)", () => {
    const result = resolveSalaryComponents(
      [
        earning("BASIC", "percentage", 40, "CTC"),
        earning("SA", "balance", 0),
        { ...earning("CANTEEN", "fixed", 500), type: "deduction" },
      ],
      1_200_000,
    );
    // Result should only contain earnings; SA balance absorbs gross - basic.
    expect(result.every((c) => c.code !== "CANTEEN")).toBe(true);
    expect(result.find((c) => c.code === "SA")!.monthlyAmount).toBe(60_000);
  });

  it("rejects non-positive CTC", () => {
    expect(() => resolveSalaryComponents([earning("BASIC", "fixed", 10000)], 0)).toThrow(/CTC/i);
    expect(() => resolveSalaryComponents([earning("BASIC", "fixed", 10000)], -1)).toThrow(/CTC/i);
  });
});
