import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { GlobalEmployeeBulkMode, GlobalEmployeeBulkResult } from "@emp-payroll/shared";
import { GLOBAL_EMPLOYEE_CSV_MAX_BYTES, GLOBAL_EMPLOYEE_CSV_MAX_ROWS } from "@emp-payroll/shared";
import toast from "react-hot-toast";
import { api, apiPost } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";

const FIELD_LABELS: Record<string, string> = {
  employeeId: "Employee ID",
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  countryCode: "Country",
  countryId: "Country",
  employmentType: "Employment type",
  contractType: "Contract type",
  jobTitle: "Job title",
  department: "Department",
  startDate: "Start date",
  endDate: "End date",
  salaryAmount: "Salary amount",
  salaryFrequency: "Salary frequency",
  salaryCurrency: "Salary currency",
  empcloudUserId: "Linked EmpCloud employee",
  taxId: "Tax ID",
  bankName: "Bank name",
  bankAccount: "Bank account",
  bankRouting: "Bank routing code",
  notes: "Notes",
  status: "Status",
  uaeProfile: "UAE payroll profile",
};

function displayValue(value: string): string {
  return value === "" ? "Not set" : value;
}

async function errorMessage(error: unknown): Promise<string> {
  let body = (error as { response?: { data?: unknown } })?.response?.data;
  if (body instanceof Blob) {
    try {
      body = JSON.parse(await body.text());
    } catch {
      return "Unable to download the CSV. Please try again.";
    }
  }
  return (
    (body as { error?: { message?: string } })?.error?.message ||
    (error instanceof Error ? error.message : "Unable to process this CSV. Please try again.")
  );
}

export function GlobalEmployeeBulkModal({
  mode,
  onClose,
}: {
  mode: GlobalEmployeeBulkMode;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [csv, setCsv] = useState("");
  const [filename, setFilename] = useState("");
  const [result, setResult] = useState<GlobalEmployeeBulkResult | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const isUpdate = mode === "update";
  const canApply =
    !!result &&
    !result.applied &&
    result.invalid === 0 &&
    result.results.some((row) => row.changes.length > 0);

  const chooseFile = async (file?: File) => {
    if (!file || busy) return;
    setCsv("");
    setResult(null);
    setError("");
    setFilename(file.name);
    if (!/\.csv$/i.test(file.name)) {
      setError("Choose a CSV file. Spreadsheet workbooks must be saved as CSV first.");
      return;
    }
    if (file.size > GLOBAL_EMPLOYEE_CSV_MAX_BYTES) {
      setError("The CSV must be no larger than 2 MB.");
      return;
    }
    setBusy("read");
    try {
      const text = await file.text();
      if (!text.trim()) throw new Error("The CSV file is empty.");
      setCsv(text);
    } catch (cause) {
      setError(await errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const download = async (current: boolean) => {
    if (busy) return;
    setBusy(current ? "export" : "template");
    setError("");
    try {
      const { data, headers } = await api.get<Blob>(
        current ? "/global/employees/bulk/export" : "/global/employees/bulk/template",
        { responseType: "blob", ...(current ? {} : { params: { mode } }) },
      );
      const suppliedName = headers["content-disposition"]?.match(/filename="?([^";]+)"?/i)?.[1];
      const name =
        suppliedName && !/[\\/\r\n]/.test(suppliedName)
          ? suppliedName
          : `global-employees-${current ? "current" : `${mode}-template`}.csv`;
      const url = URL.createObjectURL(new Blob([data], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(await errorMessage(cause));
    } finally {
      setBusy(null);
    }
  };

  const submit = async (apply: boolean) => {
    if (busy || !csv || (apply && !canApply)) return;
    setBusy(apply ? "apply" : "preview");
    setError("");
    if (!apply) setResult(null);
    try {
      const response = await apiPost<GlobalEmployeeBulkResult>("/global/employees/bulk", {
        mode,
        csv,
        apply,
      });
      const next = response.data;
      if (!next) throw new Error("The server did not return a CSV preview. Please try again.");
      setResult(next);
      if (apply && next.applied) {
        await Promise.all([
          qc.invalidateQueries({ queryKey: ["global-employees"] }),
          qc.invalidateQueries({ queryKey: ["global-employee"] }),
          qc.invalidateQueries({ queryKey: ["global-employees-for-runs"] }),
          qc.invalidateQueries({ queryKey: ["global-dashboard"] }),
        ]);
        const changed = next.results.filter(
          (row) => row.status === "created" || row.status === "updated",
        ).length;
        const unchanged = next.results.filter((row) => row.status === "unchanged").length;
        toast.success(
          `${changed} employee${changed === 1 ? "" : "s"} ${isUpdate ? "updated" : "created"}.${unchanged ? ` ${unchanged} unchanged.` : ""}`,
        );
        onClose();
      } else if (next.invalid > 0) {
        setError(
          "No changes were applied. Correct the rows below, choose the revised CSV, and preview again.",
        );
      } else if (apply) {
        setError("No changes were applied. Preview the CSV again before retrying.");
        setResult(null);
      }
    } catch (cause) {
      setError(await errorMessage(cause));
      // Revalidate after a failed apply; never offer a stale preview as a retry.
      if (apply) setResult(null);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal
      open
      onClose={() => !busy && onClose()}
      title={isUpdate ? "Bulk update global employees" : "Bulk upload global employees"}
      description="Download a CSV, preview every row, then apply the validated changes."
      className="max-w-5xl"
    >
      <div className="space-y-5" aria-busy={!!busy}>
        <div className="space-y-2 rounded-lg bg-gray-50 p-4 text-sm dark:bg-gray-800">
          <p>CSV only, up to 2 MB and {GLOBAL_EMPLOYEE_CSV_MAX_ROWS} employee rows per upload.</p>
          <p>
            Use two-letter ISO country codes such as AE or IN. salaryAmount uses the major currency
            unit, for example 10000.00 for AED 10,000. Dates use YYYY-MM-DD.
          </p>
          {isUpdate ? (
            <p>
              For updates, employeeId identifies the employee. Blank cells leave existing values
              unchanged. Split larger exports into files of no more than{" "}
              {GLOBAL_EMPLOYEE_CSV_MAX_ROWS} employees.
            </p>
          ) : (
            <p>
              New employees start in onboarding. Statutory payroll profiles can be completed after
              upload.
            </p>
          )}
          <p>
            UAE salary changes require a complete matching uaeProfile. This optional advanced JSON
            field is preserved in the current-employees export; amounts inside it use minor currency
            units (fils), so AED 100.00 is 10000.
          </p>
          <details className="pt-1">
            <summary className="cursor-pointer font-medium">CSV field guide</summary>
            <dl className="mt-2 space-y-2">
              <div>
                <dt className="font-medium">Required for new employees</dt>
                <dd>
                  firstName, lastName, email, countryCode, employmentType, contractType, jobTitle,
                  startDate, salaryAmount. Leave employeeId and status blank.
                </dd>
              </div>
              <div>
                <dt className="font-medium">employmentType</dt>
                <dd>eor, contractor, direct_hire</dd>
              </div>
              <div>
                <dt className="font-medium">contractType</dt>
                <dd>full_time, part_time, fixed_term</dd>
              </div>
              <div>
                <dt className="font-medium">salaryFrequency</dt>
                <dd>monthly (default), biweekly, weekly, annual</dd>
              </div>
              <div>
                <dt className="font-medium">status (updates only)</dt>
                <dd>active, onboarding, offboarding, terminated</dd>
              </div>
            </dl>
          </details>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!!busy} onClick={() => download(false)}>
            {busy === "template" ? "Downloading…" : "Download template"}
          </Button>
          {isUpdate && (
            <Button variant="outline" disabled={!!busy} onClick={() => download(true)}>
              {busy === "export" ? "Downloading…" : "Download current employees"}
            </Button>
          )}
        </div>

        <div className="space-y-2">
          <label htmlFor={`global-employee-${mode}-csv`} className="block text-sm font-medium">
            CSV file
          </label>
          <input
            id={`global-employee-${mode}-csv`}
            type="file"
            accept=".csv,text/csv"
            disabled={!!busy}
            aria-describedby={`global-employee-${mode}-file-help`}
            className="block w-full rounded-lg border p-2 text-sm disabled:opacity-50"
            onChange={(event) => chooseFile(event.target.files?.[0])}
          />
          <p id={`global-employee-${mode}-file-help`} className="text-xs text-gray-500">
            {filename
              ? `Selected: ${filename}`
              : "Select a completed CSV to preview. Nothing is saved during preview."}
          </p>
          <Button disabled={!!busy || !csv} onClick={() => submit(false)}>
            {busy === "preview" ? "Validating…" : isUpdate ? "Preview updates" : "Preview upload"}
          </Button>
        </div>

        {error && (
          <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">
            {error}
          </p>
        )}

        {result && (
          <section aria-label="CSV preview" className="space-y-3">
            <p role="status" className="text-sm font-medium">
              {result.total} rows · {result.valid} valid · {result.invalid} errors
            </p>
            {result.invalid === 0 && !result.results.some((row) => row.changes.length > 0) && (
              <p className="text-sm text-gray-500">
                No employee changes were found. Edit the CSV and preview again to apply updates.
              </p>
            )}
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Employee changes from the uploaded CSV</caption>
                <thead className="bg-gray-50 dark:bg-gray-800">
                  <tr>
                    <th scope="col" className="p-3">
                      Row
                    </th>
                    <th scope="col" className="p-3">
                      Employee
                    </th>
                    <th scope="col" className="p-3">
                      Status
                    </th>
                    <th scope="col" className="p-3">
                      Changes and errors
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((row) => (
                    <tr key={row.row} className="border-t align-top">
                      <td className="p-3">{row.row}</td>
                      <td className="break-all p-3">{row.identifier || "Not supplied"}</td>
                      <td
                        className={`p-3 capitalize ${row.status === "error" ? "text-red-700" : "text-green-700"}`}
                      >
                        {row.status}
                      </td>
                      <td className="min-w-64 p-3">
                        {row.errors.length > 0 && (
                          <ul className="list-inside list-disc space-y-1 text-red-700">
                            {row.errors.map((message, index) => (
                              <li key={index}>{message}</li>
                            ))}
                          </ul>
                        )}
                        {row.changes.length > 0 ? (
                          <details className="mt-1">
                            <summary className="cursor-pointer font-medium">
                              View changes ({row.changes.length})
                            </summary>
                            <dl className="mt-2 space-y-3">
                              {row.changes.map((change, index) => (
                                <div key={`${change.field}-${index}`}>
                                  <dt className="font-medium">
                                    {FIELD_LABELS[change.field] ||
                                      change.field.replace(/([a-z])([A-Z])/g, "$1 $2")}
                                  </dt>
                                  <dd className="mt-1 whitespace-pre-wrap break-all text-xs">
                                    <span className="text-gray-500">
                                      {displayValue(change.before)}
                                    </span>
                                    {" → "}
                                    <span>{displayValue(change.after)}</span>
                                  </dd>
                                </div>
                              ))}
                            </dl>
                          </details>
                        ) : row.errors.length === 0 ? (
                          <p className="text-gray-500">No changes</p>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
          <Button variant="outline" disabled={!!busy} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!!busy || !canApply} onClick={() => submit(true)}>
            {busy === "apply" ? "Applying…" : isUpdate ? "Apply updates" : "Apply upload"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
