import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { StatCard } from "@/components/ui/StatCard";
import { formatCurrency } from "@/lib/utils";
import { apiGet, apiPost, apiPut } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  HandCoins,
  Clock,
  CheckCircle,
  XCircle,
  DollarSign,
  Settings,
  Loader2,
  Send,
} from "lucide-react";
import toast from "react-hot-toast";

const STATUS_BADGE: Record<string, "active" | "draft" | "inactive"> = {
  pending: "draft",
  approved: "active",
  disbursed: "active",
  rejected: "inactive",
  repaid: "draft",
};

export function EarnedWagePage() {
  // #171 — Stat cards used to call setTab("requests") against a tab state
  // that never changed anything because the Requests table was already the
  // only content rendered. Replace with a statusFilter so clicking e.g.
  // "Pending Requests" actually scopes the table to pending rows.
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "disbursed" | "approved">(
    "all",
  );
  const [showRequest, setShowRequest] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const qc = useQueryClient();

  // --- Data ---
  const { data: dashRes } = useQuery({
    queryKey: ["ewa-dashboard"],
    queryFn: () => apiGet<any>("/earned-wage/dashboard"),
  });

  const { data: reqRes, isLoading: reqLoading } = useQuery({
    queryKey: ["ewa-requests"],
    queryFn: () => apiGet<any>("/earned-wage/requests"),
  });

  const { data: settingsRes } = useQuery({
    queryKey: ["ewa-settings"],
    queryFn: () => apiGet<any>("/earned-wage/settings"),
  });

  const { data: availRes } = useQuery({
    queryKey: ["ewa-available"],
    queryFn: () => apiGet<any>("/earned-wage/available"),
  });

  const stats = dashRes?.data || {};
  const allRequests: any[] = reqRes?.data || [];
  const settings = settingsRes?.data || {};
  const availability = availRes?.data || {};
  const requests =
    statusFilter === "all" ? allRequests : allRequests.filter((r) => r.status === statusFilter);

  // --- Handlers ---
  async function handleRequest(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    try {
      await apiPost("/earned-wage/request", {
        amount: Number(fd.get("amount")),
        reason: fd.get("reason") || undefined,
      });
      toast.success("Advance request submitted");
      setShowRequest(false);
      qc.invalidateQueries({ queryKey: ["ewa-requests"] });
      qc.invalidateQueries({ queryKey: ["ewa-dashboard"] });
      qc.invalidateQueries({ queryKey: ["ewa-available"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to submit request");
    } finally {
      setSaving(false);
    }
  }

  async function handleApprove(id: string) {
    try {
      await apiPost(`/earned-wage/requests/${id}/approve`);
      toast.success("Request approved");
      qc.invalidateQueries({ queryKey: ["ewa-requests"] });
      qc.invalidateQueries({ queryKey: ["ewa-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to approve");
    }
  }

  async function handleReject(id: string) {
    const reason = prompt("Rejection reason (optional):");
    try {
      await apiPost(`/earned-wage/requests/${id}/reject`, { reason });
      toast.success("Request rejected");
      qc.invalidateQueries({ queryKey: ["ewa-requests"] });
      qc.invalidateQueries({ queryKey: ["ewa-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to reject");
    }
  }

  async function handleSaveSettings(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    try {
      await apiPut("/earned-wage/settings", {
        isEnabled: fd.get("isEnabled") === "on",
        maxPercentage: Number(fd.get("maxPercentage") || 50),
        minAmount: Number(fd.get("minAmount") || 0),
        maxAmount: Number(fd.get("maxAmount") || 0),
        feePercentage: Number(fd.get("feePercentage") || 0),
        feeFlat: Number(fd.get("feeFlat") || 0),
        autoApproveBelow: Number(fd.get("autoApproveBelow") || 0),
        requiresManagerApproval: fd.get("requiresManagerApproval") === "on",
        cooldownDays: Number(fd.get("cooldownDays") || 7),
      });
      toast.success("Settings saved");
      setShowSettings(false);
      qc.invalidateQueries({ queryKey: ["ewa-settings"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  // --- Columns ---
  const columns = [
    {
      key: "employee_name",
      header: "Employee",
      render: (r: any) => (
        <div>
          <span className="font-medium text-gray-900">{r.employee_name}</span>
          {r.employee_code && <span className="ml-2 text-xs text-gray-400">{r.employee_code}</span>}
        </div>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      render: (r: any) => <span className="font-semibold">{formatCurrency(Number(r.amount))}</span>,
    },
    {
      key: "fee_amount",
      header: "Fee",
      render: (r: any) => formatCurrency(Number(r.fee_amount || 0)),
    },
    {
      key: "status",
      header: "Status",
      render: (r: any) => <Badge variant={STATUS_BADGE[r.status] || "draft"}>{r.status}</Badge>,
    },
    {
      key: "requested_at",
      header: "Requested",
      render: (r: any) => (r.requested_at ? new Date(r.requested_at).toLocaleDateString() : "-"),
    },
    {
      key: "reason",
      header: "Reason",
      render: (r: any) => (
        <span className="max-w-[200px] truncate text-sm text-gray-500">{r.reason || "-"}</span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r: any) =>
        r.status === "pending" ? (
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={() => handleApprove(r.id)}>
              <CheckCircle className="mr-1 h-4 w-4 text-green-600" /> Approve
            </Button>
            <Button variant="ghost" size="sm" onClick={() => handleReject(r.id)}>
              <XCircle className="mr-1 h-4 w-4 text-red-600" /> Reject
            </Button>
          </div>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Earned Wage Access"
        description="On-demand pay - allow employees to access earned wages before payday"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowSettings(true)}>
              <Settings className="mr-2 h-4 w-4" /> Settings
            </Button>
            <Button onClick={() => setShowRequest(true)}>
              <Send className="mr-2 h-4 w-4" /> Request Advance
            </Button>
          </div>
        }
      />

      {/* Stats — each card now scopes the requests table to the relevant
          status (or clears the filter for Total / Avg). */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Pending Requests"
          value={stats.totalPending || 0}
          icon={Clock}
          onClick={() => setStatusFilter("pending")}
        />
        <StatCard
          title="Total Disbursed"
          value={formatCurrency(stats.totalDisbursedAmount || 0)}
          icon={DollarSign}
          onClick={() => setStatusFilter("disbursed")}
        />
        <StatCard
          title="Avg Request"
          value={formatCurrency(stats.avgRequestAmount || 0)}
          icon={HandCoins}
          onClick={() => setStatusFilter("all")}
        />
        <StatCard
          title="Total Requests"
          value={stats.totalRequests || 0}
          icon={CheckCircle}
          onClick={() => setStatusFilter("all")}
        />
      </div>

      {statusFilter !== "all" && (
        <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
          <span>
            Showing <strong className="text-gray-900">{statusFilter}</strong> requests
          </span>
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className="text-brand-600 hover:underline"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Available amount card */}
      {availability.available !== undefined && (
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-500">Your Available Balance</p>
                <p className="text-2xl font-bold text-green-600">
                  {formatCurrency(availability.available)}
                </p>
                <p className="mt-1 text-xs text-gray-400">
                  Earned so far: {formatCurrency(availability.earnedSoFar || 0)} | Already
                  withdrawn: {formatCurrency(availability.alreadyWithdrawn || 0)} | Day{" "}
                  {availability.daysWorked}/{availability.daysInMonth}
                </p>
              </div>
              <div className="text-right">
                <Badge variant={settings.is_enabled ? "active" : "inactive"}>
                  {settings.is_enabled ? "Enabled" : "Disabled"}
                </Badge>
                <p className="mt-1 text-xs text-gray-400">
                  Max {settings.max_percentage || 50}% of earned salary
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Requests Table */}
      <Card>
        <CardContent className="p-0">
          {reqLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
            </div>
          ) : (
            <DataTable columns={columns} data={requests} emptyMessage="No advance requests yet" />
          )}
        </CardContent>
      </Card>

      {/* Request Advance Modal */}
      <Modal
        open={showRequest}
        onClose={() => setShowRequest(false)}
        title="Request Salary Advance"
      >
        <form onSubmit={handleRequest} className="space-y-4">
          {/* #93 — When availability.available is 0 (no salary configured,
              cooldown active, or employee hasn't worked any days yet), the
              native max="0" attribute blocked every non-zero entry and the
              form looked broken. Only apply the max when there's actually
              something to cap against, and surface a clear empty-state. */}
          <div
            className={`rounded-lg p-3 text-sm ${
              (availability.available || 0) > 0
                ? "bg-green-50 text-green-800"
                : "bg-amber-50 text-amber-800"
            }`}
          >
            <p className="font-medium">Available: {formatCurrency(availability.available || 0)}</p>
            <p className="text-xs opacity-80">
              Monthly salary: {formatCurrency(availability.monthlySalary || 0)} | Day{" "}
              {availability.daysWorked}/{availability.daysInMonth}
            </p>
            {(availability.available || 0) <= 0 && (
              <p className="mt-1 text-xs font-medium">
                No advance available yet. Check your salary configuration or cooldown period.
              </p>
            )}
          </div>
          {/* #172 — Don't `disabled` the Amount input when availability is 0.
              It read as "the form is broken" because users couldn't type at
              all. The amber banner above already explains why no advance is
              available; here we still let them type (useful for prefilling
              once config is fixed), keep the submit-button disabled when
              there's nothing available, and rely on server-side validation
              as the authoritative block. */}
          <Input
            label="Amount"
            name="amount"
            type="number"
            required
            min={1}
            {...(Number(availability.available) > 0 ? { max: availability.available } : {})}
            placeholder="Enter amount"
          />
          <Input
            label="Reason (optional)"
            name="reason"
            placeholder="Why do you need this advance?"
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowRequest(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || (availability.available || 0) <= 0}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Submit Request
            </Button>
          </div>
        </form>
      </Modal>

      {/* Settings Modal */}
      <Modal
        open={showSettings}
        onClose={() => setShowSettings(false)}
        title="Earned Wage Access Settings"
      >
        <form onSubmit={handleSaveSettings} className="space-y-4">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="isEnabled"
              defaultChecked={settings.is_enabled}
              className="h-4 w-4 rounded border-gray-300"
            />
            <span className="text-sm font-medium">Enable Earned Wage Access</span>
          </label>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Max % of Earned Salary"
              name="maxPercentage"
              type="number"
              defaultValue={settings.max_percentage || 50}
              min={1}
              max={100}
            />
            <Input
              label="Cooldown Days"
              name="cooldownDays"
              type="number"
              defaultValue={settings.cooldown_days || 7}
              min={0}
            />
          </div>
          {/* #94 — Stop defaulting "0" into the inputs. Placeholder carries
              the zero hint so typing a real value doesn't need a leading
              backspace. In edit mode we still pre-fill with stored values. */}
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Min Amount"
              name="minAmount"
              type="number"
              defaultValue={settings.min_amount ?? ""}
              min={0}
              placeholder="0"
            />
            <Input
              label="Max Amount (0 = no limit)"
              name="maxAmount"
              type="number"
              defaultValue={settings.max_amount ?? ""}
              min={0}
              placeholder="0"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Fee %"
              name="feePercentage"
              type="number"
              step="0.01"
              defaultValue={settings.fee_percentage ?? ""}
              min={0}
              placeholder="0"
            />
            <Input
              label="Flat Fee"
              name="feeFlat"
              type="number"
              defaultValue={settings.fee_flat ?? ""}
              min={0}
              placeholder="0"
            />
          </div>
          <Input
            label="Auto-approve Below (0 = disabled)"
            name="autoApproveBelow"
            type="number"
            defaultValue={settings.auto_approve_below ?? ""}
            min={0}
            placeholder="0"
          />
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              name="requiresManagerApproval"
              defaultChecked={settings.requires_manager_approval !== false}
              className="h-4 w-4 rounded border-gray-300"
            />
            <span className="text-sm font-medium">Requires Manager Approval</span>
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowSettings(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Settings
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
