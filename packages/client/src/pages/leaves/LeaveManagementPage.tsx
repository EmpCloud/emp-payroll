import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { apiGet, apiPost } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X, Loader2, Calendar, Clock, Ban } from "lucide-react";
import toast from "react-hot-toast";

const STATUS_COLORS: Record<string, "green" | "yellow" | "red" | "gray"> = {
  pending: "yellow",
  approved: "green",
  rejected: "red",
  cancelled: "gray",
};

export function LeaveManagementPage() {
  const [filter, setFilter] = useState("pending");
  const [remarksModal, setRemarksModal] = useState<{ id: string; action: "approve" | "reject" } | null>(null);
  const [remarks, setRemarks] = useState("");
  const [processing, setProcessing] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["leave-requests", filter],
    queryFn: () => apiGet<any>(`/leaves/requests${filter !== "all" ? `?status=${filter}` : ""}`),
  });

  const requests = data?.data?.data || [];
  const pendingCount = requests.filter((r: any) => r.status === "pending").length;
  const cancelledCount = requests.filter((r: any) => r.status === "cancelled").length;

  async function handleAction() {
    if (!remarksModal) return;
    setProcessing(true);
    try {
      await apiPost(`/leaves/${remarksModal.id}/${remarksModal.action}`, { remarks });
      toast.success(`Leave ${remarksModal.action}d successfully`);
      setRemarksModal(null);
      setRemarks("");
      qc.invalidateQueries({ queryKey: ["leave-requests"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Action failed");
    } finally {
      setProcessing(false);
    }
  }

  async function quickApprove(id: string) {
    try {
      await apiPost(`/leaves/${id}/approve`, {});
      toast.success("Leave approved");
      qc.invalidateQueries({ queryKey: ["leave-requests"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Leave Management" />

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        <Card className="cursor-pointer" onClick={() => setFilter("pending")}>
          <CardContent className="flex items-center gap-3 p-4">
            <Clock className="h-8 w-8 text-yellow-500" />
            <div>
              <p className="text-2xl font-bold">{pendingCount || "—"}</p>
              <p className="text-sm text-gray-500">Pending</p>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setFilter("approved")}>
          <CardContent className="flex items-center gap-3 p-4">
            <Check className="h-8 w-8 text-green-500" />
            <div>
              <p className="text-2xl font-bold">—</p>
              <p className="text-sm text-gray-500">Approved</p>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setFilter("rejected")}>
          <CardContent className="flex items-center gap-3 p-4">
            <X className="h-8 w-8 text-red-500" />
            <div>
              <p className="text-2xl font-bold">—</p>
              <p className="text-sm text-gray-500">Rejected</p>
            </div>
          </CardContent>
        </Card>
        {/* #61 — surfaced alongside the other status cards so admins can see
            cancelled leaves at a glance instead of only finding them via the
            filter tabs. Count only populates when the current filter actually
            includes cancelled rows (same pattern as Pending above). */}
        <Card className="cursor-pointer" onClick={() => setFilter("cancelled")}>
          <CardContent className="flex items-center gap-3 p-4">
            <Ban className="h-8 w-8 text-gray-500" />
            <div>
              <p className="text-2xl font-bold">{cancelledCount || "—"}</p>
              <p className="text-sm text-gray-500">Cancelled</p>
            </div>
          </CardContent>
        </Card>
        <Card className="cursor-pointer" onClick={() => setFilter("all")}>
          <CardContent className="flex items-center gap-3 p-4">
            <Calendar className="h-8 w-8 text-blue-500" />
            <div>
              <p className="text-2xl font-bold">{data?.data?.total || "—"}</p>
              <p className="text-sm text-gray-500">Total</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2">
        {["all", "pending", "approved", "rejected", "cancelled"].map((s) => (
          <Button key={s} variant={filter === s ? "primary" : "outline"} size="sm" onClick={() => setFilter(s)}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </Button>
        ))}
      </div>

      {/* Table */}
      <Card>
        <CardHeader><CardTitle>Leave Requests</CardTitle></CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : requests.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              <Calendar className="mx-auto mb-2 h-10 w-10 text-gray-300" />
              <p>No {filter !== "all" ? filter : ""} leave requests</p>
            </div>
          ) : (
            <DataTable
              columns={[
                { key: "employeeName", header: "Employee", render: (r: any) => (
                  <div>
                    <p className="font-medium">{r.employeeName}</p>
                    <p className="text-xs text-gray-500">{r.employeeCode} · {r.department}</p>
                  </div>
                )},
                { key: "leave_type", header: "Type", render: (r: any) => (
                  <span className="capitalize">{r.leave_type.replace("_", " ")}</span>
                )},
                { key: "start_date", header: "From", render: (r: any) => new Date(r.start_date).toLocaleDateString("en-IN") },
                { key: "end_date", header: "To", render: (r: any) => new Date(r.end_date).toLocaleDateString("en-IN") },
                { key: "days", header: "Days", render: (r: any) => (
                  <span className="font-medium">{Number(r.days)}{r.is_half_day ? " (Half)" : ""}</span>
                )},
                { key: "reason", header: "Reason", render: (r: any) => (
                  <span className="max-w-[200px] truncate block text-sm">{r.reason}</span>
                )},
                { key: "assigned_to", header: "Approver", render: (r: any) => (
                  <span className="text-sm text-gray-500">{r.assignedToName || "HR Admin"}</span>
                )},
                { key: "status", header: "Status", render: (r: any) => (
                  <Badge variant={STATUS_COLORS[r.status] || "gray"}>{r.status}</Badge>
                )},
                { key: "actions", header: "Actions", render: (r: any) => (
                  r.status === "pending" ? (
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" onClick={() => quickApprove(r.id)} title="Approve">
                        <Check className="h-4 w-4 text-green-600" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => { setRemarksModal({ id: r.id, action: "reject" }); setRemarks(""); }} title="Reject">
                        <X className="h-4 w-4 text-red-600" />
                      </Button>
                    </div>
                  ) : (
                    r.approver_remarks ? (
                      <span className="text-xs text-gray-500 italic">{r.approver_remarks}</span>
                    ) : null
                  )
                )},
              ]}
              data={requests}
            />
          )}
        </CardContent>
      </Card>

      {/* Remarks Modal */}
      <Modal
        open={!!remarksModal}
        onClose={() => setRemarksModal(null)}
        title={remarksModal?.action === "approve" ? "Approve Leave" : "Reject Leave"}
      >
        <div className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Remarks (optional)</label>
            <textarea
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              rows={3}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              placeholder="Add remarks..."
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setRemarksModal(null)}>Cancel</Button>
            <Button
              variant={remarksModal?.action === "reject" ? "danger" : "primary"}
              onClick={handleAction}
              disabled={processing}
            >
              {processing ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              {remarksModal?.action === "approve" ? "Approve" : "Reject"}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
