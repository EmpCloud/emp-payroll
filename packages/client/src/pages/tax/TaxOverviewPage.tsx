import { Link, useLocation } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { formatCurrency } from "@/lib/utils";
import { useEmployees } from "@/api/hooks";
import { Calculator, FileText, IndianRupee, Users, Loader2, AlertTriangle } from "lucide-react";

// #1657 — Indian PAN format. Anything that doesn't match (or empty) is
// treated as "missing for compliance purposes" — Section 206AA flat 20%
// kicks in at TDS calc time and the row gets flagged in the table.
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function TaxOverviewPage() {
  const { data: res, isLoading } = useEmployees({ limit: 1000 });
  const employees = res?.data?.data || [];

  const location = useLocation();
  const searchParams = new URLSearchParams(location.search);
  const regimeFilter = searchParams.get("regime"); // "new" | "old" | null

  const allTaxData = employees.map((e: any) => {
    const taxInfo = typeof e.tax_info === "string" ? JSON.parse(e.tax_info) : e.tax_info || {};
    const rawPan = typeof taxInfo.pan === "string" ? taxInfo.pan.trim() : "";
    const panValid = PAN_RE.test(rawPan);
    return {
      ...e,
      pan: rawPan || "—",
      panValid,
      regime: taxInfo.regime || "new",
      estimated_tax: Math.round((Number(e.ctc || 0) || 1200000) * 0.12),
      tds_deducted: Math.round((Number(e.ctc || 0) || 1200000) * 0.12 * (3 / 12)),
    };
  });

  const missingPanCount = allTaxData.filter((e: any) => !e.panValid).length;

  const totalEstimatedTax = allTaxData.reduce((s: number, e: any) => s + e.estimated_tax, 0);
  const totalTdsDeducted = allTaxData.reduce((s: number, e: any) => s + e.tds_deducted, 0);
  const newRegimeCount = allTaxData.filter((e: any) => e.regime === "new").length;

  // Apply regime filter to table
  const taxData = regimeFilter
    ? allTaxData.filter((e: any) => e.regime === regimeFilter)
    : allTaxData;

  const columns = [
    {
      key: "name",
      header: "Employee",
      render: (row: any) => (
        <div>
          <p className="font-medium text-gray-900">
            {row.first_name} {row.last_name}
          </p>
          <p className="flex items-center gap-2 text-xs text-gray-500">
            <span>
              {row.employee_code} &middot; PAN: {row.pan}
            </span>
            {/* #1657 — flag rows where PAN is missing or malformed; they
                trigger Section 206AA flat 20% TDS in the calc engine. */}
            {!row.panValid && (
              <span
                title="No valid PAN — TDS deducted at Section 206AA flat 20%."
                className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-800"
              >
                <AlertTriangle className="h-3 w-3" /> No PAN
              </span>
            )}
          </p>
        </div>
      ),
    },
    {
      key: "regime",
      header: "Regime",
      render: (row: any) => (
        <Badge variant={row.regime === "new" ? "approved" : "pending"}>
          {row.regime === "new" ? "New" : "Old"}
        </Badge>
      ),
    },
    {
      key: "estimated_tax",
      header: "Estimated Tax",
      render: (row: any) => formatCurrency(row.estimated_tax),
    },
    {
      key: "tds_deducted",
      header: "TDS Deducted YTD",
      render: (row: any) => formatCurrency(row.tds_deducted),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader title="Tax Overview" description="FY 2025-26 income tax summary" />

      {/* #1657 — banner highlighting the count of employees missing a valid
          PAN, since each one is being TDS'd at Section 206AA flat 20%
          until they enter their details. */}
      {missingPanCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600" />
          <div>
            <p className="font-medium">
              {missingPanCount} employee{missingPanCount === 1 ? "" : "s"} without a valid PAN
            </p>
            <p className="mt-1 text-amber-800">
              TDS for these employees is being deducted at the Section 206AA flat rate of 20%. Ask
              each employee to update their PAN in their profile so standard slab rates apply.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <Link to="/tax" className="block transition-transform hover:scale-[1.02]">
          <StatCard title="Total Employees" value={String(allTaxData.length)} icon={Users} />
        </Link>
        <Link to="/tax" className="block transition-transform hover:scale-[1.02]">
          <StatCard
            title="Estimated Tax (Annual)"
            value={formatCurrency(totalEstimatedTax)}
            icon={Calculator}
          />
        </Link>
        <Link to="/tax" className="block transition-transform hover:scale-[1.02]">
          <StatCard
            title="TDS Deducted YTD"
            value={formatCurrency(totalTdsDeducted)}
            icon={IndianRupee}
          />
        </Link>
        <Link to="/tax?regime=new" className="block transition-transform hover:scale-[1.02]">
          <StatCard
            title="New Regime"
            value={`${newRegimeCount}/${allTaxData.length}`}
            subtitle="employees opted in"
            icon={FileText}
          />
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            Employee Tax Summary
            {regimeFilter ? ` — ${regimeFilter === "new" ? "New" : "Old"} Regime` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
            </div>
          ) : (
            <DataTable columns={columns} data={taxData} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
