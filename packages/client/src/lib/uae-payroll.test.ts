import { describe, expect, it } from "vitest";
import {
  aedToFils,
  filsToAed,
  uaeRequestError,
  assertUaeFormValues,
  uaeEvidenceAmount,
  uaeDownloadFilename,
  isUaeEmployeeForPeriod,
} from "./uae-payroll";

describe("UAE payroll form amounts", () => {
  it("converts decimal AED exactly without a floating point rounding loss", () => {
    expect(aedToFils("1000.29")).toBe(100029);
    expect(aedToFils("0.01")).toBe(1);
    expect(aedToFils("0")).toBe(0);
    expect(filsToAed(100029)).toBe("1000.29");
  });

  it.each(["", "-1", "NaN", "1e5", "1.999", "Infinity", "99999999999999999"])(
    "rejects invalid or unsafe amounts: %s",
    (value) => expect(() => aedToFils(value)).toThrow(),
  );

  it("surfaces API errors returned by authenticated document endpoints", async () => {
    const error = {
      response: {
        data: new Blob([JSON.stringify({ error: { message: "Run must be approved" } })]),
      },
    };
    expect(await uaeRequestError(error)).toBe("Run must be approved");
  });

  it("blocks invalid nested amounts and impossible dates before JSON can turn NaN into null", () => {
    expect(() =>
      assertUaeFormValues({
        employee: { finalSettlement: { approvedGratuity: { amount: NaN, reference: "review" } } },
      }),
    ).toThrow("approved gratuity");
    expect(() =>
      assertUaeFormValues({ finalSettlement: { terminationDate: "2026-02-30" } }),
    ).toThrow("valid date");
    expect(() =>
      assertUaeFormValues({
        finalSettlement: {
          terminationDate: "2028-02-29",
          approvedGratuity: { amount: 0, reference: "not eligible" },
        },
      }),
    ).not.toThrow();
  });

  it("prefills a refund with the actual prior payment, and never treats bank acceptance as paid", () => {
    expect(uaeEvidenceAmount("refunded", 500000, 300000)).toBe(300000);
    expect(uaeEvidenceAmount("paid", 500000, 300000)).toBe(500000);
    expect(uaeEvidenceAmount("accepted", 500000, 300000)).toBe(0);
    expect(uaeEvidenceAmount("submitted", 500000)).toBe(0);
  });

  it("preserves the bank-provided SIF filename and rejects path fragments", () => {
    expect(
      uaeDownloadFilename('attachment; filename="1234567890123202610231200.SIF"', "fallback.sif"),
    ).toBe("1234567890123202610231200.SIF");
    expect(uaeDownloadFilename('attachment; filename="../other.sif"', "fallback.sif")).toBe(
      "fallback.sif",
    );
  });

  it("keeps contractors and out-of-period employees out of UAE run input maps", () => {
    const employee = { status: "active", employment_type: "direct_hire", start_date: "2026-10-10" };
    expect(isUaeEmployeeForPeriod(employee, 10, 2026)).toBe(true);
    expect(isUaeEmployeeForPeriod({ ...employee, employment_type: "contractor" }, 10, 2026)).toBe(
      false,
    );
    expect(isUaeEmployeeForPeriod({ ...employee, start_date: "2026-11-01" }, 10, 2026)).toBe(false);
    expect(
      isUaeEmployeeForPeriod(
        { ...employee, start_date: "2025-01-01", end_date: "2026-09-30" },
        10,
        2026,
      ),
    ).toBe(false);
    expect(
      isUaeEmployeeForPeriod(
        { ...employee, status: "offboarding", end_date: "2026-10-31" },
        10,
        2026,
      ),
    ).toBe(true);
  });
});
