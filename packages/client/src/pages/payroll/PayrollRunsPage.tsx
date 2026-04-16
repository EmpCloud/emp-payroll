import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
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
  { value: "1", label: "January" },
  { value: "2", label: "February" },
  { value: "3", label: "March" },
  { value: "4", label: "April" },
  { value: "5", label: "May" },
  { value: "6", label: "June" },
  { value: "7", label: "July" },
  { value: "8", label: "August" },
  { value: "9", label: "September" },
  { value: "10", label: "October" },
  { value: "11", label: "November" },
  { value: "12", label: "December" },
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
    render: (row: any) => (Number(row.total_gross) ? formatCurrency(row.total_gross) : "—"),
  },
  {
    key: "total_deductions",
    header: "Deductions",
    render: (row: any) =>
      Number(row.total_deductions) ? formatCurrency(row.total_deductions) : "—",
  },
  {
    key: "total_net",
    header: "Net Pay",
    render: (row: any) => (Number(row.total_net) ? formatCurrency(row.total_net) : "—"),
  },
  {
    key: "status",
    header: "Status",
    render: (row: any) => <Badge variant={row.status}>{row.status}</Badge>,
  },
];

export function PayrollRunsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
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
    const payDateRaw = fd.get("pay_date");
    const payDate = typeof payDateRaw === "string" ? payDateRaw : "";

    // Guard against silent failures: validate inputs on the client before
    // hitting the server. Without this, NaN/empty values get serialized as
    // `null` in JSON, which the server rejects with a 400 that the user may
    // miss (#22 "submit appears to succeed").
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      toast.error("Please select a valid month");
      return;
    }
    if (!Number.isInteger(year) || year < 2020 || year > 2100) {
      toast.error("Please enter a valid year (2020–2100)");
      return;
    }
    if (!payDate) {
      toast.error("Please choose a pay date");
      return;
    }

    try {
      const result = await createMutation.mutateAsync({ month, year, payDate });
      // Explicitly force a refetch of the runs list. The hook already
      // invalidates the query, but we await it here so the list is fresh
      // before the user lands back on this page via the Back button.
      await qc.invalidateQueries({ queryKey: ["payroll-runs"] });
      toast.success("Payroll run created");
      setShowCreate(false);
      if (result?.data?.id) {
        navigate(`/payroll/runs/${result.data.id}`);
      } else {
        // No id in response — something is off server-side. Surface it rather
        // than silently claiming success.
        // eslint-disable-next-line no-console
        console.error("createPayrollRun: server returned no run id", result);
        toast.error(
          "Payroll run submitted but the server did not return an id. Refresh the list to verify.",
        );
      }
    } catch (err: any) {
      // Log full error to aid debugging silent server-side failures (#22).
      // eslint-disable-next-line no-console
      console.error("createPayrollRun failed:", err?.response?.data || err);
      const serverErr = err?.response?.data?.error;
      const detailsMsg = serverErr?.details
        ? Object.entries(serverErr.details as Record<string, string[]>)
            .map(([k, v]) => `${k}: ${v.join(", ")}`)
            .join("; ")
        : "";
      toast.error(
        detailsMsg
          ? `${serverErr?.message || "Failed to create payroll run"} — ${detailsMsg}`
          : serverErr?.message || "Failed to create payroll run",
      );
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll Runs"
        description="Monthly payroll processing"
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> Run Payroll
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={runs}
          onRowClick={(row) => navigate(`/payroll/runs/${row.id}`)}
          emptyMessage="No payroll runs yet. Click 'New Payroll Run' to get started."
        />
      )}

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New Payroll Run"
        description="Create a new monthly payroll run"
      >
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
            <Button variant="outline" type="button" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              Create Run
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
