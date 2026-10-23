import { describe, expect, it } from "vitest";
import { uaeProfileExample, uaeInputExample, uaeApiPaths } from "../uae-openapi";
import {
  uaeProfileSchema,
  uaePeriodInputSchema,
  uaeInputsSchema,
  uaePaymentSchema,
  uaeDateSchema,
  exportUaeWpsSchema,
  uaeScheduleSchema,
  uaeRevisionSchema,
  uaeUnlockSchema,
  uaeLiabilityQuerySchema,
} from "./uae-payroll";
import { UAE_BANK_FORMATS } from "../../services/uae/uae-bank-exports";

describe("UAE API boundary and documented examples", () => {
  it("keeps published examples valid against the actual request contracts", () => {
    expect(uaeProfileSchema.parse(uaeProfileExample)).toEqual(uaeProfileExample);
    expect(uaePeriodInputSchema.parse(uaeInputExample)).toEqual(uaeInputExample);
    expect(() => JSON.parse(JSON.stringify(uaeApiPaths))).not.toThrow();
  });
  it.each(["2026-02-30", "2026-13-01", "2026-1-01", "not a date"])(
    "rejects invalid calendar date %s",
    (date) => {
      expect(uaeDateSchema.safeParse(date).success).toBe(false);
    },
  );
  it.each([-1, 1.2, Infinity, Number.MAX_SAFE_INTEGER])(
    "rejects invalid salary amount %s",
    (basicSalary) => {
      expect(uaeProfileSchema.safeParse({ ...uaeProfileExample, basicSalary }).success).toBe(false);
    },
  );
  it("rejects unknown profile and period keys rather than accepting unimplemented legal overrides", () => {
    expect(uaeProfileSchema.safeParse({ ...uaeProfileExample, skipPension: true }).success).toBe(
      false,
    );
    expect(uaeInputsSchema.safeParse({ employee: { skipDeductionLimits: true } }).success).toBe(
      false,
    );
  });
  it("requires actual disbursement date and keeps accepted uploads from carrying paid money", () => {
    const body = { employeeId: "employee", reference: "BANK-123", paidAmount: 100, status: "paid" };
    expect(uaePaymentSchema.safeParse({ body }).success).toBe(false);
    expect(uaePaymentSchema.safeParse({ body: { ...body, paidOn: "2026-10-01" } }).success).toBe(
      true,
    );
    expect(uaePaymentSchema.safeParse({ body: { ...body, status: "accepted" } }).success).toBe(
      false,
    );
  });
  it("requires an explicit supported bank format and nine-digit routing code", () => {
    const body = {
      employerId: "1234567890123",
      employerRoutingCode: "123456789",
      bankFormat: "dib-v1.1",
    };
    expect(exportUaeWpsSchema.safeParse({ body }).success).toBe(true);
    expect(exportUaeWpsSchema.safeParse({ body: { ...body, bankFormat: "generic" } }).success).toBe(
      false,
    );
    expect(
      exportUaeWpsSchema.safeParse({ body: { ...body, employerRoutingCode: "123\n456789" } })
        .success,
    ).toBe(false);
  });
  it("accepts every advertised bank ID and rejects malformed EVP options or extra export keys", () => {
    const body = {
      employerId: "1234567890123",
      employerRoutingCode: "123456789",
      includeEvp: false,
    };
    for (const format of UAE_BANK_FORMATS) {
      expect(
        exportUaeWpsSchema.safeParse({ body: { ...body, bankFormat: format.id } }).success,
      ).toBe(true);
    }
    expect(UAE_BANK_FORMATS.find((format) => format.id === "hsbc-xlsx")?.available).toBe(false);
    expect(
      exportUaeWpsSchema.safeParse({
        body: { ...body, bankFormat: "dib-v1.1", includeEvp: "false" },
      }).success,
    ).toBe(false);
    expect(
      exportUaeWpsSchema.safeParse({
        body: { ...body, bankFormat: "dib-v1.1", skipValidation: true },
      }).success,
    ).toBe(false);
  });
  it("requires complete integer cutoff offsets in chronological order", () => {
    expect(
      uaeScheduleSchema.safeParse({ lockDaysBeforeDue: 5, approvalDaysBeforeDue: 3 }).success,
    ).toBe(true);
    expect(
      uaeScheduleSchema.safeParse({ lockDaysBeforeDue: 0, approvalDaysBeforeDue: 0 }).success,
    ).toBe(true);
    for (const invalid of [
      { lockDaysBeforeDue: 2, approvalDaysBeforeDue: 3 },
      { lockDaysBeforeDue: 5 },
      { lockDaysBeforeDue: 32, approvalDaysBeforeDue: 3 },
      { lockDaysBeforeDue: -1, approvalDaysBeforeDue: 0 },
      { lockDaysBeforeDue: 5.5, approvalDaysBeforeDue: 3 },
      { lockDaysBeforeDue: "5", approvalDaysBeforeDue: 3 },
    ])
      expect(uaeScheduleSchema.safeParse(invalid).success).toBe(false);
  });
  it("requires an explicit reviewed revision and unlock reason", () => {
    expect(uaeRevisionSchema.safeParse({ body: { expectedRevision: 2 } }).success).toBe(true);
    for (const expectedRevision of [0, -1, 1.5, "2", undefined]) {
      expect(uaeRevisionSchema.safeParse({ body: { expectedRevision } }).success).toBe(false);
    }
    expect(
      uaeUnlockSchema.safeParse({ body: { expectedRevision: 2, reason: "Correct salary inputs" } })
        .success,
    ).toBe(true);
    expect(uaeUnlockSchema.safeParse({ body: { expectedRevision: 2, reason: "" } }).success).toBe(
      false,
    );
  });
  it("coerces query month/year but rejects fractional or unsupported periods", () => {
    expect(uaeLiabilityQuerySchema.parse({ query: { month: "10", year: "2026" } }).query).toEqual({
      month: 10,
      year: 2026,
    });
    for (const query of [
      { month: "1.5", year: "2026" },
      { month: "13", year: "2026" },
      { month: "10", year: "2025" },
    ]) {
      expect(uaeLiabilityQuerySchema.safeParse({ query }).success).toBe(false);
    }
  });
});
