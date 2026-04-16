import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { StatCard } from "@/components/ui/StatCard";
import { formatCurrency } from "@/lib/utils";
import { apiGet, apiPost } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Receipt, CheckCircle2, XCircle, Clock, CreditCard } from "lucide-react";
import toast from "react-hot-toast";
import { useState } from "react";
import { Link } from "react-router-dom";

export function ReimbursementsPage() {
  const [filter, setFilter] = useState("");
  const qc = useQueryClient();

  const { data: res, isLoading } = useQuery({
    queryKey: ["reimbursements", filter],
    queryFn: () => apiGet<any>("/reimbursements", filter ? { status: filter } : {}),
  });

  const claims = res?.data?.data || [];
  const pending = claims.filter((c: any) => c.status === "pending");
  const approved = claims.filter((c: any) => c.status === "approved");
  const rejected = claims.filter((c: any) => c.status === "rejected");
  const paid = claims.filter((c: any) => c.status === "paid");
  const totalPending = pending.reduce((s: number, c: any) => s + Number(c.amount), 0);
  const totalApproved = approved.reduce((s: number, c: any) => s + Number(c.amount), 0);
  const totalRejected = rejected.reduce((s: number, c: any) => s + Number(c.amount), 0);

  async function handleAction(id: string, action: "approve" | "reject") {
    try {
      await apiPost(`/reimbursements/${id}/${action}`);
      toast.success(`Claim ${action}d`);
      qc.invalidateQueries({ queryKey: ["reimbursements"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    }
  }

  const columns = [
    {
      key: "employee",
      header: "Employee",
      render: (r: any) => (
        <div>
          <p className="font-medium text-gray-900">{r.employee_name}</p>
          <p className="text-xs text-gray-500">{r.employee_code}</p>
        </div>
      ),
    },
    {
      key: "category",
      header: "Category",
      render: (r: any) => <Badge variant="draft">{r.category}</Badge>,
    },
    {
      key: "description",
      header: "Description",
      render: (r: any) => <span className="text-sm text-gray-700">{r.description}</span>,
    },
    {
      key: "amount",
      header: "Amount",
      render: (r: any) => <span className="font-medium">{formatCurrency(r.amount)}</span>,
    },
    {
      key: "expense_date",
      header: "Date",
      render: (r: any) => new Date(r.expense_date).toLocaleDateString("en-IN"),
    },
    {
      key: "status",
      header: "Status",
      render: (r: any) => <Badge variant={r.status}>{r.status}</Badge>,
    },
    {
      key: "actions",
      header: "",
      render: (r: any) => r.status === "pending" ? (
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => handleAction(r.id, "approve")} className="text-green-600 hover:text-green-700">
            <CheckCircle2 className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => handleAction(r.id, "reject")} className="text-red-600 hover:text-red-700">
            <XCircle className="h-4 w-4" />
          </Button>
        </div>
      ) : null,
    },
  ];

  const filters = [
    { value: "", label: "All" },
    { value: "pending", label: "Pending" },
    { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
    { value: "paid", label: "Paid" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reimbursements"
        description="Review and manage employee expense claims"
      />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
        <Link
          to="/reimbursements"
          onClick={() => setFilter("")}
          className="rounded-xl transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-500"
          aria-label="View all reimbursement claims"
        >
          <StatCard title="Total Claims" value={String(claims.length)} icon={Receipt} />
        </Link>
        <Link
          to="/reimbursements"
          onClick={() => setFilter("pending")}
          className="rounded-xl transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-500"
          aria-label="View pending reimbursement claims"
        >
          <StatCard title="Pending" value={String(pending.length)} subtitle={formatCurrency(totalPending)} icon={Clock} />
        </Link>
        <Link
          to="/reimbursements"
          onClick={() => setFilter("approved")}
          className="rounded-xl transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-500"
          aria-label="View approved reimbursement claims"
        >
          <StatCard title="Approved" value={String(approved.length)} subtitle={formatCurrency(totalApproved)} icon={CheckCircle2} />
        </Link>
        <Link
          to="/reimbursements"
          onClick={() => setFilter("rejected")}
          className="rounded-xl transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-500"
          aria-label="View rejected reimbursement claims"
        >
          <StatCard title="Rejected" value={String(rejected.length)} subtitle={formatCurrency(totalRejected)} icon={XCircle} />
        </Link>
        <Link
          to="/reimbursements"
          onClick={() => setFilter("paid")}
          className="rounded-xl transition hover:shadow-md focus:outline-none focus:ring-2 focus:ring-brand-500"
          aria-label="View paid reimbursement claims"
        >
          <StatCard title="Paid" value={String(paid.length)} icon={CreditCard} />
        </Link>
      </div>

      <div className="flex gap-2">
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === f.value ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>
      ) : (
        <DataTable
          columns={columns}
          data={claims}
          emptyMessage="No reimbursement claims found"
        />
      )}
    </div>
  );
}
