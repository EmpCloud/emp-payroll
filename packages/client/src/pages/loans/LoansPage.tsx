import { useState, useEffect } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { StatCard } from "@/components/ui/StatCard";
import { Pagination } from "@/components/ui/Pagination";
import { formatCurrency } from "@/lib/utils";
import { apiGet, apiPost } from "@/api/client";
import { useEmployees, useDepartments, useLocations } from "@/api/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Banknote, Clock, CheckCircle2, Loader2, Search } from "lucide-react";
import toast from "react-hot-toast";

const PAGE_SIZE = 20;

export function LoansPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  // Filter state lives in the URL so the top stat cards can deep-link into a
  // filtered list via `?status=...` (#71).
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = searchParams.get("status") || "";
  const qc = useQueryClient();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, departmentId, locationId, filter]);

  const { data: deptRes } = useDepartments();
  const { data: locRes } = useLocations();
  const departments: { id: string; name: string }[] = Array.isArray(deptRes?.data)
    ? deptRes.data
    : [];
  const locations: { id: string; name: string }[] = Array.isArray(locRes?.data) ? locRes.data : [];

  // Employee picker for the New Loan modal — paginated server-side already.
  const { data: empRes } = useEmployees({ limit: 100 });

  const queryParams: Record<string, any> = { page, limit: PAGE_SIZE };
  if (filter) queryParams.status = filter;
  if (search) queryParams.q = search;
  if (departmentId) queryParams.department_id = departmentId;
  if (locationId) queryParams.location_id = locationId;

  const {
    data: res,
    isLoading,
    isFetching,
  } = useQuery({
    queryKey: ["loans", queryParams],
    queryFn: () => apiGet<any>("/loans", queryParams),
  });

  // #158 — top stat cards are an org-wide summary, not a view of the
  // current filter set. Fetch a small unfiltered slice purely for the
  // counts (cheap because we only need totals).
  const { data: allRes } = useQuery({
    queryKey: ["loans-summary"],
    queryFn: () => apiGet<any>("/loans", { limit: 1, page: 1 }),
  });
  const { data: activeRes } = useQuery({
    queryKey: ["loans-summary-active"],
    queryFn: () => apiGet<any>("/loans", { status: "active", limit: 200, page: 1 }),
  });
  const { data: completedRes } = useQuery({
    queryKey: ["loans-summary-completed"],
    queryFn: () => apiGet<any>("/loans", { status: "completed", limit: 1, page: 1 }),
  });

  function setFilter(next: string) {
    const params = new URLSearchParams(searchParams);
    if (next) params.set("status", next);
    else params.delete("status");
    setSearchParams(params, { replace: true });
  }

  const loans = Array.isArray(res?.data?.data) ? res.data.data : [];
  const total = Number(res?.data?.total ?? 0);
  const totalPages = Number(res?.data?.totalPages ?? 1);

  const totalLoans = Number(allRes?.data?.total ?? 0);
  const activeLoans = Array.isArray(activeRes?.data?.data) ? activeRes.data.data : [];
  const activeCount = Number(activeRes?.data?.total ?? 0);
  const totalOutstanding = activeLoans.reduce(
    (s: number, l: any) => s + Number(l.outstanding_amount),
    0,
  );
  const totalEMI = activeLoans.reduce((s: number, l: any) => s + Number(l.emi_amount), 0);
  const completedCount = Number(completedRes?.data?.total ?? 0);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    const fd = new FormData(e.currentTarget);
    const amount = Number(fd.get("amount"));
    const tenure = Number(fd.get("tenure"));
    const interest = Number(fd.get("interest") || 0);

    // Client-side guard: amount, tenure, and interest must be non-negative.
    // Tenure must additionally be at least 1 so EMI math stays finite. (#70)
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error("Amount must be zero or greater");
      return;
    }
    if (!Number.isFinite(tenure) || tenure < 1) {
      toast.error("Tenure must be at least 1 month");
      return;
    }
    if (!Number.isFinite(interest) || interest < 0) {
      toast.error("Interest rate must be zero or greater");
      return;
    }

    setCreating(true);
    try {
      await apiPost("/loans", {
        employeeId: fd.get("employeeId"),
        type: fd.get("type"),
        description: fd.get("description"),
        principalAmount: amount,
        tenureMonths: tenure,
        interestRate: interest,
        startDate: fd.get("startDate"),
        notes: fd.get("notes"),
      });
      toast.success("Loan created");
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ["loans"] });
      qc.invalidateQueries({ queryKey: ["loans-summary"] });
      qc.invalidateQueries({ queryKey: ["loans-summary-active"] });
      qc.invalidateQueries({ queryKey: ["loans-summary-completed"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    } finally {
      setCreating(false);
    }
  }

  async function recordPayment(id: string) {
    try {
      await apiPost(`/loans/${id}/payment`);
      toast.success("Payment recorded");
      qc.invalidateQueries({ queryKey: ["loans"] });
      qc.invalidateQueries({ queryKey: ["loans-summary-active"] });
      qc.invalidateQueries({ queryKey: ["loans-summary-completed"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    }
  }

  const employees = Array.isArray(empRes?.data?.data) ? empRes.data.data : [];
  const hasEmployees = employees.length > 0;

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
      key: "type",
      header: "Type",
      render: (r: any) => <Badge variant="draft">{r.type.replace("_", " ")}</Badge>,
    },
    { key: "description", header: "Description" },
    {
      key: "principal_amount",
      header: "Principal",
      render: (r: any) => formatCurrency(r.principal_amount),
    },
    {
      key: "outstanding_amount",
      header: "Outstanding",
      render: (r: any) => (
        <span
          className={
            Number(r.outstanding_amount) > 0 ? "font-semibold text-orange-600" : "text-green-600"
          }
        >
          {formatCurrency(r.outstanding_amount)}
        </span>
      ),
    },
    { key: "emi_amount", header: "EMI", render: (r: any) => formatCurrency(r.emi_amount) },
    {
      key: "progress",
      header: "Progress",
      render: (r: any) => (
        <div className="w-20">
          <div className="mb-1 text-xs text-gray-500">
            {r.installments_paid}/{r.tenure_months}
          </div>
          <div className="h-1.5 rounded-full bg-gray-200">
            <div
              className="bg-brand-500 h-full rounded-full"
              style={{ width: `${(r.installments_paid / r.tenure_months) * 100}%` }}
            />
          </div>
        </div>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (r: any) => (
        <Badge
          variant={
            r.status === "active" ? "active" : r.status === "completed" ? "approved" : "inactive"
          }
        >
          {r.status}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r: any) =>
        r.status === "active" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => recordPayment(r.id)}
            className="text-green-600"
          >
            <CheckCircle2 className="h-4 w-4" /> Pay EMI
          </Button>
        ) : null,
    },
  ];

  // #113 — hover:shadow-md stacks on top of StatCard's own shadow-sm and
  // draws a thicker rectangle underneath the card that reads as an extra
  // box appearing on hover. Keep the lift via hover:-translate-y-0.5 and
  // drop the shadow bump.
  const cardLinkCls =
    "block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 transition hover:-translate-y-0.5";

  return (
    <div className="space-y-6">
      <PageHeader
        title="Loans & Advances"
        description={`${total} of ${totalLoans} loan${totalLoans === 1 ? "" : "s"}`}
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> New Loan
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/loans?status=active" className={cardLinkCls}>
          <StatCard title="Active Loans" value={String(activeCount)} icon={Banknote} />
        </Link>
        <Link to="/loans?status=active" className={cardLinkCls}>
          <StatCard title="Outstanding" value={formatCurrency(totalOutstanding)} icon={Clock} />
        </Link>
        <Link to="/loans?status=active" className={cardLinkCls}>
          <StatCard
            title="Monthly EMI"
            value={formatCurrency(totalEMI)}
            subtitle="total across all"
            icon={Banknote}
          />
        </Link>
        <Link to="/loans?status=completed" className={cardLinkCls}>
          <StatCard title="Completed" value={String(completedCount)} icon={CheckCircle2} />
        </Link>
      </div>

      {/* Search + filters */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_220px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by employee name, code, or designation..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          />
        </div>
        <select
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          className="focus:border-brand-500 focus:ring-brand-500 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-1 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          aria-label="Filter by department"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
        <select
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          className="focus:border-brand-500 focus:ring-brand-500 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-1 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          aria-label="Filter by location"
        >
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {["", "active", "completed", "cancelled"].map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${filter === f ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
          >
            {f || "All"}
          </button>
        ))}
        {(search || departmentId || locationId) && (
          <button
            type="button"
            onClick={() => {
              setSearchInput("");
              setSearch("");
              setDepartmentId("");
              setLocationId("");
            }}
            className="ml-auto text-xs text-gray-500 underline hover:text-gray-700"
          >
            Clear filters
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
          <DataTable
            columns={columns}
            data={loans}
            paginated={false}
            emptyMessage="No loans found"
          />
          <Pagination
            page={page}
            totalPages={totalPages}
            total={total}
            limit={PAGE_SIZE}
            onChange={setPage}
            disabled={isFetching}
          />
        </div>
      )}

      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Loan / Advance"
        className="max-w-lg"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          {hasEmployees ? (
            <SelectField
              id="employeeId"
              name="employeeId"
              label="Employee"
              required
              options={employees.map((e: any) => ({
                value: e.id,
                label: `${e.first_name} ${e.last_name} (${e.employee_code})`,
              }))}
            />
          ) : (
            // When the org has no employees the picker would otherwise render
            // as an empty / frozen dropdown; show a disabled state with a
            // helpful message instead. (#70)
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">Employee</label>
              <div className="block w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                There is no employee
              </div>
            </div>
          )}
          <SelectField
            id="type"
            name="type"
            label="Type"
            options={[
              { value: "salary_advance", label: "Salary Advance" },
              { value: "loan", label: "Loan" },
              { value: "emergency", label: "Emergency Advance" },
            ]}
          />
          <Input
            id="description"
            name="description"
            label="Description"
            placeholder="e.g. Medical emergency"
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              id="amount"
              name="amount"
              label="Amount (₹)"
              type="number"
              min="0"
              step="1"
              placeholder="50000"
              required
            />
            <Input
              id="tenure"
              name="tenure"
              label="Tenure (months)"
              type="number"
              min="1"
              step="1"
              placeholder="6"
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              id="interest"
              name="interest"
              label="Interest Rate (%)"
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              defaultValue="0"
            />
            <Input
              id="startDate"
              name="startDate"
              label="Start Date"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              required
            />
          </div>
          <Input
            id="notes"
            name="notes"
            label="Notes (optional)"
            placeholder="Any additional notes"
          />
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={creating} disabled={!hasEmployees}>
              Create Loan
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
