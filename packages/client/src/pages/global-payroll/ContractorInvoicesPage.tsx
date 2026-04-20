import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { apiGet, apiPost } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Check, X, DollarSign } from "lucide-react";
import toast from "react-hot-toast";

const STATUS_BADGE: Record<string, "active" | "draft" | "inactive"> = {
  pending: "draft",
  approved: "active",
  paid: "active",
  rejected: "inactive",
};

export function ContractorInvoicesPage() {
  const qc = useQueryClient();
  const [showSubmit, setShowSubmit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState("");

  const [form, setForm] = useState({
    globalEmployeeId: "",
    amount: "",
    description: "",
    periodStart: "",
    periodEnd: "",
  });

  const { data: invoicesRes, isLoading } = useQuery({
    queryKey: ["global-invoices", statusFilter],
    queryFn: () =>
      apiGet<any>("/global/invoices", {
        status: statusFilter || undefined,
      }),
  });

  // Get contractor employees for the dropdown
  const { data: empRes } = useQuery({
    queryKey: ["global-employees-contractors"],
    queryFn: () => apiGet<any>("/global/employees", { employmentType: "contractor" }),
  });

  const invoices = invoicesRes?.data || [];
  const contractors = empRes?.data || [];

  const contractorOptions = contractors.map((c: any) => ({
    value: c.id,
    label: `${c.first_name} ${c.last_name} (${c.country_name})`,
  }));

  const handleSubmit = async () => {
    if (!form.globalEmployeeId || !form.amount || !form.periodStart || !form.periodEnd) {
      toast.error("Please fill all required fields");
      return;
    }
    // #120 — Invoice amounts must be positive. A negative or zero invoice
    // is an accounting mistake — block it before hitting the API.
    const amtNum = Number(form.amount);
    if (!Number.isFinite(amtNum) || amtNum <= 0) {
      toast.error("Amount must be a positive number");
      return;
    }
    // #121 — End date must be on or after start date; an invoice for a
    // negative-length period is invalid.
    if (new Date(form.periodEnd).getTime() < new Date(form.periodStart).getTime()) {
      toast.error("End date must be on or after start date");
      return;
    }
    setSaving(true);
    try {
      await apiPost("/global/invoices", {
        globalEmployeeId: form.globalEmployeeId,
        amount: Math.round(amtNum * 100),
        description: form.description || undefined,
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
      });
      toast.success("Invoice submitted");
      setShowSubmit(false);
      setForm({
        globalEmployeeId: "",
        amount: "",
        description: "",
        periodStart: "",
        periodEnd: "",
      });
      qc.invalidateQueries({ queryKey: ["global-invoices"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to submit invoice");
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (invoiceId: string) => {
    try {
      await apiPost(`/global/invoices/${invoiceId}/approve`);
      toast.success("Invoice approved");
      qc.invalidateQueries({ queryKey: ["global-invoices"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to approve");
    }
  };

  const handleReject = async (invoiceId: string) => {
    if (!confirm("Reject this invoice?")) return;
    try {
      await apiPost(`/global/invoices/${invoiceId}/reject`);
      toast.success("Invoice rejected");
      qc.invalidateQueries({ queryKey: ["global-invoices"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to reject");
    }
  };

  const handleMarkPaid = async (invoiceId: string) => {
    try {
      await apiPost(`/global/invoices/${invoiceId}/paid`);
      toast.success("Invoice marked as paid");
      qc.invalidateQueries({ queryKey: ["global-invoices"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to mark paid");
    }
  };

  const columns = [
    {
      key: "invoice_number",
      header: "Invoice #",
      render: (row: any) => <span className="font-mono text-sm">{row.invoice_number}</span>,
    },
    {
      key: "contractor",
      header: "Contractor",
      render: (row: any) => (
        <div>
          <p className="font-medium">{row.contractor_name}</p>
          <p className="text-xs text-gray-400">{row.contractor_email}</p>
        </div>
      ),
    },
    {
      key: "period",
      header: "Period",
      render: (row: any) => (
        <span className="text-sm">
          {new Date(row.period_start).toLocaleDateString()} -{" "}
          {new Date(row.period_end).toLocaleDateString()}
        </span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      render: (row: any) => (
        <span className="font-mono font-medium">
          {row.currency} {(Number(row.amount) / 100).toLocaleString()}
        </span>
      ),
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
      key: "submitted_at",
      header: "Submitted",
      render: (row: any) => new Date(row.submitted_at).toLocaleDateString(),
    },
    {
      key: "actions",
      header: "Actions",
      render: (row: any) => (
        <div className="flex gap-1">
          {row.status === "pending" && (
            <>
              <Button size="sm" variant="outline" onClick={() => handleApprove(row.id)}>
                <Check className="mr-1 h-3 w-3" />
                Approve
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-red-600"
                onClick={() => handleReject(row.id)}
              >
                <X className="h-3 w-3" />
              </Button>
            </>
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
        title="Contractor Invoices"
        description="Manage and pay contractor invoices"
        actions={
          <Button onClick={() => setShowSubmit(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Submit Invoice
          </Button>
        }
      />

      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <SelectField
            className="w-40"
            options={[
              { value: "", label: "All Statuses" },
              { value: "pending", label: "Pending" },
              { value: "approved", label: "Approved" },
              { value: "paid", label: "Paid" },
              { value: "rejected", label: "Rejected" },
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
        <DataTable columns={columns} data={invoices} emptyMessage="No contractor invoices yet." />
      )}

      {/* Submit Invoice Modal */}
      <Modal
        open={showSubmit}
        onClose={() => setShowSubmit(false)}
        title="Submit Contractor Invoice"
      >
        <div className="space-y-4">
          {/* #120 — When the org has no contractor-type global employees, the
              dropdown was empty with no explanation. Show a clear empty state
              pointing to the right place to add contractors. */}
          <SelectField
            label="Contractor *"
            options={[
              {
                value: "",
                label:
                  contractorOptions.length > 0
                    ? "Select a contractor..."
                    : "No contractors yet — add one under Global Employees",
              },
              ...contractorOptions,
            ]}
            value={form.globalEmployeeId}
            onChange={(e) => setForm({ ...form, globalEmployeeId: e.target.value })}
            disabled={contractorOptions.length === 0}
          />
          <Input
            label="Amount * (in major currency unit)"
            type="number"
            min="0"
            step="0.01"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: e.target.value })}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Period Start *"
              type="date"
              value={form.periodStart}
              onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
            />
            <Input
              label="Period End *"
              type="date"
              value={form.periodEnd}
              onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
            />
          </div>
          <Input
            label="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setShowSubmit(false)}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Submit Invoice
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
