import { useParams, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { formatCurrency, formatMonth, formatDate, cn } from "@/lib/utils";
import { RazorpayDisbursePanel } from "./RazorpayDisbursePanel";
import { getUser } from "@/api/auth";
import {
  usePayrollRun,
  useRunPayslips,
  useComputePayroll,
  useApprovePayroll,
  usePayPayroll,
  useRerunPayroll,
  useDeletePayroll,
} from "@/api/hooks";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import {
  ArrowLeft,
  Users,
  Wallet,
  TrendingDown,
  Building2,
  CheckCircle,
  Play,
  Loader2,
  CreditCard,
  Download,
  Mail,
  AlertTriangle,
  RotateCcw,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { api, apiPost } from "@/api/client";
import { useMemo, useState } from "react";
import { buildPayrollReportCsv } from "./payroll-report-export";
import toast from "react-hot-toast";
import { Search, X } from "lucide-react";

/** Coloured icon chip for card titles (matches the rest of the app). */
function SectionIcon({ icon: Icon, className }: { icon: any; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg",
        className ?? "bg-brand-50 text-brand-600",
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

/** Styled tooltip for the cost-breakdown donut. */
function CostTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0];
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs shadow-lg">
      <span className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full" style={{ background: p.payload.fill }} />
        <span className="text-gray-600">{p.name}</span>
        <span className="ml-2 font-semibold tabular-nums text-gray-900">
          {formatCurrency(p.value)}
        </span>
      </span>
    </div>
  );
}

const columns = [
  {
    key: "employee",
    header: "Employee",
    render: (row: any) => (
      <div>
        <p className="font-medium text-gray-900">
          {row.first_name ? `${row.first_name} ${row.last_name}` : row.employee_id?.slice(0, 8)}
        </p>
        {(row.employee_code || row.department) && (
          <p className="text-xs text-gray-500">
            {[row.employee_code, row.department].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
    ),
  },
  {
    key: "attendance",
    header: "Days Worked",
    render: (row: any) => {
      const paid = Number(row.paid_days || 0);
      const total = Number(row.total_days || 0);
      const lop = Number(row.lop_days || 0);
      return (
        <div>
          <p className="font-medium text-gray-900">
            {paid} / {total}
          </p>
          {lop > 0 && <p className="text-xs text-red-500">LOP: {lop} days</p>}
        </div>
      );
    },
  },
  {
    key: "gross",
    header: "Gross",
    className: "text-right",
    render: (row: any) => (
      <div>
        <p className="tabular-nums">{formatCurrency(row.gross_earnings)}</p>
        {(() => {
          const earns =
            typeof row.earnings === "string" ? JSON.parse(row.earnings) : row.earnings || [];
          return earns.length > 0 ? (
            <div className="mt-0.5 text-xs text-gray-400">
              {earns.map((e: any) => (
                <span key={e.code} className="mr-1.5">
                  {e.code}: {formatCurrency(e.amount)}
                </span>
              ))}
            </div>
          ) : null;
        })()}
      </div>
    ),
  },
  {
    key: "deductions",
    header: "Deductions",
    className: "text-right",
    render: (row: any) => {
      const deds =
        typeof row.deductions === "string" ? JSON.parse(row.deductions) : row.deductions || [];
      const total = deds.reduce((s: number, d: any) => s + Number(d.amount), 0);
      return (
        <div>
          <p className="tabular-nums text-rose-600">{formatCurrency(total)}</p>
          <div className="mt-0.5 text-xs text-gray-400">
            {deds.map((d: any) => (
              <span key={d.code} className="mr-1.5">
                {d.code}: {formatCurrency(d.amount)}
              </span>
            ))}
          </div>
        </div>
      );
    },
  },
  {
    key: "net_pay",
    header: "Net Pay",
    className: "text-right",
    render: (row: any) => (
      <span className="font-semibold tabular-nums text-gray-900">
        {formatCurrency(row.net_pay)}
      </span>
    ),
  },
  {
    // Employer-side cost on top of gross — Employer EPF / EPS / EDLI /
    // Admin / Employer ESI etc. The row stores them per-component on
    // employer_contributions (populated by computePayroll); fall back
    // to total_employer_cost − gross when the breakdown isn't there
    // (older payslips computed before that JSON was persisted).
    key: "employer_cost",
    header: "Employer Cost (extra)",
    className: "text-right",
    render: (row: any) => {
      const list =
        typeof row.employer_contributions === "string"
          ? JSON.parse(row.employer_contributions)
          : row.employer_contributions || [];
      const total = list.length
        ? list.reduce((s: number, c: any) => s + Number(c.amount || 0), 0)
        : Math.max(0, Number(row.total_employer_cost || 0) - Number(row.gross_earnings || 0));
      return (
        <div>
          <p className="tabular-nums text-gray-700">{formatCurrency(total)}</p>
          {list.length > 0 && (
            <div className="mt-0.5 text-xs text-gray-400">
              {list.map((c: any) => (
                <span key={c.code} className="mr-1.5">
                  {c.code}: {formatCurrency(c.amount)}
                </span>
              ))}
            </div>
          )}
        </div>
      );
    },
  },
  {
    key: "status",
    header: "Status",
    render: (row: any) => <Badge variant={row.status}>{row.status}</Badge>,
  },
  {
    key: "actions",
    header: "",
    className: "text-right",
    render: (row: any) => (
      <button
        onClick={(e) => {
          e.stopPropagation();
          const url = `${import.meta.env.VITE_API_URL || "/api/v1"}/payslips/${row.id}/pdf`;
          window.open(url + `?token=${localStorage.getItem("access_token")}`, "_blank");
        }}
        className="text-brand-600 hover:border-brand-200 hover:bg-brand-50 hover:text-brand-700 inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-gray-200 px-2 py-1 text-xs font-medium transition-colors"
      >
        <ExternalLink className="h-3 w-3" /> Payslip
      </button>
    ),
  },
];

function exportPayrollCSV(payslips: any[], run: any) {
  const headers = [
    "Employee",
    "Emp Code",
    "Department",
    "Working Days",
    "Paid Days",
    "LOP Days",
    "Gross Earnings",
    "Deductions",
    "Net Pay",
    "Status",
  ];
  const rows = payslips.map((p: any) => {
    const deds = typeof p.deductions === "string" ? JSON.parse(p.deductions) : p.deductions || [];
    const totalDed = deds.reduce((s: number, d: any) => s + Number(d.amount), 0);
    return [
      `${p.first_name || ""} ${p.last_name || ""}`.trim(),
      p.employee_code || "",
      p.department || "",
      p.total_days || 0,
      p.paid_days || 0,
      p.lop_days || 0,
      p.gross_earnings || 0,
      totalDed,
      p.net_pay || 0,
      p.status || "",
    ].join(",");
  });
  const csv = [headers.join(","), ...rows].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payroll-${run.month}-${run.year}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Export Report — a separate, richer CSV next to the existing Export CSV.
// 23 columns, same shape the reusable Python tool in
// D:\EmpCloud\CustomScript\payroll_export.py emits. Ordered so HR reads it
// as "who is this -> what they earn -> attendance impact -> variable adds ->
// totals -> deductions -> net".
function exportPayrollReport(payslips: any[], run: any) {
  const csv = buildPayrollReportCsv(payslips, run);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payroll-report-${run.year}-${String(run.month).padStart(2, "0")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// CSV cell escaper — reasons contain commas/colons, so every field is
// quoted and internal quotes are doubled per RFC 4180.
function csvField(v: unknown): string {
  const s = v == null ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

function triggerCsvDownload(filename: string, headers: string[], rows: string[][]) {
  const csv = [headers.map(csvField).join(","), ...rows.map((r) => r.map(csvField).join(","))].join(
    "\n",
  );
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Export the "issue user list" for a run: every employee who was skipped
// (with reason code) AND every employee TDS'd at flat 20% for a missing
// PAN, in one CSV so HR can chase the fixes (assign a structure, collect a
// PAN, mark attendance) before re-running.
function exportRunIssuesCSV(
  skipped: Array<{
    empcloudUserId: number;
    name?: string;
    empCode?: string | null;
    reason: string;
    code: string;
  }>,
  missingPan: Array<{ empcloudUserId: number; name?: string; code: string }>,
  run: any,
) {
  const headers = ["Issue Type", "Code", "Employee", "Emp Code", "User ID", "Detail"];
  const rows: string[][] = [];
  for (const s of skipped) {
    rows.push([
      "Skipped",
      s.code || "",
      s.name || `#${s.empcloudUserId}`,
      s.empCode || "",
      String(s.empcloudUserId),
      s.reason || "",
    ]);
  }
  for (const m of missingPan) {
    rows.push([
      "No PAN (flat 20% TDS)",
      "MISSING_PAN",
      m.name || `#${m.empcloudUserId}`,
      m.code || "",
      String(m.empcloudUserId),
      "TDS applied at flat 20% (Section 206AA) — PAN missing on payroll profile and EmpCloud record.",
    ]);
  }
  triggerCsvDownload(`payroll-${run.month}-${run.year}-issues.csv`, headers, rows);
}

export function PayrollRunDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: runRes, isLoading } = usePayrollRun(id!);
  const { data: payslipsRes } = useRunPayslips(id!);
  const computeMutation = useComputePayroll(id!);
  const approveMutation = useApprovePayroll(id!);
  const payMutation = usePayPayroll(id!);
  const rerunMutation = useRerunPayroll(id!);
  const deleteMutation = useDeletePayroll(id!);
  const [emailing, setEmailing] = useState(false);
  // Two destructive actions get their own modal so the consequences are
  // spelled out explicitly. The delete modal additionally requires the
  // user to type "DELETE" before the button enables -- typical safeguard
  // for actions that wipe data with no undo.
  const [rerunOpen, setRerunOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  // Compute response carries `skipped` and `missingPan` lists. Persist
  // them in component state so HR can see who was excluded from the run
  // and why, without having to dig through server logs or run notes.
  // Cleared on revert/rerun so stale info doesn't linger.
  const [skipped, setSkipped] = useState<
    Array<{
      empcloudUserId: number;
      name?: string;
      empCode?: string | null;
      reason: string;
      code: string;
    }>
  >([]);
  const [missingPan, setMissingPan] = useState<
    Array<{ empcloudUserId: number; name?: string; code: string }>
  >([]);
  // Client-side filter on the Employee Payslips table. Names / employee
  // codes / department all match, case-insensitive. Filtering happens in
  // useMemo against the already-loaded payslips array -- no extra API
  // round-trip since the run detail page fetches all payslips up front.
  const [payslipSearch, setPayslipSearch] = useState("");

  // Derive payslips + filtered view BEFORE any early returns so the hook
  // count stays stable across renders (React's rules-of-hooks). Reading
  // `payslipsRes` is safe even while the run query is still loading -- it
  // just resolves to an empty array until the data arrives.
  const payslips: any[] = payslipsRes?.data?.data || [];
  const filteredPayslips = useMemo(() => {
    const q = payslipSearch.trim().toLowerCase();
    if (!q) return payslips;
    return payslips.filter((p: any) => {
      const name = `${p.first_name || ""} ${p.last_name || ""}`.trim().toLowerCase();
      const code = String(p.employee_code || "").toLowerCase();
      const dept = String(p.department || "").toLowerCase();
      return name.includes(q) || code.includes(q) || dept.includes(q);
    });
  }, [payslips, payslipSearch]);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
      </div>
    );
  }

  const run = runRes?.data;
  if (!run)
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <div className="rounded-full bg-gray-50 p-4">
          <AlertTriangle className="h-7 w-7 text-gray-300" />
        </div>
        <p className="text-sm text-gray-500">Payroll run not found.</p>
        <Button variant="outline" size="sm" onClick={() => navigate("/payroll/runs")}>
          <ArrowLeft className="h-4 w-4" /> Back to Payroll Runs
        </Button>
      </div>
    );

  async function handleCompute() {
    try {
      const res = await computeMutation.mutateAsync();
      // The /compute endpoint returns the run row plus `skipped` (employees
      // excluded from this run, with reasons) and `missingPan` (employees
      // whose TDS used Section 206AA flat 20% because PAN was missing).
      // Capture both into local state so the page can render actionable
      // banners. The shape comes from PayrollService.computePayroll.
      const data = (res as any)?.data ?? res;
      const newSkipped = Array.isArray(data?.skipped) ? data.skipped : [];
      const newMissingPan = Array.isArray(data?.missingPan) ? data.missingPan : [];
      setSkipped(newSkipped);
      setMissingPan(newMissingPan);
      const generated = Number(data?.employee_count ?? 0);
      const skipCount = newSkipped.length;
      toast.success(
        skipCount > 0
          ? `Computed ${generated} payslip(s) — ${skipCount} employee(s) skipped (see details below)`
          : `Computed ${generated} payslip(s)`,
      );
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Compute failed");
    }
  }

  async function handleApprove() {
    try {
      await approveMutation.mutateAsync();
      toast.success("Payroll approved");
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Approve failed");
    }
  }

  async function handlePay() {
    try {
      await payMutation.mutateAsync();
      toast.success("Payroll marked as paid");
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Pay failed");
    }
  }

  // Totals are 0 until compute runs. Only show the "—/Click Compute" pending
  // state for a draft run — a computed/approved/paid run with a legitimate ₹0
  // (e.g. everyone below the PF/ESI/PT/TDS thresholds, or a whole-month LOP)
  // shows the real figure instead of misleading HR into re-computing.
  const pendingCompute = run.status === "draft";

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          run.month && run.year
            ? `${formatMonth(run.month, run.year)} Payroll Run`
            : // #334 — Fall back to the human-readable `name` the server
              // stamps on every run ("May 2026 Payroll") rather than a
              // short id slice that looks like a meaningless code.
              run.name || "Payroll Run"
        }
        // #306/#334 — period only (status now lives in the badge on the meta
        // row below, so it isn't printed twice). Prefer `name` over an id-slice.
        description={
          run.month && run.year ? formatMonth(run.month, run.year) : run.name || "Payroll run"
        }
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => navigate("/payroll/runs")}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            {(run.status === "draft" || run.status === "computed") && (
              <Button
                variant="outline"
                className="text-red-500 hover:text-red-700"
                onClick={async () => {
                  if (!confirm("Cancel this payroll run? This cannot be undone.")) return;
                  try {
                    await apiPost(`/payroll/${id}/cancel`);
                    toast.success("Payroll run cancelled");
                    navigate("/payroll/runs");
                  } catch (err: any) {
                    toast.error(err.response?.data?.error?.message || "Failed to cancel");
                  }
                }}
              >
                Cancel Run
              </Button>
            )}
            {(run.status === "computed" || run.status === "approved") && (
              <Button
                variant="outline"
                onClick={async () => {
                  if (
                    !confirm(
                      "Revert to draft? This will delete all computed payslips for this run so you can fix data and recompute.",
                    )
                  )
                    return;
                  try {
                    await apiPost(`/payroll/${id}/revert`);
                    setSkipped([]);
                    setMissingPan([]);
                    toast.success("Reverted to draft — fix data and recompute");
                    window.location.reload();
                  } catch (err: any) {
                    toast.error(err.response?.data?.error?.message || "Failed to revert");
                  }
                }}
              >
                Revert to Draft
              </Button>
            )}
            {/* Re-run is the "if something went wrong" escape hatch -- works
                for any non-draft status, including paid. Backend wipes
                payslips, resets totals, flips back to draft. */}
            {run.status !== "draft" && (
              <Button variant="outline" onClick={() => setRerunOpen(true)}>
                <RotateCcw className="h-4 w-4" /> Rerun Payroll
              </Button>
            )}
            <Button
              variant="outline"
              className="text-red-600 hover:text-red-700"
              onClick={() => {
                setDeleteConfirmText("");
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete Run
            </Button>
            {run.status === "draft" && (
              <Button onClick={handleCompute} loading={computeMutation.isPending}>
                <Play className="h-4 w-4" /> Compute Payroll
              </Button>
            )}
            {run.status === "computed" && (
              <Button onClick={handleApprove} loading={approveMutation.isPending}>
                <CheckCircle className="h-4 w-4" /> Approve
              </Button>
            )}
            {run.status === "approved" && (
              <Button onClick={handlePay} loading={payMutation.isPending}>
                <CreditCard className="h-4 w-4" /> Mark as Paid
              </Button>
            )}
            {(run.status === "approved" || run.status === "paid") && (
              <Button
                variant="outline"
                onClick={async () => {
                  try {
                    const { data } = await api.get(`/payroll/${id}/reports/bank-file`, {
                      responseType: "blob",
                    });
                    const url = URL.createObjectURL(new Blob([data]));
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `bank-transfer-${run.month}-${run.year}.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success("Bank file downloaded");
                  } catch {
                    toast.error("Failed to generate bank file");
                  }
                }}
              >
                <Download className="h-4 w-4" /> Bank File
              </Button>
            )}
            {(run.status === "paid" || run.status === "approved") && (
              <Button
                variant="outline"
                loading={emailing}
                onClick={async () => {
                  setEmailing(true);
                  try {
                    const res = await apiPost<any>(`/payroll/${id}/send-payslips`);
                    const msg = res.data?.message || "Payslip emails sent";
                    // Server reports partial failure — surface as warning, not success
                    if (res.data?.failed && res.data.failed > 0) {
                      toast.error(msg);
                    } else {
                      toast.success(msg);
                    }
                  } catch (err: any) {
                    // Prefer the server-provided error message (e.g. "Email
                    // provider is not configured…") + details when present
                    // (e.g. "{ failed: 5 }") over a generic "Failed to send".
                    // Also nudge the operator to check Settings > Send Test
                    // Email if SMTP isn't configured (#222).
                    const errBody = err?.response?.data?.error;
                    const serverMsg = errBody?.message;
                    const detail = errBody?.details
                      ? Object.entries(errBody.details)
                          .map(
                            ([k, v]) => `${k}: ${Array.isArray(v) ? (v as any[]).join(", ") : v}`,
                          )
                          .join(" · ")
                      : "";
                    const code = errBody?.code;
                    const hint =
                      code === "EMAIL_NOT_CONFIGURED"
                        ? " (Set SMTP creds or SENDGRID_API_KEY on the server.)"
                        : "";
                    toast.error(
                      `${serverMsg || "Failed to send payslip emails"}${
                        detail ? ` · ${detail}` : ""
                      }${hint}`,
                      { duration: 8000 },
                    );
                  } finally {
                    setEmailing(false);
                  }
                }}
              >
                <Mail className="h-4 w-4" /> Email Payslips
              </Button>
            )}
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-gray-500">
        <Badge variant={run.status}>{run.status}</Badge>
        {run.pay_date && <span>Pay date: {formatDate(run.pay_date)}</span>}
      </div>

      {/* When the run is still in 'draft', the totals are 0 and rendered as
          '—'. Add a subtitle so it's obvious the values are pending compute
          rather than missing data (#227). */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Employees" value={String(run.employee_count || 0)} icon={Users} />
        <StatCard
          title="Gross Pay"
          value={pendingCompute ? "—" : formatCurrency(Number(run.total_gross) || 0)}
          subtitle={pendingCompute ? "Click Compute to calculate" : undefined}
          icon={Wallet}
          accentClassName="bg-emerald-50 text-emerald-600"
        />
        <StatCard
          title="Deductions"
          value={pendingCompute ? "—" : formatCurrency(Number(run.total_deductions) || 0)}
          subtitle={pendingCompute ? "Click Compute to calculate" : undefined}
          icon={TrendingDown}
          accentClassName="bg-amber-50 text-amber-600"
        />
        <StatCard
          title="Net Pay"
          value={pendingCompute ? "—" : formatCurrency(Number(run.total_net) || 0)}
          subtitle={pendingCompute ? "Click Compute to calculate" : undefined}
          icon={CreditCard}
          accentClassName="bg-sky-50 text-sky-600"
        />
      </div>

      {/* Razorpay disbursement (visible only after Approve + if org has it enabled) */}
      <RazorpayDisbursePanel
        runId={String(id)}
        runStatus={String(run.status || "")}
        orgId={String(getUser()?.orgId ?? "")}
      />

      {/* Cost Breakdown */}
      {Number(run.total_gross) > 0 &&
        (() => {
          // BUG-021 — Pie slice labels are rendered AROUND the pie, so a
          // long name + percentage (e.g. "Employer Cost 13%") gets
          // clipped past the chart's right edge by the parent container.
          // Use shorter labels here to keep labels fully inside the
          // visible area without resorting to a separate legend.
          const data = [
            { name: "Net", value: Number(run.total_net), fill: "#6366F1" },
            { name: "Deductions", value: Number(run.total_deductions), fill: "#F59E0B" },
            {
              name: "Employer",
              value: Number(run.total_employer_contributions || 0),
              fill: "#10B981",
            },
          ].filter((d) => d.value > 0);
          return (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <SectionIcon icon={Wallet} className="bg-emerald-50 text-emerald-600" />
                    Cost Breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-col items-center gap-4 sm:flex-row">
                    <div className="relative h-44 w-full sm:w-1/2">
                      <ResponsiveContainer width="100%" height="100%">
                        <PieChart>
                          <Pie
                            data={data}
                            dataKey="value"
                            nameKey="name"
                            cx="50%"
                            cy="50%"
                            innerRadius={48}
                            outerRadius={72}
                            paddingAngle={2}
                            stroke="none"
                            isAnimationActive={false}
                          >
                            {data.map((entry, i) => (
                              <Cell key={i} fill={entry.fill} />
                            ))}
                          </Pie>
                          <Tooltip content={<CostTooltip />} />
                        </PieChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="px-2 text-center text-sm font-bold tabular-nums text-gray-900">
                          {formatCurrency(data.reduce((s, d) => s + d.value, 0))}
                        </span>
                        <span className="text-[11px] text-gray-400">Total cost</span>
                      </div>
                    </div>
                    <ul className="w-full space-y-2 sm:w-1/2">
                      {data.map((d) => (
                        <li
                          key={d.name}
                          className="flex items-center justify-between gap-2 text-sm"
                        >
                          <span className="flex items-center gap-2 text-gray-600">
                            <span
                              className="h-2.5 w-2.5 rounded-sm"
                              style={{ background: d.fill }}
                            />
                            {d.name}
                          </span>
                          <span className="font-semibold tabular-nums text-gray-900">
                            {formatCurrency(d.value)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <SectionIcon icon={Building2} className="bg-sky-50 text-sky-600" />
                    Department Breakdown
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {(() => {
                    const deptMap: Record<string, number> = {};
                    for (const p of payslips) {
                      const dept =
                        (p as any).department && String((p as any).department).trim()
                          ? (p as any).department
                          : "Unassigned";
                      deptMap[dept] = (deptMap[dept] || 0) + Number((p as any).net_pay || 0);
                    }
                    const deptData = Object.entries(deptMap)
                      .map(([dept, amount]) => ({ dept, amount }))
                      .sort((a, b) => b.amount - a.amount);
                    if (deptData.length === 0) {
                      return (
                        <p className="py-6 text-center text-sm text-gray-400">
                          No payslip data to break down yet.
                        </p>
                      );
                    }
                    // Guard the bar denominator: a negative top value (whole-
                    // month LOP / recoveries) is truthy so `|| 1` wouldn't
                    // catch it and would invert every bar.
                    const max = Math.max(1, ...deptData.map((d) => d.amount));
                    const COLORS = [
                      "#6366F1",
                      "#818CF8",
                      "#A5B4FC",
                      "#C7D2FE",
                      "#E0E7FF",
                      "#EEF2FF",
                    ];
                    return (
                      <ul className="space-y-3">
                        {deptData.map(({ dept, amount }, i) => (
                          <li key={dept}>
                            <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                              <span className="flex min-w-0 items-center gap-2 text-gray-700">
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                                  style={{ background: COLORS[i % COLORS.length] }}
                                />
                                <span className="truncate">{dept}</span>
                              </span>
                              <span className="shrink-0 font-semibold tabular-nums text-gray-900">
                                {formatCurrency(amount)}
                              </span>
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                              <div
                                className="h-full rounded-full"
                                style={{
                                  width: `${Math.max(0, Math.min(100, Math.round((amount / max) * 100)))}%`,
                                  background: COLORS[i % COLORS.length],
                                }}
                              />
                            </div>
                          </li>
                        ))}
                      </ul>
                    );
                  })()}
                </CardContent>
              </Card>
            </div>
          );
        })()}

      {/* Variance Alerts */}
      {payslips.length > 0 &&
        (() => {
          const zeroNet = payslips.filter((p: any) => Number(p.net_pay) <= 0);
          const highDeduction = payslips.filter(
            (p: any) => Number(p.total_deductions) > Number(p.gross_earnings) * 0.5,
          );
          const employeeName = (p: any) => {
            const full = `${p.first_name || ""} ${p.last_name || ""}`.trim();
            return full || p.employee_code || "Employee";
          };
          const alerts = [
            ...zeroNet.map((p: any) => `${employeeName(p)} has zero/negative net pay`),
            ...highDeduction.map((p: any) => `${employeeName(p)} has deductions > 50% of gross`),
          ];
          return alerts.length > 0 ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
              <div className="mb-2 flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <h3 className="font-semibold text-amber-800 dark:text-amber-200">
                  Payroll Alerts ({alerts.length})
                </h3>
              </div>
              <ul className="list-inside list-disc space-y-1">
                {alerts.map((a, i) => (
                  <li key={i} className="text-sm text-amber-700 dark:text-amber-300">
                    {a}
                  </li>
                ))}
              </ul>
            </div>
          ) : null;
        })()}

      {/* Compute-result banners. After Compute, the API returns `skipped`
          (employees excluded with reason codes) and `missingPan`
          (employees TDS'd at flat 20% per Section 206AA). HR needs to
          see WHO was excluded and WHY before approving the run -- the
          payslips table alone hides the silent skips. Both lists clear
          on revert/rerun. */}
      {skipped.length > 0 && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-orange-600" />
              <h3 className="font-semibold text-orange-800">
                {skipped.length} employee{skipped.length === 1 ? "" : "s"} skipped — not in this run
              </h3>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportRunIssuesCSV(skipped, missingPan, run)}
            >
              <Download className="h-4 w-4" /> Export issues
            </Button>
          </div>
          <p className="mb-3 text-sm text-orange-700">
            The compute excluded these employees. Most common reasons: no salary structure assigned,
            joined after the period, exited before the period, or no attendance recorded.
          </p>
          <ul className="space-y-1">
            {skipped.slice(0, 20).map((s, i) => (
              <li key={i} className="text-sm text-orange-800">
                <span className="font-mono text-xs uppercase text-orange-600">{s.code}</span>
                {" — "}
                <span className="font-medium">
                  {s.name || `employee #${s.empcloudUserId}`}
                  {s.empCode ? ` (${s.empCode})` : ""}
                </span>
                : {s.reason}
              </li>
            ))}
            {skipped.length > 20 && (
              <li className="text-xs italic text-orange-600">…and {skipped.length - 20} more</li>
            )}
          </ul>
        </div>
      )}

      {missingPan.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <h3 className="font-semibold text-amber-800">
                {missingPan.length} employee{missingPan.length === 1 ? "" : "s"} TDS'd at flat 20%
                (no PAN)
              </h3>
            </div>
            {/* Export button lives on BOTH banners so it's reachable
                whichever issue the user is looking at. Both export the full
                combined issue list (skipped + no-PAN). */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportRunIssuesCSV(skipped, missingPan, run)}
            >
              <Download className="h-4 w-4" /> Export issues
            </Button>
          </div>
          <p className="mb-3 text-sm text-amber-700">
            Section 206AA — when PAN is missing on both the payroll profile and the EmpCloud
            employee record, TDS defaults to a flat 20% of annual gross. Ask these employees to
            update their PAN, then re-run to recompute at slab rates.
          </p>
          <ul className="space-y-1">
            {missingPan.slice(0, 20).map((s, i) => (
              <li key={i} className="text-sm text-amber-800">
                <span className="font-medium">{s.name || `employee #${s.empcloudUserId}`}</span>
                {s.code ? <span className="ml-1.5 font-mono text-xs">({s.code})</span> : null}
              </li>
            ))}
            {missingPan.length > 20 && (
              <li className="text-xs italic text-amber-600">…and {missingPan.length - 20} more</li>
            )}
          </ul>
        </div>
      )}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-y-2">
          <CardTitle className="flex items-center gap-2">
            <SectionIcon icon={Users} />
            Employee Payslips
            {(payslips.length > 0 || skipped.length > 0) && (
              <span className="ml-2 text-sm font-normal text-gray-500">
                (
                {payslipSearch.trim()
                  ? `${filteredPayslips.length} of ${payslips.length} matching`
                  : `${payslips.length} generated`}
                {skipped.length > 0 && !payslipSearch.trim() ? `, ${skipped.length} skipped` : ""})
              </span>
            )}
          </CardTitle>
          {payslips.length > 0 && (
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" size="sm" onClick={() => exportPayrollCSV(payslips, run)}>
                <Download className="h-4 w-4" /> Export CSV
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => exportPayrollReport(payslips, run)}
              >
                <Download className="h-4 w-4" /> Export Report
              </Button>
            </div>
          )}
        </CardHeader>
        {payslips.length > 0 && (
          <div className="border-b border-gray-100 px-6 py-3">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                value={payslipSearch}
                onChange={(e) => setPayslipSearch(e.target.value)}
                placeholder="Search employee, code, or department…"
                className="focus:border-brand-500 focus:ring-brand-500 block w-full rounded-lg border border-gray-200 bg-white py-2 pl-10 pr-9 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-1"
              />
              {payslipSearch && (
                <button
                  type="button"
                  onClick={() => setPayslipSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                  title="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        )}
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={filteredPayslips}
            emptyMessage={
              payslipSearch.trim()
                ? `No payslips match "${payslipSearch.trim()}"`
                : "Payroll not yet computed"
            }
          />
        </CardContent>
      </Card>

      {/* Re-run confirm modal */}
      <Modal open={rerunOpen} onClose={() => setRerunOpen(false)} title="Re-run this payroll?">
        <div className="space-y-4">
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-medium">This will:</p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>
                Delete all <strong>{payslips.length}</strong> computed payslips for this run
              </li>
              <li>Reset totals (gross / deductions / net) to zero</li>
              <li>
                Revert the run to <strong>draft</strong> so you can re-compute
              </li>
            </ul>
            {run.status === "paid" && (
              <p className="mt-2 font-medium">
                Note: this run is currently marked as <strong>paid</strong>. Re-running will not
                reverse any actual bank transfers — only the recorded payslip data.
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRerunOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={rerunMutation.isPending}
              onClick={async () => {
                try {
                  await rerunMutation.mutateAsync();
                  toast.success("Payroll reverted to draft — you can now recompute");
                  setRerunOpen(false);
                } catch (err: any) {
                  toast.error(err?.response?.data?.error?.message || "Failed to re-run payroll");
                }
              }}
            >
              <RotateCcw className="h-4 w-4" /> Yes, re-run
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm modal — type-to-confirm because there's no undo */}
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete this payroll run?"
      >
        <div className="space-y-4">
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            <p className="font-semibold">⚠ This action cannot be undone.</p>
            <p className="mt-2">
              Deleting{" "}
              <strong>
                {run.month && run.year
                  ? formatMonth(run.month, run.year)
                  : run.name || "this payroll run"}
              </strong>{" "}
              will permanently remove:
            </p>
            <ul className="mt-1 list-inside list-disc space-y-0.5">
              <li>The payroll run record itself</li>
              <li>
                All <strong>{payslips.length}</strong> employee payslips for this period
              </li>
              <li>Any payslip PDFs / report links pointing at this run will 404</li>
            </ul>
            {run.status === "paid" && (
              <p className="mt-2">
                This run is currently marked as <strong>paid</strong>. Bank transfers already made
                will <strong>not</strong> be reversed — they live outside this system.
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Type <span className="font-mono font-bold">DELETE</span> to confirm
            </label>
            <Input
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder="DELETE"
              autoFocus
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button
              className="bg-red-600 hover:bg-red-700"
              loading={deleteMutation.isPending}
              disabled={deleteConfirmText.trim() !== "DELETE"}
              onClick={async () => {
                try {
                  await deleteMutation.mutateAsync();
                  toast.success("Payroll run deleted");
                  setDeleteOpen(false);
                  navigate("/payroll/runs");
                } catch (err: any) {
                  toast.error(
                    err?.response?.data?.error?.message || "Failed to delete payroll run",
                  );
                }
              }}
            >
              <Trash2 className="h-4 w-4" /> Permanently delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
