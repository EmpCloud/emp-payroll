// ============================================================================
// EMP-PAYROLL SHARED TYPES
// These types are the single source of truth for both server and client.
// ============================================================================

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export enum EmploymentType {
  FULL_TIME = "full_time",
  PART_TIME = "part_time",
  CONTRACT = "contract",
  INTERN = "intern",
  FREELANCER = "freelancer",
}

export enum PayFrequency {
  MONTHLY = "monthly",
  BI_WEEKLY = "bi_weekly",
  WEEKLY = "weekly",
}

export enum PayrollStatus {
  DRAFT = "draft",
  PROCESSING = "processing",
  COMPUTED = "computed",
  APPROVED = "approved",
  PAID = "paid",
  CANCELLED = "cancelled",
}

export enum PayslipStatus {
  GENERATED = "generated",
  SENT = "sent",
  VIEWED = "viewed",
  DISPUTED = "disputed",
  RESOLVED = "resolved",
}

export enum ComponentType {
  EARNING = "earning",
  DEDUCTION = "deduction",
  REIMBURSEMENT = "reimbursement",
  BENEFIT = "benefit",
}

export enum TaxRegime {
  OLD = "old",
  NEW = "new",
}

export enum ApprovalStatus {
  PENDING = "pending",
  APPROVED = "approved",
  REJECTED = "rejected",
}

export enum UserRole {
  SUPER_ADMIN = "super_admin",
  HR_ADMIN = "hr_admin",
  HR_MANAGER = "hr_manager",
  PAYROLL_ADMIN = "payroll_admin",
  MANAGER = "manager",
  EMPLOYEE = "employee",
}

// ---------------------------------------------------------------------------
// Organization
// ---------------------------------------------------------------------------

export interface Organization {
  id: string;
  name: string;
  legalName: string;
  pan: string;
  tan: string;
  gstin?: string;
  pfEstablishmentCode?: string;
  esiEstablishmentCode?: string;
  ptRegistrationNumber?: string;
  registeredAddress: Address;
  payFrequency: PayFrequency;
  financialYearStart: number; // month (4 = April for India)
  currency: string; // INR
  country: string; // IN
  state: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Address {
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

// ---------------------------------------------------------------------------
// Employee
// ---------------------------------------------------------------------------

export interface Employee {
  id: string;
  orgId: string;
  employeeCode: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  dateOfBirth: Date;
  gender: "male" | "female" | "other";
  dateOfJoining: Date;
  dateOfExit?: Date;
  employmentType: EmploymentType;
  department: string;
  designation: string;
  reportingManagerId?: string;
  address?: Address;
  bankDetails: BankDetails;
  taxInfo: EmployeeTaxInfo;
  pfDetails: PFDetails;
  esiDetails?: ESIDetails;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface BankDetails {
  accountNumber: string;
  ifscCode: string;
  bankName: string;
  branchName?: string;
  accountHolderName: string;
}

export interface EmployeeTaxInfo {
  pan: string;
  uan?: string; // Universal Account Number (PF)
  taxRegime: TaxRegime;
  declarations?: TaxDeclaration[];
}

export interface TaxDeclaration {
  section: string; // 80C, 80D, etc.
  description: string;
  declaredAmount: number;
  proofSubmitted: boolean;
  approvedAmount: number;
}

export interface PFDetails {
  isEnrolled: boolean;
  uan?: string;
  pfNumber?: string;
  contributionRate: number; // default 12
  employerContributionRate: number; // default 12
  isVoluntaryPF: boolean;
  vpfRate?: number;
}

export interface ESIDetails {
  isEligible: boolean;
  esiNumber?: string;
  dispensary?: string;
}

// ---------------------------------------------------------------------------
// Salary Structure
// ---------------------------------------------------------------------------

export interface SalaryStructure {
  id: string;
  orgId: string;
  name: string; // e.g., "Standard CTC", "Senior Management"
  description?: string;
  components: SalaryComponent[];
  isDefault: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface SalaryComponent {
  id: string;
  name: string; // e.g., "Basic Salary", "HRA", "Special Allowance"
  code: string; // e.g., "BASIC", "HRA", "SA"
  type: ComponentType;
  calculationType: "fixed" | "percentage" | "formula" | "balance";
  value: number; // fixed amount or percentage (ignored when calculationType === "balance")
  percentageOf?: string; // component code to calculate percentage of (CTC | GROSS | <CODE>)
  formula?: string; // custom formula
  isTaxable: boolean;
  isStatutory: boolean; // PF, ESI, PT
  isProratable: boolean; // prorate for mid-month joins/exits
  isActive: boolean;
  sortOrder: number;
}

export interface EmployeeSalary {
  id: string;
  employeeId: string;
  structureId: string;
  ctc: number; // annual CTC
  grossSalary: number; // monthly gross
  netSalary: number; // monthly net (after deductions)
  components: EmployeeSalaryComponent[];
  effectiveFrom: Date;
  effectiveTo?: Date;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface EmployeeSalaryComponent {
  componentId: string;
  componentCode: string;
  componentName: string;
  type: ComponentType;
  monthlyAmount: number;
  annualAmount: number;
}

// ---------------------------------------------------------------------------
// Payroll Run
// ---------------------------------------------------------------------------

export interface PayrollRun {
  id: string;
  orgId: string;
  name: string; // e.g., "March 2026 Payroll"
  month: number; // 1-12
  year: number;
  payDate: Date;
  status: PayrollStatus;
  totalGross: number;
  totalDeductions: number;
  totalNet: number;
  totalEmployerContributions: number;
  employeeCount: number;
  processedBy?: string;
  approvedBy?: string;
  approvedAt?: Date;
  notes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// Payslip
// ---------------------------------------------------------------------------

export interface Payslip {
  id: string;
  payrollRunId: string;
  employeeId: string;
  month: number;
  year: number;
  paidDays: number;
  totalDays: number;
  lopDays: number;
  earnings: PayslipLineItem[];
  deductions: PayslipLineItem[];
  employerContributions: PayslipLineItem[];
  reimbursements: PayslipLineItem[];
  grossEarnings: number;
  totalDeductions: number;
  netPay: number;
  totalEmployerCost: number;
  ytdGross: number;
  ytdDeductions: number;
  ytdNetPay: number;
  ytdTaxPaid: number;
  status: PayslipStatus;
  generatedAt: Date;
  sentAt?: Date;
}

export interface PayslipLineItem {
  code: string;
  name: string;
  amount: number;
  ytdAmount: number;
}

// ---------------------------------------------------------------------------
// Tax Computation (India specific)
// ---------------------------------------------------------------------------

export interface TaxComputation {
  id: string;
  employeeId: string;
  financialYear: string; // "2025-26"
  regime: TaxRegime;
  grossIncome: number;
  exemptions: TaxExemption[];
  totalExemptions: number;
  deductions: TaxDeduction[];
  totalDeductions: number;
  taxableIncome: number;
  taxOnIncome: number;
  surcharge: number;
  healthAndEducationCess: number;
  totalTax: number;
  taxAlreadyPaid: number;
  remainingTax: number;
  monthlyTds: number;
  computedAt: Date;
  // Set to true when the employee has no PAN on record and the engine
  // applied the Section 206AA flat 20% short-circuit instead of the
  // regular slab calculation. Lets the UI surface a "no PAN — higher
  // TDS until you submit yours" warning on payslips and the tax page.
  panMissing206AA?: boolean;
}

export interface TaxExemption {
  code: string;
  description: string;
  amount: number;
}

export interface TaxDeduction {
  section: string;
  description: string;
  declaredAmount: number;
  maxAllowed: number;
  allowedAmount: number;
}

// ---------------------------------------------------------------------------
// India Statutory — PF / ESI / PT
// ---------------------------------------------------------------------------

export interface PFContribution {
  employeeId: string;
  month: number;
  year: number;
  pfWages: number; // capped at 15000
  employeeEPF: number; // 12% of PF wages
  employerEPF: number; // 3.67% of PF wages
  employerEPS: number; // 8.33% of PF wages (capped)
  employeeVPF: number;
  adminCharges: number; // 0.5%
  edliCharges: number; // 0.5%
  totalEmployer: number;
  totalEmployee: number;
}

export interface ESIContribution {
  employeeId: string;
  month: number;
  year: number;
  esiWages: number;
  employeeContribution: number; // 0.75%
  employerContribution: number; // 3.25%
  total: number;
}

export interface ProfessionalTax {
  employeeId: string;
  month: number;
  year: number;
  state: string;
  grossSalary: number;
  taxAmount: number;
}

// ---------------------------------------------------------------------------
// Attendance Integration
// ---------------------------------------------------------------------------

export interface AttendanceSummary {
  employeeId: string;
  month: number;
  year: number;
  totalDays: number;
  presentDays: number;
  absentDays: number;
  halfDays: number;
  paidLeave: number;
  unpaidLeave: number;
  holidays: number;
  weekoffs: number;
  lopDays: number; // loss of pay
  overtime: AttendanceOvertime;
}

export interface AttendanceOvertime {
  totalHours: number;
  rate: number;
  amount: number;
}

// ---------------------------------------------------------------------------
// API Response Wrappers
// ---------------------------------------------------------------------------

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: PaginationMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string[]>;
}

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export interface AuthUser {
  id: number; // EmpCloud user ID
  empcloudUserId: number; // EmpCloud user ID (same as id)
  empcloudOrgId: number; // EmpCloud organization ID
  payrollProfileId: string | null; // Payroll DB profile UUID (null if not yet created)
  email: string;
  role: UserRole;
  orgId: number; // EmpCloud org ID
  orgName: string;
  firstName: string;
  lastName: string;
  empCode?: string;
  designation?: string;
  department?: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface LoginResponse {
  user: AuthUser;
  accessToken: string;
  refreshToken: string;
}
