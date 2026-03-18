import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { formatCurrency } from "@/lib/utils";
import { useMyTaxComputation, useMySalary } from "@/api/hooks";
import { getUser } from "@/api/auth";
import { apiGet } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/Button";
import { Calculator, IndianRupee, TrendingDown, FileText, Loader2, Download } from "lucide-react";

export function MyTaxPage() {
  const user = getUser();
  const { data: salRes } = useMySalary();
  const { data: taxRes, isLoading } = useMyTaxComputation();
  const { data: regimeRes } = useQuery({
    queryKey: ["my-regime"],
    queryFn: () => apiGet<any>("/self-service/tax/regime"),
  });

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>;
  }

  const salary = salRes?.data;
  const taxComp = taxRes?.data;
  const regime = regimeRes?.data?.regime || "new";

  // Use tax computation if available, otherwise estimate from salary
  const annualGross = taxComp ? Number(taxComp.gross_income) : salary ? Number(salary.gross_salary) : 0;
  const standardDeduction = 75000;
  const taxableIncome = taxComp ? Number(taxComp.taxable_income) : Math.max(0, annualGross - standardDeduction);

  // Simple estimate if no computation saved
  function estimateTax(income: number): number {
    const slabs = [
      { limit: 400000, rate: 0 }, { limit: 800000, rate: 5 }, { limit: 1200000, rate: 10 },
      { limit: 1600000, rate: 15 }, { limit: 2000000, rate: 20 }, { limit: 2400000, rate: 25 },
      { limit: Infinity, rate: 30 },
    ];
    let tax = 0, prev = 0;
    for (const slab of slabs) {
      if (income <= prev) break;
      tax += (Math.min(income, slab.limit) - prev) * slab.rate / 100;
      prev = slab.limit;
    }
    return Math.round(tax);
  }

  const taxOnIncome = taxComp ? Number(taxComp.tax_on_income) : estimateTax(taxableIncome);
  const cess = taxComp ? Number(taxComp.health_and_education_cess) : Math.round(taxOnIncome * 0.04);
  const totalTax = taxComp ? Number(taxComp.total_tax) : taxOnIncome + cess;
  const taxPaid = taxComp ? Number(taxComp.tax_already_paid) : 0;
  const monthlyTds = taxComp ? Number(taxComp.monthly_tds) : Math.round(totalTax / 12);
  const remaining = totalTax - taxPaid;
  const progressPct = totalTax > 0 ? Math.min(100, Math.round((taxPaid / totalTax) * 100)) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Tax"
        description="FY 2025-26 tax computation"
        actions={
          <Button variant="outline" size="sm" onClick={() => {
            const url = `${import.meta.env.VITE_API_URL || "/api/v1"}/self-service/tax/form16?token=${localStorage.getItem("access_token")}`;
            window.open(url, "_blank");
          }}>
            <Download className="h-4 w-4" /> Form 16
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Annual Income" value={formatCurrency(annualGross)} icon={IndianRupee} />
        <StatCard title="Taxable Income" value={formatCurrency(taxableIncome)} icon={Calculator} />
        <StatCard title="Estimated Tax" value={formatCurrency(totalTax)} icon={TrendingDown} />
        <StatCard title="TDS Deducted YTD" value={formatCurrency(taxPaid)} icon={FileText} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Tax Computation</CardTitle>
              <Badge variant={regime === "new" ? "approved" : "pending"}>
                {regime === "new" ? "New Regime" : "Old Regime"}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              {[
                { label: "Gross Annual Income", value: annualGross, bold: false },
                { label: "Less: Standard Deduction", value: -standardDeduction, bold: false },
                ...(taxComp && Number(taxComp.total_deductions) > 0 ? [{ label: "Less: Chapter VI-A Deductions", value: -Number(taxComp.total_deductions), bold: false }] : []),
                { label: "Taxable Income", value: taxableIncome, bold: true },
                { label: "Tax on Income", value: taxOnIncome, bold: false },
                { label: "Health & Education Cess (4%)", value: cess, bold: false },
                { label: "Total Tax Liability", value: totalTax, bold: true },
                { label: "Monthly TDS", value: monthlyTds, bold: true },
              ].map((row) => (
                <div key={row.label} className={`flex justify-between text-sm ${row.bold ? "border-t border-gray-200 pt-2 font-semibold" : ""}`}>
                  <dt className="text-gray-500">{row.label}</dt>
                  <dd className={row.value < 0 ? "text-red-600" : "text-gray-900"}>
                    {row.value < 0 ? `-${formatCurrency(Math.abs(row.value))}` : formatCurrency(row.value)}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>TDS Deduction Tracker</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Total Tax for FY</span>
                <span className="font-semibold">{formatCurrency(totalTax)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">TDS Deducted YTD</span>
                <span className="font-semibold text-green-600">{formatCurrency(taxPaid)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">Remaining</span>
                <span className="font-semibold text-orange-600">{formatCurrency(remaining)}</span>
              </div>

              <div>
                <div className="mb-1 flex justify-between text-xs text-gray-500">
                  <span>Progress</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-brand-500 transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              <div className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-700">
                Monthly TDS of <strong>{formatCurrency(monthlyTds)}</strong> will be deducted from your salary each month.
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
