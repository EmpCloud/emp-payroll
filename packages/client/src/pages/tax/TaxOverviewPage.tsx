import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { formatCurrency } from "@/lib/utils";
import { useEmployees } from "@/api/hooks";
import { Calculator, FileText, IndianRupee, Users, Loader2 } from "lucide-react";

export function TaxOverviewPage() {
  const { data: res, isLoading } = useEmployees({ limit: 1000 });
  const employees = res?.data?.data || [];

  const taxData = employees.map((e: any) => {
    const taxInfo = typeof e.tax_info === "string" ? JSON.parse(e.tax_info) : e.tax_info || {};
    return {
      ...e,
      pan: taxInfo.pan || "—",
      regime: taxInfo.regime || "new",
      estimated_tax: Math.round((Number(e.ctc || 0) || 1200000) * 0.12),
      tds_deducted: Math.round((Number(e.ctc || 0) || 1200000) * 0.12 * (3 / 12)),
    };
  });

  const totalEstimatedTax = taxData.reduce((s: number, e: any) => s + e.estimated_tax, 0);
  const totalTdsDeducted = taxData.reduce((s: number, e: any) => s + e.tds_deducted, 0);
  const newRegimeCount = taxData.filter((e: any) => e.regime === "new").length;

  const columns = [
    {
      key: "name",
      header: "Employee",
      render: (row: any) => (
        <div>
          <p className="font-medium text-gray-900">{row.first_name} {row.last_name}</p>
          <p className="text-xs text-gray-500">{row.employee_code} &middot; PAN: {row.pan}</p>
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

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Employees" value={String(taxData.length)} icon={Users} />
        <StatCard title="Estimated Tax (Annual)" value={formatCurrency(totalEstimatedTax)} icon={Calculator} />
        <StatCard title="TDS Deducted YTD" value={formatCurrency(totalTdsDeducted)} icon={IndianRupee} />
        <StatCard title="New Regime" value={`${newRegimeCount}/${taxData.length}`} subtitle="employees opted in" icon={FileText} />
      </div>

      <Card>
        <CardHeader><CardTitle>Employee Tax Summary</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>
          ) : (
            <DataTable columns={columns} data={taxData} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
