import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SelectField } from "@/components/ui/SelectField";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Card, CardContent } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { formatCurrency, formatMonth } from "@/lib/utils";
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

const now = new Date();
const MONTHS = [
  { value: "", label: "All Months" },
  ...Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: new Date(2026, i).toLocaleString("en-US", { month: "long" }),
  })),
];

const YEARS = [
  { value: "", label: "All Years" },
  ...Array.from({ length: 5 }, (_, i) => {
    const y = now.getFullYear() - i;
    return { value: String(y), label: String(y) };
  }),
];

// Disputed/cancelled payslips are not finalised payroll and can carry corrupt
// figures (e.g. a ₹0-gross record flagged by migration 028 with a bogus
// multi-crore deduction). Keep them in the list but out of the money totals so
// one bad row can't blow up the org's gross/deductions/net summary.
const EXCLUDE_FROM_TOTALS = new Set(["disputed", "cancelled"]);

export function PayslipListPage() {
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
      { value: "", label: "All Departments" },
      ...Array.from(new Set(payslips.map((p: any) => p.department).filter(Boolean)))
        .sort()
        .map((d: any) => ({ value: d, label: d })),
    ],
    [payslips],
  );
  const locations = useMemo(
    () => [
      { value: "", label: "All Locations" },
      ...Array.from(new Set(payslips.map((p: any) => p.location).filter(Boolean)))
        .sort()
        .map((l: any) => ({ value: l, label: l })),
    ],
    [payslips],
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
      header: "Employee",
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
      header: "Period",
      render: (row: any) => formatMonth(row.month, row.year),
    },
    {
      key: "days",
      header: "Days",
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
      header: "Gross",
      className: "text-right",
      render: (row: any) => (
        <span className="tabular-nums">{formatCurrency(row.gross_earnings)}</span>
      ),
    },
    {
      key: "total_deductions",
      header: "Deductions",
      className: "text-right",
      render: (row: any) => (
        <span className="tabular-nums text-rose-600">{formatCurrency(row.total_deductions)}</span>
      ),
    },
    {
      key: "net_pay",
      header: "Net Pay",
      className: "text-right",
      render: (row: any) => (
        <span className="font-semibold tabular-nums text-gray-900">
          {formatCurrency(row.net_pay)}
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row: any) => <Badge variant={row.status}>{row.status}</Badge>,
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
            title="View"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              openPDF(row.id);
            }}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title="Download PDF"
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
        title="Payslips"
        description={
          isLoading
            ? "Loading…"
            : capped
              ? `First ${payslips.length} of ${total} payslips — refine filters to narrow`
              : filtered.length === payslips.length
                ? `${payslips.length} payslips`
                : `${filtered.length} of ${payslips.length} payslips`
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
                toast.success("Exported payslips CSV");
              } catch {
                toast.error("Export failed");
              }
            }}
          >
            <Download className="h-4 w-4" /> Export All
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
              Search
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                id="payslip-search"
                type="search"
                placeholder="Name or code…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="focus:border-brand-500 focus:ring-brand-500 block w-full rounded-lg border border-gray-300 py-2 pl-9 pr-3 text-sm shadow-sm focus:outline-none focus:ring-1"
              />
            </div>
          </div>
          <SelectField
            id="dept-filter"
            label="Department"
            value={activeDept}
            onChange={(e) => setDept(e.target.value)}
            options={departments}
          />
          <SelectField
            id="location-filter"
            label="Location"
            value={activeLocation}
            onChange={(e) => setLocation(e.target.value)}
            options={locations}
          />
          <SelectField
            id="month-filter"
            label="Month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            options={MONTHS}
          />
          <SelectField
            id="year-filter"
            label="Year"
            value={year}
            onChange={(e) => setYear(e.target.value)}
            options={YEARS}
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
          <p className="text-sm text-gray-500">No payslips for this selection.</p>
          <p className="text-xs text-gray-400">Try a different month or year.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Payslips"
              value={String(filtered.length)}
              subtitle={filtered.length === payslips.length ? "in view" : `of ${payslips.length}`}
              icon={FileText}
            />
            <StatCard
              title="Gross"
              value={formatCurrency(totals.gross)}
              subtitle="gross earnings"
              icon={Wallet}
              accentClassName="bg-emerald-50 text-emerald-600"
            />
            <StatCard
              title="Deductions"
              value={formatCurrency(totals.deductions)}
              subtitle="total deductions"
              icon={TrendingDown}
              accentClassName="bg-rose-50 text-rose-600"
            />
            <StatCard
              title="Net Pay"
              value={formatCurrency(totals.net)}
              subtitle="take-home"
              icon={CreditCard}
              accentClassName="bg-sky-50 text-sky-600"
            />
          </div>
          {capped && (
            <p className="text-xs text-amber-600">
              Showing the first {payslips.length} of {total} payslips — the totals above reflect
              this view. Narrow by month, year, or department to see exact figures.
            </p>
          )}
          {totals.count < filtered.length && (
            <p className="text-xs text-gray-400">
              Totals exclude {filtered.length - totals.count} disputed/cancelled payslip
              {filtered.length - totals.count === 1 ? "" : "s"}.
            </p>
          )}
          <DataTable
            columns={columns}
            data={filtered}
            onRowClick={(row) => setSelected(row)}
            emptyMessage="No payslips match your filters."
          />
        </>
      )}

      {/* Payslip preview modal */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.employee_name || "Payslip"}` : ""}
        description={
          selected
            ? `${formatMonth(selected.month, selected.year)} — ${selected.employee_code || ""}`
            : ""
        }
        className="max-w-xl"
      >
        {selected && (
          <div className="space-y-4">
            {/* Days info */}
            {Number(selected.lop_days) > 0 && (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                Paid {selected.paid_days} of {selected.total_days} days — {selected.lop_days} LOP
                days deducted
              </div>
            )}

            <Card>
              <CardContent className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-900">Earnings</h4>
                {parseJSON(selected.earnings).map((e: any) => (
                  <div key={e.code} className="flex justify-between text-sm">
                    <span className="text-gray-500">{e.name || e.code}</span>
                    <span className="tabular-nums text-gray-900">{formatCurrency(e.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-gray-100 pt-2 text-sm font-semibold">
                  <span>Gross Pay</span>
                  <span className="tabular-nums">{formatCurrency(selected.gross_earnings)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-900">Deductions</h4>
                {parseJSON(selected.deductions).map((d: any) => (
                  <div key={d.code} className="flex justify-between text-sm">
                    <span className="text-gray-500">{d.name || d.code}</span>
                    <span className="tabular-nums text-rose-600">-{formatCurrency(d.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-gray-100 pt-2 text-sm font-semibold">
                  <span>Total Deductions</span>
                  <span className="tabular-nums text-rose-600">
                    -{formatCurrency(selected.total_deductions)}
                  </span>
                </div>
              </CardContent>
            </Card>

            <div className="from-brand-600 flex items-center justify-between rounded-lg bg-gradient-to-r to-indigo-500 p-4 text-white">
              <span className="text-lg font-bold">Net Pay</span>
              <span className="text-lg font-bold tabular-nums">
                {formatCurrency(selected.net_pay)}
              </span>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => openPDF(selected.id)}>
                <FileText className="h-4 w-4" /> Print / Save PDF
              </Button>
              <Button size="sm" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
