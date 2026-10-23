import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import type { UaeEmployeeProfile, UaePayrollResult, UaePeriodInput } from "@emp-payroll/shared";
import { apiPost, apiPut } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { UaePeriodForm } from "./UaePeriodForm";
import { assertUaeFormValues, filsToAed, uaeRequestError } from "@/lib/uae-payroll";
import toast from "react-hot-toast";

export interface UaeExitPreparation {
  globalEmployeeId: string;
  countryId: string;
  month: number;
  year: number;
  uaeInput: UaePeriodInput;
  uaeProfile: UaeEmployeeProfile;
  calculation: UaePayrollResult;
  preparedAt: string;
  preparedBy: string;
  runId?: string;
}
export interface UaeExitContext {
  isUae: boolean;
  exitId: string;
  employeeId: number;
  lastWorkingDate: string | null;
  employees: {
    id: string;
    name: string;
    countryId: string;
    status: string;
    startDate: string;
    endDate: string | null;
    profile: UaeEmployeeProfile | null;
    run: {
      id: string;
      status: string;
      month: number;
      year: number;
      revision: number;
      input: UaePeriodInput | null;
      calculation: UaePayrollResult | null;
      fnfCalculated: boolean;
      fnfPaid: boolean;
    } | null;
  }[];
  prepared: UaeExitPreparation | null;
  fnfCalculated: boolean;
  fnfPaid: boolean;
  warnings: string[];
}

export function UaeExitSettlement({
  context,
  closed,
}: {
  context: UaeExitContext;
  closed: boolean;
}) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const date = context.lastWorkingDate?.slice(0, 10) || "";
  const matchingPreparation =
    context.prepared?.uaeInput.finalSettlement?.terminationDate === date ? context.prepared : null;
  const initialId = matchingPreparation?.globalEmployeeId || context.employees[0]?.id || "";
  const inputFor = (id: string): UaePeriodInput => {
    const runInput = context.employees.find((employee) => employee.id === id)?.run?.input;
    const saved = runInput?.finalSettlement
      ? runInput
      : matchingPreparation?.globalEmployeeId === id
        ? matchingPreparation.uaeInput
        : context.employees.find((employee) => employee.id === id)?.run?.input;
    return saved
      ? structuredClone(saved)
      : {
          finalSettlement: {
            terminationDate: context.lastWorkingDate || "",
            unpaidServiceDays: 0,
            noticePayDirection: "employer_pays",
          },
        };
  };
  const [employeeId, setEmployeeId] = useState(initialId);
  const [input, setInput] = useState<UaePeriodInput>(() => inputFor(initialId));
  const [prepared, setPrepared] = useState(matchingPreparation);
  const [lastWorkingDate, setLastWorkingDate] = useState(date);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const employee = context.employees.find((item) => item.id === employeeId);
  const run = employee?.run;
  const editable = !closed && (!run || run.status === "draft");
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const calculation =
    run?.calculation || (prepared?.globalEmployeeId === employeeId ? prepared.calculation : null);

  const saveDate = async () => {
    try {
      if (!lastWorkingDate) throw new Error("Enter the last working date.");
      assertUaeFormValues({ lastWorkingDate });
      setSaving(true);
      await apiPut(`/exits/${context.exitId}`, { last_working_date: lastWorkingDate });
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["uae-exit", context.exitId] }),
        qc.invalidateQueries({ queryKey: ["exits"] }),
      ]);
      toast.success("Last working date saved. Review the settlement inputs for this date.");
    } catch (error) {
      toast.error(await uaeRequestError(error));
    } finally {
      setSaving(false);
    }
  };

  const prepare = async () => {
    try {
      assertUaeFormValues(input);
      if (!input.finalSettlement || input.finalSettlement.terminationDate !== date)
        throw new Error("Include a final settlement with the recorded last working date.");
      setSaving(true);
      const response = await apiPost<UaeExitPreparation>(
        `/exits/${context.exitId}/uae-settlement`,
        { globalEmployeeId: employeeId, uaeInput: input },
      );
      if (!response.data) throw new Error("The server did not return a prepared settlement.");
      setPrepared(response.data);
      setDirty(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["uae-exit", context.exitId] }),
        qc.invalidateQueries({ queryKey: ["exits"] }),
        qc.invalidateQueries({ queryKey: ["global-employees"] }),
        qc.invalidateQueries({ queryKey: ["global-employees-for-runs"] }),
        qc.invalidateQueries({ queryKey: ["global-payroll-runs"] }),
        qc.invalidateQueries({ queryKey: ["global-payroll-run"] }),
      ]);
      toast.success(
        "UAE settlement prepared. Review and approve it in payroll, then record payment evidence.",
      );
    } catch (error) {
      toast.error(await uaeRequestError(error));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="space-y-4 rounded-lg border border-blue-200 p-4">
      <h4 className="font-semibold">UAE final settlement</h4>
      <p className="text-sm text-gray-600">
        Preparation records the employee’s last working date and offboarding status. An approved
        payroll calculation completes the calculated checklist; confirmed full payment completes the
        paid checklist.
      </p>
      {context.warnings.map((warning, index) => (
        <p key={index} role="status" className="text-sm text-amber-800">
          {warning}
        </p>
      ))}
      {!closed && context.employees.every((item) => !item.run || item.run.status === "draft") && (
        <div className="flex flex-wrap items-end gap-3">
          <Input
            type="date"
            label="Recorded last working date"
            aria-label="Recorded last working date"
            value={lastWorkingDate}
            onChange={(event) => setLastWorkingDate(event.target.value)}
          />
          <Button
            variant="outline"
            disabled={saving || !lastWorkingDate || lastWorkingDate === date}
            onClick={saveDate}
          >
            Save exit date
          </Button>
        </div>
      )}
      <SelectField
        label="Linked UAE employment"
        aria-label="Linked UAE employment"
        value={employeeId}
        options={context.employees.map((item) => ({
          value: item.id,
          label: `${item.name} · ${item.profile?.jurisdiction.toUpperCase() || "Needs configuration"} · ${item.status}`,
        }))}
        onChange={(event) => {
          setEmployeeId(event.target.value);
          setInput(inputFor(event.target.value));
          setDirty(false);
        }}
      />
      {!employee?.profile && (
        <p role="alert" className="text-sm text-amber-800">
          Configure the linked employee’s UAE payroll profile before preparing settlement.{" "}
          {employee && (
            <a className="underline" href={`/global-payroll/employees/${employee.id}`}>
              Open employee profile
            </a>
          )}
        </p>
      )}
      {!date && (
        <p role="alert" className="text-sm text-amber-800">
          A recorded last working date is required before calculating UAE settlement.
        </p>
      )}
      {run && (
        <p className="text-sm">
          Payroll run: {run.month}/{run.year} · {run.status}. Approved settlement:{" "}
          {run.fnfCalculated ? "Yes" : "Pending"}. Payment reconciled:{" "}
          {run.fnfPaid ? "Yes" : "Pending"}.
        </p>
      )}
      {editable && date && (
        <UaePeriodForm
          value={input}
          onChange={(value) => {
            setInput(value);
            setDirty(true);
          }}
          year={year}
          month={month}
        />
      )}
      {!editable && !closed && (
        <p className="text-sm text-gray-600">
          This payroll run is {run?.status}. Reopen a locked run in payroll before preparing
          changes; approved settlements remain frozen.
        </p>
      )}
      {calculation && (
        <div className="space-y-2 rounded-lg bg-gray-50 p-3 text-sm dark:bg-gray-800">
          <p className="font-medium">
            {dirty ? "Last saved" : "Saved"} settlement calculation · Net AED{" "}
            {filsToAed(calculation.netSalary)} · Payment due {calculation.paymentDueDate}
          </p>
          {calculation.finalSettlement && (
            <p>
              Gratuity AED {filsToAed(calculation.finalSettlement.gratuity)} · Leave AED{" "}
              {filsToAed(calculation.finalSettlement.leaveEncashment)} · Notice AED{" "}
              {filsToAed(calculation.finalSettlement.noticePay)}
            </p>
          )}
          {calculation.warnings.map((warning, index) => (
            <p key={index} className="text-amber-800">
              {warning}
            </p>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {editable && (
          <Button disabled={saving || !employee?.profile || !date} onClick={prepare}>
            {saving ? "Preparing…" : "Prepare UAE settlement"}
          </Button>
        )}
        {(run || prepared?.globalEmployeeId === employeeId) && (
          <Button
            variant="outline"
            disabled={saving || dirty}
            onClick={() => {
              const selectedPreparation =
                prepared?.globalEmployeeId === employeeId ? prepared : null;
              navigate("/global-payroll/runs", {
                state: run
                  ? { uaeRunId: run.id }
                  : selectedPreparation
                    ? { uaeExitPreparation: selectedPreparation }
                    : null,
              });
            }}
          >
            {run || prepared?.runId ? "Open payroll run" : "Create payroll draft"}
          </Button>
        )}
      </div>
    </section>
  );
}
