import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { apiPost, apiGet } from "@/api/client";
import {
  Upload,
  Download,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
  ArrowLeft,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import toast from "react-hot-toast";

interface ImportResult {
  row: number;
  email: string;
  status: "created" | "error";
  error?: string;
}

const REQUIRED_HEADERS = ["firstName", "lastName", "email"];
const OPTIONAL_HEADERS = [
  "phone",
  "dateOfBirth",
  "gender",
  "dateOfJoining",
  "employeeCode",
  "designation",
  "department",
  "employmentType",
];
const ALL_HEADERS = [...REQUIRED_HEADERS, ...OPTIONAL_HEADERS];

function parseCSV(text: string): Record<string, string>[] {
  const lines = text
    .trim()
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      if (values[idx]) row[h] = values[idx];
    });
    if (row.email || row.firstName) rows.push(row);
  }
  return rows;
}

export function EmployeeImportPage() {
  const navigate = useNavigate();
  const fileRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<"upload" | "preview" | "importing" | "results">("upload");
  const [parsed, setParsed] = useState<Record<string, string>[]>([]);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [summary, setSummary] = useState({ total: 0, created: 0, errors: 0 });
  const [fileName, setFileName] = useState("");

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".csv")) {
      toast.error("Please upload a CSV file");
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCSV(text);
      if (rows.length === 0) {
        toast.error("No data rows found in CSV");
        return;
      }
      setParsed(rows);
      setStep("preview");
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    setStep("importing");
    try {
      const res = await apiPost<any>("/employees/import", { employees: parsed });
      setResults(res.data.results);
      setSummary({ total: res.data.total, created: res.data.created, errors: res.data.errors });
      setStep("results");
      if (res.data.errors === 0) {
        toast.success(`Successfully imported ${res.data.created} employees`);
      } else {
        toast(
          `Imported ${res.data.created}/${res.data.total} employees (${res.data.errors} errors)`,
          { icon: "⚠️" },
        );
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Import failed");
      setStep("preview");
    }
  }

  function downloadTemplate() {
    const csv = [
      ALL_HEADERS.join(","),
      "John,Doe,john@company.com,9876543210,1990-01-15,male,2026-04-01,,Software Engineer,Engineering,full_time",
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "employee_import_template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  const validationWarnings = parsed
    .map((row, i) => {
      const issues: string[] = [];
      if (!row.email) issues.push("missing email");
      if (!row.firstName) issues.push("missing firstName");
      if (!row.lastName) issues.push("missing lastName");
      return issues.length > 0 ? { row: i + 1, issues } : null;
    })
    .filter(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import Employees"
        description="Bulk import employees from a CSV file"
        actions={
          <Button variant="ghost" onClick={() => navigate("/employees")}>
            <ArrowLeft className="h-4 w-4" /> Back to Employees
          </Button>
        }
      />

      {step === "upload" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" /> Upload CSV
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div
                onClick={() => fileRef.current?.click()}
                className="hover:border-brand-400 hover:bg-brand-50/30 cursor-pointer rounded-xl border-2 border-dashed border-gray-300 bg-gray-50 p-12 text-center transition-colors"
              >
                <FileSpreadsheet className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-4 text-sm font-medium text-gray-700">Click to select a CSV file</p>
                <p className="mt-1 text-xs text-gray-400">or drag and drop here</p>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileSelect}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Download className="h-5 w-5" /> Template & Instructions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Button variant="outline" onClick={downloadTemplate}>
                <Download className="h-4 w-4" /> Download CSV Template
              </Button>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-gray-700">Required Fields</h4>
                <div className="flex flex-wrap gap-1">
                  {REQUIRED_HEADERS.map((h) => (
                    <Badge key={h} variant="active">
                      {h}
                    </Badge>
                  ))}
                </div>
              </div>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-gray-700">Optional Fields</h4>
                <div className="flex flex-wrap gap-1">
                  {OPTIONAL_HEADERS.map((h) => (
                    <Badge key={h} variant="pending">
                      {h}
                    </Badge>
                  ))}
                </div>
              </div>

              <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700">
                <p className="mb-1 font-semibold">Notes:</p>
                <ul className="list-inside list-disc space-y-1">
                  <li>
                    Default password for all imported employees:{" "}
                    <code className="rounded bg-blue-100 px-1">Welcome@123</code>
                  </li>
                  <li>Date format: YYYY-MM-DD (e.g., 2026-04-01)</li>
                  <li>Gender: male, female, or other</li>
                  <li>Employment type: full_time, part_time, contract, intern</li>
                  <li>Maximum 500 employees per import</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>
                  Preview: {fileName} ({parsed.length} employees)
                </CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setStep("upload");
                      setParsed([]);
                    }}
                  >
                    Back
                  </Button>
                  <Button
                    onClick={handleImport}
                    disabled={validationWarnings.length === parsed.length}
                  >
                    <Upload className="h-4 w-4" /> Import {parsed.length} Employees
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {validationWarnings.length > 0 && (
                <div className="m-4 rounded-lg bg-amber-50 p-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-amber-700">
                    <AlertTriangle className="h-4 w-4" />
                    {validationWarnings.length} row(s) have validation warnings
                  </div>
                  <ul className="mt-1 list-inside list-disc text-xs text-amber-600">
                    {validationWarnings.slice(0, 5).map((w: any) => (
                      <li key={w.row}>
                        Row {w.row}: {w.issues.join(", ")}
                      </li>
                    ))}
                    {validationWarnings.length > 5 && (
                      <li>...and {validationWarnings.length - 5} more</li>
                    )}
                  </ul>
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="px-4 py-2 text-left font-medium text-gray-500">#</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Name</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Email</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Phone</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Designation</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">Department</th>
                      <th className="px-4 py-2 text-left font-medium text-gray-500">
                        Joining Date
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {parsed.slice(0, 50).map((row, i) => (
                      <tr
                        key={i}
                        className={
                          !row.email || !row.firstName || !row.lastName
                            ? "bg-red-50"
                            : "hover:bg-gray-50"
                        }
                      >
                        <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                        <td className="px-4 py-2 font-medium">
                          {row.firstName} {row.lastName}
                        </td>
                        <td className="px-4 py-2">
                          {row.email || <span className="text-red-500">missing</span>}
                        </td>
                        <td className="px-4 py-2">{row.phone || "—"}</td>
                        <td className="px-4 py-2">{row.designation || "—"}</td>
                        <td className="px-4 py-2">{row.department || "—"}</td>
                        <td className="px-4 py-2">{row.dateOfJoining || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {parsed.length > 50 && (
                  <p className="p-4 text-center text-sm text-gray-400">
                    Showing first 50 of {parsed.length} rows
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {step === "importing" && (
        <Card>
          <CardContent className="py-16 text-center">
            <Loader2 className="text-brand-600 mx-auto h-12 w-12 animate-spin" />
            <p className="mt-4 text-lg font-medium text-gray-700">Importing employees...</p>
            <p className="text-sm text-gray-400">This may take a moment for large imports</p>
          </CardContent>
        </Card>
      )}

      {step === "results" && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Card>
              <CardContent className="py-4 text-center">
                <p className="text-3xl font-bold text-gray-900">{summary.total}</p>
                <p className="text-sm text-gray-500">Total Rows</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4 text-center">
                <p className="text-3xl font-bold text-green-600">{summary.created}</p>
                <p className="text-sm text-gray-500">Successfully Created</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="py-4 text-center">
                <p className="text-3xl font-bold text-red-600">{summary.errors}</p>
                <p className="text-sm text-gray-500">Errors</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Import Results</CardTitle>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setStep("upload");
                      setParsed([]);
                      setResults([]);
                    }}
                  >
                    Import More
                  </Button>
                  <Button onClick={() => navigate("/employees")}>View Employees</Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Row</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Email</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Status</th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {results.map((r) => (
                    <tr key={r.row} className={r.status === "error" ? "bg-red-50" : ""}>
                      <td className="px-4 py-2">{r.row}</td>
                      <td className="px-4 py-2">{r.email}</td>
                      <td className="px-4 py-2">
                        {r.status === "created" ? (
                          <span className="flex items-center gap-1 text-green-600">
                            <CheckCircle className="h-4 w-4" /> Created
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-red-600">
                            <XCircle className="h-4 w-4" /> Error
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-gray-500">{r.error || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
