import { useState, useEffect } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { StatCard } from "@/components/ui/StatCard";
import { Pagination } from "@/components/ui/Pagination";
import { formatCurrency } from "@/lib/utils";
import { apiGet, apiPost } from "@/api/client";
import { useDepartments, useLocations } from "@/api/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Receipt, CheckCircle2, XCircle, Clock, CreditCard, Search } from "lucide-react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";

const PAGE_SIZE = 20;

export function ReimbursementsPage() {
  const [filter, setFilter] = useState("");
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
    queryKey: ["reimbursements", queryParams],
    queryFn: () => apiGet<any>("/reimbursements", queryParams),
  });

  // #301 — top stat cards are an org-wide summary, not a view of the
  // current tab. Each card is just a count + sum, so request a small
  // status-scoped slice for the totals.
  const { data: allRes } = useQuery({
    queryKey: ["reimbursements-summary", "all"],
    queryFn: () => apiGet<any>("/reimbursements", { limit: 1, page: 1 }),
  });
  const { data: pendingRes } = useQuery({
    queryKey: ["reimbursements-summary", "pending"],
    queryFn: () => apiGet<any>("/reimbursements", { status: "pending", limit: 200, page: 1 }),
  });
  const { data: approvedRes } = useQuery({
    queryKey: ["reimbursements-summary", "approved"],
    queryFn: () => apiGet<any>("/reimbursements", { status: "approved", limit: 200, page: 1 }),
  });
  const { data: rejectedRes } = useQuery({
    queryKey: ["reimbursements-summary", "rejected"],
    queryFn: () => apiGet<any>("/reimbursements", { status: "rejected", limit: 200, page: 1 }),
  });
  const { data: paidRes } = useQuery({
    queryKey: ["reimbursements-summary", "paid"],
    queryFn: () => apiGet<any>("/reimbursements", { status: "paid", limit: 1, page: 1 }),
  });

  const claims = Array.isArray(res?.data?.data) ? res.data.data : [];
  const total = Number(res?.data?.total ?? 0);
  const totalPages = Number(res?.data?.totalPages ?? 1);

  const totalClaims = Number(allRes?.data?.total ?? 0);
  const pendingRows = Array.isArray(pendingRes?.data?.data) ? pendingRes.data.data : [];
  const approvedRows = Array.isArray(approvedRes?.data?.data) ? approvedRes.data.data : [];
  const rejectedRows = Array.isArray(rejectedRes?.data?.data) ? rejectedRes.data.data : [];
  const pendingCount = Number(pendingRes?.data?.total ?? 0);
  const approvedCount = Number(approvedRes?.data?.total ?? 0);
  const rejectedCount = Number(rejectedRes?.data?.total ?? 0);
  const paidCount = Number(paidRes?.data?.total ?? 0);
  const totalPending = pendingRows.reduce((s: number, c: any) => s + Number(c.amount), 0);
  const totalApproved = approvedRows.reduce((s: number, c: any) => s + Number(c.amount), 0);
  const totalRejected = rejectedRows.reduce((s: number, c: any) => s + Number(c.amount), 0);

  async function handleAction(id: string, action: "approve" | "reject") {
    try {
      await apiPost(`/reimbursements/${id}/${action}`);
      toast.success(`Claim ${action}d`);
      qc.invalidateQueries({ queryKey: ["reimbursements"] });
      qc.invalidateQueries({ queryKey: ["reimbursements-summary"] });
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
      render: (r: any) =>
        r.status === "pending" ? (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleAction(r.id, "approve")}
              className="text-green-600 hover:text-green-700"
            >
              <CheckCircle2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleAction(r.id, "reject")}
              className="text-red-600 hover:text-red-700"
            >
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
        description={`${total} of ${totalClaims} claim${totalClaims === 1 ? "" : "s"}`}
      />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
        <Link
          to="/reimbursements"
          onClick={() => setFilter("")}
          className="focus-visible:ring-brand-500 block rounded-xl transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2"
          aria-label="View all reimbursement claims"
        >
          <StatCard title="Total Claims" value={String(totalClaims)} icon={Receipt} />
        </Link>
        <Link
          to="/reimbursements"
          onClick={() => setFilter("pending")}
          className="focus-visible:ring-brand-500 block rounded-xl transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2"
          aria-label="View pending reimbursement claims"
        >
          <StatCard
            title="Pending"
            value={String(pendingCount)}
            subtitle={formatCurrency(totalPending)}
            icon={Clock}
          />
        </Link>
        <Link
          to="/reimbursements"
          onClick={() => setFilter("approved")}
          className="focus-visible:ring-brand-500 block rounded-xl transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2"
          aria-label="View approved reimbursement claims"
        >
          <StatCard
            title="Approved"
            value={String(approvedCount)}
            subtitle={formatCurrency(totalApproved)}
            icon={CheckCircle2}
          />
        </Link>
        <Link
          to="/reimbursements"
          onClick={() => setFilter("rejected")}
          className="focus-visible:ring-brand-500 block rounded-xl transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2"
          aria-label="View rejected reimbursement claims"
        >
          <StatCard
            title="Rejected"
            value={String(rejectedCount)}
            subtitle={formatCurrency(totalRejected)}
            icon={XCircle}
          />
        </Link>
        <Link
          to="/reimbursements"
          onClick={() => setFilter("paid")}
          className="focus-visible:ring-brand-500 block rounded-xl transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2"
          aria-label="View paid reimbursement claims"
        >
          <StatCard title="Paid" value={String(paidCount)} icon={CreditCard} />
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
        {filters.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filter === f.value
                ? "bg-brand-600 text-white"
                : "bg-gray-100 text-gray-600 hover:bg-gray-200"
            }`}
          >
            {f.label}
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
          <DataTable columns={columns} data={claims} emptyMessage="No reimbursement claims found" />
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
    </div>
  );
}
