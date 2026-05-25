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
import { Modal } from "@/components/ui/Modal";

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

  // #399 — Mark-as-Paid flow. Backend already exposes POST
  // /reimbursements/:id/pay (month, year); this state drives the modal that
  // captures which payroll month the disbursement landed in, so reporting
  // can attribute the payment to the correct period.
  const today = new Date();
  const [payClaim, setPayClaim] = useState<{
    id: string;
    employeeName?: string;
    amount?: number;
  } | null>(null);
  const [payMonth, setPayMonth] = useState<number>(today.getMonth() + 1);
  const [payYear, setPayYear] = useState<number>(today.getFullYear());
  const [paying, setPaying] = useState(false);

  function openPayModal(row: any) {
    setPayClaim({ id: row.id, employeeName: row.employee_name, amount: Number(row.amount) || 0 });
    setPayMonth(today.getMonth() + 1);
    setPayYear(today.getFullYear());
  }

  async function confirmMarkPaid() {
    if (!payClaim) return;
    setPaying(true);
    try {
      await apiPost(`/reimbursements/${payClaim.id}/pay`, { month: payMonth, year: payYear });
      toast.success("Claim marked as paid");
      qc.invalidateQueries({ queryKey: ["reimbursements"] });
      qc.invalidateQueries({ queryKey: ["reimbursements-summary"] });
      setPayClaim(null);
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to mark paid");
    } finally {
      setPaying(false);
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
      render: (r: any) => {
        if (r.status === "pending") {
          return (
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleAction(r.id, "approve")}
                className="text-green-600 hover:text-green-700"
                title="Approve"
              >
                <CheckCircle2 className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleAction(r.id, "reject")}
                className="text-red-600 hover:text-red-700"
                title="Reject"
              >
                <XCircle className="h-4 w-4" />
              </Button>
            </div>
          );
        }
        if (r.status === "approved") {
          // #399 — After approval, HR needs a way to record that the
          // disbursement actually happened. Opens a modal capturing the
          // payroll month/year the payment landed in.
          return (
            <Button
              variant="outline"
              size="sm"
              onClick={() => openPayModal(r)}
              className="text-brand-600 hover:text-brand-700"
            >
              <CreditCard className="h-3.5 w-3.5" /> Mark as Paid
            </Button>
          );
        }
        return null;
      },
    },
  ];

  const monthOptions = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  // Show ±2 years around today so HR can backdate or pre-date a payment.
  const yearOptions = [
    today.getFullYear() - 2,
    today.getFullYear() - 1,
    today.getFullYear(),
    today.getFullYear() + 1,
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
          <DataTable
            columns={columns}
            data={claims}
            paginated={false}
            emptyMessage="No reimbursement claims found"
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

      {/* #399 — Mark-as-Paid modal. Captures the payroll month/year the
          disbursement landed in so reports can attribute it correctly. */}
      <Modal
        open={!!payClaim}
        onClose={() => (paying ? null : setPayClaim(null))}
        title="Mark reimbursement as paid"
        description={
          payClaim
            ? `${payClaim.employeeName ? payClaim.employeeName + " · " : ""}${formatCurrency(payClaim.amount || 0)}`
            : undefined
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Record the payroll period this claim was disbursed in. The status will move from{" "}
            <strong>approved</strong> to <strong>paid</strong>.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">Month</span>
              <select
                value={payMonth}
                onChange={(e) => setPayMonth(Number(e.target.value))}
                className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1"
              >
                {monthOptions.map((m, i) => (
                  <option key={m} value={i + 1}>
                    {m}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">Year</span>
              <select
                value={payYear}
                onChange={(e) => setPayYear(Number(e.target.value))}
                className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1"
              >
                {yearOptions.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setPayClaim(null)} disabled={paying}>
              Cancel
            </Button>
            <Button onClick={confirmMarkPaid} loading={paying}>
              <CreditCard className="h-4 w-4" /> Confirm payment
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
