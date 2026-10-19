import { useState, useEffect } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DataTable } from "@/components/ui/DataTable";
import { StatCard } from "@/components/ui/StatCard";
import { Pagination } from "@/components/ui/Pagination";
import { formatCurrency } from "@/lib/utils";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/api/client";
import { useDepartments, useLocations } from "@/api/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Loader2,
  Receipt,
  CheckCircle2,
  XCircle,
  Clock,
  CreditCard,
  Search,
  Plus,
  UserRound,
  Pencil,
  Trash2,
} from "lucide-react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import { Modal } from "@/components/ui/Modal";
import { useTranslation } from "react-i18next";

const PAGE_SIZE = 20;

export function ReimbursementsPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language;
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
      toast.success(
        t(
          action === "approve"
            ? "reimbursementsPage.messages.approved"
            : "reimbursementsPage.messages.rejected",
        ),
      );
      qc.invalidateQueries({ queryKey: ["reimbursements"] });
      qc.invalidateQueries({ queryKey: ["reimbursements-summary"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("reimbursementsPage.messages.failed"));
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

  // Admin "File for Employee" flow — HR fills a claim on behalf of someone
  // (e.g. a paper bill an employee dropped on their desk). Posts to the new
  // POST /reimbursements/admin endpoint, which routes through the same
  // submit() the self-service flow uses, so all the existing validation,
  // employee-resolution, and audit behaviour stays consistent.
  const [addOpen, setAddOpen] = useState(false);
  const [addEmp, setAddEmp] = useState<null | {
    id: number;
    first_name: string;
    last_name: string;
    emp_code?: string;
    email?: string;
    designation?: string;
  }>(null);
  const [empSearchQ, setEmpSearchQ] = useState("");
  const [empSearchResults, setEmpSearchResults] = useState<any[]>([]);
  const [empSearchLoading, setEmpSearchLoading] = useState(false);
  const todayIso = today.toISOString().slice(0, 10);
  const [addForm, setAddForm] = useState({
    category: "",
    description: "",
    amount: "",
    expenseDate: todayIso,
  });
  const [submittingAdd, setSubmittingAdd] = useState(false);

  // Debounced employee search. Mirrors the global header search behaviour
  // (GET /employees/search?q=...) so admins see exactly the same shape /
  // ordering they're used to elsewhere in the app.
  useEffect(() => {
    if (!addOpen) return;
    const q = empSearchQ.trim();
    if (q.length < 2) {
      setEmpSearchResults([]);
      return;
    }
    let cancelled = false;
    setEmpSearchLoading(true);
    const id = setTimeout(async () => {
      try {
        const res = await apiGet<any>("/employees/search", { q, limit: 6 });
        if (!cancelled) setEmpSearchResults(Array.isArray(res?.data) ? res.data : []);
      } catch {
        if (!cancelled) setEmpSearchResults([]);
      } finally {
        if (!cancelled) setEmpSearchLoading(false);
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [empSearchQ, addOpen]);

  function openAddModal() {
    setAddEmp(null);
    setEmpSearchQ("");
    setEmpSearchResults([]);
    setAddForm({ category: "", description: "", amount: "", expenseDate: todayIso });
    setAddOpen(true);
  }

  // Edit-claim flow. Same form fields as the File modal but without the
  // employee picker -- the row's employee is fixed. Server refuses if the
  // claim is paid (locked because it's already on a payslip's REIMB line).
  const [editClaim, setEditClaim] = useState<null | {
    id: string;
    employee_name?: string;
    category: string;
    description: string;
    amount: string;
    expenseDate: string;
  }>(null);
  const [editing, setEditing] = useState(false);

  function openEditModal(r: any) {
    setEditClaim({
      id: r.id,
      employee_name: r.employee_name,
      category: r.category || "",
      description: r.description || "",
      amount: String(r.amount ?? ""),
      expenseDate: (r.expense_date || "").slice(0, 10),
    });
  }

  async function confirmEdit() {
    if (!editClaim) return;
    const amt = Number(editClaim.amount);
    if (!editClaim.category.trim())
      return toast.error(t("reimbursementsPage.validation.categoryRequired"));
    if (!editClaim.description.trim())
      return toast.error(t("reimbursementsPage.validation.descriptionRequired"));
    if (!Number.isFinite(amt) || amt < 0)
      return toast.error(t("reimbursementsPage.validation.validAmount"));
    if (!editClaim.expenseDate)
      return toast.error(t("reimbursementsPage.validation.expenseDateRequired"));

    setEditing(true);
    try {
      await apiPatch(`/reimbursements/${editClaim.id}`, {
        category: editClaim.category.trim(),
        description: editClaim.description.trim(),
        amount: amt,
        expenseDate: editClaim.expenseDate,
      });
      toast.success(t("reimbursementsPage.messages.updated"));
      setEditClaim(null);
      qc.invalidateQueries({ queryKey: ["reimbursements"] });
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error?.message ||
          err?.message ||
          t("reimbursementsPage.messages.updateFailed"),
      );
    } finally {
      setEditing(false);
    }
  }

  // Confirm-delete is a Radix <Modal> so it matches the rest of the page
  // (the native window.confirm flickered the browser chrome and didn't
  // theme dark-mode correctly). State holds the row being confirmed --
  // null = no dialog open. The confirm button calls performDelete which
  // does the actual API call.
  const [deleteTarget, setDeleteTarget] = useState<null | {
    id: string;
    status: string;
    employee_name?: string;
    amount?: number;
    category?: string;
  }>(null);
  const [deleting, setDeleting] = useState(false);

  function handleDelete(r: any) {
    setDeleteTarget({
      id: r.id,
      status: r.status,
      employee_name: r.employee_name,
      amount: Number(r.amount) || 0,
      category: r.category,
    });
  }

  async function performDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/reimbursements/${deleteTarget.id}`);
      toast.success(t("reimbursementsPage.messages.deleted"));
      setDeleteTarget(null);
      qc.invalidateQueries({ queryKey: ["reimbursements"] });
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error?.message ||
          err?.message ||
          t("reimbursementsPage.messages.deleteFailed"),
      );
    } finally {
      setDeleting(false);
    }
  }

  async function submitAddOnBehalf() {
    if (!addEmp) {
      toast.error(t("reimbursementsPage.validation.pickEmployee"));
      return;
    }
    const amt = Number(addForm.amount);
    if (!addForm.category.trim())
      return toast.error(t("reimbursementsPage.validation.categoryRequired"));
    if (!addForm.description.trim())
      return toast.error(t("reimbursementsPage.validation.descriptionRequired"));
    if (!Number.isFinite(amt) || amt < 0)
      return toast.error(t("reimbursementsPage.validation.validAmount"));
    if (!addForm.expenseDate)
      return toast.error(t("reimbursementsPage.validation.expenseDateRequired"));

    setSubmittingAdd(true);
    try {
      await apiPost("/reimbursements/admin", {
        employeeId: addEmp.id,
        category: addForm.category.trim(),
        description: addForm.description.trim(),
        amount: amt,
        expenseDate: addForm.expenseDate,
      });
      toast.success(t("reimbursementsPage.messages.filed"));
      setAddOpen(false);
      qc.invalidateQueries({ queryKey: ["reimbursements"] });
    } catch (err: any) {
      toast.error(
        err?.response?.data?.error?.message ||
          err?.message ||
          t("reimbursementsPage.messages.fileFailed"),
      );
    } finally {
      setSubmittingAdd(false);
    }
  }

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
      toast.success(t("reimbursementsPage.messages.markedPaid"));
      qc.invalidateQueries({ queryKey: ["reimbursements"] });
      qc.invalidateQueries({ queryKey: ["reimbursements-summary"] });
      setPayClaim(null);
    } catch (err: any) {
      toast.error(
        err.response?.data?.error?.message || t("reimbursementsPage.messages.markPaidFailed"),
      );
    } finally {
      setPaying(false);
    }
  }

  const columns = [
    {
      key: "employee",
      header: t("reimbursementsPage.columns.employee"),
      render: (r: any) => (
        <div>
          <p className="font-medium text-gray-900">{r.employee_name}</p>
          <p className="text-xs text-gray-500">{r.employee_code}</p>
        </div>
      ),
    },
    {
      key: "category",
      header: t("reimbursementsPage.columns.category"),
      render: (r: any) => <Badge variant="draft">{r.category}</Badge>,
    },
    {
      key: "description",
      header: t("reimbursementsPage.columns.description"),
      render: (r: any) => <span className="text-sm text-gray-700">{r.description}</span>,
    },
    {
      key: "amount",
      header: t("reimbursementsPage.columns.amount"),
      className: "text-right",
      render: (r: any) => (
        <span className="font-medium tabular-nums">{formatCurrency(r.amount)}</span>
      ),
    },
    {
      key: "expense_date",
      header: t("reimbursementsPage.columns.date"),
      render: (r: any) => (
        <span className="whitespace-nowrap tabular-nums">
          {new Date(r.expense_date).toLocaleDateString(language)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("reimbursementsPage.columns.status"),
      render: (r: any) => (
        <Badge variant={r.status}>
          {t(`reimbursementsPage.statuses.${r.status}`, { defaultValue: r.status })}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r: any) => {
        // Action set by status:
        //   pending  : Approve | Reject | Edit | Delete
        //   approved : "Awaiting payroll" badge + Edit | Delete (HR
        //              override before payroll picks it up)
        //   paid     : Delete only -- editing the amount on an already-
        //              paid claim is risky (employee received a specific
        //              figure on the payslip; the right way to change it
        //              is to delete the payroll run, which reverts the
        //              claim to approved, edit, and regenerate). Delete
        //              is allowed for cleanup -- the loud confirm in
        //              handleDelete spells out the trade-off.
        //   rejected : Delete only -- keep visible until HR cleans up.
        const canEdit = r.status === "pending" || r.status === "approved";
        const canDelete = true;
        return (
          <div className="flex items-center gap-1">
            {r.status === "pending" && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleAction(r.id, "approve")}
                  className="text-green-600 hover:text-green-700"
                  title={t("reimbursementsPage.actions.approve")}
                >
                  <CheckCircle2 className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleAction(r.id, "reject")}
                  className="text-red-600 hover:text-red-700"
                  title={t("reimbursementsPage.actions.reject")}
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </>
            )}
            {r.status === "approved" && (
              <span
                className="text-xs text-gray-500"
                title={t("reimbursementsPage.actions.awaitingPayrollTitle")}
              >
                {t("reimbursementsPage.actions.awaitingPayroll")}
              </span>
            )}
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openEditModal(r)}
                className="text-gray-500 hover:text-gray-700"
                title={t("reimbursementsPage.actions.edit")}
              >
                <Pencil className="h-4 w-4" />
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleDelete(r)}
                className="text-red-500 hover:text-red-700"
                title={t("reimbursementsPage.actions.delete")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  const monthOptions = Array.from({ length: 12 }, (_, index) =>
    new Intl.DateTimeFormat(language, { month: "long" }).format(new Date(2026, index, 1)),
  );
  // Show ±2 years around today so HR can backdate or pre-date a payment.
  const yearOptions = [
    today.getFullYear() - 2,
    today.getFullYear() - 1,
    today.getFullYear(),
    today.getFullYear() + 1,
  ];

  const filters = [
    { value: "", label: t("reimbursementsPage.filters.all") },
    { value: "pending", label: t("reimbursementsPage.statuses.pending") },
    { value: "approved", label: t("reimbursementsPage.statuses.approved") },
    { value: "rejected", label: t("reimbursementsPage.statuses.rejected") },
    { value: "paid", label: t("reimbursementsPage.statuses.paid") },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("reimbursementsPage.title")}
        description={t("reimbursementsPage.claimsShown", {
          visible: total,
          total: totalClaims,
          count: totalClaims,
        })}
        actions={
          <Button onClick={openAddModal}>
            <Plus className="h-4 w-4" /> {t("reimbursementsPage.fileForEmployee")}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-5">
        <Link
          to="/reimbursements"
          onClick={() => setFilter("")}
          className="focus-visible:ring-brand-500 block rounded-xl transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2"
          aria-label={t("reimbursementsPage.cards.viewAll")}
        >
          <StatCard
            title={t("reimbursementsPage.cards.totalClaims")}
            value={String(totalClaims)}
            icon={Receipt}
          />
        </Link>
        <Link
          to="/reimbursements"
          onClick={() => setFilter("pending")}
          className="focus-visible:ring-brand-500 block rounded-xl transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2"
          aria-label={t("reimbursementsPage.cards.viewPending")}
        >
          <StatCard
            title={t("reimbursementsPage.statuses.pending")}
            value={String(pendingCount)}
            subtitle={formatCurrency(totalPending)}
            icon={Clock}
            accentClassName="bg-amber-50 text-amber-600"
          />
        </Link>
        <Link
          to="/reimbursements"
          onClick={() => setFilter("approved")}
          className="focus-visible:ring-brand-500 block rounded-xl transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2"
          aria-label={t("reimbursementsPage.cards.viewApproved")}
        >
          <StatCard
            title={t("reimbursementsPage.statuses.approved")}
            value={String(approvedCount)}
            subtitle={formatCurrency(totalApproved)}
            icon={CheckCircle2}
            accentClassName="bg-emerald-50 text-emerald-600"
          />
        </Link>
        <Link
          to="/reimbursements"
          onClick={() => setFilter("rejected")}
          className="focus-visible:ring-brand-500 block rounded-xl transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2"
          aria-label={t("reimbursementsPage.cards.viewRejected")}
        >
          <StatCard
            title={t("reimbursementsPage.statuses.rejected")}
            value={String(rejectedCount)}
            subtitle={formatCurrency(totalRejected)}
            icon={XCircle}
            accentClassName="bg-rose-50 text-rose-600"
          />
        </Link>
        <Link
          to="/reimbursements"
          onClick={() => setFilter("paid")}
          className="focus-visible:ring-brand-500 block rounded-xl transition hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2"
          aria-label={t("reimbursementsPage.cards.viewPaid")}
        >
          <StatCard
            title={t("reimbursementsPage.statuses.paid")}
            value={String(paidCount)}
            icon={CreditCard}
            accentClassName="bg-sky-50 text-sky-600"
          />
        </Link>
      </div>

      {/* Search + filters */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_220px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={t("reimbursementsPage.searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          />
        </div>
        <select
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          className="focus:border-brand-500 focus:ring-brand-500 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-1 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          aria-label={t("reimbursementsPage.filterDepartment")}
        >
          <option value="">{t("reimbursementsPage.allDepartments")}</option>
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
          aria-label={t("reimbursementsPage.filterLocation")}
        >
          <option value="">{t("reimbursementsPage.allLocations")}</option>
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
            {t("reimbursementsPage.clearFilters")}
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
            emptyMessage={t("reimbursementsPage.noClaims")}
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

      {/* "File for Employee" modal — HR creates a reimbursement claim on
          behalf of an employee (e.g. someone hands HR a paper bill). Two
          panels: pick employee (with debounced search) then fill the
          claim. The form clears the picked employee when the user wants
          to change selection. */}
      <Modal
        open={addOpen}
        onClose={() => (submittingAdd ? null : setAddOpen(false))}
        title={t("reimbursementsPage.fileModal.title")}
        description={t("reimbursementsPage.fileModal.description")}
      >
        <div className="space-y-4">
          {!addEmp ? (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">
                {t("reimbursementsPage.fileModal.searchEmployee")}
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  autoFocus
                  value={empSearchQ}
                  onChange={(e) => setEmpSearchQ(e.target.value)}
                  placeholder={t("reimbursementsPage.fileModal.employeePlaceholder")}
                  className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 bg-white py-2 pl-8 pr-3 text-sm focus:outline-none focus:ring-1"
                />
              </div>
              {/* Fixed-height results panel so the modal doesn't visibly
                  grow/shrink as the search box flips through
                  "type more" -> spinner -> N results -> empty. Single-line
                  rows keep the list compact (~6 visible) without each
                  result eating the form below. */}
              <div className="mt-2 h-44 overflow-y-auto rounded-lg border border-gray-200">
                {empSearchLoading ? (
                  <div className="flex h-full items-center justify-center text-sm text-gray-400">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    {t("reimbursementsPage.fileModal.searching")}
                  </div>
                ) : empSearchResults.length === 0 ? (
                  <div className="flex h-full items-center justify-center px-3 text-center text-xs text-gray-400">
                    {empSearchQ.trim().length < 2
                      ? t("reimbursementsPage.fileModal.typeMore")
                      : t("reimbursementsPage.fileModal.noEmployees")}
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {empSearchResults.map((emp: any) => (
                      <li key={emp.id}>
                        <button
                          type="button"
                          onClick={() => setAddEmp(emp)}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-50"
                        >
                          <UserRound className="h-3.5 w-3.5 flex-shrink-0 text-gray-400" />
                          <span className="min-w-0 flex-1 truncate font-medium text-gray-900">
                            {emp.first_name} {emp.last_name}
                          </span>
                          <span className="flex-shrink-0 text-[11px] text-gray-400">
                            {emp.emp_code || emp.designation || ""}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white text-gray-500">
                  <UserRound className="h-4 w-4" />
                </span>
                <div>
                  <div className="text-sm font-medium text-gray-900">
                    {addEmp.first_name} {addEmp.last_name}
                  </div>
                  <div className="text-xs text-gray-500">
                    {addEmp.emp_code ? `${addEmp.emp_code} · ` : ""}
                    {addEmp.designation || addEmp.email || ""}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setAddEmp(null)}
                className="text-xs font-medium text-gray-500 hover:text-gray-700"
              >
                {t("reimbursementsPage.fileModal.change")}
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">
                {t("reimbursementsPage.fields.category")}
              </span>
              <input
                type="text"
                value={addForm.category}
                onChange={(e) => setAddForm({ ...addForm, category: e.target.value })}
                placeholder={t("reimbursementsPage.fileModal.categoryPlaceholder")}
                className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">
                {t("reimbursementsPage.fields.amount")}
              </span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={addForm.amount}
                onChange={(e) => setAddForm({ ...addForm, amount: e.target.value })}
                placeholder="0.00"
                className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1"
              />
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-600">
              {t("reimbursementsPage.fields.expenseDate")}
            </span>
            <input
              type="date"
              value={addForm.expenseDate}
              max={todayIso}
              onChange={(e) => setAddForm({ ...addForm, expenseDate: e.target.value })}
              className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-gray-600">
              {t("reimbursementsPage.fields.description")}
            </span>
            <textarea
              rows={3}
              value={addForm.description}
              onChange={(e) => setAddForm({ ...addForm, description: e.target.value })}
              placeholder={t("reimbursementsPage.fileModal.descriptionPlaceholder")}
              className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1"
            />
          </label>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={submittingAdd}>
              {t("reimbursementsPage.actions.cancel")}
            </Button>
            <Button onClick={submitAddOnBehalf} loading={submittingAdd} disabled={!addEmp}>
              <Plus className="h-4 w-4" /> {t("reimbursementsPage.fileModal.submit")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Themed delete-confirm modal. Replaces window.confirm so the
          dialog respects dark mode and matches the rest of the page.
          Paid rows get a louder banner because the row may be linked to
          a payslip's REIMB line -- copy spells out that the payslip
          stays untouched. */}
      <Modal
        open={!!deleteTarget}
        onClose={() => (deleting ? null : setDeleteTarget(null))}
        title={t("reimbursementsPage.deleteModal.title")}
        description={
          deleteTarget?.employee_name
            ? `${t("reimbursementsPage.forEmployee", {
                name: deleteTarget.employee_name,
              })}${deleteTarget.category ? " · " + deleteTarget.category : ""}${deleteTarget.amount ? " · " + formatCurrency(deleteTarget.amount) : ""}`
            : undefined
        }
      >
        {deleteTarget && (
          <div className="space-y-4">
            {deleteTarget.status === "paid" ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                <p className="font-medium">{t("reimbursementsPage.deleteModal.paidTitle")}</p>
                <p className="mt-1 text-xs leading-relaxed">
                  {t("reimbursementsPage.deleteModal.paidWarning")}
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {t("reimbursementsPage.deleteModal.warning")}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                {t("reimbursementsPage.actions.cancel")}
              </Button>
              <Button
                onClick={performDelete}
                loading={deleting}
                className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500"
              >
                <Trash2 className="h-4 w-4" /> {t("reimbursementsPage.actions.delete")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit-claim modal. Same fields as the File modal minus the
          employee picker. Server enforces the status guard (paid claims
          rejected); this modal just opens for pending/approved rows. */}
      <Modal
        open={!!editClaim}
        onClose={() => (editing ? null : setEditClaim(null))}
        title={t("reimbursementsPage.editModal.title")}
        description={
          editClaim?.employee_name
            ? t("reimbursementsPage.forEmployee", { name: editClaim.employee_name })
            : undefined
        }
      >
        {editClaim && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">
                  {t("reimbursementsPage.fields.category")}
                </span>
                <input
                  type="text"
                  value={editClaim.category}
                  onChange={(e) => setEditClaim({ ...editClaim, category: e.target.value })}
                  className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-600">
                  {t("reimbursementsPage.fields.amount")}
                </span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={editClaim.amount}
                  onChange={(e) => setEditClaim({ ...editClaim, amount: e.target.value })}
                  className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1"
                />
              </label>
            </div>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">
                {t("reimbursementsPage.fields.expenseDate")}
              </span>
              <input
                type="date"
                value={editClaim.expenseDate}
                max={todayIso}
                onChange={(e) => setEditClaim({ ...editClaim, expenseDate: e.target.value })}
                className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">
                {t("reimbursementsPage.fields.description")}
              </span>
              <textarea
                rows={3}
                value={editClaim.description}
                onChange={(e) => setEditClaim({ ...editClaim, description: e.target.value })}
                className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1"
              />
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditClaim(null)} disabled={editing}>
                {t("reimbursementsPage.actions.cancel")}
              </Button>
              <Button onClick={confirmEdit} loading={editing}>
                {t("reimbursementsPage.editModal.save")}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* #399 — Mark-as-Paid modal. Captures the payroll month/year the
          disbursement landed in so reports can attribute it correctly. */}
      <Modal
        open={!!payClaim}
        onClose={() => (paying ? null : setPayClaim(null))}
        title={t("reimbursementsPage.payModal.title")}
        description={
          payClaim
            ? `${payClaim.employeeName ? payClaim.employeeName + " · " : ""}${formatCurrency(payClaim.amount || 0)}`
            : undefined
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">{t("reimbursementsPage.payModal.description")}</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-gray-600">
                {t("reimbursementsPage.fields.month")}
              </span>
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
              <span className="mb-1 block text-xs font-medium text-gray-600">
                {t("reimbursementsPage.fields.year")}
              </span>
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
              {t("reimbursementsPage.actions.cancel")}
            </Button>
            <Button onClick={confirmMarkPaid} loading={paying}>
              <CreditCard className="h-4 w-4" /> {t("reimbursementsPage.payModal.confirm")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
