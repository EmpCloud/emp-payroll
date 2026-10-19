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
import { apiGet, apiPost, apiPut, apiDelete } from "@/api/client";
import { useEmployees, useDepartments, useLocations } from "@/api/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Banknote, Clock, CheckCircle2, Loader2, Search, Pencil, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

const PAGE_SIZE = 20;

export function LoansPage() {
  const { t } = useTranslation();
  const [showCreateLoan, setShowCreateLoan] = useState(false);
  const [showCreateAdvance, setShowCreateAdvance] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editLoan, setEditLoan] = useState<any | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
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

  // Employee picker for the New Loan modal — load all seated employees, not
  // just the first 100, so every employee is selectable when creating a
  // loan/advance (orgs commonly have several hundred).
  const { data: empRes } = useEmployees({ limit: 10000, page: 1 });

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
  // Mirror the payroll engine: custom override wins, capped at outstanding
  // so the last-month settlement is reflected in the dashboard total too.
  const totalEMI = activeLoans.reduce((s: number, l: any) => {
    const base = Number(l.custom_emi_amount ?? l.emi_amount);
    const cap = Math.max(0, Number(l.outstanding_amount));
    return s + Math.min(base, cap);
  }, 0);
  const completedCount = Number(completedRes?.data?.total ?? 0);

  async function handleCreate(e: React.FormEvent<HTMLFormElement>, kind: "loan" | "advance") {
    e.preventDefault();

    const fd = new FormData(e.currentTarget);
    const amount = Number(fd.get("amount"));
    const isAdvance = kind === "advance";
    const tenure = isAdvance ? 1 : Number(fd.get("tenure"));
    const interest = isAdvance ? 0 : Number(fd.get("interest") || 0);

    // Client-side guard: amount, tenure, and interest must be non-negative.
    // Tenure must additionally be at least 1 so EMI math stays finite. (#70)
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error(t("loansPage.validation.amountNonNegative"));
      return;
    }
    if (!Number.isFinite(tenure) || tenure < 1) {
      toast.error(t("loansPage.validation.tenureMinimum"));
      return;
    }
    if (!Number.isFinite(interest) || interest < 0) {
      toast.error(t("loansPage.validation.interestNonNegative"));
      return;
    }

    // Optional per-month override. Empty → undefined (engine uses
    // tenure-derived EMI). A positive number capped at the loan amount is
    // sent through; the last month auto-settles whatever's left.
    const customEmiRaw = isAdvance ? "" : (fd.get("customEmi") || "").toString().trim();
    let customEmiAmount: number | undefined = undefined;
    if (customEmiRaw) {
      const v = Number(customEmiRaw);
      if (!Number.isFinite(v) || v <= 0) {
        toast.error(t("loansPage.validation.customEmiPositive"));
        return;
      }
      if (v > amount) {
        toast.error(t("loansPage.validation.customEmiMaximum"));
        return;
      }
      customEmiAmount = Math.round(v);
    }

    setCreating(true);
    try {
      await apiPost("/loans", {
        employeeId: fd.get("employeeId"),
        type: isAdvance ? fd.get("advanceType") : "loan",
        description: fd.get("description"),
        principalAmount: amount,
        tenureMonths: tenure,
        interestRate: interest,
        startDate: fd.get("startDate"),
        notes: fd.get("notes"),
        ...(customEmiAmount !== undefined ? { customEmiAmount } : {}),
      });
      toast.success(
        t(isAdvance ? "loansPage.messages.advanceCreated" : "loansPage.messages.loanCreated"),
      );
      setShowCreateLoan(false);
      setShowCreateAdvance(false);
      qc.invalidateQueries({ queryKey: ["loans"] });
      qc.invalidateQueries({ queryKey: ["loans-summary"] });
      qc.invalidateQueries({ queryKey: ["loans-summary-active"] });
      qc.invalidateQueries({ queryKey: ["loans-summary-completed"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("loansPage.messages.failed"));
    } finally {
      setCreating(false);
    }
  }

  async function recordPayment(id: string) {
    try {
      await apiPost(`/loans/${id}/payment`);
      toast.success(t("loansPage.messages.paymentRecorded"));
      qc.invalidateQueries({ queryKey: ["loans"] });
      qc.invalidateQueries({ queryKey: ["loans-summary-active"] });
      qc.invalidateQueries({ queryKey: ["loans-summary-completed"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("loansPage.messages.failed"));
    }
  }

  async function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editLoan) return;
    const fd = new FormData(e.currentTarget);
    const amount = Number(fd.get("amount"));
    const isAdvance = editLoan.type !== "loan";
    const tenure = isAdvance ? 1 : Number(fd.get("tenure"));
    const interest = isAdvance ? 0 : Number(fd.get("interest") || 0);
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error(t("loansPage.validation.amountNonNegative"));
      return;
    }
    if (!Number.isFinite(tenure) || tenure < 1) {
      toast.error(t("loansPage.validation.tenureMinimum"));
      return;
    }
    if (!Number.isFinite(interest) || interest < 0) {
      toast.error(t("loansPage.validation.interestNonNegative"));
      return;
    }
    // Custom EMI editor:
    //  - blank string → null  (clears any existing override; falls back to
    //                          tenure-based EMI)
    //  - positive number → set / replace
    const customEmiRawEdit = isAdvance ? "" : (fd.get("customEmi") || "").toString().trim();
    let customEmiAmount: number | null | undefined = undefined;
    if (isAdvance) {
      customEmiAmount = null;
    } else if (customEmiRawEdit === "") {
      customEmiAmount = null;
    } else {
      const v = Number(customEmiRawEdit);
      if (!Number.isFinite(v) || v <= 0) {
        toast.error(t("loansPage.validation.customEmiPositive"));
        return;
      }
      if (v > amount) {
        toast.error(t("loansPage.validation.customEmiMaximum"));
        return;
      }
      customEmiAmount = Math.round(v);
    }

    setEditing(true);
    try {
      await apiPut(`/loans/${editLoan.id}`, {
        type: fd.get("type"),
        description: fd.get("description"),
        principalAmount: amount,
        tenureMonths: tenure,
        interestRate: interest,
        startDate: fd.get("startDate"),
        notes: fd.get("notes"),
        customEmiAmount,
      });
      toast.success(
        t(isAdvance ? "loansPage.messages.advanceUpdated" : "loansPage.messages.loanUpdated"),
      );
      setEditLoan(null);
      qc.invalidateQueries({ queryKey: ["loans"] });
      qc.invalidateQueries({ queryKey: ["loans-summary-active"] });
      qc.invalidateQueries({ queryKey: ["loans-summary-completed"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("loansPage.messages.updateFailed"));
    } finally {
      setEditing(false);
    }
  }

  async function performDelete() {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await apiDelete(`/loans/${deleteTarget.id}`);
      toast.success(t("loansPage.messages.deleted"));
      qc.invalidateQueries({ queryKey: ["loans"] });
      qc.invalidateQueries({ queryKey: ["loans-summary"] });
      qc.invalidateQueries({ queryKey: ["loans-summary-active"] });
      qc.invalidateQueries({ queryKey: ["loans-summary-completed"] });
      setDeleteTarget(null);
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("loansPage.messages.deleteFailed"));
    } finally {
      setDeleting(false);
    }
  }

  const employees = Array.isArray(empRes?.data?.data) ? empRes.data.data : [];
  const hasEmployees = employees.length > 0;
  const typeLabel = (type: string) =>
    t(`loansPage.types.${type}`, { defaultValue: type.replace(/_/g, " ") });

  const columns = [
    {
      key: "employee",
      header: t("loansPage.columns.employee"),
      render: (r: any) => (
        <div>
          <p className="font-medium text-gray-900">{r.employee_name}</p>
          <p className="text-xs text-gray-500">{r.employee_code}</p>
        </div>
      ),
    },
    {
      key: "type",
      header: t("loansPage.columns.type"),
      render: (r: any) => <Badge variant="draft">{typeLabel(r.type)}</Badge>,
    },
    { key: "description", header: t("loansPage.columns.description") },
    {
      key: "principal_amount",
      header: t("loansPage.columns.principal"),
      className: "text-right",
      render: (r: any) => (
        <span className="tabular-nums">{formatCurrency(r.principal_amount)}</span>
      ),
    },
    {
      key: "outstanding_amount",
      header: t("loansPage.columns.outstanding"),
      className: "text-right",
      render: (r: any) => (
        <span
          className={
            Number(r.outstanding_amount) > 0
              ? "font-semibold tabular-nums text-orange-600"
              : "tabular-nums text-green-600"
          }
        >
          {formatCurrency(r.outstanding_amount)}
        </span>
      ),
    },
    {
      key: "emi_amount",
      header: t("loansPage.columns.deduction"),
      className: "text-right",
      render: (r: any) => (
        <div>
          <div className="font-medium tabular-nums">
            {formatCurrency(r.custom_emi_amount ?? r.emi_amount)}
          </div>
          {r.custom_emi_amount != null && (
            <div className="text-[10px] uppercase tracking-wide text-amber-600">
              {t("loansPage.deduction.customDefault", {
                amount: formatCurrency(r.emi_amount),
              })}
            </div>
          )}
          {r.type !== "loan" && (
            <div className="text-[10px] uppercase tracking-wide text-gray-500">
              {t("loansPage.deduction.oneTime")}
            </div>
          )}
        </div>
      ),
    },
    {
      key: "progress",
      header: t("loansPage.columns.progress"),
      render: (r: any) =>
        r.type !== "loan" ? (
          <span className="text-xs text-gray-500">
            {r.status === "completed"
              ? t("loansPage.progress.recovered")
              : t("loansPage.progress.pendingRecovery")}
          </span>
        ) : (
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
      header: t("loansPage.columns.status"),
      render: (r: any) => (
        <Badge
          variant={
            r.status === "active" ? "active" : r.status === "completed" ? "approved" : "inactive"
          }
        >
          {t(`loansPage.statuses.${r.status}`, { defaultValue: r.status })}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r: any) => (
        <div className="flex items-center justify-end gap-1">
          {r.status === "active" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => recordPayment(r.id)}
              className="text-green-600"
              title={
                r.type === "loan"
                  ? t("loansPage.actions.recordEmiPayment")
                  : t("loansPage.actions.recordAdvanceRecovery")
              }
            >
              <CheckCircle2 className="h-4 w-4" />
              {r.type === "loan" ? t("loansPage.actions.pay") : t("loansPage.actions.recover")}
            </Button>
          )}
          {r.status !== "cancelled" && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditLoan(r)}
              title={t("loansPage.actions.edit")}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeleteTarget(r)}
            className="text-red-500 hover:text-red-600"
            title={t("loansPage.actions.delete")}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
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
        title={t("loansPage.title")}
        description={t("loansPage.recordsShown", { visible: total, total: totalLoans })}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setShowCreateAdvance(true)}>
              <Plus className="h-4 w-4" /> {t("loansPage.addAdvance")}
            </Button>
            <Button size="sm" onClick={() => setShowCreateLoan(true)}>
              <Plus className="h-4 w-4" /> {t("loansPage.addLoan")}
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/loans?status=active" className={cardLinkCls}>
          <StatCard
            title={t("loansPage.cards.active")}
            value={String(activeCount)}
            icon={Banknote}
          />
        </Link>
        <Link to="/loans?status=active" className={cardLinkCls}>
          <StatCard
            title={t("loansPage.cards.outstanding")}
            value={formatCurrency(totalOutstanding)}
            icon={Clock}
            accentClassName="bg-amber-50 text-amber-600"
          />
        </Link>
        <Link to="/loans?status=active" className={cardLinkCls}>
          <StatCard
            title={t("loansPage.cards.monthlyDeductions")}
            value={formatCurrency(totalEMI)}
            subtitle={t("loansPage.cards.totalAcrossAll")}
            icon={Banknote}
            accentClassName="bg-sky-50 text-sky-600"
          />
        </Link>
        <Link to="/loans?status=completed" className={cardLinkCls}>
          <StatCard
            title={t("loansPage.cards.completed")}
            value={String(completedCount)}
            icon={CheckCircle2}
            accentClassName="bg-emerald-50 text-emerald-600"
          />
        </Link>
      </div>

      {/* Search + filters */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_220px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={t("loansPage.searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          />
        </div>
        <select
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          className="focus:border-brand-500 focus:ring-brand-500 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-1 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          aria-label={t("loansPage.filterDepartment")}
        >
          <option value="">{t("loansPage.allDepartments")}</option>
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
          aria-label={t("loansPage.filterLocation")}
        >
          <option value="">{t("loansPage.allLocations")}</option>
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
            {f ? t(`loansPage.statuses.${f}`, { defaultValue: f }) : t("loansPage.filters.all")}
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
            {t("loansPage.clearFilters")}
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
            emptyMessage={t("loansPage.noRecords")}
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
        open={showCreateLoan}
        onClose={() => setShowCreateLoan(false)}
        title={t("loansPage.addLoan")}
        className="max-w-lg"
      >
        <form onSubmit={(e) => handleCreate(e, "loan")} className="space-y-4">
          {hasEmployees ? (
            <SelectField
              id="employeeId"
              name="employeeId"
              label={t("loansPage.fields.employee")}
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
              <label className="block text-sm font-medium text-gray-700">
                {t("loansPage.fields.employee")}
              </label>
              <div className="block w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                {t("loansPage.form.noEmployee")}
              </div>
            </div>
          )}
          <Input
            id="description"
            name="description"
            label={t("loansPage.fields.description")}
            placeholder={t("loansPage.form.descriptionPlaceholder")}
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              id="amount"
              name="amount"
              label={t("loansPage.fields.amount")}
              type="number"
              min="0"
              step="1"
              placeholder="50000"
              required
            />
            <Input
              id="tenure"
              name="tenure"
              label={t("loansPage.fields.tenure")}
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
              label={t("loansPage.fields.interestRate")}
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              defaultValue="0"
            />
            <Input
              id="startDate"
              name="startDate"
              label={t("loansPage.fields.startDate")}
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
              required
            />
          </div>
          <Input
            id="customEmi"
            name="customEmi"
            label={t("loansPage.fields.customMonthlyEmi")}
            type="number"
            min="1"
            step="1"
            placeholder={t("loansPage.form.customEmiPlaceholder")}
          />
          <div className="-mt-2 text-xs text-gray-500">
            {t("loansPage.form.customEmiHelpCreate")}
          </div>
          <Input
            id="notes"
            name="notes"
            label={t("loansPage.fields.notes")}
            placeholder={t("loansPage.form.notesPlaceholder")}
          />
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setShowCreateLoan(false)}>
              {t("loansPage.actions.cancel")}
            </Button>
            <Button type="submit" loading={creating} disabled={!hasEmployees}>
              {t("loansPage.addLoan")}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={showCreateAdvance}
        onClose={() => setShowCreateAdvance(false)}
        title={t("loansPage.addAdvance")}
        description={t("loansPage.advanceModal.description")}
        className="max-w-lg"
      >
        <form onSubmit={(e) => handleCreate(e, "advance")} className="space-y-4">
          {hasEmployees ? (
            <SelectField
              id="advanceEmployeeId"
              name="employeeId"
              label={t("loansPage.fields.employee")}
              required
              options={employees.map((employee: any) => ({
                value: employee.id,
                label: `${employee.first_name} ${employee.last_name} (${employee.employee_code})`,
              }))}
            />
          ) : (
            <div className="space-y-1">
              <label className="block text-sm font-medium text-gray-700">
                {t("loansPage.fields.employee")}
              </label>
              <div className="block w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500">
                {t("loansPage.form.noEmployee")}
              </div>
            </div>
          )}
          <SelectField
            id="advanceType"
            name="advanceType"
            label={t("loansPage.fields.advanceType")}
            options={[
              { value: "salary_advance", label: t("loansPage.types.salary_advance") },
              { value: "emergency", label: t("loansPage.types.emergency") },
            ]}
          />
          <Input
            id="advanceDescription"
            name="description"
            label={t("loansPage.fields.reason")}
            placeholder={t("loansPage.form.descriptionPlaceholder")}
            required
          />
          <Input
            id="advanceAmount"
            name="amount"
            label={t("loansPage.fields.advanceAmount")}
            type="number"
            min="0"
            step="1"
            placeholder="10000"
            required
          />
          <Input
            id="advanceStartDate"
            name="startDate"
            label={t("loansPage.fields.recoveryDate")}
            type="date"
            defaultValue={new Date().toISOString().slice(0, 10)}
            required
          />
          <Input
            id="advanceNotes"
            name="notes"
            label={t("loansPage.fields.notes")}
            placeholder={t("loansPage.form.notesPlaceholder")}
          />
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setShowCreateAdvance(false)}>
              {t("loansPage.actions.cancel")}
            </Button>
            <Button type="submit" loading={creating} disabled={!hasEmployees}>
              {t("loansPage.addAdvance")}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!editLoan}
        onClose={() => setEditLoan(null)}
        title={
          editLoan?.type === "loan"
            ? t("loansPage.editModal.loanTitle")
            : t("loansPage.editModal.advanceTitle")
        }
        className="max-w-lg"
      >
        {editLoan && (
          <form onSubmit={handleEdit} className="space-y-4" key={editLoan.id}>
            <div className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700">
              {editLoan.employee_name}
              {editLoan.employee_code && (
                <span className="ml-2 text-gray-400">{editLoan.employee_code}</span>
              )}
            </div>
            {editLoan.type === "loan" ? (
              <input type="hidden" name="type" value="loan" />
            ) : (
              <SelectField
                id="editType"
                name="type"
                label={t("loansPage.fields.advanceType")}
                defaultValue={editLoan.type}
                options={[
                  { value: "salary_advance", label: t("loansPage.types.salary_advance") },
                  { value: "emergency", label: t("loansPage.types.emergency") },
                ]}
              />
            )}
            <Input
              id="editDescription"
              name="description"
              label={t("loansPage.fields.description")}
              defaultValue={editLoan.description || ""}
              required
            />
            <div className={editLoan.type === "loan" ? "grid grid-cols-2 gap-4" : ""}>
              <Input
                id="editAmount"
                name="amount"
                label={t("loansPage.fields.amount")}
                type="number"
                min="0"
                step="1"
                defaultValue={editLoan.principal_amount}
                required
              />
              {editLoan.type === "loan" && (
                <Input
                  id="editTenure"
                  name="tenure"
                  label={t("loansPage.fields.tenure")}
                  type="number"
                  min="1"
                  step="1"
                  defaultValue={editLoan.tenure_months}
                  required
                />
              )}
            </div>
            <div className={editLoan.type === "loan" ? "grid grid-cols-2 gap-4" : ""}>
              {editLoan.type === "loan" && (
                <Input
                  id="editInterest"
                  name="interest"
                  label={t("loansPage.fields.interestRate")}
                  type="number"
                  min="0"
                  step="0.01"
                  defaultValue={editLoan.interest_rate ?? 0}
                />
              )}
              <Input
                id="editStartDate"
                name="startDate"
                label={
                  editLoan.type === "loan"
                    ? t("loansPage.fields.startDate")
                    : t("loansPage.fields.recoveryDate")
                }
                type="date"
                defaultValue={String(editLoan.start_date || "").slice(0, 10)}
                required
              />
            </div>
            {editLoan.type === "loan" && (
              <Input
                id="editCustomEmi"
                name="customEmi"
                label={t("loansPage.fields.customMonthlyEmi")}
                type="number"
                min="1"
                step="1"
                defaultValue={editLoan.custom_emi_amount ?? ""}
                placeholder={t("loansPage.form.customEmiPlaceholder")}
              />
            )}
            {editLoan.type === "loan" && (
              <div className="-mt-2 text-xs text-gray-500">
                {t("loansPage.form.customEmiHelpEdit")}
              </div>
            )}
            <Input
              id="editNotes"
              name="notes"
              label={t("loansPage.fields.notes")}
              defaultValue={editLoan.notes || ""}
            />
            {Number(editLoan.installments_paid) > 0 && (
              <p className="text-xs text-amber-600">
                {t("loansPage.form.paidInstallmentsNotice", {
                  count: editLoan.installments_paid,
                })}
              </p>
            )}
            <div className="flex justify-end gap-3">
              <Button variant="outline" type="button" onClick={() => setEditLoan(null)}>
                {t("loansPage.actions.cancel")}
              </Button>
              <Button type="submit" loading={editing}>
                {t("loansPage.actions.saveChanges")}
              </Button>
            </div>
          </form>
        )}
      </Modal>

      {/* Confirm-delete is a Radix <Modal> so it matches the rest of the page
          instead of the native window.confirm() this used to fire. */}
      <Modal
        open={!!deleteTarget}
        onClose={() => (deleting ? null : setDeleteTarget(null))}
        title={t("loansPage.deleteModal.title")}
        description={
          deleteTarget
            ? `${typeLabel(String(deleteTarget.type || "loan"))}${deleteTarget.employee_name ? " · " + deleteTarget.employee_name : ""}${deleteTarget.principal_amount ? " · " + formatCurrency(deleteTarget.principal_amount) : ""}`
            : undefined
        }
      >
        {deleteTarget && (
          <div className="space-y-4">
            {Number(deleteTarget.outstanding_amount) > 0 && deleteTarget.status !== "cancelled" ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-200">
                <p className="font-medium">
                  {t("loansPage.deleteModal.outstandingTitle", {
                    amount: formatCurrency(deleteTarget.outstanding_amount),
                  })}
                </p>
                <p className="mt-1 text-xs leading-relaxed">
                  {t("loansPage.deleteModal.outstandingWarning")}
                </p>
              </div>
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-300">
                {t("loansPage.deleteModal.warning")}
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                {t("loansPage.actions.cancel")}
              </Button>
              <Button
                onClick={performDelete}
                loading={deleting}
                className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500"
              >
                <Trash2 className="h-4 w-4" /> {t("loansPage.actions.delete")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
