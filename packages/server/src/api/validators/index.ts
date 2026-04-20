import { z } from "zod";
import { Request, Response, NextFunction } from "express";
import { AppError } from "../middleware/error.middleware";

// ---------------------------------------------------------------------------
// Validation middleware factory
// ---------------------------------------------------------------------------
export function validate(schema: z.ZodObject<any> | z.ZodEffects<any>) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const result = schema.safeParse({
      body: req.body,
      query: req.query,
      params: req.params,
    });

    if (!result.success) {
      const details: Record<string, string[]> = {};
      for (const issue of result.error.issues) {
        const path = issue.path.join(".");
        if (!details[path]) details[path] = [];
        details[path].push(issue.message);
      }
      return next(new AppError(400, "VALIDATION_ERROR", "Request validation failed", details));
    }
    next();
  };
}

// ---------------------------------------------------------------------------
// Shared field schemas — defined here so they're in scope for every other
// schema further down in the file. ES `const` is not hoisted, so order
// matters: defining these below would fail at module load time.
// ---------------------------------------------------------------------------

// Person name (first / last) — letters (inc. accented / i18n), spaces,
// apostrophes, hyphens, periods. Rejects digits and other symbols. (#11)
const personNameRegex = /^[\p{L}\s.'-]+$/u;
const firstNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(personNameRegex, "First name must not contain numbers or special characters");
const lastNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(personNameRegex, "Last name must not contain numbers or special characters");

// Phone — digits, +, spaces, hyphens, parentheses. Rejects alphabets. (#11)
// Must start with a digit or + so leading letters / whitespace don't pass.
const phoneRegex = /^[+\d][\d\s()-]{0,19}$/;
const phoneSchema = z
  .string()
  .max(20)
  .regex(phoneRegex, "Phone must only contain digits, spaces, and + - ( )");

// ---------------------------------------------------------------------------
// Auth Schemas
// ---------------------------------------------------------------------------
export const loginSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(6),
  }),
});

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    firstName: firstNameSchema,
    lastName: lastNameSchema,
    orgId: z.string().uuid().optional(),
  }),
});

// ---------------------------------------------------------------------------
// Employee Schemas
// ---------------------------------------------------------------------------
// DOB must be a valid date strictly in the past (not today, not future).
const pastDateOfBirth = z
  .string()
  .min(1, "Date of birth is required")
  .refine(
    (v) => {
      const d = new Date(v);
      if (Number.isNaN(d.getTime())) return false;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      d.setHours(0, 0, 0, 0);
      return d.getTime() < today.getTime();
    },
    { message: "Date of birth must be in the past" },
  );

// Bank name: letters, spaces, periods, commas, hyphens, ampersands.
// Accented/Unicode letters are allowed (i18n bank names). Pure numeric or
// any embedded digit is rejected.
const bankNameRegex = /^[\p{L}\s.,&-]+$/u;
const bankNameSchema = z
  .string()
  .min(1, "Bank name is required")
  .max(100)
  .regex(bankNameRegex, "Bank name must only contain letters, spaces, and . , & -");

export const createEmployeeSchema = z.object({
  body: z.object({
    employeeCode: z.string().min(1).max(50).optional(),
    firstName: firstNameSchema,
    lastName: lastNameSchema,
    email: z.string().email(),
    phone: phoneSchema.optional(),
    dateOfBirth: pastDateOfBirth,
    gender: z.enum(["male", "female", "other"]),
    dateOfJoining: z.string(),
    employmentType: z.enum(["full_time", "part_time", "contract", "intern"]).default("full_time"),
    department: z.string().min(1).max(100),
    designation: z.string().min(1).max(100),
    reportingManagerId: z.string().uuid().optional(),
    bankDetails: z
      .object({
        accountNumber: z.string(),
        ifscCode: z.string(),
        bankName: bankNameSchema,
        branchName: z.string().optional(),
      })
      .optional(),
    taxInfo: z
      .object({
        pan: z.string().min(1).max(10),
        regime: z.enum(["old", "new"]).default("new"),
        uan: z.string().optional(),
      })
      .optional(),
    pfDetails: z
      .object({
        pfNumber: z.string().optional(),
        isOptedOut: z.boolean().default(false),
        contributionRate: z.number().default(12),
      })
      .optional(),
  }),
});

export const updateBankDetailsSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    bankName: bankNameSchema,
    accountNumber: z.string().min(1).max(50),
    ifscCode: z.string().min(1).max(20),
    accountType: z.enum(["savings", "current", "salary"]).optional(),
    branchName: z.string().max(100).optional(),
  }),
});

// Same body as updateBankDetailsSchema but without the :id param — used by
// the self-service route where the user is always operating on their own
// profile. Having a dedicated schema lets the self-service route enforce
// the same bank-name regex check that the HR route does.
export const selfUpdateBankDetailsSchema = z.object({
  body: z.object({
    bankName: bankNameSchema,
    accountNumber: z.string().min(1).max(50),
    ifscCode: z.string().min(1).max(20),
    accountType: z.enum(["savings", "current", "salary"]).optional(),
    branchName: z.string().max(100).optional(),
  }),
});

// Employee-submitted change request. currentDetails is read-only context;
// only requestedDetails needs strict validation since that's what would be
// applied if approved.
export const bankUpdateRequestSchema = z.object({
  body: z.object({
    currentDetails: z
      .object({
        bankName: z.string().optional(),
        accountNumber: z.string().optional(),
        ifscCode: z.string().optional(),
      })
      .optional(),
    requestedDetails: z.object({
      bankName: bankNameSchema,
      accountNumber: z.string().min(1).max(50),
      ifscCode: z.string().min(1).max(20),
      accountType: z.enum(["savings", "current", "salary"]).optional(),
      branchName: z.string().max(100).optional(),
    }),
    reason: z.string().max(500).optional(),
  }),
});

export const updateEmployeeSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    firstName: firstNameSchema.optional(),
    lastName: lastNameSchema.optional(),
    phone: phoneSchema.optional(),
    department: z.string().max(100).optional(),
    designation: z.string().max(100).optional(),
    reportingManagerId: z.string().uuid().nullable().optional(),
    address: z.record(z.any()).optional(),
  }),
});

// ---------------------------------------------------------------------------
// Salary Structure Schemas
// ---------------------------------------------------------------------------
export const createSalaryStructureSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(100),
    description: z.string().optional(),
    isDefault: z.boolean().default(false),
    components: z
      .array(
        z.object({
          name: z.string().min(1),
          code: z.string().min(1).max(20),
          type: z.enum(["earning", "deduction", "reimbursement", "benefit"]),
          calculationType: z.enum(["fixed", "percentage", "formula"]),
          value: z.number().default(0),
          percentageOf: z.string().optional(),
          formula: z.string().optional(),
          isTaxable: z.boolean().default(true),
          isStatutory: z.boolean().default(false),
          isProratable: z.boolean().default(true),
          sortOrder: z.number().default(0),
        }),
      )
      .min(1),
  }),
});

export const assignSalarySchema = z.object({
  body: z.object({
    employeeId: z.union([z.string(), z.number()]).transform(String),
    structureId: z.string(),
    ctc: z.number().positive(),
    components: z.array(
      z.object({
        code: z.string(),
        monthlyAmount: z.number(),
        annualAmount: z.number(),
      }),
    ),
    effectiveFrom: z.string(),
  }),
});

export const bulkSalaryAssignSchema = z.object({
  body: z.object({
    employeeIds: z
      .array(z.union([z.string(), z.number()]).transform(String))
      .min(1, "Select at least one employee"),
    structureId: z.string().min(1),
    ctc: z.number().positive(),
    components: z.array(
      z.object({
        code: z.string(),
        name: z.string(),
        monthlyAmount: z.number().nonnegative(),
        annualAmount: z.number().nonnegative(),
      }),
    ),
    effectiveFrom: z.string().min(1),
  }),
});

// ---------------------------------------------------------------------------
// Payroll Schemas
// ---------------------------------------------------------------------------
export const createPayrollRunSchema = z.object({
  body: z.object({
    month: z.number().min(1).max(12),
    year: z.number().min(2020).max(2100),
    payDate: z.string(),
    notes: z.string().optional(),
  }),
});

// ---------------------------------------------------------------------------
// Tax Declaration Schema
// ---------------------------------------------------------------------------
export const submitDeclarationSchema = z.object({
  body: z.object({
    financialYear: z.string(),
    declarations: z.array(
      z.object({
        section: z.string(),
        description: z.string(),
        declaredAmount: z.number().positive(),
      }),
    ),
  }),
});

// ---------------------------------------------------------------------------
// Attendance Schema
// ---------------------------------------------------------------------------
export const importAttendanceSchema = z.object({
  body: z.object({
    month: z.number().min(1).max(12),
    year: z.number().min(2020).max(2100),
    records: z.array(
      z.object({
        employeeId: z.union([z.string(), z.number()]).transform(String),
        totalDays: z.number().int().min(1).max(31),
        presentDays: z.number().min(0).max(31),
        absentDays: z.number().min(0).max(31).default(0),
        halfDays: z.number().min(0).max(31).default(0),
        paidLeave: z.number().min(0).max(31).default(0),
        unpaidLeave: z.number().min(0).max(31).default(0),
        holidays: z.number().min(0).max(31).default(0),
        weekoffs: z.number().min(0).max(31).default(0),
        lopDays: z.number().min(0).max(31).default(0),
        overtimeHours: z.number().min(0).default(0),
      }),
    ),
  }),
});

// ---------------------------------------------------------------------------
// Organization Schemas
// ---------------------------------------------------------------------------
export const createOrgSchema = z.object({
  body: z.object({
    name: z.string().min(1).max(255),
    legalName: z.string().min(1).max(255),
    pan: z.string().length(10),
    tan: z.string().length(10),
    gstin: z.string().length(15).optional(),
    pfEstablishmentCode: z.string().optional(),
    esiEstablishmentCode: z.string().optional(),
    registeredAddress: z.object({
      line1: z.string(),
      line2: z.string().optional(),
      city: z.string(),
      state: z.string(),
      pincode: z.string(),
    }),
    state: z.string().min(2).max(5),
    currency: z.string().length(3).default("INR"),
    country: z.string().length(2).default("IN"),
  }),
});

// ---------------------------------------------------------------------------
// Benefits Schemas
// ---------------------------------------------------------------------------
// Reusable helper — guards any schema where both startKey and endKey are
// optional date strings. Fails with a clear "end must be on or after start"
// message so the UI can surface it inline. Shared by the benefit-plan /
// benefit-enrollment schemas (both affected by #15) and reused by the
// insurance schemas (#13).
function refineDateRange<T extends z.ZodRawShape>(
  shape: z.ZodObject<T>,
  startKey: keyof T & string,
  endKey: keyof T & string,
  label: string,
) {
  return shape.refine(
    (v: any) => {
      if (!v[startKey] || !v[endKey]) return true;
      return new Date(v[endKey]).getTime() >= new Date(v[startKey]).getTime();
    },
    {
      message: `${label} end date must be on or after start date`,
      path: [endKey],
    },
  );
}

export const createBenefitPlanSchema = z.object({
  body: refineDateRange(
    z.object({
      name: z.string().min(1).max(100),
      type: z.enum(["health", "dental", "vision", "life", "disability", "retirement"]),
      provider: z.string().max(255).optional(),
      description: z.string().optional(),
      premiumAmount: z.number().min(0).default(0),
      employerContribution: z.number().min(0).default(0),
      coverageDetails: z.record(z.any()).optional(),
      enrollmentPeriodStart: z.string().optional(),
      enrollmentPeriodEnd: z.string().optional(),
    }),
    "enrollmentPeriodStart",
    "enrollmentPeriodEnd",
    "Enrollment period",
  ),
});

export const updateBenefitPlanSchema = z.object({
  params: z.object({ id: z.string() }),
  body: refineDateRange(
    z.object({
      name: z.string().min(1).max(100).optional(),
      type: z.enum(["health", "dental", "vision", "life", "disability", "retirement"]).optional(),
      provider: z.string().max(255).optional().nullable(),
      description: z.string().optional().nullable(),
      premiumAmount: z.number().min(0).optional(),
      employerContribution: z.number().min(0).optional(),
      coverageDetails: z.record(z.any()).optional(),
      enrollmentPeriodStart: z.string().optional().nullable(),
      enrollmentPeriodEnd: z.string().optional().nullable(),
      isActive: z.boolean().optional(),
    }),
    "enrollmentPeriodStart",
    "enrollmentPeriodEnd",
    "Enrollment period",
  ),
});

export const enrollBenefitSchema = z.object({
  body: refineDateRange(
    z.object({
      employeeId: z.union([z.string(), z.number()]).transform(String),
      planId: z.string(),
      coverageType: z
        .enum(["individual", "family", "individual_plus_spouse"])
        .default("individual"),
      startDate: z.string(),
      endDate: z.string().optional(),
      status: z.enum(["enrolled", "pending"]).default("pending"),
      premiumEmployeeShare: z.number().min(0).default(0),
      premiumEmployerShare: z.number().min(0).optional(),
      dependents: z
        .array(
          z.object({
            name: z.string().min(1).max(255),
            relationship: z.enum(["spouse", "child", "parent"]),
            dateOfBirth: z.string().optional(),
          }),
        )
        .optional(),
    }),
    "startDate",
    "endDate",
    "Enrollment",
  ),
});

// ---------------------------------------------------------------------------
// GL Accounting Schemas
// ---------------------------------------------------------------------------
export const createGLMappingSchema = z.object({
  body: z.object({
    payComponent: z.string().min(1).max(50),
    glAccountCode: z.string().min(1).max(50),
    glAccountName: z.string().min(1).max(255),
    description: z.string().optional(),
  }),
});

export const generateJournalSchema = z.object({
  body: z.object({
    payrollRunId: z.string(),
  }),
});

// ---------------------------------------------------------------------------
// Compensation Benchmark Schemas
// ---------------------------------------------------------------------------
export const createBenchmarkSchema = z.object({
  body: z.object({
    jobTitle: z.string().min(1).max(255),
    department: z.string().max(100).optional(),
    location: z.string().max(255).optional(),
    marketP25: z.number().min(0),
    marketP50: z.number().min(0),
    marketP75: z.number().min(0),
    source: z.string().max(255).optional(),
    effectiveDate: z.string(),
  }),
});

export const updateBenchmarkSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    jobTitle: z.string().min(1).max(255).optional(),
    department: z.string().max(100).optional().nullable(),
    location: z.string().max(255).optional().nullable(),
    marketP25: z.number().min(0).optional(),
    marketP50: z.number().min(0).optional(),
    marketP75: z.number().min(0).optional(),
    source: z.string().max(255).optional().nullable(),
    effectiveDate: z.string().optional(),
  }),
});

export const importBenchmarksSchema = z.object({
  body: z.object({
    benchmarks: z
      .array(
        z.object({
          jobTitle: z.string().min(1).max(255),
          department: z.string().max(100).optional(),
          location: z.string().max(255).optional(),
          marketP25: z.number().min(0),
          marketP50: z.number().min(0),
          marketP75: z.number().min(0),
          source: z.string().max(255).optional(),
          effectiveDate: z.string(),
        }),
      )
      .min(1),
  }),
});

// ---------------------------------------------------------------------------
// Earned Wage Access Schemas
// ---------------------------------------------------------------------------
export const earnedWageSettingsSchema = z.object({
  body: z.object({
    isEnabled: z.boolean().optional(),
    maxPercentage: z.number().min(1).max(100).optional(),
    minAmount: z.number().min(0).optional(),
    maxAmount: z.number().min(0).optional(),
    feePercentage: z.number().min(0).max(100).optional(),
    feeFlat: z.number().min(0).optional(),
    autoApproveBelow: z.number().min(0).optional(),
    requiresManagerApproval: z.boolean().optional(),
    cooldownDays: z.number().min(0).max(365).optional(),
  }),
});

export const earnedWageRequestSchema = z.object({
  body: z.object({
    amount: z.number().positive(),
    reason: z.string().max(1000).optional(),
  }),
});

export const earnedWageRejectSchema = z.object({
  body: z.object({
    reason: z.string().max(1000).optional(),
  }),
});

// ---------------------------------------------------------------------------
// Insurance Schemas
// ---------------------------------------------------------------------------
export const createInsurancePolicySchema = z.object({
  body: refineDateRange(
    z.object({
      name: z.string().min(1).max(255),
      policyNumber: z.string().max(100).optional(),
      provider: z.string().min(1).max(255),
      type: z.enum(["group_health", "group_life", "disability", "accidental", "travel"]),
      premiumTotal: z.number().min(0).default(0),
      premiumPerEmployee: z.number().min(0).default(0),
      coverageAmount: z.number().min(0).default(0),
      startDate: z.string(),
      endDate: z.string().optional(),
      renewalDate: z.string().optional(),
      documentUrl: z.string().optional(),
      terms: z.string().optional(),
    }),
    "startDate",
    "endDate",
    "Policy",
  ),
});

export const updateInsurancePolicySchema = z.object({
  params: z.object({ id: z.string() }),
  body: refineDateRange(
    z.object({
      name: z.string().min(1).max(255).optional(),
      policyNumber: z.string().max(100).optional().nullable(),
      provider: z.string().min(1).max(255).optional(),
      type: z.enum(["group_health", "group_life", "disability", "accidental", "travel"]).optional(),
      premiumTotal: z.number().min(0).optional(),
      premiumPerEmployee: z.number().min(0).optional(),
      coverageAmount: z.number().min(0).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional().nullable(),
      renewalDate: z.string().optional().nullable(),
      documentUrl: z.string().optional().nullable(),
      terms: z.string().optional().nullable(),
      status: z.enum(["active", "expired", "cancelled"]).optional(),
    }),
    "startDate",
    "endDate",
    "Policy",
  ),
});

export const enrollInsuranceSchema = z.object({
  body: z.object({
    policyId: z.string(),
    employeeId: z.union([z.string(), z.number()]).transform(String),
    sumInsured: z.number().min(0).optional(),
    premiumShare: z.number().min(0).default(0),
    nomineeName: z.string().max(255).optional(),
    nomineeRelationship: z.string().max(50).optional(),
  }),
});

export const submitInsuranceClaimSchema = z.object({
  body: z.object({
    policyId: z.string(),
    claimType: z.enum(["hospitalization", "outpatient", "dental", "vision", "life", "disability"]),
    amountClaimed: z.number().positive(),
    description: z.string().max(2000).optional(),
    documents: z.array(z.string()).optional(),
    notes: z.string().max(1000).optional(),
  }),
});

export const reviewInsuranceClaimSchema = z.object({
  body: z.object({
    amountApproved: z.number().min(0).optional(),
    rejectionReason: z.string().max(1000).optional(),
    notes: z.string().max(1000).optional(),
  }),
});

// ---------------------------------------------------------------------------
// Global Payroll / EOR Schemas
// ---------------------------------------------------------------------------
export const addGlobalEmployeeSchema = z.object({
  body: z.object({
    firstName: firstNameSchema,
    lastName: lastNameSchema,
    email: z.string().email(),
    countryId: z.string().min(1),
    employmentType: z.enum(["eor", "contractor", "direct_hire"]),
    contractType: z.enum(["full_time", "part_time", "fixed_term"]),
    jobTitle: z.string().min(1).max(200),
    department: z.string().max(100).optional(),
    startDate: z.string(),
    endDate: z.string().optional(),
    salaryAmount: z.number().positive(),
    salaryCurrency: z.string().length(3).optional(),
    salaryFrequency: z.enum(["monthly", "biweekly", "weekly", "annual"]).default("monthly"),
    empcloudUserId: z.union([z.string(), z.number()]).optional(),
    taxId: z.string().max(50).optional(),
    bankName: bankNameSchema.optional(),
    bankAccount: z.string().max(50).optional(),
    bankRouting: z.string().max(50).optional(),
    contractDocumentUrl: z.string().optional(),
    notes: z.string().optional(),
  }),
});

export const updateGlobalEmployeeSchema = z.object({
  params: z.object({ id: z.string() }),
  body: z.object({
    firstName: firstNameSchema.optional(),
    lastName: lastNameSchema.optional(),
    email: z.string().email().optional(),
    countryId: z.string().optional(),
    employmentType: z.enum(["eor", "contractor", "direct_hire"]).optional(),
    contractType: z.enum(["full_time", "part_time", "fixed_term"]).optional(),
    jobTitle: z.string().max(200).optional(),
    department: z.string().max(100).optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    salaryAmount: z.number().positive().optional(),
    salaryCurrency: z.string().length(3).optional(),
    salaryFrequency: z.enum(["monthly", "biweekly", "weekly", "annual"]).optional(),
    status: z.enum(["active", "onboarding", "offboarding", "terminated"]).optional(),
    taxId: z.string().max(50).optional(),
    bankName: bankNameSchema.optional(),
    bankAccount: z.string().max(50).optional(),
    bankRouting: z.string().max(50).optional(),
    contractDocumentUrl: z.string().optional(),
    notes: z.string().optional(),
  }),
});

export const createGlobalPayrollRunSchema = z.object({
  body: z.object({
    countryId: z.string().min(1),
    month: z.number().min(1).max(12),
    year: z.number().min(2020).max(2100),
  }),
});

export const submitContractorInvoiceSchema = z.object({
  body: z.object({
    globalEmployeeId: z.string().min(1),
    amount: z.number().positive(),
    currency: z.string().length(3).optional(),
    description: z.string().max(2000).optional(),
    periodStart: z.string(),
    periodEnd: z.string(),
  }),
});

export const updateComplianceItemSchema = z.object({
  params: z.object({ itemId: z.string() }),
  body: z.object({
    completed: z.boolean(),
  }),
});

// ---------------------------------------------------------------------------
// Leave Schemas
// ---------------------------------------------------------------------------
// Apply-leave payload. Accepts either leaveTypeId (preferred — numeric PK of
// the EmpCloud leave_types row) or the legacy leaveType code string. #26:
// previously only the free-form code was accepted, so apps still sending
// hardcoded "earned" hit `Leave type 'earned' not found` for every org whose
// real codes were CL / SL / EL. Sending the id bypasses the tenant-code
// mismatch entirely. #36: end date must not be before start date.
export const applyLeaveSchema = z.object({
  body: z
    .object({
      leaveTypeId: z.union([z.string(), z.number()]).optional(),
      leaveType: z.string().optional(),
      startDate: z.string().min(1, "Start date is required"),
      endDate: z.string().min(1, "End date is required"),
      reason: z.string().min(1, "Reason is required").max(2000),
      isHalfDay: z.boolean().optional(),
      halfDayPeriod: z.enum(["first_half", "second_half"]).optional(),
    })
    .refine(
      (v) => {
        const hasId =
          v.leaveTypeId !== undefined &&
          v.leaveTypeId !== null &&
          String(v.leaveTypeId).trim() !== "";
        const hasCode = typeof v.leaveType === "string" && v.leaveType.length > 0;
        return hasId || hasCode;
      },
      {
        message: "Leave type is required",
        path: ["leaveTypeId"],
      },
    )
    .refine(
      (v) => {
        if (!v.startDate || !v.endDate) return true;
        const s = new Date(v.startDate).getTime();
        const e = new Date(v.endDate).getTime();
        if (Number.isNaN(s) || Number.isNaN(e)) return true;
        return e >= s;
      },
      {
        message: "End date must be greater than start date",
        path: ["endDate"],
      },
    ),
});

// ---------------------------------------------------------------------------
// Pagination query params
// ---------------------------------------------------------------------------
export const paginationSchema = z.object({
  query: z.object({
    page: z.coerce.number().min(1).default(1).optional(),
    limit: z.coerce.number().min(1).max(100).default(20).optional(),
    sort: z.string().optional(),
    order: z.enum(["asc", "desc"]).default("desc").optional(),
  }),
});
