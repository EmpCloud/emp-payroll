import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { apiGet } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Globe,
  Users,
  UserCheck,
  Briefcase,
  ShieldCheck,
  FileText,
  TrendingUp,
  MapPin,
  Loader2,
} from "lucide-react";

const COUNTRY_FLAGS: Record<string, string> = {
  IN: "\uD83C\uDDEE\uD83C\uDDF3",
  US: "\uD83C\uDDFA\uD83C\uDDF8",
  GB: "\uD83C\uDDEC\uD83C\uDDE7",
  DE: "\uD83C\uDDE9\uD83C\uDDEA",
  FR: "\uD83C\uDDEB\uD83C\uDDF7",
  CA: "\uD83C\uDDE8\uD83C\uDDE6",
  AU: "\uD83C\uDDE6\uD83C\uDDFA",
  SG: "\uD83C\uDDF8\uD83C\uDDEC",
  AE: "\uD83C\uDDE6\uD83C\uDDEA",
  JP: "\uD83C\uDDEF\uD83C\uDDF5",
  BR: "\uD83C\uDDE7\uD83C\uDDF7",
  MX: "\uD83C\uDDF2\uD83C\uDDFD",
  KR: "\uD83C\uDDF0\uD83C\uDDF7",
  NL: "\uD83C\uDDF3\uD83C\uDDF1",
  ES: "\uD83C\uDDEA\uD83C\uDDF8",
  IT: "\uD83C\uDDEE\uD83C\uDDF9",
  SE: "\uD83C\uDDF8\uD83C\uDDEA",
  CH: "\uD83C\uDDE8\uD83C\uDDED",
  IE: "\uD83C\uDDEE\uD83C\uDDEA",
  PL: "\uD83C\uDDF5\uD83C\uDDF1",
  PH: "\uD83C\uDDF5\uD83C\uDDED",
  ID: "\uD83C\uDDEE\uD83C\uDDE9",
  MY: "\uD83C\uDDF2\uD83C\uDDFE",
  TH: "\uD83C\uDDF9\uD83C\uDDED",
  VN: "\uD83C\uDDFB\uD83C\uDDF3",
  ZA: "\uD83C\uDDFF\uD83C\uDDE6",
  NG: "\uD83C\uDDF3\uD83C\uDDEC",
  KE: "\uD83C\uDDF0\uD83C\uDDEA",
  EG: "\uD83C\uDDEA\uD83C\uDDEC",
  SA: "\uD83C\uDDF8\uD83C\uDDE6",
};

export function GlobalDashboardPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language;
  const formatCount = (value: number) => new Intl.NumberFormat(language).format(value);
  const formatAmount = (value: number) =>
    new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(value / 100);

  const { data: dashRes, isLoading } = useQuery({
    queryKey: ["global-dashboard"],
    queryFn: () => apiGet<any>("/global/dashboard"),
  });

  const { data: costRes } = useQuery({
    queryKey: ["global-cost-analysis"],
    queryFn: () => apiGet<any>("/global/cost-analysis"),
  });

  const dash = dashRes?.data;
  const cost = costRes?.data;

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("globalPayrollDashboard.title")}
        description={t("globalPayrollDashboard.description")}
      />

      {/* Stats — each card links to the drill-down page (#115) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          to="/global-payroll/employees?status=active"
          className="block transition hover:-translate-y-0.5"
        >
          <StatCard
            title={t("globalPayrollDashboard.stats.activeEmployees")}
            value={formatCount(dash?.totalActive || 0)}
            icon={Users}
          />
        </Link>
        <Link
          to="/global-payroll/compliance?configured=true"
          className="block transition hover:-translate-y-0.5"
        >
          <StatCard
            title={t("globalPayrollDashboard.stats.countries")}
            value={formatCount(dash?.totalCountries || 0)}
            icon={Globe}
          />
        </Link>
        <Link
          to="/global-payroll/employees?employmentType=eor"
          className="block transition hover:-translate-y-0.5"
        >
          <StatCard
            title={t("globalPayrollDashboard.stats.eorWorkers")}
            value={formatCount(dash?.totalEOR || 0)}
            icon={UserCheck}
          />
        </Link>
        <Link
          to="/global-payroll/employees?employmentType=contractor"
          className="block transition hover:-translate-y-0.5"
        >
          <StatCard
            title={t("globalPayrollDashboard.stats.contractors")}
            value={formatCount(dash?.totalContractors || 0)}
            icon={Briefcase}
          />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* #151 — Compliance Score is an aggregate health metric, not a filter.
            Linking it to /global-payroll/compliance (the country list) was
            confusing because the destination is a catalogue, not a drill-in
            view of the score. Render it as a static card until there's a
            dedicated compliance-breakdown page to link to. */}
        <div>
          <StatCard
            title={t("globalPayrollDashboard.stats.complianceScore")}
            value={`${dash?.compliancePercentage || 0}%`}
            icon={ShieldCheck}
            trend={
              dash?.compliancePercentage >= 80
                ? { value: t("globalPayrollDashboard.compliance.good"), positive: true }
                : {
                    value: t("globalPayrollDashboard.compliance.needsAttention"),
                    positive: false,
                  }
            }
          />
        </div>
        <Link
          to="/global-payroll/invoices?status=pending"
          className="block transition hover:-translate-y-0.5"
        >
          <StatCard
            title={t("globalPayrollDashboard.stats.pendingInvoices")}
            value={formatCount(dash?.pendingInvoices || 0)}
            icon={FileText}
          />
        </Link>
        <Link
          to="/global-payroll/employees?status=onboarding"
          className="block transition hover:-translate-y-0.5"
        >
          <StatCard
            title={t("globalPayrollDashboard.stats.onboarding")}
            value={formatCount(dash?.totalOnboarding || 0)}
            icon={TrendingUp}
          />
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Employees by Country */}
        <Card>
          <CardContent className="p-6">
            <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
              <MapPin className="mr-2 inline h-5 w-5" />
              {t("globalPayrollDashboard.employeesByCountry.title")}
            </h3>
            {dash?.employeesByCountry?.length > 0 ? (
              <div className="space-y-3">
                {dash.employeesByCountry.map((c: any) => (
                  <div key={c.code} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">{COUNTRY_FLAGS[c.code] || ""}</span>
                      <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        {c.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <div
                          className="bg-brand-500 h-full rounded-full"
                          style={{
                            width: `${Math.min(100, (c.count / (dash?.totalActive || 1)) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="w-8 text-right text-sm font-semibold text-gray-900 dark:text-white">
                        {formatCount(c.count)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                {t("globalPayrollDashboard.employeesByCountry.empty")}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Monthly Cost by Currency */}
        <Card>
          <CardContent className="p-6">
            <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
              <TrendingUp className="mr-2 inline h-5 w-5" />
              {t("globalPayrollDashboard.costByCurrency.title")}
            </h3>
            {dash?.costByCurrency && Object.keys(dash.costByCurrency).length > 0 ? (
              <div className="space-y-3">
                {Object.entries(dash.costByCurrency)
                  .sort(([, a], [, b]) => (b as number) - (a as number))
                  .map(([currency, amount]) => (
                    <div
                      key={currency}
                      className="flex items-center justify-between rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50"
                    >
                      <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                        {currency}
                      </span>
                      <span className="text-sm font-bold text-gray-900 dark:text-white">
                        {currency} {formatAmount(amount as number)}
                      </span>
                    </div>
                  ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">
                {t("globalPayrollDashboard.costByCurrency.empty")}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cost Analysis by Country */}
      {cost?.countryBreakdown?.length > 0 && (
        <Card>
          <CardContent className="p-6">
            <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-white">
              {t("globalPayrollDashboard.costAnalysis.title")}
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="pb-3 font-medium text-gray-500">
                      {t("globalPayrollDashboard.costAnalysis.columns.country")}
                    </th>
                    <th className="pb-3 text-right font-medium text-gray-500">
                      {t("globalPayrollDashboard.costAnalysis.columns.employees")}
                    </th>
                    <th className="pb-3 text-right font-medium text-gray-500">
                      {t("globalPayrollDashboard.costAnalysis.columns.averageSalary")}
                    </th>
                    <th className="pb-3 text-right font-medium text-gray-500">
                      {t("globalPayrollDashboard.costAnalysis.columns.totalGross")}
                    </th>
                    <th className="pb-3 text-right font-medium text-gray-500">
                      {t("globalPayrollDashboard.costAnalysis.columns.employerCost")}
                    </th>
                    <th className="pb-3 text-right font-medium text-gray-500">
                      {t("globalPayrollDashboard.costAnalysis.columns.netPay")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {cost.countryBreakdown.map((cb: any) => (
                    <tr key={cb.code} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-3">
                        <span className="mr-2">{COUNTRY_FLAGS[cb.code] || ""}</span>
                        {cb.name}
                      </td>
                      <td className="py-3 text-right">{formatCount(cb.employee_count)}</td>
                      <td className="py-3 text-right">
                        {cb.currency_symbol}
                        {formatAmount(cb.avg_salary)}
                      </td>
                      <td className="py-3 text-right">
                        {cb.currency_symbol}
                        {formatAmount(cb.total_gross)}
                      </td>
                      <td className="py-3 text-right font-medium text-red-600">
                        {cb.currency_symbol}
                        {formatAmount(cb.total_employer_cost)}
                      </td>
                      <td className="py-3 text-right text-green-600">
                        {cb.currency_symbol}
                        {formatAmount(cb.total_net)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
