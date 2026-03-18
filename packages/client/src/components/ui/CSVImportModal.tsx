import { useState, useRef } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { Upload, FileText, CheckCircle2, AlertCircle } from "lucide-react";
import { apiPost } from "@/api/client";
import toast from "react-hot-toast";

interface CSVImportModalProps {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export function CSVImportModal({ open, onClose, onSuccess }: CSVImportModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ success: number; failed: number; errors: string[] } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function parseCSV(text: string): Record<string, string>[] {
    const lines = text.trim().split("\n");
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
    return lines.slice(1).map((line) => {
      const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      const row: Record<string, string> = {};
      headers.forEach((h, i) => { row[h] = values[i] || ""; });
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
    if (!file) return;
    setImporting(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
      const rows = parseCSV(e.target?.result as string);
      let success = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const row of rows) {
        try {
          await apiPost("/employees", {
            employeeCode: row["Employee Code"] || row["employee_code"] || `EMP-${Date.now()}`,
            firstName: row["First Name"] || row["first_name"] || "",
            lastName: row["Last Name"] || row["last_name"] || "",
            email: row["Email"] || row["email"] || "",
            phone: row["Phone"] || row["phone"] || undefined,
            dateOfBirth: row["Date of Birth"] || row["date_of_birth"] || "1990-01-01",
            gender: (row["Gender"] || row["gender"] || "other").toLowerCase(),
            dateOfJoining: row["Date of Joining"] || row["date_of_joining"] || new Date().toISOString().slice(0, 10),
            department: row["Department"] || row["department"] || "General",
            designation: row["Designation"] || row["designation"] || "Employee",
            employmentType: row["Employment Type"] || row["employment_type"] || "full_time",
            bankDetails: {
              accountNumber: row["Account Number"] || row["account_number"] || "",
              ifscCode: row["IFSC"] || row["ifsc"] || "",
              bankName: row["Bank Name"] || row["bank_name"] || "",
            },
            taxInfo: {
              pan: row["PAN"] || row["pan"] || "",
              regime: row["Tax Regime"] || row["tax_regime"] || "new",
            },
            pfDetails: {
              pfNumber: row["PF Number"] || row["pf_number"] || "",
              isOptedOut: false,
              contributionRate: 12,
            },
          });
          success++;
        } catch (err: any) {
          failed++;
          const name = `${row["First Name"] || ""} ${row["Last Name"] || ""}`.trim();
          errors.push(`${name}: ${err.response?.data?.error?.message || "Failed"}`);
        }
      }

      setResult({ success, failed, errors });
      setImporting(false);
      if (success > 0) {
        toast.success(`Imported ${success} employees`);
        onSuccess?.();
      }
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
    <Modal open={open} onClose={handleClose} title="Import Employees from CSV" className="max-w-2xl">
      <div className="space-y-4">
        {!file ? (
          <>
            <div
              onClick={() => inputRef.current?.click()}
              className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-300 p-8 transition-colors hover:border-brand-400 hover:bg-brand-50"
            >
              <Upload className="h-10 w-10 text-gray-400" />
              <p className="mt-2 text-sm font-medium text-gray-700">Click to upload CSV file</p>
              <p className="mt-1 text-xs text-gray-400">Required columns: First Name, Last Name, Email, Department, Designation</p>
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
                First Name,Last Name,Email,Phone,Department,Designation,Date of Joining,Date of Birth,Gender,PAN,Bank Name,Account Number,IFSC
              </code>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              <FileText className="h-5 w-5 text-brand-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{file.name}</p>
                <p className="text-xs text-gray-500">{preview.length > 0 ? `${preview.length}+ rows detected` : "Parsing..."}</p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => { setFile(null); setPreview([]); setResult(null); }}>
                Change
              </Button>
            </div>

            {preview.length > 0 && !result && (
              <div className="max-h-48 overflow-auto rounded-lg border border-gray-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50">
                      {Object.keys(preview[0]).slice(0, 6).map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-medium text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {preview.map((row, i) => (
                      <tr key={i}>
                        {Object.values(row).slice(0, 6).map((v, j) => (
                          <td key={j} className="px-3 py-1.5 text-gray-700">{v as string}</td>
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
                    <span className="text-sm font-medium text-green-700">{result.success} imported</span>
                  </div>
                  {result.failed > 0 && (
                    <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2">
                      <AlertCircle className="h-4 w-4 text-red-600" />
                      <span className="text-sm font-medium text-red-700">{result.failed} failed</span>
                    </div>
                  )}
                </div>
                {result.errors.length > 0 && (
                  <div className="max-h-32 overflow-auto rounded-lg bg-red-50 p-3 text-xs text-red-600">
                    {result.errors.map((e, i) => <p key={i}>{e}</p>)}
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
            <Button onClick={handleImport} loading={importing}>
              Import {preview.length > 0 ? `(${preview.length}+ rows)` : ""}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
}
