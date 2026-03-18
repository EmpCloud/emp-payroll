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
import { Plus, Calendar, Loader2, X } from "lucide-react";
import toast from "react-hot-toast";

const LEAVE_TYPES = [
  { value: "earned", label: "Earned Leave" },
  { value: "casual", label: "Casual Leave" },
  { value: "sick", label: "Sick Leave" },
  { value: "comp_off", label: "Compensatory Off" },
];

const STATUS_COLORS: Record<string, "green" | "yellow" | "red" | "gray"> = {
  pending: "yellow",
  approved: "green",
  rejected: "red",
  cancelled: "gray",
};

export function MyLeavesPage() {
  const [showApply, setShowApply] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [filter, setFilter] = useState("all");
  const qc = useQueryClient();

  const { data: balanceData, isLoading: balLoading } = useQuery({
    queryKey: ["my-leave-balance"],
    queryFn: () => apiGet<any>("/leaves/my-balance"),
  });

  const { data: requestsData, isLoading: reqLoading } = useQuery({
    queryKey: ["my-leave-requests", filter],
    queryFn: () => apiGet<any>(`/leaves/my-requests${filter !== "all" ? `?status=${filter}` : ""}`),
  });

  const balances = balanceData?.data?.data || [];
  const requests = requestsData?.data?.data || [];

  const totalAvailable = balances.reduce((s: number, b: any) => s + Number(b.closing_balance), 0);
  const totalUsed = balances.reduce((s: number, b: any) => s + Number(b.used), 0);

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
      toast.success("Leave applied successfully");
      setShowApply(false);
      qc.invalidateQueries({ queryKey: ["my-leave-requests"] });
      qc.invalidateQueries({ queryKey: ["my-leave-balance"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to apply leave");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel(id: string) {
    if (!confirm("Cancel this leave request?")) return;
    try {
      await apiPost(`/leaves/${id}/cancel`);
      toast.success("Leave cancelled");
      qc.invalidateQueries({ queryKey: ["my-leave-requests"] });
      qc.invalidateQueries({ queryKey: ["my-leave-balance"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to cancel");
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
              <p className="text-sm text-gray-500 dark:text-gray-400 capitalize">{b.leave_type.replace("_", " ")}</p>
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

      {/* Requests Table */}
      <Card>
        <CardHeader><CardTitle>Leave Requests</CardTitle></CardHeader>
        <CardContent>
          {reqLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : requests.length === 0 ? (
            <div className="py-8 text-center text-gray-500">
              <Calendar className="mx-auto mb-2 h-10 w-10 text-gray-300" />
              <p>No leave requests found</p>
            </div>
          ) : (
            <DataTable
              columns={[
                { key: "leave_type", header: "Type", render: (r: any) => (
                  <span className="capitalize font-medium">{r.leave_type.replace("_", " ")}</span>
                )},
                { key: "start_date", header: "From", render: (r: any) => new Date(r.start_date).toLocaleDateString("en-IN") },
                { key: "end_date", header: "To", render: (r: any) => new Date(r.end_date).toLocaleDateString("en-IN") },
                { key: "days", header: "Days", render: (r: any) => (
                  <span>{Number(r.days)}{r.is_half_day ? " (Half)" : ""}</span>
                )},
                { key: "reason", header: "Reason", render: (r: any) => (
                  <span className="max-w-[200px] truncate block">{r.reason}</span>
                )},
                { key: "status", header: "Status", render: (r: any) => (
                  <Badge variant={STATUS_COLORS[r.status] || "gray"}>{r.status}</Badge>
                )},
                { key: "actions", header: "", render: (r: any) => (
                  (r.status === "pending" || r.status === "approved") ? (
                    <Button variant="ghost" size="sm" onClick={() => handleCancel(r.id)}>
                      <X className="h-4 w-4 text-red-500" />
                    </Button>
                  ) : null
                )},
              ]}
              data={requests}
            />
          )}
        </CardContent>
      </Card>

      {/* Apply Leave Modal */}
      <Modal open={showApply} onClose={() => setShowApply(false)} title="Apply for Leave">
        <form onSubmit={handleApply} className="space-y-4">
          <SelectField
            id="leaveType"
            name="leaveType"
            label="Leave Type"
            required
            options={[{ value: "", label: "Select type..." }, ...LEAVE_TYPES]}
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
            <label htmlFor="reason" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
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
          <div className="flex justify-end gap-2">
            <Button variant="outline" type="button" onClick={() => setShowApply(false)}>Cancel</Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : null}
              Submit
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
