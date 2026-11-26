import { z } from "zod";
import { GLOBAL_EMPLOYEE_CSV_MAX_BYTES } from "@emp-payroll/shared";

export const globalEmployeeBulkSchema = z.object({
  body: z
    .object({
      mode: z.enum(["create", "update"]),
      csv: z.string().min(1).max(GLOBAL_EMPLOYEE_CSV_MAX_BYTES),
      apply: z.boolean().default(false),
    })
    .strict(),
});

export const globalEmployeeBulkTemplateSchema = z.object({
  query: z.object({ mode: z.enum(["create", "update"]).default("create") }),
});
