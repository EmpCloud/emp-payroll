import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/SelectField";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { apiGet, apiPost } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Eye, Check, DollarSign } from "lucide-react";
import toast from "react-hot-toast";

const STATUS_BADGE: Record<string, "active" | "draft" | "inactive"> = {
  draft: "draft",
  processing: "draft",
  approved: "active",
  paid: "active",
  cancelled: "inactive",
};

const MONTHS = [
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
];

export function GlobalPayrollRunsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [countryId, setCountryId] = useState("");
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [statusFilter, setStatusFilter] = useState("");

  const { data: countriesRes } = useQuery({
    queryKey: ["global-countries"],
    queryFn: () => apiGet<any>("/global/countries"),
  });

  // #154 — Filter the Create Run country picker down to only countries that
  // actually have active EOR/direct-hire employees. Without this, users
  // could select a country with no payable employees and hit the server's
  // "No active EOR/direct-hire employees found in <Country>" error after
  // the fact. Pulling the employee list up-front lets us prune the
  // dropdown instead.
  const { data: globalEmployeesRes } = useQuery({
    queryKey: ["global-employees-for-runs"],
    queryFn: () => apiGet<any>("/global/employees"),
  });

  const { data: runsRes, isLoading } = useQuery({
    queryKey: ["global-payroll-runs", statusFilter],
    queryFn: () =>
      apiGet<any>("/global/payroll-runs", {
        status: statusFilter || undefined,
      }),
  });

  const { data: detailRes, isLoading: detailLoading } = useQuery({
    queryKey: ["global-payroll-run", showDetail],
    queryFn: () => apiGet<any>(`/global/payroll-runs/${showDetail}`),
    enabled: !!showDetail,
  });

  const countries = countriesRes?.data || [];
  const runs = runsRes?.data || [];
  const runDetail = detailRes?.data;

  // Country IDs where we have at least one active EOR or direct-hire
  // employee — those are the only countries the backend will accept for
  // a Create Run (#154).
  const globalEmployees: any[] = globalEmployeesRes?.data || [];
  const payableCountryIds = new Set(
    globalEmployees
      .filter(
        (e) =>
          e.status === "active" &&
          (e.employment_type === "eor" || e.employment_type === "direct_hire"),
      )
      .map((e) => e.country_id),
  );

  const countryOptions = countries
    .filter((c: any) => payableCountryIds.has(c.id))
    .map((c: any) => ({
      value: c.id,
      label: `${c.name} (${c.currency})`,
    }));

  const yearOptions = Array.from({ length: 5 }, (_, i) => {
    const y = new Date().getFullYear() - 1 + i;
    return { value: String(y), label: String(y) };
  });

  const handleCreate = async () => {
    if (!countryId) {
      toast.error("Please select a country");
      return;
    }
    setSaving(true);
    try {
      await apiPost("/global/payroll-runs", {
        countryId,
        month: Number(month),
        year: Number(year),
      });
      toast.success("Payroll run created");
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ["global-payroll-runs"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to create run");
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (runId: string) => {
    try {
      await apiPost(`/global/payroll-runs/${runId}/approve`);
      toast.success("Payroll run approved");
      qc.invalidateQueries({ queryKey: ["global-payroll-runs"] });
      qc.invalidateQueries({ queryKey: ["global-payroll-run", runId] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to approve");
    }
  };

  const handleMarkPaid = async (runId: string) => {
    try {
      await apiPost(`/global/payroll-runs/${runId}/paid`);
      toast.success("Payroll run marked as paid");
      qc.invalidateQueries({ queryKey: ["global-payroll-runs"] });
      qc.invalidateQueries({ queryKey: ["global-payroll-run", runId] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to mark paid");
    }
  };

  const columns = [
    {
      key: "country",
      header: "Country",
      render: (row: any) => <span className="font-medium">{row.country_name}</span>,
    },
    {
      key: "period",
      header: "Period",
      render: (row: any) =>
        `${MONTHS.find((m) => m.value === String(row.period_month))?.label || row.period_month} ${row.period_year}`,
    },
    {
      key: "status",
      header: "Status",
      render: (row: any) => (
        <Badge variant={STATUS_BADGE[row.status] || "draft"}>
          {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
        </Badge>
      ),
    },
    {
      key: "total_gross",
      header: "Gross",
      render: (row: any) => (
        <span className="font-mono text-sm">
          {row.currency_symbol || row.currency} {(Number(row.total_gross) / 100).toLocaleString()}
        </span>
      ),
    },
    {
      key: "total_net",
      header: "Net",
      render: (row: any) => (
        <span className="font-mono text-sm text-green-600">
          {row.currency_symbol || row.currency} {(Number(row.total_net) / 100).toLocaleString()}
        </span>
      ),
    },
    {
      key: "total_employer_cost",
      header: "Employer Cost",
      render: (row: any) => (
        <span className="font-mono text-sm text-red-600">
          {row.currency_symbol || row.currency}{" "}
          {(Number(row.total_employer_cost) / 100).toLocaleString()}
        </span>
      ),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: any) => (
        <div className="flex gap-1">
          <Button size="sm" variant="outline" onClick={() => setShowDetail(row.id)}>
            <Eye className="h-3 w-3" />
          </Button>
          {row.status === "draft" && (
            <Button size="sm" variant="outline" onClick={() => handleApprove(row.id)}>
              <Check className="mr-1 h-3 w-3" />
              Approve
            </Button>
          )}
          {row.status === "approved" && (
            <Button size="sm" variant="outline" onClick={() => handleMarkPaid(row.id)}>
              <DollarSign className="mr-1 h-3 w-3" />
              Paid
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Global Payroll Runs"
        description="Run payroll per country per month, review, approve, and mark paid"
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Create Run
          </Button>
        }
      />

      {/* Filters */}
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <SelectField
            className="w-40"
            options={[
              { value: "", label: "All Statuses" },
              { value: "draft", label: "Draft" },
              { value: "approved", label: "Approved" },
              { value: "paid", label: "Paid" },
              { value: "cancelled", label: "Cancelled" },
            ]}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          />
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={runs}
          emptyMessage="No payroll runs yet. Create your first global payroll run."
        />
      )}

      {/* Create Run Modal */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Global Payroll Run"
      >
        <div className="space-y-4">
          {/* #118/#154 — When there are no *payable* countries (i.e. none
              with an active EOR or direct-hire employee), keep the dropdown
              empty with an explanatory label so users don't submit into
              "no employees in <country>" errors. */}
          <SelectField
            label="Country *"
            options={[
              {
                value: "",
                label:
                  countryOptions.length > 0
                    ? "Select a country..."
                    : "No countries with active EOR/direct-hire employees",
              },
              ...countryOptions,
            ]}
            value={countryId}
            onChange={(e) => setCountryId(e.target.value)}
            disabled={countryOptions.length === 0}
          />
          <div className="grid grid-cols-2 gap-4">
            <SelectField
              label="Month"
              options={MONTHS}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
            <SelectField
              label="Year"
              options={yearOptions}
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </div>
          <p className="text-xs text-gray-500">
            This will auto-calculate deductions for all active EOR and direct-hire employees in the
            selected country.
          </p>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Create Run
            </Button>
          </div>
        </div>
      </Modal>

      {/* Run Detail Modal */}
      <Modal
        open={!!showDetail}
        onClose={() => setShowDetail(null)}
        title={`Payroll Run - ${runDetail?.country_name || ""}`}
      >
        {detailLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : runDetail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                <p className="text-xs text-gray-500">Gross</p>
                <p className="text-sm font-bold">
                  {runDetail.currency_symbol}{" "}
                  {(Number(runDetail.total_gross) / 100).toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                <p className="text-xs text-gray-500">Deductions</p>
                <p className="text-sm font-bold text-orange-600">
                  {runDetail.currency_symbol}{" "}
                  {(Number(runDetail.total_deductions) / 100).toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                <p className="text-xs text-gray-500">Net Pay</p>
                <p className="text-sm font-bold text-green-600">
                  {runDetail.currency_symbol} {(Number(runDetail.total_net) / 100).toLocaleString()}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                <p className="text-xs text-gray-500">Employer Cost</p>
                <p className="text-sm font-bold text-red-600">
                  {runDetail.currency_symbol}{" "}
                  {(Number(runDetail.total_employer_cost) / 100).toLocaleString()}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="pb-2 font-medium text-gray-500">Employee</th>
                    <th className="pb-2 text-right font-medium text-gray-500">Gross</th>
                    <th className="pb-2 text-right font-medium text-gray-500">Tax</th>
                    <th className="pb-2 text-right font-medium text-gray-500">SS (Emp)</th>
                    <th className="pb-2 text-right font-medium text-gray-500">Pension (Emp)</th>
                    <th className="pb-2 text-right font-medium text-gray-500">Net</th>
                    <th className="pb-2 text-right font-medium text-gray-500">Employer Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {runDetail.items?.map((item: any) => (
                    <tr key={item.id} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-2">
                        <p className="font-medium">{item.employee_name}</p>
                        <p className="text-gray-400">{item.employee_email}</p>
                      </td>
                      <td className="py-2 text-right font-mono">
                        {(Number(item.gross_salary) / 100).toLocaleString()}
                      </td>
                      <td className="py-2 text-right font-mono text-orange-600">
                        {(Number(item.tax_amount) / 100).toLocaleString()}
                      </td>
                      <td className="py-2 text-right font-mono">
                        {(Number(item.social_security_employee) / 100).toLocaleString()}
                      </td>
                      <td className="py-2 text-right font-mono">
                        {(Number(item.pension_employee) / 100).toLocaleString()}
                      </td>
                      <td className="py-2 text-right font-mono text-green-600">
                        {(Number(item.net_salary) / 100).toLocaleString()}
                      </td>
                      <td className="py-2 text-right font-mono font-bold text-red-600">
                        {(Number(item.total_employer_cost) / 100).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              {runDetail.status === "draft" && (
                <Button
                  size="sm"
                  onClick={() => {
                    handleApprove(runDetail.id);
                    setShowDetail(null);
                  }}
                >
                  <Check className="mr-1 h-3 w-3" />
                  Approve
                </Button>
              )}
              {runDetail.status === "approved" && (
                <Button
                  size="sm"
                  onClick={() => {
                    handleMarkPaid(runDetail.id);
                    setShowDetail(null);
                  }}
                >
                  <DollarSign className="mr-1 h-3 w-3" />
                  Mark Paid
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
