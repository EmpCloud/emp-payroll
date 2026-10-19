import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { Pagination } from "@/components/ui/Pagination";
import { formatCurrency } from "@/lib/utils";
import { useEmployees, useDepartments, useLocations } from "@/api/hooks";
import {
  Calculator,
  FileText,
  IndianRupee,
  Users,
  Loader2,
  AlertTriangle,
  Search,
} from "lucide-react";
import { useTranslation } from "react-i18next";

// #1657 — Indian PAN format. Anything that doesn't match (or empty) is
// treated as "missing for compliance purposes" — Section 206AA flat 20%
// kicks in at TDS calc time and the row gets flagged in the table.
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

const PAGE_SIZE = 20;

export function TaxOverviewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const regimeFilter = searchParams.get("regime"); // "new" | "old" | null

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
  }, [search, departmentId, locationId]);

  const { data: deptRes } = useDepartments();
  const { data: locRes } = useLocations();
  const departments: { id: string; name: string }[] = Array.isArray(deptRes?.data)
    ? deptRes.data
    : [];
  const locations: { id: string; name: string }[] = Array.isArray(locRes?.data) ? locRes.data : [];

  const queryParams: Record<string, any> = { page, limit: PAGE_SIZE };
  if (search) queryParams.q = search;
  if (departmentId) queryParams.department_id = departmentId;
  if (locationId) queryParams.location_id = locationId;

  const { data: res, isLoading, isFetching } = useEmployees(queryParams);
  const employees = Array.isArray(res?.data?.data) ? res.data.data : [];
  const total = Number(res?.data?.total ?? 0);
  const totalPages = Number(res?.data?.totalPages ?? 1);

  // Org-wide summary slice for the stat cards (count + new-regime split).
  // Uses a small page so we don't pull every row, just the totals.
  const { data: summaryRes } = useEmployees({ limit: 1, page: 1 });
  const orgTotal = Number(summaryRes?.data?.total ?? total);

  // BUG-FY — Compute the running Indian financial year dynamically. The
  // page used to hardcode "FY 2025-26" in the header even months after
  // FY rollover; for May 2026 the correct label is FY 2026-27 (Apr 2026
  // → Mar 2027).
  const _now = new Date();
  const fyStartYear = _now.getMonth() >= 3 ? _now.getFullYear() : _now.getFullYear() - 1;
  const fyLabel = t("taxOverview.financialYear", {
    start: fyStartYear,
    end: String(fyStartYear + 1).slice(-2),
  });

  const taxData = employees.map((e: any) => {
    const taxInfo = typeof e.tax_info === "string" ? JSON.parse(e.tax_info) : e.tax_info || {};
    const rawPan = typeof taxInfo.pan === "string" ? taxInfo.pan.trim() : "";
    const panValid = PAN_RE.test(rawPan);
    // BUG-011 — The previous estimate fell back to a HARDCODED ₹12L CTC
    // when the employee had no salary structure assigned, producing a
    // fake "₹1,44,000 estimated tax" line for every unassigned employee
    // (12L × 12% flat). HR couldn't tell who was actually projected for
    // that much tax versus who simply had no salary on file.
    const ctc = Number(e.ctc || 0);
    const hasSalary = ctc > 0;
    return {
      ...e,
      pan: rawPan || "—",
      panValid,
      regime: taxInfo.regime || "new",
      hasSalary,
      estimated_tax: hasSalary ? Math.round(ctc * 0.12) : null,
      tds_deducted: hasSalary ? Math.round(ctc * 0.12 * (3 / 12)) : null,
    };
  });

  // Apply regime filter to the visible page (regime is stored inside the
  // JSON tax_info column and isn't easy to push into the seated-users SQL
  // join without a schema change; the page-scoped filter is intentional).
  const displayed = regimeFilter ? taxData.filter((e: any) => e.regime === regimeFilter) : taxData;

  const missingPanCount = displayed.filter((e: any) => !e.panValid).length;
  const newRegimeOnPage = displayed.filter((e: any) => e.regime === "new").length;
  const totalEstimatedTax = displayed.reduce((s: number, e: any) => s + (e.estimated_tax || 0), 0);
  const totalTdsDeducted = displayed.reduce((s: number, e: any) => s + (e.tds_deducted || 0), 0);

  const columns = [
    {
      key: "name",
      header: t("taxOverview.columns.employee"),
      render: (row: any) => (
        <div>
          <p className="font-medium text-gray-900">
            {row.first_name} {row.last_name}
          </p>
          <p className="flex items-center gap-2 text-xs text-gray-500">
            <span>
              {row.employee_code} &middot; {t("taxOverview.pan.label")}: {row.pan}
            </span>
            {/* #1657 — flag rows where PAN is missing or malformed; they
                trigger Section 206AA flat 20% TDS in the calc engine. */}
            {!row.panValid && (
              <span
                title={t("taxOverview.pan.invalidTitle")}
                className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800"
              >
                <AlertTriangle className="h-3 w-3" /> {t("taxOverview.pan.missing")}
              </span>
            )}
          </p>
        </div>
      ),
    },
    {
      key: "regime",
      header: t("taxOverview.columns.regime"),
      render: (row: any) => (
        <Badge variant={row.regime === "new" ? "approved" : "pending"}>
          {row.regime === "new" ? t("taxOverview.regimes.new") : t("taxOverview.regimes.old")}
        </Badge>
      ),
    },
    {
      key: "estimated_tax",
      header: t("taxOverview.columns.estimatedTax"),
      render: (row: any) =>
        row.estimated_tax == null ? (
          <span className="text-gray-400" title={t("taxOverview.noSalaryStructure")}>
            —
          </span>
        ) : (
          formatCurrency(row.estimated_tax)
        ),
    },
    {
      key: "tds_deducted",
      header: t("taxOverview.columns.tdsDeductedYtd"),
      render: (row: any) =>
        row.tds_deducted == null ? (
          <span className="text-gray-400">—</span>
        ) : (
          formatCurrency(row.tds_deducted)
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("taxOverview.title")}
        description={t("taxOverview.description", { fy: fyLabel })}
      />

      {/* #1657 — banner highlighting the count of employees missing a valid
          PAN, since each one is being TDS'd at Section 206AA flat 20%
          until they enter their details. (Page-scoped count.) */}
      {missingPanCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">
              {t("taxOverview.missingPanCount", { count: missingPanCount })}
            </p>
            <p className="mt-1 text-amber-800">{t("taxOverview.missingPanDetail")}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/tax" className="block transition-transform hover:scale-[1.02]">
          <StatCard
            title={t("taxOverview.stats.totalEmployees")}
            value={String(orgTotal)}
            icon={Users}
          />
        </Link>
        <Link to="/tax" className="block transition-transform hover:scale-[1.02]">
          <StatCard
            title={t("taxOverview.stats.estimatedTaxPage")}
            value={formatCurrency(totalEstimatedTax)}
            subtitle={t("taxOverview.stats.pageOf", { page, totalPages })}
            icon={Calculator}
          />
        </Link>
        <Link to="/tax" className="block transition-transform hover:scale-[1.02]">
          <StatCard
            title={t("taxOverview.stats.tdsDeductedYtdPage")}
            value={formatCurrency(totalTdsDeducted)}
            subtitle={t("taxOverview.stats.pageOf", { page, totalPages })}
            icon={IndianRupee}
          />
        </Link>
        <Link to="/tax?regime=new" className="block transition-transform hover:scale-[1.02]">
          <StatCard
            title={t("taxOverview.stats.newRegimePage")}
            value={`${newRegimeOnPage}/${displayed.length}`}
            subtitle={t("taxOverview.stats.optedIn")}
            icon={FileText}
          />
        </Link>
      </div>

      {/* Search + filters */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_220px]">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={t("taxOverview.filters.searchPlaceholder")}
            aria-label={t("taxOverview.filters.searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          />
        </div>
        <select
          value={departmentId}
          onChange={(e) => setDepartmentId(e.target.value)}
          className="focus:border-brand-500 focus:ring-brand-500 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-1 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          aria-label={t("taxOverview.filters.filterDepartment")}
        >
          <option value="">{t("taxOverview.filters.allDepartments")}</option>
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
          aria-label={t("taxOverview.filters.filterLocation")}
        >
          <option value="">{t("taxOverview.filters.allLocations")}</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </select>
      </div>

      {(search || departmentId || locationId) && (
        <button
          type="button"
          onClick={() => {
            setSearchInput("");
            setSearch("");
            setDepartmentId("");
            setLocationId("");
          }}
          className="text-xs text-gray-500 underline hover:text-gray-700"
        >
          {t("taxOverview.filters.clear")}
        </button>
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            {t("taxOverview.summaryTitle")}
            {regimeFilter
              ? ` — ${t("taxOverview.regimeSuffix", {
                  regime:
                    regimeFilter === "new"
                      ? t("taxOverview.regimes.new")
                      : t("taxOverview.regimes.old"),
                })}`
              : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
            </div>
          ) : (
            <>
              <DataTable
                columns={columns}
                data={displayed}
                paginated={false}
                emptyMessage={t("taxOverview.empty")}
                onRowClick={(row: any) => row.id && navigate(`/employees/${row.id}`)}
              />
              <Pagination
                page={page}
                totalPages={totalPages}
                total={total}
                limit={PAGE_SIZE}
                onChange={setPage}
                disabled={isFetching}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
