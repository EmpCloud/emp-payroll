import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { SelectField } from "@/components/ui/SelectField";
import { Input } from "@/components/ui/Input";
import { formatCurrency, formatMonth } from "@/lib/utils";
import { usePayrollRuns, useCreatePayrollRun } from "@/api/hooks";
import { Plus, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

const MONTHS = [
  { value: "1", label: "January" }, { value: "2", label: "February" }, { value: "3", label: "March" },
  { value: "4", label: "April" }, { value: "5", label: "May" }, { value: "6", label: "June" },
  { value: "7", label: "July" }, { value: "8", label: "August" }, { value: "9", label: "September" },
  { value: "10", label: "October" }, { value: "11", label: "November" }, { value: "12", label: "December" },
];

const columns = [
  {
    key: "period",
    header: "Period",
    render: (row: any) => (
      <span className="font-medium text-gray-900">{formatMonth(row.month, row.year)}</span>
    ),
  },
  {
    key: "employee_count",
    header: "Employees",
    render: (row: any) => row.employee_count || 0,
  },
  {
    key: "total_gross",
    header: "Gross Pay",
    render: (row: any) => Number(row.total_gross) ? formatCurrency(row.total_gross) : "—",
  },
  {
    key: "total_deductions",
    header: "Deductions",
    render: (row: any) => Number(row.total_deductions) ? formatCurrency(row.total_deductions) : "—",
  },
  {
    key: "total_net",
    header: "Net Pay",
    render: (row: any) => Number(row.total_net) ? formatCurrency(row.total_net) : "—",
  },
  {
    key: "status",
    header: "Status",
    render: (row: any) => <Badge variant={row.status}>{row.status}</Badge>,
  },
];

export function PayrollRunsPage() {
  const navigate = useNavigate();
  const { data: res, isLoading } = usePayrollRuns();
  const createMutation = useCreatePayrollRun();
  const [showCreate, setShowCreate] = useState(false);

  const runs = res?.data?.data || [];
  const now = new Date();

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const month = Number(fd.get("month"));
    const year = Number(fd.get("year"));
    const payDate = fd.get("pay_date") as string;

    try {
      const result = await createMutation.mutateAsync({ month, year, payDate });
      toast.success("Payroll run created");
      setShowCreate(false);
      if (result?.data?.id) {
        navigate(`/payroll/runs/${result.data.id}`);
      }
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to create payroll run");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll Runs"
        description="Monthly payroll processing"
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> New Payroll Run
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={runs}
          onRowClick={(row) => navigate(`/payroll/runs/${row.id}`)}
          emptyMessage="No payroll runs yet. Click 'New Payroll Run' to get started."
        />
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Payroll Run" description="Create a new monthly payroll run">
        <form onSubmit={handleCreate} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <SelectField
              id="month"
              name="month"
              label="Month"
              defaultValue={String(now.getMonth() + 1)}
              options={MONTHS}
            />
            <Input
              id="year"
              name="year"
              label="Year"
              type="number"
              defaultValue={String(now.getFullYear())}
              required
            />
          </div>
          <Input
            id="pay_date"
            name="pay_date"
            label="Pay Date"
            type="date"
            defaultValue={`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-28`}
            required
          />
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" loading={createMutation.isPending}>Create Run</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
