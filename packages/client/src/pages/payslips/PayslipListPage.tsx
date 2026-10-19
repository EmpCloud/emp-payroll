import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SelectField } from "@/components/ui/SelectField";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Card, CardContent } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { formatCurrency } from "@/lib/utils";
import { apiGet } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import {
  Download,
  Eye,
  FileText,
  Loader2,
  Search,
  Wallet,
  TrendingDown,
  CreditCard,
} from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

const now = new Date();

// Disputed/cancelled payslips are not finalised payroll and can carry corrupt
// figures (e.g. a ₹0-gross record flagged by migration 028 with a bogus
// multi-crore deduction). Keep them in the list but out of the money totals so
// one bad row can't blow up the org's gross/deductions/net summary.
const EXCLUDE_FROM_TOTALS = new Set(["disputed", "cancelled"]);

export function PayslipListPage() {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage || i18n.language;
  const [selected, setSelected] = useState<any | null>(null);
  // Default to All Months / All Years so the list always shows whatever
  // payslips exist on first load — defaulting to the current calendar month/
  // year made the page look empty (and the filters "broken") whenever this
  // month's payroll hadn't been run yet. The user narrows from there.
  const [month, setMonth] = useState("");
  const [year, setYear] = useState("");
  const [search, setSearch] = useState("");
  const [dept, setDept] = useState("");
  const [location, setLocation] = useState("");

  const months = useMemo(
    () => [
      { value: "", label: t("payslipList.filters.allMonths") },
      ...Array.from({ length: 12 }, (_, i) => ({
        value: String(i + 1),
        label: new Intl.DateTimeFormat(locale, { month: "long" }).format(new Date(2026, i)),
      })),
    ],
    [locale, t],
  );

  const years = useMemo(
    () => [
      { value: "", label: t("payslipList.filters.allYears") },
      ...Array.from({ length: 5 }, (_, i) => {
        const value = now.getFullYear() - i;
        return { value: String(value), label: String(value) };
      }),
    ],
    [locale, t],
  );

  const localizedMonth = (monthValue: number, yearValue: number) =>
    new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(
      new Date(yearValue, monthValue - 1),
    );

  const { data: res, isLoading } = useQuery({
    queryKey: ["payslips", month, year],
    queryFn: () => {
      // A single month can exceed a few hundred payslips (one per active
      // employee), so keep the page ceiling well above one org's monthly
      // headcount — otherwise the list silently truncates and the summary
      // totals undercount. `capped` still flags the rare >1000 case.
      const params: any = { limit: 1000 };
      if (month) params.month = month;
      if (year) params.year = year;
      return apiGet<any>("/payslips", params);
    },
  });

  const payslips = res?.data?.data || [];
  // The query caps at 200 rows; `total` is the full server-side count for this
  // month/year so we can flag when the loaded set (and the KPI sums) is capped.
  const total = Number(res?.data?.total ?? payslips.length);
  const capped = total > payslips.length;

  // Department / location dropdown options derived from the loaded payslips.
  const departments = useMemo(
    () => [
      { value: "", label: t("payslipList.filters.allDepartments") },
      ...Array.from(new Set(payslips.map((p: any) => p.department).filter(Boolean)))
        .sort()
        .map((d: any) => ({ value: d, label: d })),
    ],
    [payslips, t],
  );
  const locations = useMemo(
    () => [
      { value: "", label: t("payslipList.filters.allLocations") },
      ...Array.from(new Set(payslips.map((p: any) => p.location).filter(Boolean)))
        .sort()
        .map((l: any) => ({ value: l, label: l })),
    ],
    [payslips, t],
  );

  // Clamp facet selections to options that still exist after a reload, so a
  // stale dept/location (e.g. after a month/year change to a set that lacks it)
  // can't silently empty the table or blank the <select>.
  const activeDept = departments.some((d: any) => d.value === dept) ? dept : "";
  const activeLocation = locations.some((l: any) => l.value === location) ? location : "";

  // Client-side search + department + location filtering on the loaded set.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return payslips.filter((p: any) => {
      if (activeDept && p.department !== activeDept) return false;
      if (activeLocation && p.location !== activeLocation) return false;
      if (q) {
        const hay = `${p.first_name || ""} ${p.last_name || ""} ${p.employee_name || ""} ${
          p.employee_code || ""
        }`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [payslips, search, activeDept, activeLocation]);

  // Aggregate totals over the currently-filtered set for the summary cards,
  // excluding disputed/cancelled payslips (see EXCLUDE_FROM_TOTALS).
  const totals = useMemo(
    () =>
      filtered
        .filter((p: any) => !EXCLUDE_FROM_TOTALS.has(String(p.status || "").toLowerCase()))
        .reduce(
          (acc: { gross: number; deductions: number; net: number; count: number }, p: any) => {
            acc.gross += Number(p.gross_earnings) || 0;
            acc.deductions += Number(p.total_deductions) || 0;
            acc.net += Number(p.net_pay) || 0;
            acc.count += 1;
            return acc;
          },
          { gross: 0, deductions: 0, net: 0, count: 0 },
        ),
    [filtered],
  );

  function openPDF(payslipId: string) {
    const url = `${import.meta.env.VITE_API_URL || "/api/v1"}/payslips/${payslipId}/pdf`;
    window.open(url + `?token=${localStorage.getItem("access_token")}`, "_blank");
  }

  const columns = [
    {
      key: "employee",
      header: t("payslipList.columns.employee"),
      render: (row: any) => (
        <div>
          <p className="font-medium text-gray-900">
            {row.first_name
              ? `${row.first_name} ${row.last_name || ""}`.trim()
              : row.employee_name || `ID: ${row.empcloud_user_id}`}
          </p>
          {(row.employee_code || row.department) && (
            <p className="text-xs text-gray-500">
              {[row.employee_code, row.department].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "period",
      header: t("payslipList.columns.period"),
      render: (row: any) => localizedMonth(row.month, row.year),
    },
    {
      key: "days",
      header: t("payslipList.columns.days"),
      render: (row: any) => {
        const paid = Number(row.paid_days || 0);
        const total = Number(row.total_days || 0);
        const lop = Number(row.lop_days || 0);
        return (
          <div className="tabular-nums">
            <span>
              {paid}/{total}
            </span>
            {lop > 0 && <span className="ml-1 text-xs text-rose-500">({lop} LOP)</span>}
          </div>
        );
      },
    },
    {
      key: "gross",
      header: t("payslipList.columns.gross"),
      className: "text-right",
      render: (row: any) => (
        <span className="tabular-nums">{formatCurrency(row.gross_earnings)}</span>
      ),
    },
    {
      key: "total_deductions",
      header: t("payslipList.columns.deductions"),
      className: "text-right",
      render: (row: any) => (
        <span className="tabular-nums text-rose-600">{formatCurrency(row.total_deductions)}</span>
      ),
    },
    {
      key: "net_pay",
      header: t("payslipList.columns.netPay"),
      className: "text-right",
      render: (row: any) => (
        <span className="font-semibold tabular-nums text-gray-900">
          {formatCurrency(row.net_pay)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("payslipList.columns.status"),
      render: (row: any) => (
        <Badge variant={row.status}>
          {t(`payslipList.statuses.${String(row.status || "").toLowerCase()}`, {
            defaultValue: row.status,
          })}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      className: "text-right",
      render: (row: any) => (
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setSelected(row);
            }}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title={t("payslipList.actions.view")}
            aria-label={t("payslipList.actions.view")}
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              openPDF(row.id);
            }}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title={t("payslipList.actions.downloadPdf")}
            aria-label={t("payslipList.actions.downloadPdf")}
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  const parseJSON = (val: any) => {
    if (typeof val === "string")
      try {
        return JSON.parse(val);
      } catch {
        return [];
      }
    return val || [];
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("payslipList.title")}
        description={
          isLoading
            ? t("payslipList.loading")
            : capped
              ? t("payslipList.firstOf", { loaded: payslips.length, total })
              : filtered.length === payslips.length
                ? t("payslipList.count", { count: payslips.length })
                : t("payslipList.filteredOf", {
                    filtered: filtered.length,
                    total: payslips.length,
                  })
        }
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                const { data } = await api.get("/payslips/export/csv", { responseType: "blob" });
                const url = URL.createObjectURL(new Blob([data]));
                const a = document.createElement("a");
                a.href = url;
                a.download = "payslips.csv";
                a.click();
                URL.revokeObjectURL(url);
                toast.success(t("payslipList.exportSuccess"));
              } catch {
                toast.error(t("payslipList.exportFailed"));
              }
            }}
          >
            <Download className="h-4 w-4" /> {t("payslipList.exportAll")}
          </Button>
        }
      />

      {/* Filters */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div>
            <label
              htmlFor="payslip-search"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              {t("payslipList.filters.search")}
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                id="payslip-search"
                type="search"
                placeholder={t("payslipList.filters.searchPlaceholder")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="focus:border-brand-500 focus:ring-brand-500 block w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm shadow-sm focus:outline-none focus:ring-1"
              />
            </div>
          </div>
          <SelectField
            id="dept-filter"
            label={t("payslipList.filters.department")}
            value={activeDept}
            onChange={(e) => setDept(e.target.value)}
            options={departments}
          />
          <SelectField
            id="location-filter"
            label={t("payslipList.filters.location")}
            value={activeLocation}
            onChange={(e) => setLocation(e.target.value)}
            options={locations}
          />
          <SelectField
            id="month-filter"
            label={t("payslipList.filters.month")}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            options={months}
          />
          <SelectField
            id="year-filter"
            label={t("payslipList.filters.year")}
            value={year}
            onChange={(e) => setYear(e.target.value)}
            options={years}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
        </div>
      ) : payslips.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-20 text-center">
          <div className="rounded-full bg-gray-50 p-3">
            <FileText className="h-6 w-6 text-gray-300" />
          </div>
          <p className="text-sm text-gray-500">{t("payslipList.emptyTitle")}</p>
          <p className="text-xs text-gray-400">{t("payslipList.emptyHint")}</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title={t("payslipList.stats.payslips")}
              value={String(filtered.length)}
              subtitle={
                filtered.length === payslips.length
                  ? t("payslipList.stats.inView")
                  : t("payslipList.stats.of", { count: payslips.length })
              }
              icon={FileText}
            />
            <StatCard
              title={t("payslipList.stats.gross")}
              value={formatCurrency(totals.gross)}
              subtitle={t("payslipList.stats.grossEarnings")}
              icon={Wallet}
              accentClassName="bg-emerald-50 text-emerald-600"
            />
            <StatCard
              title={t("payslipList.stats.deductions")}
              value={formatCurrency(totals.deductions)}
              subtitle={t("payslipList.stats.totalDeductions")}
              icon={TrendingDown}
              accentClassName="bg-rose-50 text-rose-600"
            />
            <StatCard
              title={t("payslipList.stats.netPay")}
              value={formatCurrency(totals.net)}
              subtitle={t("payslipList.stats.takeHome")}
              icon={CreditCard}
              accentClassName="bg-sky-50 text-sky-600"
            />
          </div>
          {capped && (
            <p className="text-xs text-amber-600">
              {t("payslipList.cappedNotice", { loaded: payslips.length, total })}
            </p>
          )}
          {totals.count < filtered.length && (
            <p className="text-xs text-gray-400">
              {t("payslipList.excludedTotals", {
                count: filtered.length - totals.count,
              })}
            </p>
          )}
          <DataTable
            columns={columns}
            data={filtered}
            onRowClick={(row) => setSelected(row)}
            emptyMessage={t("payslipList.emptyFiltered")}
          />
        </>
      )}

      {/* Payslip preview modal */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.employee_name || t("payslipList.modal.fallbackTitle")}` : ""}
        description={
          selected
            ? `${localizedMonth(selected.month, selected.year)} — ${selected.employee_code || ""}`
            : ""
        }
        className="max-w-xl"
      >
        {selected && (
          <div className="space-y-4">
            {/* Days info */}
            {Number(selected.lop_days) > 0 && (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                {t("payslipList.modal.lopNotice", {
                  paid: selected.paid_days,
                  total: selected.total_days,
                  lop: selected.lop_days,
                })}
              </div>
            )}

            <Card>
              <CardContent className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-900">
                  {t("payslipList.modal.earnings")}
                </h4>
                {parseJSON(selected.earnings).map((e: any) => (
                  <div key={e.code} className="flex justify-between text-sm">
                    <span className="text-gray-500">
                      {t(`salaryStructures.presetNames.${e.code}`, {
                        defaultValue: e.name || e.code,
                      })}
                    </span>
                    <span className="tabular-nums text-gray-900">{formatCurrency(e.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-gray-100 pt-2 text-sm font-semibold">
                  <span>{t("payslipList.modal.grossPay")}</span>
                  <span className="tabular-nums">{formatCurrency(selected.gross_earnings)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-900">
                  {t("payslipList.modal.deductions")}
                </h4>
                {parseJSON(selected.deductions).map((d: any) => (
                  <div key={d.code} className="flex justify-between text-sm">
                    <span className="text-gray-500">
                      {t(`salaryStructures.presetNames.${d.code}`, {
                        defaultValue: d.name || d.code,
                      })}
                    </span>
                    <span className="tabular-nums text-rose-600">-{formatCurrency(d.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-gray-100 pt-2 text-sm font-semibold">
                  <span>{t("payslipList.modal.totalDeductions")}</span>
                  <span className="tabular-nums text-rose-600">
                    -{formatCurrency(selected.total_deductions)}
                  </span>
                </div>
              </CardContent>
            </Card>

            <div className="from-brand-600 flex items-center justify-between rounded-lg bg-gradient-to-r to-indigo-500 p-4 text-white">
              <span className="text-lg font-bold">{t("payslipList.modal.netPay")}</span>
              <span className="text-lg font-bold tabular-nums">
                {formatCurrency(selected.net_pay)}
              </span>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => openPDF(selected.id)}>
                <FileText className="h-4 w-4" /> {t("payslipList.modal.printSavePdf")}
              </Button>
              <Button size="sm" onClick={() => setSelected(null)}>
                {t("payslipList.modal.close")}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
