import { useState, useRef } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { Upload, FileText, CheckCircle2, AlertCircle, Download, Loader2 } from "lucide-react";
import { apiGet, apiPost } from "@/api/client";
import toast from "react-hot-toast";

interface BulkUpdateModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

// Full column set the importer understands. The first column (Employee Code)
// is the preferred match key; Email is the fallback key when no code is given.
// Everything else is an editable field — blank cells are left untouched.
const TEMPLATE_HEADERS = [
  "Employee Code",
  "First Name",
  "Last Name",
  "Email",
  "Phone",
  "Department",
  "Location",
  "Designation",
  "Date of Joining",
  "Date of Birth",
  "Gender",
  "PAN",
  "Bank Name",
  "Account Number",
  "IFSC",
  "Tax Regime",
  "Deduct TDS",
  "Deduct Professional Tax",
  "Provident Fund",
  "UAN",
  "PF Number",
  "PF Rate",
  "PF Opted Out",
  "ESI Eligible",
  "ESI Number",
  "Dispensary",
];

export function BulkUpdateModal({ open, onClose, onSuccess }: BulkUpdateModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Record<string, string>[]>([]);
  const [importing, setImporting] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [result, setResult] = useState<{
    updated: number;
    failed: number;
    errors: string[];
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Split a single CSV line into fields, honouring double-quoted values so a
  // comma inside a quoted cell (e.g. "Sales, EMEA") doesn't split the row.
  // `""` inside a quoted field is an escaped quote.
  function splitCsvLine(line: string): string[] {
    const out: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQuotes) {
        if (ch === '"') {
          if (line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        out.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    out.push(cur);
    return out.map((v) => v.trim());
  }

  function parseCSV(text: string): Record<string, string>[] {
    const lines = text
      .trim()
      .split("\n")
      .map((l) => l.replace(/\r$/, ""))
      .filter(Boolean);
    if (lines.length < 2) return [];
    const headers = splitCsvLine(lines[0]);
    return lines.slice(1).map((line) => {
      const values = splitCsvLine(line);
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (row[h] && !values[i]) return;
        row[h] = values[i] || "";
      });
      return row;
    });
  }

  // Quote a cell for CSV output when it contains a comma, quote, or newline.
  function csvCell(v: unknown): string {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  // Case- / separator-insensitive header lookup (matches the Bulk Salary CSV
  // importer) so "Date of Joining", "date_of_joining", "DateOfJoining" all hit.
  function pick(row: Record<string, string>, ...candidates: string[]): string {
    const norm = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "");
    const wanted = candidates.map(norm);
    for (const key of Object.keys(row)) {
      if (wanted.includes(norm(key)) && row[key]) return row[key];
    }
    return "";
  }

  const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
  const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  function isValidDate(s: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(s);
    return !Number.isNaN(d.getTime()) && s === d.toISOString().slice(0, 10);
  }

  function handleFile(f: File) {
    setFile(f);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => setPreview(parseCSV(e.target?.result as string).slice(0, 5));
    reader.readAsText(f);
  }

  // Render a stored boolean as a Yes/No cell; blank when the value was never
  // set, so a round-trip re-upload leaves it untouched.
  function boolCell(v: unknown): string {
    return v === true ? "Yes" : v === false ? "No" : "";
  }
  function dateCell(v: unknown): string {
    if (!v) return "";
    const s = String(v);
    return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : s;
  }

  // Map one merged employee record to a template row (same column order as
  // TEMPLATE_HEADERS). Tolerates both camelCase and snake_case shapes.
  function employeeToRow(e: any): string[] {
    const tax = e.taxInfo || e.tax_info || {};
    const bank = e.bankDetails || e.bank_details || {};
    const pf = e.pfDetails || e.pf_details || {};
    const esi = e.esiDetails || e.esi_details || {};
    return [
      e.emp_code || e.empCode || e.employee_code || "",
      e.first_name || e.firstName || "",
      e.last_name || e.lastName || "",
      e.email || "",
      e.phone || e.contact_number || e.contactNumber || "",
      e.department || "",
      // Location is exported by name (matches Department behavior) so the
      // CSV is human-editable; backend resolves NAME → location_id on
      // update.
      e.location || e.location_name || "",
      e.designation || "",
      dateCell(e.date_of_joining || e.dateOfJoining),
      dateCell(e.date_of_birth || e.dateOfBirth),
      e.gender || "",
      tax.pan || "",
      bank.bankName || "",
      bank.accountNumber || "",
      bank.ifscCode || "",
      tax.regime || "",
      boolCell(tax.deductTDS),
      boolCell(tax.deductPT),
      boolCell(pf.providentFund),
      pf.uan || tax.uan || "",
      pf.pfNumber || "",
      pf.contributionRate ?? "",
      boolCell(pf.isOptedOut),
      boolCell(esi.isEligible),
      esi.esiNumber || "",
      esi.dispensary || "",
    ].map(csvCell);
  }

  // Download the CSV pre-filled with the org's existing employees so the admin
  // edits real rows and re-uploads. Falls back to a header-only file when the
  // org has no employees yet.
  async function downloadTemplate() {
    setDownloading(true);
    try {
      const res = await apiGet<any>("/employees", { limit: 10000, page: 1 });
      const employees: any[] = res?.data?.data ?? (Array.isArray(res?.data) ? res.data : []);
      const rows = employees.map((e) => employeeToRow(e).join(","));
      const csv = [TEMPLATE_HEADERS.join(","), ...rows].join("\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = "employee_bulk_update.csv";
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        employees.length
          ? `Downloaded ${employees.length} employee${employees.length === 1 ? "" : "s"}`
          : "No employees yet — downloaded an empty template",
      );
    } catch {
      toast.error("Could not load employees for the template");
    } finally {
      setDownloading(false);
    }
  }

  // Turn one CSV row into the structured payload the server merges. Only
  // non-empty cells are included so blanks never clobber existing data. Every
  // malformed cell is reported with the field name, the offending value, and
  // the expected format — collected in `errors` so the user can fix the CSV in
  // one pass instead of one row at a time.
  function rowToUpdate(row: Record<string, string>): {
    key: { empCode: string } | { email: string } | null;
    label: string;
    payload: Record<string, any> | null;
    errors: string[];
  } {
    const errors: string[] = [];

    // Yes/No cell → boolean. Blank leaves the field untouched; an
    // unrecognised value is a hard error (field name supplied by the caller).
    const parseBool = (field: string, raw: string): boolean | undefined => {
      if (!raw) return undefined;
      const s = raw.trim().toLowerCase();
      if (["yes", "y", "true", "1"].includes(s)) return true;
      if (["no", "n", "false", "0"].includes(s)) return false;
      errors.push(`${field}: "${raw}" is not valid — use Yes or No`);
      return undefined;
    };

    const empCode = pick(row, "Employee Code", "Emp Code", "Employee ID", "EmployeeCode");
    const emailCell = pick(row, "Email");
    // Code is the preferred key; email is the fallback. When matched by code,
    // the Email cell is treated as an editable value; when it IS the key, it
    // stays put.
    const label = empCode || emailCell || "(no key)";
    const key = empCode ? { empCode } : emailCell ? { email: emailCell } : null;
    if (!key) {
      errors.push("Missing Employee Code and Email — provide at least one to match an employee");
      return { key: null, label, payload: null, errors };
    }
    if (emailCell && !EMAIL_RE.test(emailCell)) {
      errors.push(`Email: "${emailCell}" is not a valid email address`);
    }

    const user: Record<string, any> = {};
    if (empCode && emailCell) user.email = emailCell;
    const firstName = pick(row, "First Name");
    const lastName = pick(row, "Last Name");
    const phone = pick(row, "Phone", "Contact Number", "Mobile");
    const department = pick(row, "Department");
    const location = pick(row, "Location");
    const designation = pick(row, "Designation");
    const doj = pick(row, "Date of Joining", "Joining Date", "DOJ");
    const dob = pick(row, "Date of Birth", "DOB");
    const gender = pick(row, "Gender").toLowerCase();
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (phone) user.phone = phone;
    if (department) user.department = department;
    // Location is sent by NAME; server resolves it to organization_locations.id
    // (same pattern as Department). Unknown names are silently dropped server-
    // side rather than failing the row.
    if (location) user.location = location;
    if (designation) user.designation = designation;
    if (doj) {
      if (isValidDate(doj)) user.dateOfJoining = doj;
      else errors.push(`Date of Joining: "${doj}" is not valid — use YYYY-MM-DD (e.g. 2026-04-01)`);
    }
    if (dob) {
      if (isValidDate(dob)) user.dateOfBirth = dob;
      else errors.push(`Date of Birth: "${dob}" is not valid — use YYYY-MM-DD (e.g. 1990-01-15)`);
    }
    if (gender) {
      if (["male", "female", "other"].includes(gender)) user.gender = gender;
      else errors.push(`Gender: "${gender}" is not valid — use male, female, or other`);
    }

    const taxInfo: Record<string, any> = {};
    const pan = pick(row, "PAN", "PAN Number").toUpperCase();
    const regime = pick(row, "Tax Regime", "Regime").toLowerCase();
    const deductTDS = parseBool("Deduct TDS", pick(row, "Deduct TDS", "TDS"));
    const deductPT = parseBool(
      "Deduct Professional Tax",
      pick(row, "Deduct Professional Tax", "Deduct PT", "PT"),
    );
    if (pan) {
      if (PAN_RE.test(pan)) taxInfo.pan = pan;
      else errors.push(`PAN: "${pan}" is not valid — expected format ABCDE1234F`);
    }
    if (regime) {
      if (regime === "old" || regime === "new") taxInfo.regime = regime;
      else errors.push(`Tax Regime: "${regime}" is not valid — use old or new`);
    }
    if (deductTDS !== undefined) taxInfo.deductTDS = deductTDS;
    if (deductPT !== undefined) taxInfo.deductPT = deductPT;

    const bankDetails: Record<string, any> = {};
    const bankName = pick(row, "Bank Name");
    const accountNumber = pick(row, "Account Number", "Account No", "A/C");
    const ifscCode = pick(row, "IFSC", "IFSC Code").toUpperCase();
    if (bankName) bankDetails.bankName = bankName;
    if (accountNumber) bankDetails.accountNumber = accountNumber;
    if (ifscCode) {
      if (IFSC_RE.test(ifscCode)) bankDetails.ifscCode = ifscCode;
      else
        errors.push(
          `IFSC: "${ifscCode}" is not valid — expected 11 characters like HDFC0001234 (4 letters + 0 + 6 letters/digits)`,
        );
    }

    const pfDetails: Record<string, any> = {};
    const providentFund = parseBool("Provident Fund", pick(row, "Provident Fund", "PF Applicable"));
    const uan = pick(row, "UAN", "UAN Number");
    const pfNumber = pick(row, "PF Number", "PF No");
    const pfRate = pick(row, "PF Rate", "Contribution Rate");
    const pfOptedOut = parseBool("PF Opted Out", pick(row, "PF Opted Out", "Opted Out"));
    if (providentFund !== undefined) pfDetails.providentFund = providentFund;
    if (uan) pfDetails.uan = uan;
    if (pfNumber) pfDetails.pfNumber = pfNumber;
    if (pfRate) {
      const n = Number(pfRate);
      if (!Number.isNaN(n) && n >= 0 && n <= 100) pfDetails.contributionRate = n;
      else errors.push(`PF Rate: "${pfRate}" is not valid — enter a number between 0 and 100`);
    }
    if (pfOptedOut !== undefined) pfDetails.isOptedOut = pfOptedOut;

    const esiDetails: Record<string, any> = {};
    const esiEligible = parseBool("ESI Eligible", pick(row, "ESI Eligible", "ESI"));
    const esiNumber = pick(row, "ESI Number", "ESI No");
    const dispensary = pick(row, "Dispensary");
    if (esiEligible !== undefined) esiDetails.isEligible = esiEligible;
    if (esiNumber) esiDetails.esiNumber = esiNumber;
    if (dispensary) esiDetails.dispensary = dispensary;

    const payload = {
      key,
      ...(Object.keys(user).length ? { user } : {}),
      ...(Object.keys(taxInfo).length ? { taxInfo } : {}),
      ...(Object.keys(bankDetails).length ? { bankDetails } : {}),
      ...(Object.keys(pfDetails).length ? { pfDetails } : {}),
      ...(Object.keys(esiDetails).length ? { esiDetails } : {}),
    };
    return { key, label, payload, errors };
  }

  async function handleImport() {
    if (!file) return;
    setImporting(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const rows = parseCSV(e.target?.result as string);
      const updates: any[] = [];
      const localErrors: string[] = [];
      let localFailedRows = 0;
      let skippedNoChange = 0;
      rows.forEach((row, i) => {
        // Row number as the user sees it in a spreadsheet: header is line 1,
        // so the first data row is line 2.
        const lineNo = i + 2;
        const { payload, label, errors } = rowToUpdate(row);
        if (errors.length > 0) {
          localFailedRows++;
          errors.forEach((msg) => localErrors.push(`Row ${lineNo} [${label}]: ${msg}`));
          return;
        }
        // A row with only the key and no editable fields is a no-op — skip it
        // silently rather than counting it as an error.
        if (!payload || Object.keys(payload).length <= 1) {
          skippedNoChange++;
          return;
        }
        updates.push(payload);
      });

      if (updates.length === 0) {
        const errs =
          localErrors.length > 0
            ? localErrors
            : [
                skippedNoChange > 0
                  ? `No changes found — ${skippedNoChange} row(s) had only an Employee Code/Email and no fields to update.`
                  : "No data rows found in the file.",
              ];
        setResult({ updated: 0, failed: localFailedRows, errors: errs });
        setImporting(false);
        return;
      }

      try {
        const res = await apiPost<any>("/employees/bulk-update", { updates });
        const payload = res?.data ?? {};
        const serverErrors = (payload.results || [])
          .filter((r: any) => r.status === "error")
          .map((r: any) => `${r.key}: ${r.error}`);
        setResult({
          updated: Number(payload.updated ?? 0),
          failed: Number(payload.failed ?? 0) + localFailedRows,
          errors: [...localErrors, ...serverErrors],
        });
        if (Number(payload.updated ?? 0) > 0) {
          toast.success(`Updated ${payload.updated} employee(s)`);
          onSuccess?.();
        }
      } catch (err: any) {
        setResult({
          updated: 0,
          failed: updates.length + localFailedRows,
          errors: [...localErrors, err.response?.data?.error?.message || "Bulk update failed"],
        });
        toast.error("Bulk update failed");
      }
      setImporting(false);
    };
    reader.readAsText(file);
  }

  function handleClose() {
    setFile(null);
    setPreview([]);
    setResult(null);
    onClose();
  }

  return (
    <Modal open={open} onClose={handleClose} title="Bulk Update Employees" className="max-w-2xl">
      <div className="space-y-4">
        {!file ? (
          <>
            <div
              onClick={() => inputRef.current?.click()}
              className="hover:border-brand-400 hover:bg-brand-50 flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 p-8 transition-colors"
            >
              <Upload className="h-10 w-10 text-gray-400" />
              <p className="mt-2 text-sm font-medium text-gray-700">Click to upload CSV file</p>
              <p className="mt-1 text-xs text-gray-400">
                Match key: Employee Code (or Email). Blank cells are left unchanged.
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />

            <div className="flex items-center justify-between rounded-lg bg-gray-50 p-3">
              <div className="pr-3">
                <p className="text-xs font-medium text-gray-600">Start from your current data</p>
                <p className="mt-1 text-xs text-gray-500">
                  Download every existing employee pre-filled into the supported columns, edit the
                  rows you need, and upload it back.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={downloadTemplate} disabled={downloading}>
                {downloading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Download className="h-4 w-4" />
                )}
                Download employees
              </Button>
            </div>

            <div className="rounded-lg bg-gray-50 p-3 text-xs text-gray-600">
              <p className="mb-1 font-semibold">Notes:</p>
              <ul className="list-inside list-disc space-y-1">
                <li>Rows are matched by Employee Code first, then Email.</li>
                <li>Yes/No columns: TDS, Professional Tax, Provident Fund, PF Opted Out, ESI.</li>
                <li>Dates: YYYY-MM-DD. Gender: male / female / other. Regime: old / new.</li>
                <li>PAN (AAAAA9999A) and IFSC are validated; bad rows are skipped.</li>
              </ul>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <FileText className="text-brand-600 h-5 w-5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{file.name}</p>
                <p className="text-xs text-gray-500">
                  {preview.length > 0 ? `${preview.length}+ rows detected` : "Parsing..."}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFile(null);
                  setPreview([]);
                  setResult(null);
                }}
              >
                Change
              </Button>
            </div>

            {preview.length > 0 && !result && (
              <div className="max-h-48 overflow-auto rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50">
                      {Object.keys(preview[0])
                        .slice(0, 5)
                        .map((h) => (
                          <th key={h} className="px-3 py-2 text-left font-medium text-gray-500">
                            {h}
                          </th>
                        ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row)
                          .slice(0, 5)
                          .map((v, j) => (
                            <td key={j} className="px-3 py-1.5 text-gray-700">
                              {v as string}
                            </td>
                          ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {result && (
              <div className="space-y-2">
                <div className="flex gap-4">
                  <div className="flex items-center gap-2 rounded-lg bg-green-50 px-3 py-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="text-sm font-medium text-green-700">
                      {result.updated} updated
                    </span>
                  </div>
                  {result.failed > 0 && (
                    <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2">
                      <AlertCircle className="h-4 w-4 text-red-600" />
                      <span className="text-sm font-medium text-red-700">
                        {result.failed} failed
                      </span>
                    </div>
                  )}
                </div>
                {result.errors.length > 0 && (
                  <div className="max-h-32 overflow-auto rounded-lg bg-red-50 p-3 text-xs text-red-600">
                    {result.errors.map((e, i) => (
                      <p key={i}>{e}</p>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={handleClose}>
            {result ? "Done" : "Cancel"}
          </Button>
          {file && !result && (
            <Button onClick={handleImport} disabled={importing}>
              {importing
                ? "Updating..."
                : `Update ${preview.length > 0 ? `(${preview.length}+ rows)` : ""}`}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
