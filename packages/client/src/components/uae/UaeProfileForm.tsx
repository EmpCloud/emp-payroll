import type { UaeEmployeeProfile, UaePensionScheme } from "@emp-payroll/shared";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { Button } from "@/components/ui/Button";
import { UaeApprovedFields, UaeCheckbox, UaeMoneyField, UaeNumberField } from "./UaeFields";

export const UAE_JURISDICTIONS = [
  { value: "federal", label: "Federal private sector / ordinary free zone" },
  { value: "difc", label: "DIFC" },
  { value: "adgm", label: "ADGM" },
];
const PENSIONS = [
  ["none", "No statutory pension"],
  ["gpssa_old", "GPSSA — existing regime"],
  ["gpssa_new", "GPSSA — new regime"],
  ["adpf_old", "Abu Dhabi Pension Fund — existing regime"],
  ["adpf_new", "Abu Dhabi Pension Fund — new regime"],
  ["sssf", "Sharjah Social Security Fund"],
  ["gcc", "GCC extension of protection"],
].map(([value, label]) => ({ value, label }));

export function newUaeProfile(effectiveFrom = ""): UaeEmployeeProfile {
  return {
    jurisdiction: "federal",
    effectiveFrom,
    nationality: "",
    basicSalary: 0,
    allowances: [],
    normalDailyHours: 8,
    workPattern: "full_time",
    pension: { scheme: "none" },
    iloe: { mode: "employee_paid" },
    healthInsuranceEmployer: 0,
    savings: { scheme: "gratuity" },
    wps: {},
  };
}

export function UaeProfileForm({
  value,
  onChange,
}: {
  value: UaeEmployeeProfile;
  onChange: (profile: UaeEmployeeProfile) => void;
}) {
  const patch = (fields: Partial<UaeEmployeeProfile>) => onChange({ ...value, ...fields });
  const pension = value.pension || { scheme: "none" as const };
  const setPension = (fields: Partial<NonNullable<UaeEmployeeProfile["pension"]>>) =>
    patch({ pension: { ...pension, ...fields } });
  const setSavings = (fields: Partial<UaeEmployeeProfile["savings"]>) =>
    patch({ savings: { ...value.savings, ...fields } });
  return (
    <div className="space-y-5">
      <p className="text-sm text-gray-500">
        Amounts are monthly AED. Select the employee’s actual legal jurisdiction and pension
        registration. Changes to an existing profile must start on the first of a month. Existing
        payroll snapshots keep their original profile.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField
          label="Employment jurisdiction"
          aria-label="Employment jurisdiction"
          options={UAE_JURISDICTIONS}
          value={value.jurisdiction}
          onChange={(e) =>
            patch({ jurisdiction: e.target.value as UaeEmployeeProfile["jurisdiction"] })
          }
        />
        <Input
          label="Profile effective from"
          aria-label="Profile effective from"
          type="date"
          value={value.effectiveFrom}
          onChange={(e) => patch({ effectiveFrom: e.target.value })}
        />
        <Input
          label="Nationality (ISO country code)"
          aria-label="Nationality (ISO country code)"
          placeholder="AE, IN, SA…"
          maxLength={2}
          value={value.nationality}
          onChange={(e) => patch({ nationality: e.target.value.toUpperCase() })}
        />
        <SelectField
          label="Work pattern"
          aria-label="Work pattern"
          value={value.workPattern || "full_time"}
          options={[
            { value: "full_time", label: "Full time" },
            { value: "part_time", label: "Part time" },
            { value: "temporary", label: "Temporary" },
            { value: "domestic", label: "Domestic worker — separate rules" },
          ]}
          onChange={(e) =>
            patch({ workPattern: e.target.value as UaeEmployeeProfile["workPattern"] })
          }
        />
        <UaeMoneyField
          label="Monthly basic salary"
          value={value.basicSalary}
          required
          onChange={(amount) => patch({ basicSalary: amount ?? NaN })}
        />
        <UaeNumberField
          label="Normal daily working hours"
          value={value.normalDailyHours}
          max={12}
          onChange={(hours) => patch({ normalDailyHours: hours ?? NaN })}
        />
        <Input
          label="Probation ends on"
          aria-label="Probation ends on"
          type="date"
          value={value.probationEndsOn || ""}
          onChange={(e) => patch({ probationEndsOn: e.target.value || null })}
        />
        <UaeNumberField
          label="Salary due day next month (optional)"
          value={value.salaryPaymentDay}
          integer
          max={28}
          onChange={(day) => patch({ salaryPaymentDay: day })}
        />
      </div>
      <UaeCheckbox
        label="Shift worker"
        checked={value.isShiftWorker}
        onChange={(isShiftWorker) => patch({ isShiftWorker })}
      />
      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 font-medium">Fixed monthly allowances</legend>
        {value.allowances.map((row, index) => (
          <div key={index} className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              aria-label={`Allowance ${index + 1} name`}
              label="Allowance name"
              value={row.name}
              onChange={(e) =>
                patch({
                  allowances: value.allowances.map((item, i) =>
                    i === index ? { ...item, name: e.target.value } : item,
                  ),
                })
              }
            />
            <UaeMoneyField
              label={`Allowance ${index + 1}`}
              value={row.amount}
              required
              onChange={(amount) =>
                patch({
                  allowances: value.allowances.map((item, i) =>
                    i === index ? { ...item, amount: amount ?? NaN } : item,
                  ),
                })
              }
            />
            <Button
              variant="outline"
              size="sm"
              aria-label={`Remove allowance ${index + 1}`}
              onClick={() => patch({ allowances: value.allowances.filter((_, i) => i !== index) })}
            >
              Remove
            </Button>
          </div>
        ))}
        <Button
          size="sm"
          variant="outline"
          onClick={() => patch({ allowances: [...value.allowances, { name: "", amount: 0 }] })}
        >
          Add allowance
        </Button>
      </fieldset>
      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 font-medium">Pension registration</legend>
        <p className="text-xs text-gray-500">
          Use the authority’s registered contribution salary and applicable salary year. This is not
          prorated earned pay.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField
            label="Pension authority and regime"
            aria-label="Pension authority and regime"
            options={PENSIONS}
            value={pension.scheme}
            onChange={(e) => setPension({ scheme: e.target.value as UaePensionScheme })}
          />
          <SelectField
            label="Pension sector"
            aria-label="Pension sector"
            value={pension.sector || "private"}
            options={[
              { value: "private", label: "Private" },
              { value: "government", label: "Government" },
            ]}
            onChange={(e) => setPension({ sector: e.target.value as "private" | "government" })}
          />
        </div>
        {pension.scheme === "none" && (
          <Input
            label="Pension authority exemption reference (required for UAE / GCC nationals)"
            aria-label="Pension authority exemption reference"
            value={pension.authorityReference || ""}
            onChange={(e) => setPension({ authorityReference: e.target.value || undefined })}
          />
        )}
        {pension.scheme !== "none" && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                type="date"
                label="First insured / membership date"
                aria-label="First insured / membership date"
                value={pension.firstInsuredOn || ""}
                onChange={(e) => setPension({ firstInsuredOn: e.target.value || undefined })}
              />
              <UaeMoneyField
                label="Registered pension contribution salary"
                value={pension.contributionSalary}
                onChange={(contributionSalary) => setPension({ contributionSalary })}
              />
              <UaeNumberField
                label="Pension salary reference year"
                integer
                value={pension.salaryYear}
                onChange={(salaryYear) => setPension({ salaryYear })}
              />
              <Input
                label="Pension authority reference"
                aria-label="Pension authority reference"
                value={pension.authorityReference || ""}
                onChange={(e) => setPension({ authorityReference: e.target.value || undefined })}
              />
            </div>
            {pension.scheme === "gcc" && (
              <div className="space-y-3 rounded bg-gray-50 p-3 dark:bg-gray-800">
                <p className="text-xs text-gray-500">
                  Enter the home-country authority’s approved rates and salary limits; rates are
                  percentages.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["employeeRate", "GCC employee rate (%)"],
                      ["employerRate", "GCC employer rate (%)"],
                      ["governmentRate", "GCC government rate (%)"],
                    ] as const
                  ).map(([key, label]) => (
                    <UaeNumberField
                      key={key}
                      label={label}
                      value={pension.gcc?.[key]}
                      max={100}
                      onChange={(rate) =>
                        setPension({
                          gcc: {
                            employeeRate: 0,
                            employerRate: 0,
                            minimumSalary: 0,
                            maximumSalary: 0,
                            effectiveFrom: "",
                            reference: "",
                            ...pension.gcc,
                            [key]: rate ?? 0,
                          },
                        })
                      }
                    />
                  ))}
                  {(
                    [
                      ["minimumSalary", "GCC minimum salary"],
                      ["maximumSalary", "GCC maximum salary"],
                    ] as const
                  ).map(([key, label]) => (
                    <UaeMoneyField
                      key={key}
                      label={label}
                      value={pension.gcc?.[key]}
                      onChange={(amount) =>
                        setPension({
                          gcc: {
                            employeeRate: 0,
                            employerRate: 0,
                            minimumSalary: 0,
                            maximumSalary: 0,
                            effectiveFrom: "",
                            reference: "",
                            ...pension.gcc,
                            [key]: amount ?? 0,
                          },
                        })
                      }
                    />
                  ))}
                  {(
                    [
                      ["effectiveFrom", "GCC rates effective from"],
                      ["effectiveTo", "GCC rates effective until"],
                      ["reference", "GCC authority approval reference"],
                    ] as const
                  ).map(([key, label]) => (
                    <Input
                      key={key}
                      label={label}
                      aria-label={label}
                      type={key === "reference" ? "text" : "date"}
                      value={pension.gcc?.[key] || ""}
                      onChange={(e) =>
                        setPension({
                          gcc: {
                            employeeRate: 0,
                            employerRate: 0,
                            minimumSalary: 0,
                            maximumSalary: 0,
                            effectiveFrom: "",
                            reference: "",
                            ...pension.gcc,
                            [key]: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  ))}
                </div>
              </div>
            )}
            <details className="space-y-3">
              <summary className="cursor-pointer text-sm font-medium">
                Authority-approved pension adjustment for a specific month
              </summary>
              <UaeCheckbox
                label="Use reviewed contribution amounts for a specific month"
                checked={!!pension.approvedPeriodAmounts}
                onChange={(enabled) =>
                  setPension({
                    approvedPeriodAmounts: enabled
                      ? {
                          employee: 0,
                          employer: 0,
                          government: 0,
                          reference: "",
                          month: new Date().getMonth() + 1,
                          year: new Date().getFullYear(),
                        }
                      : undefined,
                  })
                }
              />
              {pension.approvedPeriodAmounts && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {(
                    [
                      ["employee", "Approved employee pension"],
                      ["employer", "Approved employer pension"],
                      ["government", "Approved government pension"],
                    ] as const
                  ).map(([key, label]) => (
                    <UaeMoneyField
                      key={key}
                      label={label}
                      value={pension.approvedPeriodAmounts![key]}
                      required
                      onChange={(amount) =>
                        setPension({
                          approvedPeriodAmounts: {
                            ...pension.approvedPeriodAmounts!,
                            [key]: amount ?? NaN,
                          },
                        })
                      }
                    />
                  ))}
                  <Input
                    label="Adjustment approval reference"
                    aria-label="Adjustment approval reference"
                    value={pension.approvedPeriodAmounts.reference}
                    onChange={(e) =>
                      setPension({
                        approvedPeriodAmounts: {
                          ...pension.approvedPeriodAmounts!,
                          reference: e.target.value,
                        },
                      })
                    }
                  />
                  {(
                    [
                      ["month", "Adjustment month"],
                      ["year", "Adjustment year"],
                    ] as const
                  ).map(([key, label]) => (
                    <UaeNumberField
                      key={key}
                      label={label}
                      integer
                      max={key === "month" ? 12 : undefined}
                      value={pension.approvedPeriodAmounts![key]}
                      onChange={(number) =>
                        setPension({
                          approvedPeriodAmounts: {
                            ...pension.approvedPeriodAmounts!,
                            [key]: number ?? NaN,
                          },
                        })
                      }
                    />
                  ))}
                </div>
              )}
            </details>
          </>
        )}
      </fieldset>
      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 font-medium">ILOE and health insurance</legend>
        <SelectField
          label="ILOE payment arrangement"
          aria-label="ILOE payment arrangement"
          value={value.iloe.mode}
          options={[
            { value: "employee_paid", label: "Employee pays insurer directly" },
            { value: "employer_collected", label: "Employer collects an actual premium when due" },
            { value: "exempt", label: "Exempt — record reason" },
          ]}
          onChange={(e) =>
            patch({
              iloe: { ...value.iloe, mode: e.target.value as UaeEmployeeProfile["iloe"]["mode"] },
            })
          }
        />
        <p className="text-xs text-gray-500">
          Selecting employer collection does not create a recurring deduction. Enter each actual
          policy premium in the payroll period.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            label="ILOE policy reference"
            aria-label="ILOE policy reference"
            value={value.iloe.policyReference || ""}
            onChange={(e) =>
              patch({ iloe: { ...value.iloe, policyReference: e.target.value || undefined } })
            }
          />
          {value.iloe.mode === "exempt" && (
            <Input
              label="ILOE exemption reason"
              aria-label="ILOE exemption reason"
              value={value.iloe.exemptionReason || ""}
              onChange={(e) => patch({ iloe: { ...value.iloe, exemptionReason: e.target.value } })}
            />
          )}
          <Input
            type="date"
            label="ILOE policy starts on"
            aria-label="ILOE policy starts on"
            value={value.iloe.policyStartsOn || ""}
            onChange={(e) =>
              patch({ iloe: { ...value.iloe, policyStartsOn: e.target.value || undefined } })
            }
          />
          <SelectField
            label="ILOE policy term"
            aria-label="ILOE policy term"
            value={value.iloe.policyMonths || ""}
            options={[
              { value: "", label: "Select if applicable" },
              { value: "12", label: "12 months" },
              { value: "24", label: "24 months" },
            ]}
            onChange={(e) =>
              patch({
                iloe: {
                  ...value.iloe,
                  policyMonths: e.target.value ? (Number(e.target.value) as 12 | 24) : undefined,
                },
              })
            }
          />
          <SelectField
            label="ILOE payment frequency"
            aria-label="ILOE payment frequency"
            value={value.iloe.paymentFrequency || ""}
            options={[
              { value: "", label: "Select if applicable" },
              ...[
                ["monthly", "Monthly"],
                ["quarterly", "Quarterly"],
                ["semi_annually", "Every six months"],
                ["annually", "Annually"],
                ["in_full", "In full"],
              ].map(([option, label]) => ({ value: option, label })),
            ]}
            onChange={(e) =>
              patch({
                iloe: {
                  ...value.iloe,
                  paymentFrequency:
                    (e.target.value as UaeEmployeeProfile["iloe"]["paymentFrequency"]) || undefined,
                },
              })
            }
          />
          <UaeMoneyField
            label="Monthly employer health insurance cost"
            value={value.healthInsuranceEmployer}
            required
            onChange={(amount) => patch({ healthInsuranceEmployer: amount ?? NaN })}
          />
        </div>
      </fieldset>
      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 font-medium">End-of-service savings</legend>
        {value.jurisdiction === "difc" && pension.scheme !== "none" && (
          <p className="text-xs text-gray-500">
            For DIFC pension members, record the reviewed qualifying-scheme top-up below, including
            zero with its assessment reference, or a documented exemption.
          </p>
        )}
        <SelectField
          label="Savings / gratuity scheme"
          aria-label="Savings / gratuity scheme"
          value={value.savings.scheme}
          options={[
            ["gratuity", "Traditional gratuity"],
            ["federal_savings", "Federal alternative savings scheme"],
            ["dews", "DIFC DEWS"],
            ["alternative", "Approved alternative scheme"],
          ].map(([option, label]) => ({ value: option, label }))}
          onChange={(e) =>
            setSavings({ scheme: e.target.value as UaeEmployeeProfile["savings"]["scheme"] })
          }
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input
            type="date"
            label="Savings enrollment date"
            aria-label="Savings enrollment date"
            value={value.savings.enrolledOn || ""}
            onChange={(e) => setSavings({ enrolledOn: e.target.value || undefined })}
          />
          <Input
            type="date"
            label="Continuous service start date"
            aria-label="Continuous service start date"
            value={value.savings.continuousServiceStartDate || ""}
            onChange={(e) =>
              setSavings({ continuousServiceStartDate: e.target.value || undefined })
            }
          />
          <Input
            label="Scheme exemption / election reference"
            aria-label="Scheme exemption / election reference"
            value={value.savings.exemptionReference || ""}
            onChange={(e) => setSavings({ exemptionReference: e.target.value || undefined })}
          />
        </div>
        <UaeApprovedFields
          label="Approved monthly scheme contribution"
          value={value.savings.approvedMonthlyContribution}
          onChange={(approvedMonthlyContribution) => setSavings({ approvedMonthlyContribution })}
        />
        <UaeApprovedFields
          label="Preserved gratuity before enrollment"
          value={value.savings.frozenGratuity}
          onChange={(approved) =>
            setSavings({
              frozenGratuity: approved
                ? { ...approved, asOf: value.savings.frozenGratuity?.asOf || "" }
                : undefined,
            })
          }
        />
        {value.savings.frozenGratuity && (
          <Input
            type="date"
            label="Preserved gratuity as of"
            aria-label="Preserved gratuity as of"
            value={value.savings.frozenGratuity.asOf}
            onChange={(e) =>
              setSavings({
                frozenGratuity: { ...value.savings.frozenGratuity!, asOf: e.target.value },
              })
            }
          />
        )}
      </fieldset>
      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 font-medium">Gratuity liability opening history</legend>
        <p className="text-xs text-gray-500">
          For each reporting month, record a verified opening baseline dated exactly the previous
          month-end. Include cumulative unpaid service and gratuity already paid; confirm zero
          values against the employee’s records. An older baseline does not roll forward
          automatically.
        </p>
        <UaeCheckbox
          label="Verified gratuity history is available"
          checked={!!value.gratuityHistory}
          onChange={(enabled) =>
            patch({
              gratuityHistory: enabled
                ? { asOf: "", cumulativeUnpaidServiceDays: 0, settlementsPaid: 0, reference: "" }
                : undefined,
            })
          }
        />
        {value.gratuityHistory && (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="History verified as of"
                aria-label="History verified as of"
                type="date"
                value={value.gratuityHistory.asOf}
                onChange={(e) =>
                  patch({ gratuityHistory: { ...value.gratuityHistory!, asOf: e.target.value } })
                }
              />
              <UaeNumberField
                label="Cumulative unpaid service days"
                value={value.gratuityHistory.cumulativeUnpaidServiceDays}
                onChange={(days) =>
                  patch({
                    gratuityHistory: {
                      ...value.gratuityHistory!,
                      cumulativeUnpaidServiceDays: days ?? NaN,
                    },
                  })
                }
              />
              <UaeMoneyField
                label="Gratuity settlements paid through baseline"
                value={value.gratuityHistory.settlementsPaid}
                required
                onChange={(amount) =>
                  patch({
                    gratuityHistory: { ...value.gratuityHistory!, settlementsPaid: amount ?? NaN },
                  })
                }
              />
              <Input
                label="Service and settlement history evidence"
                aria-label="Service and settlement history evidence"
                value={value.gratuityHistory.reference}
                onChange={(e) =>
                  patch({
                    gratuityHistory: { ...value.gratuityHistory!, reference: e.target.value },
                  })
                }
              />
            </div>
            <UaeApprovedFields
              label="Reviewed annual benefit wage (ADGM)"
              value={value.gratuityHistory.annualWage}
              onChange={(annualWage) =>
                patch({ gratuityHistory: { ...value.gratuityHistory!, annualWage } })
              }
            />
          </>
        )}
      </fieldset>
      <fieldset className="space-y-3 rounded-lg border p-3">
        <legend className="px-1 font-medium">Wage Protection System</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {(
            [
              ["employeeId", "WPS employee / labour ID"],
              ["routingCode", "Employee bank / agent routing code"],
              ["accountNumber", "WPS IBAN / account number"],
            ] as const
          ).map(([key, label]) => (
            <Input
              key={key}
              label={label}
              aria-label={label}
              value={value.wps[key] || ""}
              onChange={(e) => patch({ wps: { ...value.wps, [key]: e.target.value || undefined } })}
            />
          ))}
        </div>
        <UaeCheckbox
          label="Documented WPS exemption"
          checked={!!value.wps.exemption}
          onChange={(enabled) =>
            patch({
              wps: { ...value.wps, exemption: enabled ? { reason: "", reference: "" } : undefined },
            })
          }
        />
        {value.wps.exemption && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="WPS exemption reason"
              aria-label="WPS exemption reason"
              value={value.wps.exemption.reason}
              onChange={(e) =>
                patch({
                  wps: {
                    ...value.wps,
                    exemption: { ...value.wps.exemption!, reason: e.target.value },
                  },
                })
              }
            />
            <Input
              label="WPS exemption approval reference"
              aria-label="WPS exemption approval reference"
              value={value.wps.exemption.reference}
              onChange={(e) =>
                patch({
                  wps: {
                    ...value.wps,
                    exemption: { ...value.wps.exemption!, reference: e.target.value },
                  },
                })
              }
            />
          </div>
        )}
      </fieldset>
    </div>
  );
}
