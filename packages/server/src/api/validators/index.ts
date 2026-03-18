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
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    orgId: z.string().uuid().optional(),
  }),
});

// ---------------------------------------------------------------------------
// Employee Schemas
// ---------------------------------------------------------------------------
export const createEmployeeSchema = z.object({
  body: z.object({
    employeeCode: z.string().min(1).max(50),
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    email: z.string().email(),
    phone: z.string().max(20).optional(),
    dateOfBirth: z.string(),
    gender: z.enum(["male", "female", "other"]),
    dateOfJoining: z.string(),
    employmentType: z.enum(["full_time", "part_time", "contract", "intern"]).default("full_time"),
    department: z.string().min(1).max(100),
    designation: z.string().min(1).max(100),
    reportingManagerId: z.string().uuid().optional(),
    bankDetails: z.object({
      accountNumber: z.string(),
      ifscCode: z.string(),
      bankName: z.string(),
      branchName: z.string().optional(),
    }),
    taxInfo: z.object({
      pan: z.string().length(10),
      regime: z.enum(["old", "new"]).default("new"),
      uan: z.string().optional(),
    }),
    pfDetails: z.object({
      pfNumber: z.string().optional(),
      isOptedOut: z.boolean().default(false),
      contributionRate: z.number().default(12),
    }),
  }),
});

export const updateEmployeeSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z.object({
    firstName: z.string().min(1).max(100).optional(),
    lastName: z.string().min(1).max(100).optional(),
    phone: z.string().max(20).optional(),
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
    components: z.array(z.object({
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
    })).min(1),
  }),
});

export const assignSalarySchema = z.object({
  body: z.object({
    employeeId: z.string().uuid(),
    structureId: z.string().uuid(),
    ctc: z.number().positive(),
    components: z.array(z.object({
      code: z.string(),
      monthlyAmount: z.number(),
      annualAmount: z.number(),
    })),
    effectiveFrom: z.string(),
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
    declarations: z.array(z.object({
      section: z.string(),
      description: z.string(),
      declaredAmount: z.number().positive(),
    })),
  }),
});

// ---------------------------------------------------------------------------
// Attendance Schema
// ---------------------------------------------------------------------------
export const importAttendanceSchema = z.object({
  body: z.object({
    month: z.number().min(1).max(12),
    year: z.number().min(2020).max(2100),
    records: z.array(z.object({
      employeeId: z.string().uuid(),
      totalDays: z.number(),
      presentDays: z.number(),
      absentDays: z.number().default(0),
      halfDays: z.number().default(0),
      paidLeave: z.number().default(0),
      unpaidLeave: z.number().default(0),
      holidays: z.number().default(0),
      weekoffs: z.number().default(0),
      lopDays: z.number().default(0),
      overtimeHours: z.number().default(0),
    })),
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
