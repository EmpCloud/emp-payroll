import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SelectField } from "@/components/ui/SelectField";
import { DataTable } from "@/components/ui/DataTable";
import { formatCurrency } from "@/lib/utils";
import { usePayrollRuns } from "@/api/hooks";
import { api, apiGet } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { Download, FileText, Shield, Building2, IndianRupee, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

const MONTHS = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function ReportsPage() {
  const { data: runsRes, isLoading } = usePayrollRuns();
  // Statutory returns (PF ECR / ESI / PT / TDS) are derivable from a run's
  // payslips the moment it's COMPUTED — they don't require the run to be
  // approved/paid first. Previously the dropdown only listed paid/approved
  // runs, so an org that had computed (but not yet approved) payroll saw an
  // empty selector and assumed Reports was broken. Include computed runs too;
  // only draft runs (no payslips yet) are excluded.
  const runs = (runsRes?.data?.data || []).filter((r: any) =>
    ["computed", "approved", "paid"].includes(String(r.status || "").toLowerCase()),
  );
  const [selectedRun, setSelectedRun] = useState("");

  const runId = selectedRun || runs[0]?.id || "";
  const selectedRunData = runs.find((r: any) => r.id === runId);

  // TDS summary for selected run
  const { data: tdsRes } = useQuery({
    queryKey: ["tds-report", runId],
    queryFn: () => apiGet<any>(`/payroll/${runId}/reports/tds`),
    enabled: !!runId,
  });
  const tdsData = tdsRes?.data || [];

  async function downloadReport(type: string) {
    if (!runId) {
      toast.error("Select a payroll run first");
      return;
    }
    try {
      const { data } = await api.get(`/payroll/${runId}/reports/${type}`, { responseType: "blob" });
      const ext = type === "pf" ? "txt" : "csv";
      const url = URL.createObjectURL(new Blob([data]));
      const a = document.createElement("a");
      a.href = url;
      a.download = `${type}-report.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`${type.toUpperCase()} report downloaded`);
    } catch {
      toast.error(`Failed to generate ${type.toUpperCase()} report`);
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Statutory Reports"
        description="Generate PF, ESI, PT, and TDS returns for compliance filing"
      />

      {/* Run selector */}
      <Card>
        <CardContent className="py-4">
          <div className="flex items-center gap-4">
            <span className="text-sm font-medium text-gray-700">Payroll Run:</span>
            <SelectField
              id="run"
              value={runId}
              onChange={(e) => setSelectedRun(e.target.value)}
              options={runs.map((r: any) => ({
                value: r.id,
                label: `${MONTHS[r.month]} ${r.year} — ${r.employee_count} employees`,
              }))}
              className="w-80"
            />
            {selectedRunData && (
              <Badge variant={selectedRunData.status}>{selectedRunData.status}</Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {runs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-4 text-gray-500">No computed payroll runs yet</p>
            <p className="mt-1 text-sm text-gray-400">
              Create and <span className="font-medium">Compute</span> a payroll run (Payroll → Runs)
              to generate statutory reports — approval isn't required.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Report cards */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <ReportCard
              icon={Shield}
              title="PF ECR"
              description="Electronic Challan cum Return for EPFO filing"
              format="TXT (ECR Format)"
              onDownload={() => downloadReport("pf")}
            />
            <ReportCard
              icon={Building2}
              title="ESI Return"
              description="Monthly contribution statement for ESIC"
              format="CSV"
              onDownload={() => downloadReport("esi")}
            />
            <ReportCard
              icon={IndianRupee}
              title="PT Return"
              description="Professional Tax return for state filing"
              format="CSV"
              onDownload={() => downloadReport("pt")}
            />
            <ReportCard
              icon={FileText}
              title="Bank Transfer"
              description="NEFT/RTGS salary transfer file"
              format="CSV"
              onDownload={() => downloadReport("bank-file")}
            />
          </div>

          {/* TDS Summary Table */}
          <Card>
            <CardHeader>
              <CardTitle>
                TDS Summary —{" "}
                {selectedRunData ? `${MONTHS[selectedRunData.month]} ${selectedRunData.year}` : ""}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <DataTable
                columns={[
                  {
                    key: "name",
                    header: "Employee",
                    render: (r: any) => (
                      <div>
                        <p className="font-medium text-gray-900">{r.name}</p>
                        <p className="text-xs text-gray-500">
                          {r.employeeCode} &middot; PAN: {r.pan}
                        </p>
                      </div>
                    ),
                  },
                  {
                    key: "grossSalary",
                    header: "Gross Salary",
                    render: (r: any) => formatCurrency(r.grossSalary),
                  },
                  {
                    key: "tdsDeducted",
                    header: "TDS Deducted",
                    render: (r: any) => (
                      <span
                        className={r.tdsDeducted > 0 ? "font-medium text-red-600" : "text-gray-400"}
                      >
                        {r.tdsDeducted > 0 ? formatCurrency(r.tdsDeducted) : "Nil"}
                      </span>
                    ),
                  },
                ]}
                data={tdsData}
                emptyMessage="No TDS data for this run"
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function ReportCard({
  icon: Icon,
  title,
  description,
  format,
  onDownload,
}: {
  icon: any;
  title: string;
  description: string;
  format: string;
  onDownload: () => void;
}) {
  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col py-5">
        <div className="bg-brand-50 mb-3 flex h-10 w-10 items-center justify-center rounded-lg">
          <Icon className="text-brand-600 h-5 w-5" />
        </div>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <p className="mt-1 flex-1 text-xs text-gray-500">{description}</p>
        <div className="mt-3 flex items-center justify-between">
          <Badge variant="draft">{format}</Badge>
          <Button variant="outline" size="sm" onClick={onDownload}>
            <Download className="h-3 w-3" /> Download
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
