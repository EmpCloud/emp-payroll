import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { SelectField } from "@/components/ui/SelectField";
import { Input } from "@/components/ui/Input";
import { StatCard } from "@/components/ui/StatCard";
import { formatCurrency, formatMonth, cn } from "@/lib/utils";
import { usePayrollRuns, useCreatePayrollRun } from "@/api/hooks";
import { Plus, Loader2, Play, Wallet, CheckCircle2, Clock } from "lucide-react";
import toast from "react-hot-toast";

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

// A cancelled run keeps its computed totals in the DB for audit purposes,
// but those numbers are misleading in the list view — the run never paid out
// (#5). Render an em-dash for money columns when the run is cancelled so QA
// and HR don't read a ₹2.3 Cr deduction figure on a run that was thrown away.
function isCancelled(row: any) {
  return String(row?.status || "").toLowerCase() === "cancelled";
}

function moneyCell(row: any, value: any) {
  if (isCancelled(row)) return "—";
  return Number(value) ? formatCurrency(value) : "—";
}

const columns = [
  {
    key: "period",
    header: "Period",
    render: (row: any) => (
      <span className="font-medium text-gray-900">
        {/* #334 — Fall back to the server-stamped `name` ("May 2026 Payroll")
            when month/year are missing, instead of rendering "Invalid Date"
            from the formatMonth call. */}
        {row.month && row.year ? formatMonth(row.month, row.year) : row.name || "—"}
      </span>
    ),
  },
  {
    key: "employee_count",
    header: "Employees",
    className: "text-right",
    render: (row: any) => (
      <span className="tabular-nums">{isCancelled(row) ? "—" : row.employee_count || 0}</span>
    ),
  },
  {
    key: "total_gross",
    header: "Gross Pay",
    className: "text-right",
    render: (row: any) => <span className="tabular-nums">{moneyCell(row, row.total_gross)}</span>,
  },
  {
    key: "total_deductions",
    header: "Deductions",
    className: "text-right",
    render: (row: any) => (
      <span className="tabular-nums text-rose-600">{moneyCell(row, row.total_deductions)}</span>
    ),
  },
  {
    key: "total_net",
    header: "Net Pay",
    className: "text-right",
    render: (row: any) => (
      <span className="font-semibold tabular-nums text-gray-900">
        {moneyCell(row, row.total_net)}
      </span>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (row: any) => <Badge variant={row.status}>{row.status}</Badge>,
  },
];

export function PayrollRunsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: res, isLoading } = usePayrollRuns();
  const createMutation = useCreatePayrollRun();
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const runs = res?.data?.data || [];
  const now = new Date();

  // Derived summary + status filter (presentation-only).
  const sortedRuns = [...runs].sort(
    (a: any, b: any) => Number(b.year) - Number(a.year) || Number(b.month) - Number(a.month),
  );
  // Latest run that actually has a computed, non-cancelled net — so the KPI
  // never shows a cancelled run's audit-only figure (contradicting the table's
  // "—" per #5) or a ₹0/NaN for an uncomputed draft.
  const latestRun = sortedRuns.find((r: any) => !isCancelled(r) && Number(r.total_net));
  const latestMonth =
    latestRun && latestRun.month && latestRun.year
      ? formatMonth(latestRun.month, latestRun.year)
      : undefined;
  const statusCount = (s: string) =>
    runs.filter((r: any) => String(r.status).toLowerCase() === s).length;
  const paidCount = statusCount("paid");
  const inProgressCount = ["draft", "processing", "computed", "approved"].reduce(
    (n, s) => n + statusCount(s),
    0,
  );
  const filterOptions = [
    { key: "all", label: "All", count: runs.length },
    ...["draft", "processing", "computed", "approved", "paid", "cancelled"]
      .map((s) => ({
        key: s,
        label: s.charAt(0).toUpperCase() + s.slice(1),
        count: statusCount(s),
      }))
      .filter((o) => o.count > 0),
  ];
  const filteredRuns =
    statusFilter === "all"
      ? runs
      : runs.filter((r: any) => String(r.status).toLowerCase() === statusFilter);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const month = Number(fd.get("month"));
    const year = Number(fd.get("year"));
    const payDateRaw = fd.get("pay_date");
    const payDate = typeof payDateRaw === "string" ? payDateRaw : "";

    // Guard against silent failures: validate inputs on the client before
    // hitting the server. Without this, NaN/empty values get serialized as
    // `null` in JSON, which the server rejects with a 400 that the user may
    // miss (#22 "submit appears to succeed").
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      toast.error("Please select a valid month");
      return;
    }
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      toast.error("Please enter a valid year (2020–2100)");
      return;
    }
    // #1655 — Reject future-period runs client-side too, so the user gets
    // immediate feedback instead of a 400 from the server.
    const requested = year * 12 + (month - 1);
    const current = now.getFullYear() * 12 + now.getMonth();
    if (requested > current) {
      toast.error("Cannot create a payroll run for a future period");
      return;
    }
    if (!payDate) {
      toast.error("Please choose a pay date");
      return;
    }

    try {
      const result = await createMutation.mutateAsync({ month, year, payDate });
      // Explicitly force a refetch of the runs list. The hook already
      // invalidates the query, but we await it here so the list is fresh
      // before the user lands back on this page via the Back button.
      await qc.invalidateQueries({ queryKey: ["payroll-runs"] });
      toast.success("Payroll run created");
      setShowCreate(false);
      if (result?.data?.id) {
        navigate(`/payroll/runs/${result.data.id}`);
      } else {
        // No id in response — something is off server-side. Surface it rather
        // than silently claiming success.
        // eslint-disable-next-line no-console
        console.error("createPayrollRun: server returned no run id", result);
        toast.error(
          "Payroll run submitted but the server did not return an id. Refresh the list to verify.",
        );
      }
    } catch (err: any) {
      // Log full error to aid debugging silent server-side failures (#22).
      // eslint-disable-next-line no-console
      console.error("createPayrollRun failed:", err?.response?.data || err);
      const serverErr = err?.response?.data?.error;
      const detailsMsg = serverErr?.details
        ? Object.entries(serverErr.details as Record<string, string[]>)
            .map(([k, v]) => `${k}: ${v.join(", ")}`)
            .join("; ")
        : "";
      toast.error(
        detailsMsg
          ? `${serverErr?.message || "Failed to create payroll run"} — ${detailsMsg}`
          : serverErr?.message || "Failed to create payroll run",
      );
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll Runs"
        description="Monthly payroll processing"
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> Run Payroll
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
        </div>
      ) : runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-20 text-center">
          <div className="rounded-full bg-gray-50 p-3">
            <Play className="h-6 w-6 text-gray-300" />
          </div>
          <p className="text-sm text-gray-500">No payroll runs yet.</p>
          <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> Run your first payroll
          </Button>
        </div>
      ) : (
        <>
          {/* Summary */}
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Total Runs"
              value={String(runs.length)}
              subtitle="All periods"
              icon={Play}
            />
            <StatCard
              title="Latest Net Pay"
              value={latestRun ? formatCurrency(latestRun.total_net) : "—"}
              subtitle={latestMonth || "No computed runs"}
              icon={Wallet}
              accentClassName="bg-emerald-50 text-emerald-600"
            />
            <StatCard
              title="Paid"
              value={String(paidCount)}
              subtitle="Marked paid"
              icon={CheckCircle2}
              accentClassName="bg-sky-50 text-sky-600"
            />
            <StatCard
              title="In Progress"
              value={String(inProgressCount)}
              subtitle="Draft · computed · approved"
              icon={Clock}
              accentClassName="bg-amber-50 text-amber-600"
            />
          </div>

          {/* Status filter */}
          <div
            className="flex flex-wrap items-center gap-2"
            role="group"
            aria-label="Filter runs by status"
          >
            {filterOptions.map((o) => (
              <button
                key={o.key}
                onClick={() => setStatusFilter(o.key)}
                aria-pressed={statusFilter === o.key}
                className={cn(
                  "focus-visible:ring-brand-500 flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2",
                  statusFilter === o.key
                    ? "border-brand-200 bg-brand-50 text-brand-700"
                    : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50",
                )}
              >
                {o.label}
                <span className="tabular-nums text-gray-400">{o.count}</span>
              </button>
            ))}
          </div>

          <DataTable
            columns={columns}
            data={filteredRuns}
            onRowClick={(row) => {
              // #343 — Guard against missing id (avoids navigating to
              // "/payroll/runs/undefined" which lands on the detail page
              // and 404s server-side with a misleading "page not found"
              // message). Surface a real toast so HR knows the row was
              // somehow malformed instead of getting a confusing 404.
              if (!row?.id) {
                toast.error("This payroll run is missing an id — please refresh the list.");
                return;
              }
              navigate(`/payroll/runs/${row.id}`);
            }}
            emptyMessage="No runs match this filter."
          />
        </>
      )}

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New Payroll Run"
        description="Create a new monthly payroll run"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
            <span className="bg-brand-50 text-brand-600 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
              <Play className="h-[18px] w-[18px]" />
            </span>
            <p className="text-xs text-gray-500">
              Creates a draft run and computes gross, deductions, and net for every active employee
              in the selected month. You can review and approve it before marking it paid.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <SelectField
              id="month"
              name="month"
              label="Month"
              defaultValue={String(now.getMonth() + 1)}
              options={MONTHS}
            />
            <Input
              id="year"
              name="year"
              label="Year"
              type="number"
              min={2020}
              max={now.getFullYear()}
              defaultValue={String(now.getFullYear())}
              required
            />
          </div>
          <Input
            id="pay_date"
            name="pay_date"
            label="Pay Date"
            type="date"
            defaultValue={`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-28`}
            required
          />
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              <Play className="h-4 w-4" /> Create Run
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
