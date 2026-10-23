import type {
  UaePeriodInput,
  UaeLeaveKind,
  UaeDeductionInput,
  UaeWpsCategory,
} from "@emp-payroll/shared";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { UaeApprovedFields, UaeCheckbox, UaeMoneyField, UaeNumberField } from "./UaeFields";

const LEAVES = [
  ["annual", "Annual leave"],
  ["sick", "Sick leave"],
  ["maternity", "Maternity leave"],
  ["parental", "Parental leave"],
  ["bereavement_spouse", "Bereavement — spouse"],
  ["bereavement_family", "Bereavement — family"],
  ["study", "Study leave"],
  ["unpaid", "Unpaid leave"],
].map(([value, label]) => ({ value, label }));
const DEDUCTIONS = [
  ["loan", "Loan repayment"],
  ["overpayment", "Overpayment recovery"],
  ["disciplinary", "Disciplinary penalty"],
  ["court", "Court order"],
  ["maintenance", "Maintenance order"],
  ["damage", "Damage recovery"],
  ["voluntary", "Voluntary deduction"],
].map(([value, label]) => ({ value, label }));

export function UaePeriodForm({
  value,
  onChange,
  year,
  month,
}: {
  value: UaePeriodInput;
  onChange: (input: UaePeriodInput) => void;
  year: number;
  month: number;
}) {
  const patch = (fields: Partial<UaePeriodInput>) => onChange({ ...value, ...fields });
  const leaves = value.leaves || [];
  const earnings = value.variableEarnings || [];
  const deductions = value.deductions || [];
  const settlement = value.finalSettlement;
  const periodEnd = `${year}-${String(month).padStart(2, "0")}-${new Date(year, month, 0).getDate()}`;
  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        Enter only this period’s changes. Do not enter the same unpaid absence in both unpaid days
        and the leave list. All amounts are AED.
      </p>
      <UaeNumberField
        label="Other unpaid absence days this month"
        value={value.unpaidDays}
        max={31}
        onChange={(unpaidDays) => patch({ unpaidDays })}
      />
      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Leave</legend>
        {leaves.map((leave, index) => (
          <div key={index} className="space-y-2 rounded bg-gray-50 p-3 dark:bg-gray-800">
            <div className="grid gap-3 sm:grid-cols-3">
              <SelectField
                label="Leave type"
                aria-label={`Leave ${index + 1} type`}
                options={LEAVES}
                value={leave.kind}
                onChange={(e) =>
                  patch({
                    leaves: leaves.map((row, i) =>
                      i === index ? { ...row, kind: e.target.value as UaeLeaveKind } : row,
                    ),
                  })
                }
              />
              <UaeNumberField
                label={`Leave ${index + 1} days this month`}
                value={leave.days}
                max={31}
                onChange={(days) =>
                  patch({
                    leaves: leaves.map((row, i) =>
                      i === index ? { ...row, days: days ?? NaN } : row,
                    ),
                  })
                }
              />
              <UaeNumberField
                label="Days used earlier in entitlement cycle"
                value={leave.usedToDate}
                onChange={(usedToDate) =>
                  patch({
                    leaves: leaves.map((row, i) => (i === index ? { ...row, usedToDate } : row)),
                  })
                }
              />
            </div>
            <Input
              label="Leave approval / entitlement reference"
              aria-label={`Leave ${index + 1} approval reference`}
              value={leave.entitlementReference || ""}
              onChange={(e) =>
                patch({
                  leaves: leaves.map((row, i) =>
                    i === index
                      ? { ...row, entitlementReference: e.target.value || undefined }
                      : row,
                  ),
                })
              }
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => patch({ leaves: leaves.filter((_, i) => i !== index) })}
            >
              Remove leave
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() => patch({ leaves: [...leaves, { kind: "annual", days: 0, usedToDate: 0 }] })}
        >
          Add leave
        </Button>
      </fieldset>
      <details className="space-y-3 rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Overtime and rest / holiday work
        </summary>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["ordinaryHours", "Ordinary overtime hours"],
              ["nightHours", "Night overtime hours"],
              ["restDays", "Rest days worked"],
              ["publicHolidayDays", "Public holidays worked"],
              ["compensatedRestDays", "Rest days receiving compensatory leave"],
              ["compensatedPublicHolidayDays", "Public holidays receiving compensatory leave"],
            ] as const
          ).map(([key, label]) => (
            <UaeNumberField
              key={key}
              label={label}
              value={value.overtime?.[key]}
              onChange={(number) => patch({ overtime: { ...value.overtime, [key]: number } })}
            />
          ))}
        </div>
        <Input
          label="Approved work schedule reference"
          aria-label="Approved work schedule reference"
          value={value.overtime?.approvedScheduleReference || ""}
          onChange={(e) =>
            patch({
              overtime: {
                ...value.overtime,
                approvedScheduleReference: e.target.value || undefined,
              },
            })
          }
        />
        <p className="text-xs text-gray-500">
          Paid rest / holiday work needs an approved overtime amount below. DIFC / ADGM leave and
          overtime also require reviewed amounts.
        </p>
      </details>
      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Variable earnings and reimbursements</legend>
        {earnings.map((earning, index) => (
          <div key={index} className="space-y-2 rounded bg-gray-50 p-3 dark:bg-gray-800">
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label="Description"
                aria-label={`Earning ${index + 1} description`}
                value={earning.name}
                onChange={(e) =>
                  patch({
                    variableEarnings: earnings.map((row, i) =>
                      i === index ? { ...row, name: e.target.value } : row,
                    ),
                  })
                }
              />
              <SelectField
                label="Payment type"
                aria-label={`Earning ${index + 1} type`}
                value={earning.kind || "earning"}
                options={[
                  { value: "earning", label: "Variable earning" },
                  { value: "reimbursement", label: "Reimbursement" },
                ]}
                onChange={(e) =>
                  patch({
                    variableEarnings: earnings.map((row, i) =>
                      i === index
                        ? {
                            ...row,
                            kind: e.target.value as "earning" | "reimbursement",
                            wpsCategory:
                              e.target.value === "reimbursement" ? undefined : row.wpsCategory,
                          }
                        : row,
                    ),
                  })
                }
              />
              <UaeMoneyField
                label={`Earning ${index + 1}`}
                value={earning.amount}
                required
                onChange={(amount) =>
                  patch({
                    variableEarnings: earnings.map((row, i) =>
                      i === index ? { ...row, amount: amount ?? NaN } : row,
                    ),
                  })
                }
              />
            </div>
            {earning.kind !== "reimbursement" && (
              <SelectField
                label="WPS variable pay category"
                aria-label={`Earning ${index + 1} WPS category`}
                value={earning.wpsCategory || ""}
                options={[
                  { value: "", label: "Use automatic category" },
                  { value: "housing", label: "Housing allowance" },
                  { value: "conveyance", label: "Conveyance allowance" },
                  { value: "medical", label: "Medical allowance" },
                  { value: "annualPassage", label: "Annual passage / leave travel" },
                  { value: "overtime", label: "Overtime allowance" },
                  { value: "other", label: "Other allowance" },
                  { value: "leaveEncashment", label: "Leave encashment" },
                ]}
                onChange={(event) =>
                  patch({
                    variableEarnings: earnings.map((row, i) =>
                      i === index
                        ? {
                            ...row,
                            wpsCategory: (event.target.value || undefined) as
                              | UaeWpsCategory
                              | undefined,
                          }
                        : row,
                    ),
                  })
                }
              />
            )}
            <Button
              size="sm"
              variant="outline"
              onClick={() => patch({ variableEarnings: earnings.filter((_, i) => i !== index) })}
            >
              Remove earning
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            patch({ variableEarnings: [...earnings, { name: "", amount: 0, kind: "earning" }] })
          }
        >
          Add earning / reimbursement
        </Button>
      </fieldset>
      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Authorised deductions</legend>
        {deductions.map((deduction, index) => (
          <div key={index} className="space-y-2 rounded bg-gray-50 p-3 dark:bg-gray-800">
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Deduction description"
                aria-label={`Deduction ${index + 1} description`}
                value={deduction.name}
                onChange={(e) =>
                  patch({
                    deductions: deductions.map((row, i) =>
                      i === index ? { ...row, name: e.target.value } : row,
                    ),
                  })
                }
              />
              <SelectField
                label="Deduction basis"
                aria-label={`Deduction ${index + 1} basis`}
                value={deduction.kind}
                options={DEDUCTIONS}
                onChange={(e) =>
                  patch({
                    deductions: deductions.map((row, i) =>
                      i === index
                        ? { ...row, kind: e.target.value as UaeDeductionInput["kind"] }
                        : row,
                    ),
                  })
                }
              />
              <UaeMoneyField
                label={`Deduction ${index + 1}`}
                value={deduction.amount}
                required
                onChange={(amount) =>
                  patch({
                    deductions: deductions.map((row, i) =>
                      i === index ? { ...row, amount: amount ?? NaN } : row,
                    ),
                  })
                }
              />
              <Input
                label="Deduction authorisation reference"
                aria-label={`Deduction ${index + 1} authorisation reference`}
                value={deduction.reference}
                onChange={(e) =>
                  patch({
                    deductions: deductions.map((row, i) =>
                      i === index ? { ...row, reference: e.target.value } : row,
                    ),
                  })
                }
              />
            </div>
            <UaeCheckbox
              label="Written employee consent recorded"
              checked={deduction.consent}
              onChange={(consent) =>
                patch({
                  deductions: deductions.map((row, i) => (i === index ? { ...row, consent } : row)),
                })
              }
            />
            <UaeCheckbox
              label="Court order recorded"
              checked={deduction.courtOrder}
              onChange={(courtOrder) =>
                patch({
                  deductions: deductions.map((row, i) =>
                    i === index ? { ...row, courtOrder } : row,
                  ),
                })
              }
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => patch({ deductions: deductions.filter((_, i) => i !== index) })}
            >
              Remove deduction
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            patch({
              deductions: [
                ...deductions,
                { name: "", kind: "voluntary", amount: 0, reference: "" },
              ],
            })
          }
        >
          Add authorised deduction
        </Button>
      </fieldset>
      <details className="space-y-3 rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Actual ILOE premium collection
        </summary>
        <UaeCheckbox
          label="Collect a policy premium due this period"
          checked={!!value.iloeCollection}
          onChange={(enabled) =>
            patch({
              iloeCollection: enabled
                ? {
                    amount: 0,
                    premium: 0,
                    vat: 0,
                    coverageMonths: 1,
                    dueOn: periodEnd,
                    reference: "",
                  }
                : undefined,
            })
          }
        />
        {value.iloeCollection && (
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["premium", "Policy premium before VAT"],
                ["vat", "Policy VAT"],
              ] as const
            ).map(([key, label]) => (
              <UaeMoneyField
                key={key}
                label={label}
                value={value.iloeCollection![key]}
                required
                onChange={(amount) => {
                  const collection = { ...value.iloeCollection!, [key]: amount ?? NaN };
                  patch({
                    iloeCollection: { ...collection, amount: collection.premium + collection.vat },
                  });
                }}
              />
            ))}
            <UaeNumberField
              label="Months covered by this payment"
              value={value.iloeCollection.coverageMonths}
              integer
              max={24}
              onChange={(coverageMonths) =>
                patch({
                  iloeCollection: {
                    ...value.iloeCollection!,
                    coverageMonths: coverageMonths ?? NaN,
                  },
                })
              }
            />
            <Input
              label="ILOE premium due on"
              aria-label="ILOE premium due on"
              type="date"
              value={value.iloeCollection.dueOn}
              onChange={(e) =>
                patch({ iloeCollection: { ...value.iloeCollection!, dueOn: e.target.value } })
              }
            />
            <Input
              label="ILOE invoice / payment approval reference"
              aria-label="ILOE invoice / payment approval reference"
              value={value.iloeCollection.reference}
              onChange={(e) =>
                patch({ iloeCollection: { ...value.iloeCollection!, reference: e.target.value } })
              }
            />
          </div>
        )}
      </details>
      <details className="space-y-3 rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">Reviewed payroll amounts</summary>
        <p className="text-xs text-gray-500">
          Use documented approvals for non-standard work patterns, DIFC / ADGM leave or overtime,
          and partial months. A zero approved amount is an explicit instruction.
        </p>
        {(
          [
            ["regularSalary", "Approved earned regular salary"],
            ["leaveDeduction", "Approved leave deduction"],
            ["overtimePay", "Approved overtime / holiday pay"],
            ["deductionLimit", "Approved deduction limit"],
          ] as const
        ).map(([key, label]) => (
          <UaeApprovedFields
            key={key}
            label={label}
            value={value.approvedAdjustments?.[key]}
            onChange={(amount) =>
              patch({ approvedAdjustments: { ...value.approvedAdjustments, [key]: amount } })
            }
          />
        ))}
      </details>
      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 text-sm font-medium">Final settlement</legend>
        <UaeCheckbox
          label="Include final settlement for this employee"
          checked={!!settlement}
          onChange={(enabled) =>
            patch({
              finalSettlement: enabled
                ? {
                    terminationDate: periodEnd,
                    unpaidServiceDays: 0,
                    noticePayDirection: "employer_pays",
                  }
                : undefined,
            })
          }
        />
        {settlement && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Termination date"
                aria-label="Termination date"
                type="date"
                value={settlement.terminationDate}
                onChange={(e) =>
                  patch({ finalSettlement: { ...settlement, terminationDate: e.target.value } })
                }
              />
              {(
                [
                  ["unpaidServiceDays", "Total unpaid days excluded from service"],
                  ["unusedAnnualLeaveDays", "Unused annual leave days"],
                  ["noticePayDays", "Notice pay days"],
                ] as const
              ).map(([key, label]) => (
                <UaeNumberField
                  key={key}
                  label={label}
                  value={settlement[key]}
                  onChange={(number) =>
                    patch({
                      finalSettlement: {
                        ...settlement,
                        [key]: number ?? (key === "unpaidServiceDays" ? NaN : undefined),
                      },
                    })
                  }
                />
              ))}
              <SelectField
                label="Notice pay direction"
                aria-label="Notice pay direction"
                value={settlement.noticePayDirection || "employer_pays"}
                options={[
                  { value: "employer_pays", label: "Employer pays employee" },
                  { value: "employee_owes", label: "Employee owes employer" },
                ]}
                onChange={(e) =>
                  patch({
                    finalSettlement: {
                      ...settlement,
                      noticePayDirection: e.target.value as "employer_pays" | "employee_owes",
                    },
                  })
                }
              />
              <UaeMoneyField
                label="Gratuity previously paid"
                value={settlement.gratuityAlreadyPaid}
                onChange={(gratuityAlreadyPaid) =>
                  patch({ finalSettlement: { ...settlement, gratuityAlreadyPaid } })
                }
              />
            </div>
            {(
              [
                ["approvedGratuity", "Approved gratuity"],
                ["approvedLeaveEncashment", "Approved leave encashment"],
                ["approvedNoticePay", "Approved notice pay"],
                ["annualWage", "Reviewed annual wage for ADGM benefit floor"],
              ] as const
            ).map(([key, label]) => (
              <UaeApprovedFields
                key={key}
                label={label}
                value={settlement[key]}
                onChange={(amount) => patch({ finalSettlement: { ...settlement, [key]: amount } })}
              />
            ))}
          </>
        )}
      </fieldset>
    </div>
  );
}
