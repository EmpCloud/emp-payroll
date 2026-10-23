import { useEffect, useState } from "react";
import type { UaeEmployeeProfile, UaePeriodInput, UaePayrollResult } from "@emp-payroll/shared";
import { api, apiGet, apiPost } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { UaeCheckbox, UaeMoneyField } from "./UaeFields";
import { UaePeriodForm } from "./UaePeriodForm";
import {
  assertUaeFormValues,
  filsToAed,
  saveUaeDownload,
  uaeRequestError,
  uaeEvidenceAmount,
  uaeDownloadFilename,
} from "@/lib/uae-payroll";
import toast from "react-hot-toast";

type PaymentStatus = "submitted" | "accepted" | "rejected" | "paid" | "refunded";
interface UaeBankFormat {
  id: string;
  label: string;
  available: boolean;
  requirement: string;
  source: string;
}
interface UaeRunItem {
  id: string;
  global_employee_id: string;
  employee_name: string;
  net_salary: number;
  uae_profile?: UaeEmployeeProfile | null;
  uae_calculation?: UaePayrollResult | null;
  uae_input?: UaePeriodInput;
  uae_payment?: {
    status: PaymentStatus;
    reference: string;
    paidAmount: number;
    paidOn?: string;
    recordedAt?: string;
  } | null;
}
interface UaeRun {
  id: string;
  status: string;
  period_month: number;
  period_year: number;
  uae_revision: number;
  uae_schedule?: { lockDaysBeforeDue: number; approvalDaysBeforeDue: number };
  uae_calendar?: {
    lockDate: string;
    approvalDate: string;
    paymentDueDate: string;
    reminders: string[];
    isOverdue: boolean;
  };
  uae_inputs?: Record<string, UaePeriodInput>;
  items?: UaeRunItem[];
  payment_summary?: {
    fullyPaid: boolean;
    paidAmount: number;
    netDue: number;
    wpsThresholdMet: boolean | null;
    warnings?: string[];
  };
}

export function UaeRunDetails({
  run,
  onChanged,
  onDirtyChange,
  dirty,
}: {
  run: UaeRun;
  onChanged: () => void | Promise<void>;
  onDirtyChange: (dirty: boolean) => void;
  dirty: boolean;
}) {
  const items = run.items || [];
  const [inputs, setInputs] = useState<Record<string, UaePeriodInput>>(
    () =>
      run.uae_inputs ||
      Object.fromEntries(items.map((item) => [item.global_employee_id, item.uae_input || {}])),
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [schedule, setSchedule] = useState(
    run.uae_schedule || { lockDaysBeforeDue: 5, approvalDaysBeforeDue: 3 },
  );
  const [inputRevision, setInputRevision] = useState(Number(run.uae_revision));
  const staleInputs = dirty && inputRevision !== Number(run.uae_revision);
  const reloadInputs = () => {
    setInputs(
      run.uae_inputs ||
        Object.fromEntries(items.map((item) => [item.global_employee_id, item.uae_input || {}])),
    );
    setSchedule(run.uae_schedule || { lockDaysBeforeDue: 5, approvalDaysBeforeDue: 3 });
    setInputRevision(Number(run.uae_revision));
    onDirtyChange(false);
  };
  useEffect(() => {
    if (!dirty) {
      setInputs(
        run.uae_inputs ||
          Object.fromEntries(
            (run.items || []).map((item) => [item.global_employee_id, item.uae_input || {}]),
          ),
      );
      setSchedule(run.uae_schedule || { lockDaysBeforeDue: 5, approvalDaysBeforeDue: 3 });
      setInputRevision(Number(run.uae_revision));
    }
  }, [run.uae_revision, run.uae_inputs, run.items, run.uae_schedule, dirty]);
  const [unlockReason, setUnlockReason] = useState("");
  const [wps, setWps] = useState({ employerId: "", employerRoutingCode: "", reference: "" });
  const [bankFormat, setBankFormat] = useState("dib-v1.1");
  const [includeEvp, setIncludeEvp] = useState(false);
  const {
    data: bankFormatsResponse,
    isError: bankFormatsError,
    refetch: refetchBankFormats,
  } = useQuery({
    queryKey: ["uae-bank-formats"],
    queryFn: () => apiGet<UaeBankFormat[]>("/global/uae/bank-formats"),
  });
  const bankFormats = bankFormatsResponse?.data || [];
  const selectedBankFormat = bankFormats.find((format) => format.id === bankFormat);
  const optionalEvp = bankFormat === "mohre-sif" || bankFormat === "rakbank-sif";
  const [payment, setPayment] = useState({
    employeeId: items[0]?.global_employee_id || "",
    status: "submitted" as PaymentStatus,
    reference: "",
    paidAmount: 0,
    paidOn: "",
  });
  const approved = run.status === "approved" || run.status === "paid";
  const canExportWps =
    run.status === "approved" &&
    !items.some((item) => item.uae_payment?.status === "paid") &&
    items.some(
      (item) =>
        item.uae_calculation?.jurisdiction === "federal" && !item.uae_calculation.wps.exemption,
    );
  const hasSnapshots =
    items.length > 0 && items.every((item) => !!item.uae_calculation && !!item.uae_profile);

  const recalculate = async () => {
    try {
      assertUaeFormValues(inputs);
      setBusy("recalculate");
      await apiPost(`/global/payroll-runs/${run.id}/uae/recalculate`, {
        uaeInputs: inputs,
        uaeSchedule: schedule,
        expectedRevision: inputRevision,
      });
      toast.success("UAE payroll recalculated. Review the updated amounts before approval.");
      await onChanged();
      onDirtyChange(false);
    } catch (error) {
      toast.error(await uaeRequestError(error));
      await onChanged();
    } finally {
      setBusy(null);
    }
  };
  const changeLock = async (unlock: boolean) => {
    if (unlock && !unlockReason.trim()) {
      toast.error("Enter the reason for reopening payroll inputs.");
      return;
    }
    try {
      setBusy(unlock ? "unlock" : "lock");
      await apiPost(`/global/payroll-runs/${run.id}/uae/${unlock ? "unlock" : "lock"}`, {
        expectedRevision: Number(run.uae_revision),
        ...(unlock ? { reason: unlockReason.trim() } : {}),
      });
      toast.success(
        unlock ? "Payroll reopened for corrections" : "Payroll inputs locked for approval",
      );
      setUnlockReason("");
      await onChanged();
    } catch (error) {
      toast.error(await uaeRequestError(error));
    } finally {
      setBusy(null);
    }
  };
  const payslip = async (item: UaeRunItem, print: boolean) => {
    const preview = print ? window.open("", "_blank") : null;
    if (print && !preview) {
      toast.error("Allow pop-ups to view and print the payslip, or use Download payslip.");
      return;
    }
    if (preview) preview.opener = null;
    try {
      setBusy(`payslip-${item.id}`);
      const { data } = await api.get<Blob>(
        `/global/payroll-runs/${run.id}/uae/payslips/${item.id}`,
        { responseType: "blob" },
      );
      const html = new Blob([data], { type: "text/html;charset=utf-8" });
      if (preview) {
        const url = URL.createObjectURL(html);
        preview.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else
        saveUaeDownload(html, `uae-payslip-${run.period_year}-${run.period_month}-${item.id}.html`);
    } catch (error) {
      preview?.close();
      toast.error(await uaeRequestError(error));
    } finally {
      setBusy(null);
    }
  };
  const exportWps = async () => {
    if (!wps.employerId.trim() || !wps.employerRoutingCode.trim() || !wps.reference.trim()) {
      toast.error("Enter the employer ID, bank routing code and export reference.");
      return;
    }
    try {
      setBusy("wps");
      const { data, headers } = await api.post<Blob>(
        `/global/payroll-runs/${run.id}/uae/wps`,
        { ...wps, bankFormat, includeEvp: optionalEvp ? includeEvp : true },
        { responseType: "blob" },
      );
      saveUaeDownload(
        data,
        uaeDownloadFilename(
          headers["content-disposition"],
          `uae-wps-${run.period_year}-${run.period_month}-${run.id}.sif`,
        ),
      );
      toast.success(
        "WPS file downloaded. Submit it through your bank and record the response below.",
      );
      onChanged();
    } catch (error) {
      toast.error(await uaeRequestError(error));
    } finally {
      setBusy(null);
    }
  };
  const recordPayment = async () => {
    if (!payment.employeeId || !payment.reference.trim()) {
      toast.error("Choose an employee and enter the bank / payment evidence reference.");
      return;
    }
    if ((payment.status === "paid" || payment.status === "refunded") && !payment.paidOn) {
      toast.error("Enter the actual payment or refund date.");
      return;
    }
    try {
      assertUaeFormValues(payment);
      setBusy("payment");
      await apiPost(`/global/payroll-runs/${run.id}/uae/payments`, {
        ...payment,
        paidOn: payment.paidOn || undefined,
      });
      toast.success("Payment evidence recorded");
      setPayment({ ...payment, reference: "" });
      onChanged();
    } catch (error) {
      toast.error(await uaeRequestError(error));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="space-y-5">
      {staleInputs && (
        <div role="alert" className="space-y-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          <p>
            This payroll run changed while you were editing. Reload the saved inputs and reapply
            your changes before saving.
          </p>
          <Button variant="outline" onClick={reloadInputs}>
            Reload saved inputs
          </Button>
        </div>
      )}
      {run.uae_calendar && (
        <section
          aria-label="UAE payroll calendar"
          className={`space-y-3 rounded-lg border p-4 ${run.uae_calendar.isOverdue ? "border-amber-300 bg-amber-50" : "bg-gray-50 dark:bg-gray-800"}`}
        >
          <h3 className="font-semibold">Payroll calendar</h3>
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt>Lock inputs by</dt>
              <dd className="font-medium">{run.uae_calendar.lockDate}</dd>
            </div>
            <div>
              <dt>Approve by</dt>
              <dd className="font-medium">{run.uae_calendar.approvalDate}</dd>
            </div>
            <div>
              <dt>Payment due by</dt>
              <dd className="font-medium">{run.uae_calendar.paymentDueDate}</dd>
            </div>
          </dl>
          {run.uae_calendar.reminders.map((reminder, index) => (
            <p key={index} role="status" className="text-sm">
              {reminder}
            </p>
          ))}
        </section>
      )}
      {run.status === "draft" && (
        <fieldset className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
          <legend className="px-1 text-sm font-medium">Payroll cutoffs</legend>
          <Input
            label="Lock inputs days before payment due"
            aria-label="Lock inputs days before payment due"
            type="number"
            min="0"
            max="31"
            value={schedule.lockDaysBeforeDue}
            onChange={(e) => {
              setSchedule({ ...schedule, lockDaysBeforeDue: Number(e.target.value) });
              onDirtyChange(true);
            }}
          />
          <Input
            label="Approve days before payment due"
            aria-label="Approve days before payment due"
            type="number"
            min="0"
            max="31"
            value={schedule.approvalDaysBeforeDue}
            onChange={(e) => {
              setSchedule({ ...schedule, approvalDaysBeforeDue: Number(e.target.value) });
              onDirtyChange(true);
            }}
          />
        </fieldset>
      )}
      {!hasSnapshots && (
        <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          This run has no complete UAE calculation snapshot. Configure the employees’ UAE profiles
          and recalculate a draft before approval or reporting.
        </p>
      )}
      <p className="text-xs text-gray-500">
        Amounts below use the employee profile saved with this run. Payslips and WPS exports become
        available after approval.
      </p>
      {items.map((item) => {
        const calc = item.uae_calculation;
        return (
          <details key={item.id} className="space-y-4 rounded-lg border p-4">
            <summary className="cursor-pointer text-sm font-medium">
              {item.employee_name} · Net AED {filsToAed(Number(item.net_salary))} ·{" "}
              {item.uae_payment?.status || "No payment evidence"}
            </summary>
            {calc && (
              <>
                <div className="grid gap-3 text-xs sm:grid-cols-3">
                  <p>
                    Jurisdiction: <strong>{calc.jurisdiction.toUpperCase()}</strong>
                  </p>
                  <p>
                    Salary due: <strong>{calc.paymentDueDate}</strong>
                  </p>
                  <p>
                    Pension due: <strong>{calc.pensionDueDate || "Not applicable"}</strong>
                  </p>
                  <p>
                    Savings due: <strong>{calc.savingsDueDate || "Not applicable"}</strong>
                  </p>
                  <p>
                    Paid days:{" "}
                    <strong>
                      {calc.paidDays} / {calc.totalDays}
                    </strong>
                  </p>
                  <p>
                    Profile from: <strong>{item.uae_profile?.effectiveFrom}</strong>
                  </p>
                </div>
                {calc.warnings.length > 0 && (
                  <ul className="list-inside list-disc rounded bg-amber-50 p-3 text-sm text-amber-900">
                    {calc.warnings.map((warning, index) => (
                      <li key={index}>{warning}</li>
                    ))}
                  </ul>
                )}
                <div className="grid gap-4 md:grid-cols-3">
                  {(
                    [
                      ["Earnings", calc.earnings],
                      ["Employee deductions", calc.deductions],
                      ["Employer contributions", calc.employerContributions],
                    ] as const
                  ).map(([title, lines]) => (
                    <div key={title}>
                      <h4 className="mb-2 text-sm font-semibold">{title}</h4>
                      <dl className="space-y-2 text-xs">
                        {lines.map((line, index) => (
                          <div key={`${line.code}-${index}`}>
                            <div className="flex justify-between gap-3">
                              <dt>{line.name}</dt>
                              <dd className="whitespace-nowrap font-mono">
                                AED {filsToAed(line.amount)}
                              </dd>
                            </div>
                            {line.reference && <p className="text-gray-500">{line.reference}</p>}
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
                {calc.finalSettlement && (
                  <p className="rounded bg-blue-50 p-3 text-sm text-blue-900">
                    Final settlement: gratuity AED {filsToAed(calc.finalSettlement.gratuity)}, leave
                    AED {filsToAed(calc.finalSettlement.leaveEncashment)}, notice AED{" "}
                    {filsToAed(calc.finalSettlement.noticePay)}. Due{" "}
                    {calc.finalSettlement.paymentDueDate}.
                  </p>
                )}
              </>
            )}
            {item.uae_payment && (
              <p className="text-xs text-gray-600">
                Latest evidence: {item.uae_payment.status} · {item.uae_payment.reference} · AED{" "}
                {filsToAed(item.uae_payment.paidAmount)}
                {item.uae_payment.paidOn ? ` · ${item.uae_payment.paidOn}` : ""}
              </p>
            )}
            {run.status === "draft" && (
              <UaePeriodForm
                value={inputs[item.global_employee_id] || {}}
                onChange={(input) => {
                  setInputs({ ...inputs, [item.global_employee_id]: input });
                  onDirtyChange(true);
                }}
                year={run.period_year}
                month={run.period_month}
              />
            )}
            {approved && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy || !calc}
                  onClick={() => payslip(item, false)}
                >
                  Download payslip
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!busy || !calc}
                  onClick={() => payslip(item, true)}
                >
                  View / print payslip
                </Button>
              </div>
            )}
          </details>
        );
      })}
      {run.status === "draft" && (
        <div className="flex flex-wrap gap-2">
          <Button disabled={!!busy || staleInputs} onClick={recalculate}>
            {busy === "recalculate" ? "Recalculating…" : "Save inputs and recalculate"}
          </Button>
          <Button
            variant="outline"
            disabled={!!busy || dirty || !hasSnapshots}
            onClick={() => changeLock(false)}
          >
            Lock inputs for approval
          </Button>
        </div>
      )}
      {run.status === "locked" && (
        <fieldset className="space-y-3 rounded-lg border p-4">
          <legend className="px-1 font-semibold">Inputs locked</legend>
          <p className="text-sm text-gray-500">
            Review the saved calculation and approve below. An administrator can reopen this run
            with a recorded reason.
          </p>
          <Input
            label="Reason for reopening payroll"
            aria-label="Reason for reopening payroll"
            value={unlockReason}
            onChange={(e) => setUnlockReason(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={!!busy || !unlockReason.trim()}
            onClick={() => changeLock(true)}
          >
            Reopen inputs
          </Button>
        </fieldset>
      )}
      {approved && hasSnapshots && (
        <>
          <fieldset className="space-y-3 rounded-lg border p-4">
            <legend className="px-1 font-semibold">WPS bank export</legend>
            <p className="text-xs text-gray-500">
              Bank SIF files include eligible federal employees. DIFC, ADGM and documented WPS
              exemptions are excluded. Have your receiving bank confirm this format before live
              upload. Downloading a file does not submit it to the bank or mark wages paid.
            </p>
            <SelectField
              label="Receiving bank format"
              aria-label="Receiving bank format"
              value={bankFormat}
              options={bankFormats.map((format) => ({
                value: format.id,
                label: format.label,
                disabled: !format.available,
              }))}
              onChange={(event) => {
                setBankFormat(event.target.value);
                setIncludeEvp(false);
              }}
            />
            {bankFormatsError && (
              <p role="alert" className="text-sm text-red-700">
                Bank formats could not be loaded.{" "}
                <button className="underline" onClick={() => refetchBankFormats()}>
                  Retry
                </button>
              </p>
            )}
            {selectedBankFormat && (
              <p className="text-xs text-gray-600">
                {selectedBankFormat.requirement}{" "}
                <a
                  href={selectedBankFormat.source}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Bank format reference
                </a>
              </p>
            )}
            {bankFormats
              .filter((format) => !format.available)
              .map((format) => (
                <p key={format.id} className="text-xs text-amber-800">
                  {format.label}: {format.requirement}
                </p>
              ))}
            {optionalEvp && (
              <UaeCheckbox
                label="Include EVP allowance records (confirm bank acceptance)"
                checked={includeEvp}
                onChange={setIncludeEvp}
              />
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <Input
                label="WPS employer ID"
                aria-label="WPS employer ID"
                value={wps.employerId}
                onChange={(e) => setWps({ ...wps, employerId: e.target.value })}
              />
              <Input
                label="Employer bank routing code"
                aria-label="Employer bank routing code"
                value={wps.employerRoutingCode}
                onChange={(e) => setWps({ ...wps, employerRoutingCode: e.target.value })}
              />
              <Input
                label="Bank export reference"
                aria-label="Bank export reference"
                value={wps.reference}
                onChange={(e) => setWps({ ...wps, reference: e.target.value })}
              />
            </div>
            {!canExportWps && (
              <p className="text-xs text-gray-500">
                A bank export requires an approved run with eligible federal employees and no
                confirmed disbursements.
              </p>
            )}
            <Button
              variant="outline"
              disabled={!!busy || !canExportWps || !selectedBankFormat?.available}
              onClick={exportWps}
            >
              Download WPS SIF
            </Button>
          </fieldset>
          <fieldset id="uae-payment-reconciliation" className="space-y-3 rounded-lg border p-4">
            <legend className="px-1 font-semibold">Payment reconciliation</legend>
            <p className="text-xs text-gray-500">
              Record bank responses and actual payment evidence. Accepted or submitted files are not
              proof that wages were paid. Use the employee’s current confirmed paid amount, not a
              repeated payment increment.
            </p>
            {run.payment_summary && (
              <div className="rounded bg-gray-50 p-3 text-sm dark:bg-gray-800">
                <p>
                  Confirmed paid: AED {filsToAed(run.payment_summary.paidAmount)} · Net due: AED{" "}
                  {filsToAed(run.payment_summary.netDue)}
                </p>
                <p>
                  {run.payment_summary.fullyPaid
                    ? "All employee wages reconciled."
                    : "Employee wages still require reconciliation."}{" "}
                  WPS threshold:{" "}
                  {run.payment_summary.wpsThresholdMet == null
                    ? "Not applicable"
                    : run.payment_summary.wpsThresholdMet
                      ? "Met"
                      : "Not met"}
                  .
                </p>
                {run.payment_summary.warnings?.map((warning, index) => (
                  <p key={index} className="text-amber-700">
                    {warning}
                  </p>
                ))}
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                label="Employee"
                aria-label="Payment employee"
                options={items.map((item) => ({
                  value: item.global_employee_id,
                  label: item.employee_name,
                }))}
                value={payment.employeeId}
                onChange={(e) => {
                  const employee = items.find((item) => item.global_employee_id === e.target.value);
                  setPayment({
                    ...payment,
                    employeeId: e.target.value,
                    paidAmount: uaeEvidenceAmount(
                      payment.status,
                      Number(employee?.net_salary || 0),
                      Number(employee?.uae_payment?.paidAmount || 0),
                    ),
                    reference: "",
                  });
                }}
              />
              <SelectField
                label="Bank / payment status"
                aria-label="Bank / payment status"
                options={["submitted", "accepted", "rejected", "paid", "refunded"].map(
                  (status) => ({ value: status, label: status[0].toUpperCase() + status.slice(1) }),
                )}
                value={payment.status}
                onChange={(e) => {
                  const employee = items.find(
                    (item) => item.global_employee_id === payment.employeeId,
                  );
                  setPayment({
                    ...payment,
                    status: e.target.value as PaymentStatus,
                    paidAmount: uaeEvidenceAmount(
                      e.target.value,
                      Number(employee?.net_salary || 0),
                      Number(employee?.uae_payment?.paidAmount || 0),
                    ),
                  });
                }}
              />
              <Input
                label="Bank / evidence reference"
                aria-label="Bank / evidence reference"
                value={payment.reference}
                onChange={(e) => setPayment({ ...payment, reference: e.target.value })}
              />
              <UaeMoneyField
                label={
                  payment.status === "refunded" ? "Amount fully reversed" : "Confirmed paid amount"
                }
                value={payment.paidAmount}
                required
                onChange={(paidAmount) => setPayment({ ...payment, paidAmount: paidAmount ?? NaN })}
              />
              <Input
                label="Actual payment / refund date"
                aria-label="Actual payment / refund date"
                type="date"
                value={payment.paidOn}
                onChange={(e) => setPayment({ ...payment, paidOn: e.target.value })}
              />
            </div>
            <Button disabled={!!busy} onClick={recordPayment}>
              {busy === "payment" ? "Saving evidence…" : "Record bank response"}
            </Button>
          </fieldset>
        </>
      )}
    </div>
  );
}
