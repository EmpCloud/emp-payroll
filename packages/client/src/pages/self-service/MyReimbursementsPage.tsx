import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { formatCurrency } from "@/lib/utils";
import { apiGet, apiPost } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Receipt, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

const CATEGORIES = [
  { value: "medical", label: "Medical" },
  { value: "travel", label: "Travel" },
  { value: "food", label: "Food & Meals" },
  { value: "equipment", label: "Equipment" },
  { value: "internet", label: "Internet / Phone" },
  { value: "books", label: "Books & Learning" },
  { value: "other", label: "Other" },
];

export function MyReimbursementsPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const qc = useQueryClient();

  // #1358 — Request a large page so client-side pagination has all records
  // to paginate through. Without per_page, backend caps at 20 and anything
  // past page 2 of the DataTable had no data to render.
  const { data: res, isLoading } = useQuery({
    queryKey: ["my-reimbursements"],
    queryFn: () => apiGet<any>("/self-service/reimbursements", { params: { per_page: 500 } }),
  });

  const claims = res?.data?.data || [];
  const totalPending = claims
    .filter((c: any) => c.status === "pending")
    .reduce((s: number, c: any) => s + Number(c.amount), 0);
  const totalApproved = claims
    .filter((c: any) => c.status === "approved" || c.status === "paid")
    .reduce((s: number, c: any) => s + Number(c.amount), 0);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const amount = Number(fd.get("amount"));
    // #38 — guard against negative / NaN amounts before hitting the server
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("Amount must be zero or a positive number");
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/self-service/reimbursements", {
        category: fd.get("category"),
        description: fd.get("description"),
        amount,
        expenseDate: fd.get("date"),
      });
      toast.success("Claim submitted for approval");
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ["my-reimbursements"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Reimbursements"
        description="Submit and track expense claims"
        actions={
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" /> New Claim
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-gray-500">Total Claims</p>
            <p className="text-xl font-bold">{claims.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-gray-500">Pending</p>
            <p className="text-xl font-bold text-orange-600">{formatCurrency(totalPending)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-gray-500">Approved / Paid</p>
            <p className="text-xl font-bold text-green-600">{formatCurrency(totalApproved)}</p>
          </CardContent>
        </Card>
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
        </div>
      ) : claims.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Receipt className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-4 text-gray-500">No reimbursement claims</p>
            <p className="mt-1 text-sm text-gray-400">Click "New Claim" to submit an expense</p>
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={[
            {
              key: "category",
              header: "Category",
              render: (r: any) => <Badge variant="draft">{r.category}</Badge>,
            },
            { key: "description", header: "Description" },
            { key: "amount", header: "Amount", render: (r: any) => formatCurrency(r.amount) },
            {
              key: "expense_date",
              header: "Date",
              render: (r: any) => new Date(r.expense_date).toLocaleDateString("en-IN"),
            },
            {
              key: "status",
              header: "Status",
              render: (r: any) => {
                const steps = ["pending", "approved", "paid"];
                const idx = steps.indexOf(r.status);
                return (
                  <div className="flex items-center gap-2">
                    <div className="flex gap-0.5">
                      {steps.map((step, i) => (
                        <div
                          key={step}
                          className={`h-1.5 w-5 rounded-full ${
                            r.status === "rejected"
                              ? "bg-red-400"
                              : i <= idx
                                ? "bg-green-500"
                                : "bg-gray-200"
                          }`}
                        />
                      ))}
                    </div>
                    <Badge variant={r.status}>{r.status}</Badge>
                  </div>
                );
              },
            },
          ]}
          data={claims}
        />
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Submit Expense Claim">
        <form onSubmit={handleSubmit} className="space-y-4">
          <SelectField id="category" name="category" label="Category" options={CATEGORIES} />
          <Input
            id="description"
            name="description"
            label="Description"
            placeholder="e.g. Client meeting taxi"
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              id="amount"
              name="amount"
              label="Amount (₹)"
              type="number"
              placeholder="1500"
              min="0"
              step="0.01"
              required
            />
            <Input id="date" name="date" label="Expense Date" type="date" required />
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Submit Claim
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
