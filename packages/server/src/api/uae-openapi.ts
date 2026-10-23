import type { UaeEmployeeProfile, UaePeriodInput } from "@emp-payroll/shared";

// Runtime Zod schemas in validators/uae-payroll.ts are the input source of truth.
export const uaeProfileExample: UaeEmployeeProfile = {
  jurisdiction: "federal",
  effectiveFrom: "2026-06-01",
  nationality: "IN",
  basicSalary: 600000,
  allowances: [
    { name: "Housing", amount: 200000 },
    { name: "Transport", amount: 100000 },
  ],
  normalDailyHours: 8,
  workPattern: "full_time",
  probationEndsOn: "2020-07-01",
  pension: { scheme: "none" },
  iloe: { mode: "employee_paid" },
  healthInsuranceEmployer: 0,
  savings: { scheme: "gratuity" },
  wps: {
    employeeId: "12345678901234",
    routingCode: "123456789",
    accountNumber: "AE070331234567890123456",
  },
};
export const uaeInputExample: UaePeriodInput = {
  overtime: {
    ordinaryHours: 10,
    approvedScheduleReference: "Approved October attendance register",
  },
  deductions: [
    {
      kind: "loan",
      name: "Interest-free loan repayment",
      amount: 50000,
      consent: true,
      reference: "Signed repayment agreement",
    },
  ],
};

const request = (example: unknown, description: string) => ({
  required: true,
  description,
  content: { "application/json": { schema: { type: "object" }, example } },
});
const runId = { name: "id", in: "path", required: true, schema: { type: "string" } };
const itemId = { name: "itemId", in: "path", required: true, schema: { type: "string" } };
const errors = {
  "400": { description: "Invalid input, unsupported period, invalid payment or missing evidence" },
  "401": { description: "Authentication required" },
  "403": { description: "Insufficient payroll role" },
  "404": { description: "Record not found in the authenticated organisation" },
  "409": {
    description:
      "Missing profile, immutable/legacy run, duplicate period or concurrent modification; refresh before retrying",
  },
  "422": {
    description:
      "Jurisdiction-specific calculation requires reviewed input or statutory validation failed",
  },
};
const jsonResponses = {
  "200": { description: "{ success: true, data: ... }; all monetary values are integer fils" },
  ...errors,
};
const htmlResponses = {
  "200": {
    description:
      "Printable itemised payslip from an approved immutable snapshot; contains personal data and is not cacheable",
    content: { "text/html": { schema: { type: "string" } } },
  },
  ...errors,
};

export const uaeApiPaths = {
  "/global/employees": {
    post: {
      tags: ["Global payroll"],
      summary: "Create an international employee, optionally with a UAE statutory profile",
      description:
        "HR admin/manager. UAE profile uses integer fils, monthly AED salary and explicit jurisdiction/nationality. Basic plus allowances must equal salaryAmount. Profiles may be omitted during onboarding, but UAE calculation then fails closed. WPS details may be incomplete while saving an employee; federal payroll requires complete payment details or a documented exemption. Government/domestic employment require separate regimes.",
      requestBody: request(
        {
          firstName: "Example",
          lastName: "Employee",
          email: "employee@example.test",
          countryId: "uae-country-id",
          employmentType: "direct_hire",
          contractType: "full_time",
          jobTitle: "Engineer",
          startDate: "2020-01-01",
          salaryAmount: 900000,
          salaryCurrency: "AED",
          salaryFrequency: "monthly",
          uaeProfile: uaeProfileExample,
        },
        "See UaeEmployeeProfile and the runtime schemas for pension/savings/insurance alternatives.",
      ),
      responses: {
        "201": {
          description: "Employee with parsed uae_profile and append-only uae_profile_history",
        },
        ...errors,
      },
    },
  },
  "/global/employees/{id}": {
    put: {
      tags: ["Global payroll"],
      parameters: [runId],
      summary: "Update employee and append an effective UAE profile version",
      description:
        "HR admin/manager. Salary amendments require the matching complete uaeProfile. WPS details may remain incomplete during profile setup; payroll still enforces payment readiness and any exemption must include its reason and reference. Profile amendments take effect on a month boundary; approved payroll snapshots remain unchanged.",
      requestBody: request(
        { salaryAmount: 900000, uaeProfile: uaeProfileExample },
        "Complete profile replacement; history is maintained by the server.",
      ),
      responses: jsonResponses,
    },
  },
  "/global/payroll-runs": {
    post: {
      tags: ["Global payroll"],
      summary: "Create a payroll run with country-specific employee calculations",
      description:
        "HR admin/manager. UAE currently supports June 2026 onward, including new joiners from their actual start date. uaeInputs keys are eligible employee IDs in the authenticated organisation. Full validation occurs before transactional writes. Missing UAE profiles never fall back to generic GPSSA/ILOE rates. UAE employer identity is required for frozen payslips. uaeSchedule configures business review cutoffs ahead of the statutory deadline; defaults are 5 and 3 days. Calendar reminders are in-app and use Asia/Dubai dates.",
      requestBody: request(
        {
          countryId: "uae-country-id",
          month: 10,
          year: 2026,
          uaeEmployer: { name: "Example UAE LLC" },
          uaeInputs: { "employee-id": uaeInputExample },
          uaeSchedule: { lockDaysBeforeDue: 5, approvalDaysBeforeDue: 3 },
        },
        "Amounts are integer fils, dates YYYY-MM-DD. Include a finalSettlement only with the recorded employment end date.",
      ),
      responses: {
        "201": { description: "Draft run, totals, revision and employee count" },
        ...errors,
      },
    },
  },
  "/global/payroll-runs/{id}/uae/recalculate": {
    post: {
      tags: ["UAE payroll"],
      parameters: [runId],
      summary: "Replace period inputs and recalculate a draft UAE run",
      description:
        "HR admin/manager. Entire uaeInputs map is replaced. Previous draft items remain in the audit trail. Locked/approved/paid runs cannot be recalculated. The caller's reviewed revision is required; concurrent modifications return 409. Optional uaeSchedule replaces review cutoffs.",
      requestBody: request(
        { expectedRevision: 1, uaeInputs: { "employee-id": uaeInputExample } },
        "Complete replacement of period inputs, not a patch.",
      ),
      responses: jsonResponses,
    },
  },
  "/global/payroll-runs/{id}/uae/payslips/{itemId}": {
    get: {
      tags: ["UAE payroll"],
      parameters: [runId, itemId],
      summary: "Download an approved UAE payslip",
      description:
        "HR admin/manager, scoped to the authenticated organisation. Includes separate employer benefits and actual payment status; approval does not imply payment.",
      responses: htmlResponses,
    },
  },
  "/global/payroll-runs/{id}/uae/wps": {
    post: {
      tags: ["UAE payroll"],
      parameters: [runId],
      summary: "Export an approved unpaid UAE run using a verified bank profile",
      description:
        "HR admin. Select dib-v1.1, mohre-sif, rakbank-sif or emirates-nbd-sif; hsbc-xlsx returns a template-required error. Consult bank-formats metadata for documented limits and routing rules. Optional includeEvp enables seven variable-pay categories for standard/RAK files; DIB and ENBD require EVP for variable pay. variableEarnings.wpsCategory maps housing, conveyance, medical, annualPassage, overtime, other and leaveEncashment. Documented exemptions and non-MoHRE jurisdictions are excluded. Final settlements require a separately reviewed wage allocation and cannot be exported by this adapter. Export does not send funds or mark payroll paid.",
      requestBody: request(
        {
          employerId: "1234567890123",
          employerRoutingCode: "123456789",
          reference: "OCT2026",
          bankFormat: "mohre-sif",
          includeEvp: true,
        },
        "Bank identifiers must match the employer's registered WPS arrangement.",
      ),
      responses: {
        "200": {
          description:
            "SIF download with Content-Disposition filename; approved net amounts reconcile to the control total",
          content: { "text/plain": { schema: { type: "string" } } },
        },
        ...errors,
      },
    },
  },
  "/global/payroll-runs/{id}/uae/payments": {
    post: {
      tags: ["UAE payroll"],
      parameters: [runId],
      summary: "Record bank evidence and reconcile a UAE employee payment",
      description:
        "HR admin. Status is submitted, accepted, rejected, paid or refunded. paidAmount is the cumulative confirmed total, not an increment; paid and refunded require the actual bank payment/refund date in paidOn. Other statuses require zero amount. Refund reverses the complete prior confirmed amount. Only full individual settlement marks a run paid; the 85% WPS indicator is separate. Events preserve actor, reference and prior evidence.",
      requestBody: request(
        {
          employeeId: "employee-id",
          status: "paid",
          reference: "BANK-CONFIRMATION-123",
          paidAmount: 881250,
          paidOn: "2026-10-23",
        },
        "All amounts in fils; manual evidence recording does not initiate a bank payment.",
      ),
      responses: jsonResponses,
    },
  },
  "/global/payroll-runs/{id}/uae/lock": {
    post: {
      tags: ["UAE payroll"],
      parameters: [runId],
      summary: "Lock a reviewed UAE draft",
      description:
        "HR admin/manager. Freezes period inputs for approval. Current employee profiles and exit dates must still match the calculated snapshots. Refresh after the revision increments.",
      requestBody: request(
        { expectedRevision: 1 },
        "Revision displayed when the reviewer checked the run.",
      ),
      responses: jsonResponses,
    },
  },
  "/global/payroll-runs/{id}/uae/unlock": {
    post: {
      tags: ["UAE payroll"],
      parameters: [runId],
      summary: "Return locked UAE payroll to draft with an audit reason",
      description:
        "HR admin. Approved or paid runs cannot be unlocked. Recalculation and a new review are required after employee changes.",
      requestBody: request(
        { expectedRevision: 2, reason: "Correct approved attendance inputs" },
        "Audited reason and currently reviewed revision.",
      ),
      responses: jsonResponses,
    },
  },
  "/global/payroll-runs/{id}/approve": {
    post: {
      tags: ["Global payroll"],
      parameters: [runId],
      summary: "Approve a reviewed payroll run",
      description:
        "HR admin. UAE requires locked status and the revision actually reviewed. Stale revisions return 409. Other countries retain their existing workflow.",
      requestBody: request({ expectedRevision: 2 }, "Required for UAE approval."),
      responses: jsonResponses,
    },
  },
  "/global/uae/bank-formats": {
    get: {
      tags: ["UAE payroll"],
      summary: "List bank export profiles and verification limits",
      description:
        "HR admin/manager. Returns id, label, available, requirement and primary-source URL. HSBC XLSX remains unavailable until its complete current template is mapped. Standard MoHRE, RAK and ENBD profiles validate the 25-character filename stem; DIB follows its published v1.1 identifier rules. Bank acceptance must be confirmed separately.",
      responses: jsonResponses,
    },
  },
  "/global/uae/gratuity-liability": {
    get: {
      tags: ["UAE payroll"],
      summary: "Monthly UAE gratuity liability and movement report",
      parameters: [
        {
          name: "month",
          in: "query",
          required: true,
          schema: { type: "integer", minimum: 1, maximum: 12 },
        },
        {
          name: "year",
          in: "query",
          required: true,
          schema: { type: "integer", minimum: 2026, maximum: 2100 },
        },
      ],
      description:
        "HR admin/manager. Undiscounted statutory-formula provision, separate vested balances, service accrual, salary revaluation, confirmed settlement cash and employer savings costs. Record profile.gratuityHistory for the exact previous month-end, including verified zero unpaid service/payments when applicable. Uses approved snapshots; missing history, partial settlement allocation or unavailable profiles remain needs_review/null. Does not post a general-ledger journal or perform actuarial valuation.",
      responses: jsonResponses,
    },
  },
  "/exits/{id}/uae-settlement": {
    get: {
      tags: ["UAE payroll"],
      parameters: [runId],
      summary: "Resolve UAE exit employment and approved settlement/payment status",
      description:
        "HR admin/manager. Tenant and EmpCloud user links must match the exit. Calculated/paid indicators derive from matching immutable approved payroll and actual bank evidence.",
      responses: jsonResponses,
    },
    post: {
      tags: ["UAE payroll"],
      parameters: [runId],
      summary: "Prepare UAE final settlement and update an existing draft",
      description:
        "HR admin/manager. Requires a matching recorded last working date, verified service and leave/notice inputs. Saves employee end date and offboarding status transactionally. An existing draft is recalculated with other inputs preserved; locked/approved runs reject. Does not approve, pay, or create a duplicate payroll.",
      requestBody: request(
        {
          globalEmployeeId: "employee-id",
          uaeInput: {
            finalSettlement: {
              terminationDate: "2026-10-23",
              unpaidServiceDays: 0,
              unusedAnnualLeaveDays: 5,
            },
          },
        },
        "Amounts are integer fils. Missing entitlement history must be reviewed before preparation.",
      ),
      responses: jsonResponses,
    },
  },
  "/global/my-payslips": {
    get: {
      tags: ["Self-Service"],
      summary: "List the signed-in employee's approved UAE payslips",
      description:
        "Uses authenticated organisation and EmpCloud user identity, never a caller-supplied employee ID.",
      responses: jsonResponses,
    },
  },
  "/global/my-payslips/{itemId}": {
    get: {
      tags: ["Self-Service"],
      parameters: [itemId],
      summary: "Download the signed-in employee's approved UAE payslip",
      description:
        "Snapshot ownership is checked against the authenticated EmpCloud user and organisation.",
      responses: htmlResponses,
    },
  },
};
