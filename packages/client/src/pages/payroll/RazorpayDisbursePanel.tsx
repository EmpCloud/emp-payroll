import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { apiGet, apiPost } from "@/api/client";
import { Banknote, Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { useState } from "react";
import { formatCurrency } from "@/lib/utils";
import toast from "react-hot-toast";

// Phase 1B + 2 — the Run Detail page mounts this panel once the run is
// `approved`. It checks the org's Razorpay config; if disabled the panel
// hides itself. When enabled, the admin clicks "Disburse via Razorpay" to
// push every payslip as a queued payout. Status comes back via the webhook
// (Phase 2) and is polled here every 5s while anything is in flight.
//
// Decisions locked earlier in the design:
//   - separate manual click (no auto-disburse on approve)
//   - never auto-flip the run to "paid" — admin still has to click Mark Paid

interface PayoutRow {
  id: string;
  payslip_id: string;
  empcloud_user_id: number;
  /** Decorated by the server via JOIN to EmpCloud users. */
  employee_name?: string;
  emp_code?: string | null;
  razorpay_payout_id: string | null;
  status: string;
  amount_paise: number;
  mode: string | null;
  failure_reason: string | null;
  attempted_at: string;
  settled_at: string | null;
}

const TERMINAL = new Set(["processed", "failed", "rejected", "reversed", "cancelled"]);

export function RazorpayDisbursePanel({
  runId,
  runStatus,
  orgId,
}: {
  runId: string;
  runStatus: string;
  orgId: string;
}) {
  const qc = useQueryClient();
  const [disbursing, setDisbursing] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);

  const { data: cfgRes } = useQuery({
    queryKey: ["razorpay-config", orgId],
    queryFn: () => apiGet<any>(`/organizations/${orgId}/razorpay`),
    enabled: !!orgId,
  });
  const enabled = !!(cfgRes as any)?.data?.enabled;

  const { data: payoutsRes, isLoading: payoutsLoading } = useQuery({
    queryKey: ["run-payouts", runId],
    queryFn: () => apiGet<any>(`/payroll/${runId}/payouts`),
    enabled: enabled && (runStatus === "approved" || runStatus === "paid"),
    // Poll every 5s if anything is in flight; otherwise idle.
    refetchInterval: (q) => {
      const rows = (q.state.data as any)?.data || [];
      const inFlight = rows.some((r: PayoutRow) => !TERMINAL.has(String(r.status)));
      return inFlight ? 5000 : false;
    },
  });
  const payouts: PayoutRow[] = (payoutsRes as any)?.data || [];

  if (!enabled) return null;
  if (runStatus !== "approved" && runStatus !== "paid") return null;

  const counts = {
    total: payouts.length,
    processed: payouts.filter((p) => p.status === "processed").length,
    queued: payouts.filter((p) => p.status === "queued" || p.status === "processing").length,
    failed: payouts.filter((p) => ["failed", "rejected", "reversed"].includes(p.status)).length,
  };

  async function handleDisburse() {
    if (!confirm("Push every payslip on this run to Razorpay as a queued payout?")) return;
    setDisbursing(true);
    try {
      const res: any = await apiPost(`/payroll/${runId}/disburse`, {});
      const d = res?.data || {};
      toast.success(
        `Razorpay batch: ${d.queued || 0} queued${d.skipped ? `, ${d.skipped} skipped` : ""}${
          d.errors ? `, ${d.errors} failed` : ""
        }.`,
        { duration: 6000 },
      );
      await qc.invalidateQueries({ queryKey: ["run-payouts", runId] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || "Razorpay disbursement failed");
    } finally {
      setDisbursing(false);
    }
  }

  async function handleRetry(payoutId: string) {
    setRetrying(payoutId);
    try {
      await apiPost(`/payroll/${runId}/payouts/${payoutId}/retry`, {});
      toast.success("Retry submitted");
      await qc.invalidateQueries({ queryKey: ["run-payouts", runId] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || "Retry failed");
    } finally {
      setRetrying(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5" /> RazorpayX Disbursement
          </CardTitle>
          <div className="flex flex-wrap items-center gap-3">
            {counts.total > 0 && (
              <span className="flex items-center gap-2 text-xs text-gray-500">
                <Badge variant="approved">{counts.processed} processed</Badge>
                {counts.queued > 0 && <Badge variant="pending">{counts.queued} in flight</Badge>}
                {counts.failed > 0 && <Badge variant="rejected">{counts.failed} failed</Badge>}
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => qc.invalidateQueries({ queryKey: ["run-payouts", runId] })}
              disabled={payoutsLoading}
            >
              <RefreshCw className="h-4 w-4" /> Refresh
            </Button>
            {runStatus === "approved" && (
              <Button onClick={handleDisburse} disabled={disbursing}>
                {disbursing && <Loader2 className="h-4 w-4 animate-spin" />}
                {counts.total === 0 ? "Disburse via Razorpay" : "Re-run / fill gaps"}
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-xs text-gray-500">
          Each payslip is pushed to Razorpay as a queued payout. Approve them on the RazorpayX
          dashboard for the bank transfer to fire. Status here updates automatically as Razorpay's
          webhook events arrive.
        </p>

        {payoutsLoading && payouts.length === 0 ? (
          <div className="flex h-24 items-center justify-center">
            <Loader2 className="text-brand-600 h-5 w-5 animate-spin" />
          </div>
        ) : payouts.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-sm text-gray-500">
            <Banknote className="h-8 w-8 text-gray-300" />
            <p>No payouts yet. Click "Disburse via Razorpay" to push this run.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left">Employee</th>
                  <th className="px-4 py-3 text-right">Amount</th>
                  <th className="px-4 py-3 text-left">Mode</th>
                  <th className="px-4 py-3 text-left">Status</th>
                  <th className="px-4 py-3 text-left">Razorpay ID</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {payouts.map((p) => {
                  const inflight = !TERMINAL.has(p.status);
                  const canRetry = ["failed", "rejected", "reversed"].includes(p.status);
                  const name = p.employee_name || `Employee #${p.empcloud_user_id}`;
                  return (
                    <tr key={p.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{name}</p>
                        {p.emp_code && <p className="text-xs text-gray-500">{p.emp_code}</p>}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-900">
                        {formatCurrency(p.amount_paise / 100)}
                      </td>
                      <td className="px-4 py-3 text-gray-600">{p.mode || "—"}</td>
                      <td className="px-4 py-3">
                        <PayoutStatusBadge status={p.status} />
                        {p.failure_reason && (
                          <p
                            className="mt-1 max-w-xs truncate text-xs text-red-600"
                            title={p.failure_reason}
                          >
                            {p.failure_reason}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <code className="text-xs text-gray-500">{p.razorpay_payout_id || "—"}</code>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canRetry ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={retrying === p.id}
                            onClick={() => handleRetry(p.id)}
                          >
                            {retrying === p.id && <Loader2 className="h-3 w-3 animate-spin" />}
                            Retry
                          </Button>
                        ) : inflight ? (
                          <Loader2 className="ml-auto h-4 w-4 animate-spin text-gray-400" />
                        ) : (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PayoutStatusBadge({ status }: { status: string }) {
  if (status === "processed") {
    return (
      <Badge variant="approved" className="inline-flex items-center gap-1">
        <CheckCircle2 className="h-3 w-3" /> processed
      </Badge>
    );
  }
  if (status === "failed" || status === "rejected" || status === "reversed") {
    return (
      <Badge variant="rejected" className="inline-flex items-center gap-1">
        <AlertTriangle className="h-3 w-3" /> {status}
      </Badge>
    );
  }
  return <Badge variant="pending">{status}</Badge>;
}
