export * from "./types/index";
export type * from "./types/uae-payroll";
export type { GlobalEmployeeBulkMode, GlobalEmployeeBulkResult } from "./utils/global-employee-csv";
export {
  GLOBAL_EMPLOYEE_CSV_HEADERS,
  GLOBAL_EMPLOYEE_CSV_MAX_ROWS,
  GLOBAL_EMPLOYEE_CSV_MAX_BYTES,
  parseGlobalEmployeeCsv,
  stringifyGlobalEmployeeCsv,
} from "./utils/global-employee-csv";
export * from "./constants/india";
export * from "./constants/us";
export * from "./constants/uk";
export * from "./constants/za";
export { computeIndiaPF, getIndiaPFWageCeiling, getIndiaPFDueDate } from "./utils/india-pf";

// Explicit named re-exports — Rollup's CJS analyzer can't see runtime symbols
// through `export *` wildcards, which makes Vite client builds fail with
// "X is not exported by ../shared/dist/index.js" even though dist exports it.
export {
  resolveSalaryComponents,
  validateComponents,
  checkResolvedComponents,
  applySalaryOverrides,
  validateOverrides,
  SalaryResolverError,
} from "./utils/salary-resolver";
export type {
  ResolverCalcType,
  ResolverComponent,
  ResolvedComponent,
  ResolveOptions,
  ResolverWarning,
} from "./utils/salary-resolver";
