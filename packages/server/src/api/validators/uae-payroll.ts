import { z } from "zod";
import { UAE_BANK_FORMAT_IDS } from "../../services/uae/uae-bank-exports";

const money = z.number().int().min(0).max(1_000_000_000_000);
const reference = z.string().trim().min(1).max(500);
export const uaeDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, "Use a valid calendar date (YYYY-MM-DD)");
const approvedAmount = z.object({ amount: money, reference }).strict();
const period = {
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020).max(2100),
};

export const uaeProfileSchema = z
  .object({
    jurisdiction: z.enum(["federal", "difc", "adgm"]),
    effectiveFrom: uaeDateSchema,
    nationality: z.string().regex(/^[A-Z]{2}$/),
    basicSalary: money.positive(),
    allowances: z.array(z.object({ name: reference, amount: money }).strict()).max(50),
    normalDailyHours: z.number().positive().max(12),
    workPattern: z.enum(["full_time", "part_time", "temporary", "domestic"]).optional(),
    isShiftWorker: z.boolean().optional(),
    probationEndsOn: uaeDateSchema.nullable().optional(),
    pension: z
      .object({
        scheme: z.enum(["none", "gpssa_old", "gpssa_new", "adpf_old", "adpf_new", "sssf", "gcc"]),
        sector: z.enum(["private", "government"]).optional(),
        firstInsuredOn: uaeDateSchema.optional(),
        contributionSalary: money.optional(),
        salaryYear: period.year.optional(),
        authorityReference: reference.optional(),
        gcc: z
          .object({
            employeeRate: z.number().min(0).max(100),
            employerRate: z.number().min(0).max(100),
            governmentRate: z.number().min(0).max(100).optional(),
            minimumSalary: money,
            maximumSalary: money,
            effectiveFrom: uaeDateSchema,
            effectiveTo: uaeDateSchema.optional(),
            reference,
          })
          .strict()
          .optional(),
        approvedPeriodAmounts: z
          .object({ employee: money, employer: money, government: money, reference, ...period })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
    iloe: z
      .object({
        mode: z.enum(["employee_paid", "employer_collected", "exempt"]),
        exemptionReason: reference.optional(),
        policyReference: reference.optional(),
        policyStartsOn: uaeDateSchema.optional(),
        policyMonths: z.union([z.literal(12), z.literal(24)]).optional(),
        paymentFrequency: z
          .enum(["monthly", "quarterly", "semi_annually", "annually", "in_full"])
          .optional(),
      })
      .strict(),
    healthInsuranceEmployer: money,
    savings: z
      .object({
        scheme: z.enum(["gratuity", "federal_savings", "dews", "alternative"]),
        enrolledOn: uaeDateSchema.optional(),
        continuousServiceStartDate: uaeDateSchema.optional(),
        frozenGratuity: approvedAmount.extend({ asOf: uaeDateSchema }).optional(),
        approvedMonthlyContribution: approvedAmount.optional(),
        exemptionReference: reference.optional(),
      })
      .strict(),
    wps: z
      .object({
        employeeId: z.string().max(35).optional(),
        routingCode: z.string().max(9).optional(),
        accountNumber: z.string().max(35).optional(),
        exemption: z.object({ reason: reference, reference }).strict().optional(),
      })
      .strict(),
    salaryPaymentDay: z.number().int().min(1).max(31).optional(),
    gratuityHistory: z
      .object({
        asOf: uaeDateSchema,
        cumulativeUnpaidServiceDays: z.number().min(0).max(36500),
        settlementsPaid: money,
        reference,
        annualWage: approvedAmount.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const uaePeriodInputSchema = z
  .object({
    unpaidDays: z.number().min(0).max(31).optional(),
    leaves: z
      .array(
        z
          .object({
            kind: z.enum([
              "annual",
              "sick",
              "maternity",
              "parental",
              "bereavement_spouse",
              "bereavement_family",
              "study",
              "unpaid",
            ]),
            days: z.number().min(0).max(31),
            usedToDate: z.number().min(0).max(366).optional(),
            entitlementReference: reference.optional(),
          })
          .strict(),
      )
      .max(31)
      .optional(),
    overtime: z
      .object({
        ordinaryHours: z.number().min(0).max(744).optional(),
        nightHours: z.number().min(0).max(744).optional(),
        restDays: z.number().min(0).max(31).optional(),
        publicHolidayDays: z.number().min(0).max(31).optional(),
        compensatedRestDays: z.number().min(0).max(31).optional(),
        compensatedPublicHolidayDays: z.number().min(0).max(31).optional(),
        approvedScheduleReference: reference.optional(),
      })
      .strict()
      .optional(),
    variableEarnings: z
      .array(
        z
          .object({
            name: reference,
            amount: money,
            kind: z.enum(["earning", "reimbursement"]).optional(),
            wpsCategory: z
              .enum([
                "housing",
                "conveyance",
                "medical",
                "annualPassage",
                "overtime",
                "other",
                "leaveEncashment",
              ])
              .optional(),
          })
          .strict()
          .refine(
            (line) => line.kind !== "reimbursement" || !line.wpsCategory,
            "Reimbursements cannot be classified as EVP wages",
          ),
      )
      .max(100)
      .optional(),
    deductions: z
      .array(
        approvedAmount.extend({
          name: reference,
          kind: z.enum([
            "loan",
            "overpayment",
            "disciplinary",
            "court",
            "maintenance",
            "damage",
            "voluntary",
          ]),
          consent: z.boolean().optional(),
          courtOrder: z.boolean().optional(),
        }),
      )
      .max(100)
      .optional(),
    iloeCollection: approvedAmount
      .extend({
        premium: money,
        vat: money,
        coverageMonths: z.number().int().min(1).max(24),
        dueOn: uaeDateSchema,
      })
      .optional(),
    approvedAdjustments: z
      .object({
        regularSalary: approvedAmount.optional(),
        leaveDeduction: approvedAmount.optional(),
        overtimePay: approvedAmount.optional(),
        deductionLimit: approvedAmount.optional(),
      })
      .strict()
      .optional(),
    finalSettlement: z
      .object({
        terminationDate: uaeDateSchema,
        unpaidServiceDays: z.number().min(0).max(36500),
        unusedAnnualLeaveDays: z.number().min(0).max(365).optional(),
        noticePayDays: z.number().min(0).max(90).optional(),
        noticePayDirection: z.enum(["employer_pays", "employee_owes"]).optional(),
        gratuityAlreadyPaid: money.optional(),
        approvedGratuity: approvedAmount.optional(),
        approvedLeaveEncashment: approvedAmount.optional(),
        approvedNoticePay: approvedAmount.optional(),
        annualWage: approvedAmount.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const uaeInputsSchema = z.record(z.string().min(1).max(100), uaePeriodInputSchema);
export const uaeEmployerSchema = z
  .object({
    name: reference,
    address: z.string().max(1000).optional(),
    registrationNumber: z.string().max(100).optional(),
  })
  .strict();
export const uaeScheduleSchema = z
  .object({
    lockDaysBeforeDue: z.number().int().min(0).max(31),
    approvalDaysBeforeDue: z.number().int().min(0).max(31),
  })
  .strict()
  .refine(
    (s) => s.lockDaysBeforeDue >= s.approvalDaysBeforeDue,
    "Lock payroll on or before its approval cutoff",
  );
export const recalculateUaeSchema = z.object({
  body: z
    .object({
      uaeInputs: uaeInputsSchema,
      uaeSchedule: uaeScheduleSchema.optional(),
      expectedRevision: z.number().int().positive(),
    })
    .strict(),
});
export const uaeRevisionSchema = z.object({
  body: z.object({ expectedRevision: z.number().int().positive() }).strict(),
});
export const uaeUnlockSchema = z.object({
  body: z.object({ expectedRevision: z.number().int().positive(), reason: reference }).strict(),
});
export const uaeLiabilityQuerySchema = z.object({
  query: z.object({
    month: z.coerce.number().int().min(1).max(12),
    year: z.coerce.number().int().min(2026).max(2100),
  }),
});
export const uaeExitSchema = z.object({
  body: z
    .object({
      globalEmployeeId: z.string().min(1).max(100),
      uaeInput: uaePeriodInputSchema.refine(
        (input) => !!input.finalSettlement,
        "Final settlement inputs are required",
      ),
    })
    .strict(),
});
export const exportUaeWpsSchema = z.object({
  body: z
    .object({
      employerId: z.string().min(1).max(35),
      employerRoutingCode: z.string().regex(/^\d{9}$/),
      reference: z.string().max(100).optional(),
      bankFormat: z.enum(UAE_BANK_FORMAT_IDS),
      includeEvp: z.boolean().optional(),
    })
    .strict(),
});
export const uaePaymentSchema = z.object({
  body: z
    .object({
      employeeId: z.string().min(1).max(100),
      status: z.enum(["submitted", "accepted", "rejected", "paid", "refunded"]),
      reference,
      paidAmount: money,
      paidOn: uaeDateSchema.optional(),
    })
    .strict()
    .superRefine((value, ctx) => {
      if (["paid", "refunded"].includes(value.status) && !value.paidOn)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paidOn"],
          message: "Actual payment or refund date is required for bank evidence",
        });
      if (!["paid", "refunded"].includes(value.status) && value.paidAmount !== 0)
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["paidAmount"],
          message: "Only disbursement or refund evidence can carry a paid amount",
        });
    }),
});
