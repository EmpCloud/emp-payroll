import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { StatCard } from "@/components/ui/StatCard";
import { formatCurrency } from "@/lib/utils";
import { apiGet, apiPost } from "@/api/client";
import { useEmployees } from "@/api/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Banknote, Clock, CheckCircle2, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

export function LoansPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [filter, setFilter] = useState("");
  const qc = useQueryClient();
  const { data: empRes } = useEmployees({ limit: 100 });

  const { data: res, isLoading } = useQuery({
    queryKey: ["loans", filter],
    queryFn: () => apiGet<any>("/loans", filter ? { status: filter } : {}),
  });

  const loans = res?.data?.data || [];
  const active = loans.filter((l: any) => l.status === "active");
  const totalOutstanding = active.reduce((s: number, l: any) => s + Number(l.outstanding_amount), 0);
  const totalEMI = active.reduce((s: number, l: any) => s + Number(l.emi_amount), 0);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    const fd = new FormData(e.currentTarget);
    try {
      await apiPost("/loans", {
        employeeId: fd.get("employeeId"),
        type: fd.get("type"),
        description: fd.get("description"),
        principalAmount: Number(fd.get("amount")),
        tenureMonths: Number(fd.get("tenure")),
        interestRate: Number(fd.get("interest") || 0),
        startDate: fd.get("startDate"),
        notes: fd.get("notes"),
      });
      toast.success("Loan created");
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ["loans"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    } finally { setCreating(false); }
  }

  async function recordPayment(id: string) {
    try {
      await apiPost(`/loans/${id}/payment`);
      toast.success("Payment recorded");
      qc.invalidateQueries({ queryKey: ["loans"] });
    } catch (err: any) { toast.error(err.response?.data?.error?.message || "Failed"); }
  }

  const employees = empRes?.data?.data || [];

  const columns = [
    {
      key: "employee", header: "Employee",
      render: (r: any) => (
        <div>
          <p className="font-medium text-gray-900">{r.employee_name}</p>
          <p className="text-xs text-gray-500">{r.employee_code}</p>
        </div>
      ),
    },
    { key: "type", header: "Type", render: (r: any) => <Badge variant="draft">{r.type.replace("_", " ")}</Badge> },
    { key: "description", header: "Description" },
    { key: "principal_amount", header: "Principal", render: (r: any) => formatCurrency(r.principal_amount) },
    { key: "outstanding_amount", header: "Outstanding", render: (r: any) => (
      <span className={Number(r.outstanding_amount) > 0 ? "font-semibold text-orange-600" : "text-green-600"}>
        {formatCurrency(r.outstanding_amount)}
      </span>
    )},
    { key: "emi_amount", header: "EMI", render: (r: any) => formatCurrency(r.emi_amount) },
    { key: "progress", header: "Progress", render: (r: any) => (
      <div className="w-20">
        <div className="mb-1 text-xs text-gray-500">{r.installments_paid}/{r.tenure_months}</div>
        <div className="h-1.5 rounded-full bg-gray-200">
          <div className="h-full rounded-full bg-brand-500" style={{ width: `${(r.installments_paid / r.tenure_months) * 100}%` }} />
        </div>
      </div>
    )},
    { key: "status", header: "Status", render: (r: any) => <Badge variant={r.status === "active" ? "active" : r.status === "completed" ? "approved" : "inactive"}>{r.status}</Badge> },
    { key: "actions", header: "", render: (r: any) => r.status === "active" ? (
      <Button variant="ghost" size="sm" onClick={() => recordPayment(r.id)} className="text-green-600">
        <CheckCircle2 className="h-4 w-4" /> Pay EMI
      </Button>
    ) : null },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Loans & Advances" description="Track employee loans, advances, and EMI deductions"
        actions={<Button size="sm" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4" /> New Loan</Button>}
      />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Active Loans" value={String(active.length)} icon={Banknote} />
        <StatCard title="Outstanding" value={formatCurrency(totalOutstanding)} icon={Clock} />
        <StatCard title="Monthly EMI" value={formatCurrency(totalEMI)} subtitle="total across all" icon={Banknote} />
        <StatCard title="Completed" value={String(loans.filter((l: any) => l.status === "completed").length)} icon={CheckCircle2} />
      </div>

      <div className="flex gap-2">
        {["", "active", "completed", "cancelled"].map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${filter === f ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
            {f || "All"}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>
      ) : (
        <DataTable columns={columns} data={loans} emptyMessage="No loans found" />
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Create Loan / Advance" className="max-w-lg">
        <form onSubmit={handleCreate} className="space-y-4">
          <SelectField id="employeeId" name="employeeId" label="Employee"
            options={employees.map((e: any) => ({ value: e.id, label: `${e.first_name} ${e.last_name} (${e.employee_code})` }))} />
          <SelectField id="type" name="type" label="Type" options={[
            { value: "salary_advance", label: "Salary Advance" },
            { value: "loan", label: "Loan" },
            { value: "emergency", label: "Emergency Advance" },
          ]} />
          <Input id="description" name="description" label="Description" placeholder="e.g. Medical emergency" required />
          <div className="grid grid-cols-2 gap-4">
            <Input id="amount" name="amount" label="Amount (₹)" type="number" placeholder="50000" required />
            <Input id="tenure" name="tenure" label="Tenure (months)" type="number" placeholder="6" required />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input id="interest" name="interest" label="Interest Rate (%)" type="number" placeholder="0" defaultValue="0" />
            <Input id="startDate" name="startDate" label="Start Date" type="date" defaultValue={new Date().toISOString().slice(0, 10)} required />
          </div>
          <Input id="notes" name="notes" label="Notes (optional)" placeholder="Any additional notes" />
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" loading={creating}>Create Loan</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
