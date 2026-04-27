import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { Upload, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { Input } from "./Input";
import { apiPost, apiGet } from "@/api/client";
import toast from "react-hot-toast";

interface BulkSalaryCSVModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function BulkSalaryCSVModal({ open, onClose, onSuccess }: BulkSalaryCSVModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any[]>([]);
  const [structureId, setStructureId] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    success: number;
    failed: number;
    errors: string[];
  } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Endpoint returns a paginated envelope `{ success, data: { data: [...], total, ... } }`.
  // Tolerate a flat `data: [...]` shape too in case the endpoint is ever
  // simplified — the array can live at either level. Same defensive
  // pattern used by SalaryStructuresPage / EmployeeDetailPage / Bulk
  // Update modal after PR #258.
  const { data: structures = [] } = useQuery({
    queryKey: ["salary-structures"],
    queryFn: () =>
      apiGet<any>("/salary-structures").then((r) => {
        const p: any = r?.data;
        if (Array.isArray(p)) return p;
        if (Array.isArray(p?.data)) return p.data;
        return [];
      }),
  });

  function parseCSV(text: string): Record<string, string>[] {
    const lines = text.trim().split("\n");
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    return lines.slice(1).map((line) => {
      const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      const row: Record<string, string> = {};
      headers.forEach((h, i) => {
        row[h] = values[i] || "";
      });
      return row;
    });
  }

  function handleFile(f: File) {
    setFile(f);
    setResult(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      const rows = parseCSV(e.target?.result as string);
      setPreview(rows.slice(0, 5));
    };
    reader.readAsText(f);
  }

  async function handleImport() {
    if (!file || !structureId) {
      toast.error("Please select salary structure");
      return;
    }
    setImporting(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const rows = parseCSV(e.target?.result as string);
      let success = 0;
      let failed = 0;
      const errors: string[] = [];

      const assignments: {
        employeeId: string;
        ctc: number;
        bankDetails?: { accountNumber: string; ifscCode: string; bankName: string };
      }[] = [];

      for (const row of rows) {
        try {
          const employeeId =
            row["Employee ID"] || row["employee_id"] || row["EmployeeId"] || row["employeeId"];
          const ctcStr = row["Annual CTC"] || row["ctc"] || row["annual_ctc"] || "";
          const ctc = Number(ctcStr);

          if (!employeeId) {
            errors.push(`Row: Missing Employee ID`);
            failed++;
            continue;
          }
          if (!ctc || ctc <= 0) {
            errors.push(`${employeeId}: Invalid or missing CTC`);
            failed++;
            continue;
          }

          const assignment: any = { employeeId, ctc };

          // Bank details (optional)
          const accountNumber = row["Account Number"] || row["account_number"] || "";
          const ifscCode = row["IFSC"] || row["ifsc"] || row["IFSC Code"] || row["ifsc_code"] || "";
          const bankName = row["Bank Name"] || row["bank_name"] || "";

          if (accountNumber || ifscCode || bankName) {
            assignment.bankDetails = { accountNumber, ifscCode, bankName };
          }

          assignments.push(assignment);
          success++;
        } catch (err: any) {
          failed++;
          errors.push(`Row: ${err.message}`);
        }
      }

      if (assignments.length === 0) {
        setResult({ success: 0, failed, errors });
        setImporting(false);
        return;
      }

      try {
        const response = await apiPost<any>("/salary-structures/bulk-assign", {
          structureId,
          effectiveFrom,
          assignments,
        });

        const { updated, failed: apiFailures } = response.data.data || { updated: 0, failed: 0 };
        setResult({ success: updated, failed: apiFailures, errors });
        if (updated > 0) {
          toast.success(`Updated salary for ${updated} employee(s)`);
          onSuccess?.();
        }
      } catch (err: any) {
        setResult({
          success: 0,
          failed: assignments.length,
          errors: [err.response?.data?.error?.message || "Failed"],
        });
        toast.error("Failed to update salaries");
      }

      setImporting(false);
    };
    reader.readAsText(file);
  }

  function handleClose() {
    setFile(null);
    setPreview([]);
    setResult(null);
    setStructureId("");
    setEffectiveFrom(new Date().toISOString().slice(0, 10));
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Bulk Update Salary from CSV"
      className="max-w-2xl"
    >
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
                Required columns: Employee ID, Annual CTC
              </p>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />

            <div className="rounded-lg bg-gray-50 p-3">
              <p className="text-xs font-medium text-gray-600">Expected CSV format:</p>
              <code className="mt-1 block text-xs text-gray-500">
                Employee ID,Annual CTC,[Bank Name],[Account Number],[IFSC]
              </code>
              <p className="mt-2 text-xs text-gray-600">
                Example:
                <br />
                EMP001,1200000,HDFC Bank,1234567890,HDFC0001234
                <br />
                EMP002,1500000,ICICI Bank,0987654321,ICIC0005678
                <br />
                <span className="text-gray-500">(Bank details are optional)</span>
              </p>
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

            {!result && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-gray-700">Salary Structure *</label>
                  <select
                    value={structureId}
                    onChange={(e) => setStructureId(e.target.value)}
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Select Structure</option>
                    {Array.isArray(structures) &&
                      structures.map((s: any) => (
                        <option key={s.id} value={String(s.id)}>
                          {s.name || s.id}
                        </option>
                      ))}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-gray-700">Effective From *</label>
                  <input
                    type="date"
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    className="mt-1 w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>
            )}

            {preview.length > 0 && !result && (
              <div className="max-h-48 overflow-auto rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50">
                      {Object.keys(preview[0])
                        .slice(0, 4)
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
                          .slice(0, 4)
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
                      {result.success} updated
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
            <Button onClick={handleImport} disabled={!structureId || importing}>
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
