export * from "./types/index";
export * from "./constants/india";
export * from "./constants/us";
export * from "./constants/uk";

// Explicit named re-exports — Rollup's CJS analyzer can't see runtime symbols
// through `export *` wildcards, which makes Vite client builds fail with
// "X is not exported by ../shared/dist/index.js" even though dist exports it.
export {
  resolveSalaryComponents,
  validateComponents,
  SalaryResolverError,
} from "./utils/salary-resolver";
export type {
  ResolverCalcType,
  ResolverComponent,
  ResolvedComponent,
  ResolveOptions,
} from "./utils/salary-resolver";
