import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { StatCard } from "@/components/ui/StatCard";
import { formatCurrency } from "@/lib/utils";
import { useMyProfile, useMyTaxComputation, useMySalary } from "@/api/hooks";
import { Button } from "@/components/ui/Button";
import { Calculator, IndianRupee, TrendingDown, FileText, Loader2, Download } from "lucide-react";
import { Trans, useTranslation } from "react-i18next";

export function MyTaxPage() {
  const { t } = useTranslation();
  const { data: salRes } = useMySalary();
  const { data: taxRes, isLoading } = useMyTaxComputation();
  const { data: profileRes } = useMyProfile();

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
      </div>
    );
  }

  const salary = salRes?.data;
  const taxComp = taxRes?.data;
  const profile = profileRes?.data;
  const taxInfo =
    typeof profile?.tax_info === "string" ? JSON.parse(profile.tax_info) : profile?.tax_info || {};
  const regime = taxComp?.regime || taxInfo.regime || "new";
  const now = new Date();
  const financialYearStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const financialYearLabel = `${financialYearStart}-${String(financialYearStart + 1).slice(-2)}`;

  // Use tax computation if available, otherwise estimate from salary
  const annualGross = taxComp
    ? Number(taxComp.gross_income)
    : salary
      ? Number(salary.gross_salary)
      : 0;
  const standardDeduction = 75000;
  const taxableIncome = taxComp
    ? Number(taxComp.taxable_income)
    : Math.max(0, annualGross - standardDeduction);

  // Mirrors india-tax.service.computeTax for both regimes so the fallback
  // preview remains consistent even before a persisted computation exists.
  function estimateTax(income: number, selectedRegime: string): number {
    const slabs =
      selectedRegime === "old"
        ? [
            { limit: 250000, rate: 0 },
            { limit: 500000, rate: 5 },
            { limit: 1000000, rate: 20 },
            { limit: Infinity, rate: 30 },
          ]
        : [
            { limit: 400000, rate: 0 },
            { limit: 800000, rate: 5 },
            { limit: 1200000, rate: 10 },
            { limit: 1600000, rate: 15 },
            { limit: 2000000, rate: 20 },
            { limit: 2400000, rate: 25 },
            { limit: Infinity, rate: 30 },
          ];
    let tax = 0,
      prev = 0;
    for (const slab of slabs) {
      if (income <= prev) break;
      tax += ((Math.min(income, slab.limit) - prev) * slab.rate) / 100;
      prev = slab.limit;
    }
    if (selectedRegime === "old" && income <= 500000) {
      tax = Math.max(0, tax - 12500);
    } else if (selectedRegime !== "old" && income <= 1200000) {
      tax = Math.max(0, tax - 60000);
    } else if (selectedRegime !== "old" && income <= 1275000) {
      tax = Math.min(tax, income - 1200000);
    }
    return Math.round(tax);
  }

  const taxOnIncome = taxComp ? Number(taxComp.tax_on_income) : estimateTax(taxableIncome, regime);
  const cess = taxComp ? Number(taxComp.health_and_education_cess) : Math.round(taxOnIncome * 0.04);
  const totalTax = taxComp ? Number(taxComp.total_tax) : taxOnIncome + cess;
  const taxPaid = taxComp ? Number(taxComp.tax_already_paid) : 0;
  const monthlyTds = taxComp ? Number(taxComp.monthly_tds) : Math.round(totalTax / 12);
  const remaining = totalTax - taxPaid;
  const progressPct = totalTax > 0 ? Math.min(100, Math.round((taxPaid / totalTax) * 100)) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("myTaxPage.title")}
        description={t("myTaxPage.description", { financialYear: financialYearLabel })}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const url = `${import.meta.env.VITE_API_URL || "/api/v1"}/self-service/tax/form16?token=${localStorage.getItem("access_token")}`;
              window.open(url, "_blank");
            }}
          >
            <Download className="h-4 w-4" /> {t("myTaxPage.form16")}
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("myTaxPage.stats.annualIncome")}
          value={formatCurrency(annualGross)}
          icon={IndianRupee}
        />
        <StatCard
          title={t("myTaxPage.stats.taxableIncome")}
          value={formatCurrency(taxableIncome)}
          icon={Calculator}
        />
        <StatCard
          title={t("myTaxPage.stats.estimatedTax")}
          value={formatCurrency(totalTax)}
          icon={TrendingDown}
        />
        <StatCard
          title={t("myTaxPage.stats.tdsDeductedYtd")}
          value={formatCurrency(taxPaid)}
          icon={FileText}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>{t("myTaxPage.computationTitle")}</CardTitle>
              <Badge variant={regime === "new" ? "approved" : "pending"}>
                {t(`myTaxPage.regimes.${regime}`, { defaultValue: regime })}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              {[
                {
                  label: t("myTaxPage.rows.grossAnnualIncome"),
                  value: annualGross,
                  bold: false,
                },
                {
                  label: t("myTaxPage.rows.standardDeduction"),
                  value: -standardDeduction,
                  bold: false,
                },
                ...(taxComp && Number(taxComp.total_deductions) > 0
                  ? [
                      {
                        label: t("myTaxPage.rows.chapterDeductions"),
                        value: -Number(taxComp.total_deductions),
                        bold: false,
                      },
                    ]
                  : []),
                { label: t("myTaxPage.rows.taxableIncome"), value: taxableIncome, bold: true },
                { label: t("myTaxPage.rows.taxOnIncome"), value: taxOnIncome, bold: false },
                { label: t("myTaxPage.rows.cess"), value: cess, bold: false },
                { label: t("myTaxPage.rows.totalLiability"), value: totalTax, bold: true },
                { label: t("myTaxPage.rows.monthlyTds"), value: monthlyTds, bold: true },
              ].map((row) => (
                <div
                  key={row.label}
                  className={`flex justify-between text-sm ${row.bold ? "border-t border-gray-200 pt-2 font-semibold" : ""}`}
                >
                  <dt className="text-gray-500">{row.label}</dt>
                  <dd className={row.value < 0 ? "text-red-600" : "text-gray-900"}>
                    {row.value < 0
                      ? `-${formatCurrency(Math.abs(row.value))}`
                      : formatCurrency(row.value)}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("myTaxPage.tracker.title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">{t("myTaxPage.tracker.totalTax")}</span>
                <span className="font-semibold">{formatCurrency(totalTax)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">{t("myTaxPage.tracker.tdsDeductedYtd")}</span>
                <span className="font-semibold text-green-600">{formatCurrency(taxPaid)}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500">{t("myTaxPage.tracker.remaining")}</span>
                <span className="font-semibold text-orange-600">{formatCurrency(remaining)}</span>
              </div>

              <div>
                <div className="mb-1 flex justify-between text-xs text-gray-500">
                  <span>{t("myTaxPage.tracker.progress")}</span>
                  <span>{progressPct}%</span>
                </div>
                <div className="h-3 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="bg-brand-500 h-full rounded-full transition-all"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              <div className="mt-4 rounded-lg bg-blue-50 p-3 text-sm text-blue-700">
                <Trans
                  i18nKey="myTaxPage.tracker.monthlyMessage"
                  values={{ amount: formatCurrency(monthlyTds) }}
                  components={{ strong: <strong /> }}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
