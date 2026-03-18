import { useParams, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { DataTable } from "@/components/ui/DataTable";
import { formatCurrency, formatMonth } from "@/lib/utils";
import { usePayrollRun, useRunPayslips, useComputePayroll, useApprovePayroll, usePayPayroll } from "@/api/hooks";
import { ArrowLeft, Users, Wallet, TrendingDown, Building2, CheckCircle, Play, Loader2, CreditCard, Download, Mail, AlertTriangle } from "lucide-react";
import { api, apiPost } from "@/api/client";
import { useState } from "react";
import toast from "react-hot-toast";

const columns = [
  {
    key: "employee",
    header: "Employee",
    render: (row: any) => (
      <div>
        <p className="font-medium text-gray-900">
          {row.first_name ? `${row.first_name} ${row.last_name}` : row.employee_id?.slice(0, 8)}
        </p>
        {row.employee_code && <p className="text-xs text-gray-500">{row.employee_code} &middot; {row.department}</p>}
      </div>
    ),
  },
  {
    key: "gross",
    header: "Gross",
    render: (row: any) => formatCurrency(row.gross_earnings),
  },
  {
    key: "deductions",
    header: "Deductions",
    render: (row: any) => {
      const deds = typeof row.deductions === "string" ? JSON.parse(row.deductions) : row.deductions || [];
      return (
        <div className="text-xs">
          {deds.map((d: any) => (
            <span key={d.code} className="mr-2">{d.code}: {formatCurrency(d.amount)}</span>
          ))}
        </div>
      );
    },
  },
  {
    key: "net_pay",
    header: "Net Pay",
    render: (row: any) => (
      <span className="font-semibold text-gray-900">{formatCurrency(row.net_pay)}</span>
    ),
  },
  {
    key: "status",
    header: "Status",
    render: (row: any) => <Badge variant={row.status}>{row.status}</Badge>,
  },
  {
    key: "actions",
    header: "",
    render: (row: any) => (
      <a
        href={`${import.meta.env.VITE_API_URL || "/api/v1"}/payslips/${row.id}/pdf`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-brand-600 hover:text-brand-700 text-xs font-medium"
        onClick={(e) => e.stopPropagation()}
      >
        View Payslip
      </a>
    ),
  },
];

export function PayrollRunDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { data: runRes, isLoading } = usePayrollRun(id!);
  const { data: payslipsRes } = useRunPayslips(id!);
  const computeMutation = useComputePayroll(id!);
  const approveMutation = useApprovePayroll(id!);
  const payMutation = usePayPayroll(id!);
  const [emailing, setEmailing] = useState(false);

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>;
  }

  const run = runRes?.data;
  if (!run) return <div className="p-8 text-gray-500">Payroll run not found</div>;

  const payslips = payslipsRes?.data?.data || [];

  async function handleCompute() {
    try {
      await computeMutation.mutateAsync();
      toast.success("Payroll computed successfully");
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

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Payroll — ${formatMonth(run.month, run.year)}`}
        actions={
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => navigate("/payroll/runs")}>
              <ArrowLeft className="h-4 w-4" /> Back
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
              <Button variant="outline" onClick={async () => {
                try {
                  const { data } = await api.get(`/payroll/${id}/reports/bank-file`, { responseType: "blob" });
                  const url = URL.createObjectURL(new Blob([data]));
                  const a = document.createElement("a"); a.href = url; a.download = `bank-transfer-${run.month}-${run.year}.csv`; a.click();
                  URL.revokeObjectURL(url);
                  toast.success("Bank file downloaded");
                } catch { toast.error("Failed to generate bank file"); }
              }}>
                <Download className="h-4 w-4" /> Bank File
              </Button>
            )}
            {(run.status === "paid" || run.status === "approved") && (
              <Button variant="outline" loading={emailing} onClick={async () => {
                setEmailing(true);
                try {
                  const res = await apiPost<any>(`/payroll/${id}/send-payslips`);
                  toast.success(res.data?.message || "Payslip emails sent");
                } catch { toast.error("Failed to send emails"); }
                finally { setEmailing(false); }
              }}>
                <Mail className="h-4 w-4" /> Email Payslips
              </Button>
            )}
          </div>
        }
      />

      <div className="flex items-center gap-3">
        <Badge variant={run.status}>{run.status}</Badge>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Employees" value={String(run.employee_count || 0)} icon={Users} />
        <StatCard title="Gross Pay" value={Number(run.total_gross) ? formatCurrency(run.total_gross) : "—"} icon={Wallet} />
        <StatCard title="Deductions" value={Number(run.total_deductions) ? formatCurrency(run.total_deductions) : "—"} icon={TrendingDown} />
        <StatCard title="Net Pay" value={Number(run.total_net) ? formatCurrency(run.total_net) : "—"} icon={Building2} />
      </div>

      {/* Variance Alerts */}
      {payslips.length > 0 && (() => {
        const zeroNet = payslips.filter((p: any) => Number(p.net_pay) <= 0);
        const highDeduction = payslips.filter((p: any) => Number(p.total_deductions) > Number(p.gross_earnings) * 0.5);
        const alerts = [
          ...zeroNet.map((p: any) => `${p.first_name || "Employee"} has zero/negative net pay`),
          ...highDeduction.map((p: any) => `${p.first_name || "Employee"} has deductions > 50% of gross`),
        ];
        return alerts.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-5 w-5 text-amber-600" />
              <h3 className="font-semibold text-amber-800 dark:text-amber-200">Payroll Alerts ({alerts.length})</h3>
            </div>
            <ul className="list-disc list-inside space-y-1">
              {alerts.map((a, i) => <li key={i} className="text-sm text-amber-700 dark:text-amber-300">{a}</li>)}
            </ul>
          </div>
        ) : null;
      })()}

      <Card>
        <CardHeader><CardTitle>Employee Payslips</CardTitle></CardHeader>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={payslips}
            emptyMessage="Payroll not yet computed"
          />
        </CardContent>
      </Card>
    </div>
  );
}
