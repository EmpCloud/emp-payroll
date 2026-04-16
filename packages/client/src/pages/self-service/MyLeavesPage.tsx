import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { apiGet, apiPost } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Calendar, Loader2, X, Check, Users } from "lucide-react";
import toast from "react-hot-toast";

const STATUS_COLORS: Record<string, "green" | "yellow" | "red" | "gray"> = {
  pending: "yellow",
  approved: "green",
  rejected: "red",
  cancelled: "gray",
};

export function MyLeavesPage() {
  const [showApply, setShowApply] = useState(false);
  const [showCancel, setShowCancel] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState("all");
  const [tab, setTab] = useState<"my" | "team">("my");
  const [teamFilter, setTeamFilter] = useState("pending");
  const [remarksModal, setRemarksModal] = useState<{
    id: string;
    action: "approve" | "reject";
  } | null>(null);
  const [remarks, setRemarks] = useState("");
  const qc = useQueryClient();

  const { data: balanceData } = useQuery({
    queryKey: ["my-leave-balance"],
    queryFn: () => apiGet<any>("/leaves/my-balance"),
  });

  // Fetch leave types from EmpCloud instead of hardcoding them (#12).
  // The previous hardcoded {earned, casual, sick, comp_off} values never
  // matched what leave_types.code actually held in the DB (CL / SL / EL),
  // so every Apply Leave attempt 400'd with 'Leave type not found'.
  const { data: typesData } = useQuery({
    queryKey: ["leave-types"],
    queryFn: () => apiGet<any>("/leaves/types"),
  });
  const leaveTypeOptions = (typesData?.data || []).map((t: any) => ({
    value: t.code,
    label: t.name,
  }));

  const { data: requestsData, isLoading: reqLoading } = useQuery({
    queryKey: ["my-leave-requests", filter],
    queryFn: () => apiGet<any>(`/leaves/my-requests${filter !== "all" ? `?status=${filter}` : ""}`),
  });

  // Team leaves (direct reports) — fetched for everyone, empty if no reports
  const { data: teamData, isLoading: teamLoading } = useQuery({
    queryKey: ["team-leave-requests", teamFilter],
    queryFn: () =>
      apiGet<any>(`/leaves/team${teamFilter !== "all" ? `?status=${teamFilter}` : ""}`),
  });

  const balances = balanceData?.data?.data || [];
  const requests = requestsData?.data?.data || [];
  const teamRequests = teamData?.data?.data || [];
  const hasTeam = teamRequests.length > 0 || teamFilter !== "pending";

  const totalAvailable = balances.reduce((s: number, b: any) => s + Number(b.closing_balance), 0);
  const totalUsed = balances.reduce((s: number, b: any) => s + Number(b.used), 0);
  const teamPendingCount = teamRequests.filter((r: any) => r.status === "pending").length;

  async function handleApply(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);
    try {
      await apiPost("/leaves/apply", {
        leaveType: fd.get("leaveType"),
        startDate: fd.get("startDate"),
        endDate: fd.get("endDate"),
        reason: fd.get("reason"),
        isHalfDay: fd.get("isHalfDay") === "true",
        halfDayPeriod: fd.get("halfDayPeriod") || undefined,
      });
      toast.success("Leave applied — sent to your reporting manager");
      setShowApply(false);
      qc.invalidateQueries({ queryKey: ["my-leave-requests"] });
      qc.invalidateQueries({ queryKey: ["my-leave-balance"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to apply leave");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!showCancel) return;
    setSubmitting(true);
    try {
      await apiPost(`/leaves/${showCancel}/cancel`, { reason: cancelReason });
      toast.success("Leave cancelled. Balance restored.");
      setShowCancel(null);
      setCancelReason("");
      qc.invalidateQueries({ queryKey: ["my-leave-requests"] });
      qc.invalidateQueries({ queryKey: ["my-leave-balance"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to cancel");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTeamAction() {
    if (!remarksModal) return;
    setSubmitting(true);
    try {
      await apiPost(`/leaves/${remarksModal.id}/${remarksModal.action}`, { remarks });
      toast.success(`Leave ${remarksModal.action}d`);
      setRemarksModal(null);
      setRemarks("");
      qc.invalidateQueries({ queryKey: ["team-leave-requests"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Action failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function quickApprove(id: string) {
    try {
      await apiPost(`/leaves/${id}/approve`, {});
      toast.success("Leave approved");
      qc.invalidateQueries({ queryKey: ["team-leave-requests"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Leaves"
        actions={
          <Button onClick={() => setShowApply(true)}>
            <Plus className="mr-1 h-4 w-4" /> Apply Leave
          </Button>
        }
      />

      {/* Tab switcher — only show Team tab if user has direct reports */}
      {hasTeam && (
        <div className="flex gap-1 rounded-lg bg-gray-100 p-1 dark:bg-gray-800">
          <button
            onClick={() => setTab("my")}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === "my"
                ? "bg-white shadow dark:bg-gray-700 dark:text-white"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <Calendar className="mr-1.5 inline h-4 w-4" /> My Leaves
          </button>
          <button
            onClick={() => setTab("team")}
            className={`flex-1 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === "team"
                ? "bg-white shadow dark:bg-gray-700 dark:text-white"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            <Users className="mr-1.5 inline h-4 w-4" /> Team Leaves
            {teamPendingCount > 0 && (
              <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                {teamPendingCount}
              </span>
            )}
          </button>
        </div>
      )}

      {tab === "my" ? (
        <>
          {/* Balance Cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-sm text-gray-500 dark:text-gray-400">Total Available</p>
                <p className="text-2xl font-bold text-blue-600">{totalAvailable}</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-4 text-center">
                <p className="text-sm text-gray-500 dark:text-gray-400">Total Used</p>
                <p className="text-2xl font-bold text-orange-600">{totalUsed}</p>
              </CardContent>
            </Card>
            {balances.map((b: any) => (
              <Card key={b.leave_type}>
                <CardContent className="p-4 text-center">
                  <p className="text-sm capitalize text-gray-500 dark:text-gray-400">
                    {b.leave_type.replace("_", " ")}
                  </p>
                  <p className="text-2xl font-bold">{Number(b.closing_balance)}</p>
                  <p className="text-xs text-gray-400">of {Number(b.accrued)}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Filter */}
          <div className="flex items-center gap-2">
            {["all", "pending", "approved", "rejected", "cancelled"].map((s) => (
              <Button
                key={s}
                variant={filter === s ? "primary" : "outline"}
                size="sm"
                onClick={() => setFilter(s)}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </Button>
            ))}
          </div>

          {/* My Requests Table */}
          <Card>
            <CardHeader>
              <CardTitle>Leave Requests</CardTitle>
            </CardHeader>
            <CardContent>
              {reqLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : requests.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  <Calendar className="mx-auto mb-2 h-10 w-10 text-gray-300" />
                  <p>No leave requests found</p>
                </div>
              ) : (
                <DataTable
                  columns={[
                    {
                      key: "leave_type",
                      header: "Type",
                      render: (r: any) => (
                        <span className="font-medium capitalize">
                          {r.leave_type.replace("_", " ")}
                        </span>
                      ),
                    },
                    {
                      key: "start_date",
                      header: "From",
                      render: (r: any) => new Date(r.start_date).toLocaleDateString("en-IN"),
                    },
                    {
                      key: "end_date",
                      header: "To",
                      render: (r: any) => new Date(r.end_date).toLocaleDateString("en-IN"),
                    },
                    {
                      key: "days",
                      header: "Days",
                      render: (r: any) => (
                        <span>
                          {Number(r.days)}
                          {r.is_half_day ? " (Half)" : ""}
                        </span>
                      ),
                    },
                    {
                      key: "reason",
                      header: "Reason",
                      render: (r: any) => (
                        <span className="block max-w-[200px] truncate">{r.reason}</span>
                      ),
                    },
                    {
                      key: "assigned_to",
                      header: "Approver",
                      render: (r: any) => (
                        <span className="text-sm text-gray-500">
                          {r.assignedToName || "HR Admin"}
                        </span>
                      ),
                    },
                    {
                      key: "status",
                      header: "Status",
                      render: (r: any) => (
                        <Badge variant={STATUS_COLORS[r.status] || "gray"}>{r.status}</Badge>
                      ),
                    },
                    {
                      key: "actions",
                      header: "",
                      render: (r: any) =>
                        r.status === "pending" || r.status === "approved" ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setShowCancel(r.id);
                              setCancelReason("");
                            }}
                            title="Cancel leave"
                          >
                            <X className="h-4 w-4 text-red-500" />
                          </Button>
                        ) : r.cancellation_reason ? (
                          <span className="text-xs italic text-gray-400">
                            Cancelled: {r.cancellation_reason}
                          </span>
                        ) : null,
                    },
                  ]}
                  data={requests}
                />
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <>
          {/* TEAM LEAVES TAB */}
          <div className="flex items-center gap-2">
            {["all", "pending", "approved", "rejected", "cancelled"].map((s) => (
              <Button
                key={s}
                variant={teamFilter === s ? "primary" : "outline"}
                size="sm"
                onClick={() => setTeamFilter(s)}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </Button>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Team Leave Requests (Direct Reports)</CardTitle>
            </CardHeader>
            <CardContent>
              {teamLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : teamRequests.length === 0 ? (
                <div className="py-8 text-center text-gray-500">
                  <Users className="mx-auto mb-2 h-10 w-10 text-gray-300" />
                  <p>No {teamFilter !== "all" ? teamFilter : ""} leave requests from your team</p>
                </div>
              ) : (
                <DataTable
                  columns={[
                    {
                      key: "employeeName",
                      header: "Employee",
                      render: (r: any) => (
                        <div>
                          <p className="font-medium">{r.employeeName}</p>
                          <p className="text-xs text-gray-500">
                            {r.employeeCode} · {r.department}
                          </p>
                        </div>
                      ),
                    },
                    {
                      key: "leave_type",
                      header: "Type",
                      render: (r: any) => (
                        <span className="capitalize">{r.leave_type.replace("_", " ")}</span>
                      ),
                    },
                    {
                      key: "start_date",
                      header: "From",
                      render: (r: any) => new Date(r.start_date).toLocaleDateString("en-IN"),
                    },
                    {
                      key: "end_date",
                      header: "To",
                      render: (r: any) => new Date(r.end_date).toLocaleDateString("en-IN"),
                    },
                    {
                      key: "days",
                      header: "Days",
                      render: (r: any) => (
                        <span className="font-medium">
                          {Number(r.days)}
                          {r.is_half_day ? " (Half)" : ""}
                        </span>
                      ),
                    },
                    {
                      key: "reason",
                      header: "Reason",
                      render: (r: any) => (
                        <span className="block max-w-[200px] truncate text-sm">{r.reason}</span>
                      ),
                    },
                    {
                      key: "status",
                      header: "Status",
                      render: (r: any) => (
                        <Badge variant={STATUS_COLORS[r.status] || "gray"}>{r.status}</Badge>
                      ),
                    },
                    {
                      key: "actions",
                      header: "Actions",
                      render: (r: any) =>
                        r.status === "pending" ? (
                          <div className="flex gap-1">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => quickApprove(r.id)}
                              title="Approve"
                            >
                              <Check className="h-4 w-4 text-green-600" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setRemarksModal({ id: r.id, action: "reject" });
                                setRemarks("");
                              }}
                              title="Reject"
                            >
                              <X className="h-4 w-4 text-red-600" />
                            </Button>
                          </div>
                        ) : r.approver_remarks ? (
                          <span className="text-xs italic text-gray-500">{r.approver_remarks}</span>
                        ) : null,
                    },
                  ]}
                  data={teamRequests}
                />
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* Apply Leave Modal */}
      <Modal open={showApply} onClose={() => setShowApply(false)} title="Apply for Leave">
        <form onSubmit={handleApply} className="space-y-4">
          <SelectField
            id="leaveType"
            name="leaveType"
            label="Leave Type"
            required
            options={[{ value: "", label: "Select type..." }, ...leaveTypeOptions]}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input id="startDate" name="startDate" label="Start Date" type="date" required />
            <Input id="endDate" name="endDate" label="End Date" type="date" required />
          </div>
          <SelectField
            id="isHalfDay"
            name="isHalfDay"
            label="Half Day?"
            options={[
              { value: "false", label: "No — Full Day(s)" },
              { value: "true", label: "Yes — Half Day" },
            ]}
          />
          <div>
            <label
              htmlFor="reason"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Reason
            </label>
            <textarea
              id="reason"
              name="reason"
              required
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              placeholder="Reason for leave..."
            />
          </div>
          <p className="text-xs text-gray-500">
            Your leave request will be sent to your reporting manager for approval.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setShowApply(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Submit
            </Button>
          </div>
        </form>
      </Modal>

      {/* Cancel Leave Modal */}
      <Modal open={!!showCancel} onClose={() => setShowCancel(null)} title="Cancel Leave">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Are you sure you want to cancel this leave? If already approved, your balance will be
            restored.
          </p>
          <div>
            <label
              htmlFor="cancelReason"
              className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Reason
            </label>
            <textarea
              id="cancelReason"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              required
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              placeholder="Why are you cancelling?"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowCancel(null)}>
              Go Back
            </Button>
            <Button
              variant="danger"
              onClick={handleCancel}
              disabled={submitting || !cancelReason.trim()}
            >
              {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Confirm Cancellation
            </Button>
          </div>
        </div>
      </Modal>

      {/* Reject with Remarks Modal */}
      <Modal
        open={!!remarksModal}
        onClose={() => setRemarksModal(null)}
        title={remarksModal?.action === "approve" ? "Approve Leave" : "Reject Leave"}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Remarks (optional)
            </label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              placeholder="Add remarks..."
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRemarksModal(null)}>
              Cancel
            </Button>
            <Button
              variant={remarksModal?.action === "reject" ? "danger" : "primary"}
              onClick={handleTeamAction}
              disabled={submitting}
            >
              {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {remarksModal?.action === "approve" ? "Approve" : "Reject"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
