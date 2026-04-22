import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { StatCard } from "@/components/ui/StatCard";
import { formatCurrency } from "@/lib/utils";
import { apiGet } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Scale,
  Users,
  AlertTriangle,
  FileText,
  Loader2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

export function PayEquityPage() {
  const [tab, setTab] = useState<"overview" | "compliance">("overview");

  const { data: analysisRes, isLoading: analysisLoading } = useQuery({
    queryKey: ["pay-equity-analysis"],
    queryFn: () => apiGet<any>("/pay-equity/analysis"),
  });

  const { data: complianceRes, isLoading: complianceLoading } = useQuery({
    queryKey: ["pay-equity-compliance"],
    queryFn: () => apiGet<any>("/pay-equity/compliance-report"),
    enabled: tab === "compliance",
  });

  const analysis = analysisRes?.data || {};
  const compliance = complianceRes?.data || {};
  const payGap = analysis.payGap || {};

  const gapSeverity =
    Math.abs(payGap.meanGapPercentage || 0) > 10
      ? "high"
      : Math.abs(payGap.meanGapPercentage || 0) > 5
        ? "medium"
        : "low";

  return (
    <div>
      <PageHeader
        title="Pay Equity Analysis"
        description="Analyze compensation fairness across gender, department, and role"
      />

      {analysisLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
        </div>
      ) : (
        <>
          {/* #169 — Previously all 4 cards called setTab against the local
              tab state, which only swapped the narrow "Analysis Overview /
              Compliance Report" tabs on this very page. Two of them
              (Employees Analyzed, Median Salary) were on the already-
              active tab, so clicks produced zero visible change — users
              reported the cards as "not redirecting". Point them at the
              dedicated list/benchmarks pages; keep the gap cards on the
              Compliance tab (that IS their drill-in view) but scroll it
              into focus so the switch is visible. */}
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Employees Analyzed"
              value={analysis.totalEmployees || 0}
              icon={Users}
              to="/employees"
            />
            <StatCard
              title="Median Salary"
              value={formatCurrency(analysis.overallStats?.median || 0)}
              icon={BarChart3}
              to="/benchmarks"
            />
            <StatCard
              title="Mean Pay Gap"
              value={`${payGap.meanGapPercentage || 0}%`}
              icon={gapSeverity === "low" ? Scale : AlertTriangle}
              onClick={() => {
                setTab("compliance");
                requestAnimationFrame(() =>
                  document
                    .getElementById("pay-equity-tabs")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                );
              }}
            />
            <StatCard
              title="Median Pay Gap"
              value={`${payGap.medianGapPercentage || 0}%`}
              icon={Scale}
              onClick={() => {
                setTab("compliance");
                requestAnimationFrame(() =>
                  document
                    .getElementById("pay-equity-tabs")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" }),
                );
              }}
            />
          </div>

          {/* Tabs */}
          <div id="pay-equity-tabs" className="mb-4 flex gap-2 border-b border-gray-200">
            <button
              onClick={() => setTab("overview")}
              className={`px-4 py-2 text-sm font-medium ${tab === "overview" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
            >
              Analysis Overview
            </button>
            <button
              onClick={() => setTab("compliance")}
              className={`px-4 py-2 text-sm font-medium ${tab === "compliance" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
            >
              Compliance Report
            </button>
          </div>

          {tab === "overview" && (
            <div className="space-y-6">
              {/* Gender Pay Gap Card */}
              {payGap.maleCount !== undefined && (
                <Card>
                  <CardContent className="p-6">
                    <h3 className="mb-4 text-lg font-semibold text-gray-900">
                      Gender Pay Gap Analysis
                    </h3>
                    <div className="grid gap-6 md:grid-cols-2">
                      <div>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between rounded-lg bg-blue-50 p-3">
                            <span className="text-sm text-blue-700">Male Employees</span>
                            <span className="font-semibold text-blue-900">{payGap.maleCount}</span>
                          </div>
                          <div className="flex items-center justify-between rounded-lg bg-pink-50 p-3">
                            <span className="text-sm text-pink-700">Female Employees</span>
                            <span className="font-semibold text-pink-900">
                              {payGap.femaleCount}
                            </span>
                          </div>
                          <div className="flex items-center justify-between rounded-lg bg-blue-50 p-3">
                            <span className="text-sm text-blue-700">Male Mean Salary</span>
                            <span className="font-semibold text-blue-900">
                              {formatCurrency(payGap.maleMean || 0)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between rounded-lg bg-pink-50 p-3">
                            <span className="text-sm text-pink-700">Female Mean Salary</span>
                            <span className="font-semibold text-pink-900">
                              {formatCurrency(payGap.femaleMean || 0)}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-col items-center justify-center">
                        <div
                          className={`rounded-2xl p-8 text-center ${
                            gapSeverity === "high"
                              ? "bg-red-50"
                              : gapSeverity === "medium"
                                ? "bg-yellow-50"
                                : "bg-green-50"
                          }`}
                        >
                          <p className="text-sm text-gray-600">Mean Pay Gap</p>
                          <p
                            className={`text-4xl font-bold ${
                              gapSeverity === "high"
                                ? "text-red-600"
                                : gapSeverity === "medium"
                                  ? "text-yellow-600"
                                  : "text-green-600"
                            }`}
                          >
                            {payGap.meanGapPercentage > 0 ? (
                              <TrendingUp className="mb-1 inline h-8 w-8" />
                            ) : (
                              <TrendingDown className="mb-1 inline h-8 w-8" />
                            )}{" "}
                            {Math.abs(payGap.meanGapPercentage || 0)}%
                          </p>
                          <p className="mt-1 text-xs text-gray-500">
                            {payGap.meanGapPercentage > 0
                              ? "Men are paid more on average"
                              : payGap.meanGapPercentage < 0
                                ? "Women are paid more on average"
                                : "No gap detected"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Department Analysis */}
              {analysis.departmentAnalysis && (
                <Card>
                  <CardContent className="p-6">
                    <h3 className="mb-4 text-lg font-semibold text-gray-900">
                      Department Analysis
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase text-gray-500">
                            <th className="pb-2 pr-4">Department</th>
                            <th className="pb-2 pr-4">Employees</th>
                            <th className="pb-2 pr-4">Mean Salary</th>
                            <th className="pb-2 pr-4">Median</th>
                            <th className="pb-2 pr-4">Min</th>
                            <th className="pb-2 pr-4">Max</th>
                            <th className="pb-2">Spread</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(analysis.departmentAnalysis).map(
                            ([dept, stats]: [string, any]) => (
                              <tr key={dept} className="border-b border-gray-100">
                                <td className="py-3 pr-4 font-medium text-gray-900">{dept}</td>
                                <td className="py-3 pr-4">{stats.count}</td>
                                <td className="py-3 pr-4">{formatCurrency(stats.mean)}</td>
                                <td className="py-3 pr-4">{formatCurrency(stats.median)}</td>
                                <td className="py-3 pr-4 text-sm text-gray-500">
                                  {formatCurrency(stats.min)}
                                </td>
                                <td className="py-3 pr-4 text-sm text-gray-500">
                                  {formatCurrency(stats.max)}
                                </td>
                                <td className="py-3">
                                  <Badge
                                    variant={
                                      stats.max - stats.min > stats.mean ? "inactive" : "active"
                                    }
                                  >
                                    {formatCurrency(stats.max - stats.min)}
                                  </Badge>
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Role Analysis */}
              {analysis.roleAnalysis && (
                <Card>
                  <CardContent className="p-6">
                    <h3 className="mb-4 text-lg font-semibold text-gray-900">
                      Role / Designation Analysis
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-200 text-left text-xs font-semibold uppercase text-gray-500">
                            <th className="pb-2 pr-4">Designation</th>
                            <th className="pb-2 pr-4">Count</th>
                            <th className="pb-2 pr-4">Mean</th>
                            <th className="pb-2 pr-4">Median</th>
                            <th className="pb-2 pr-4">P25</th>
                            <th className="pb-2">P75</th>
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(analysis.roleAnalysis).map(
                            ([role, stats]: [string, any]) => (
                              <tr key={role} className="border-b border-gray-100">
                                <td className="py-3 pr-4 font-medium text-gray-900">{role}</td>
                                <td className="py-3 pr-4">{stats.count}</td>
                                <td className="py-3 pr-4">{formatCurrency(stats.mean)}</td>
                                <td className="py-3 pr-4">{formatCurrency(stats.median)}</td>
                                <td className="py-3 pr-4 text-sm text-gray-500">
                                  {formatCurrency(stats.p25)}
                                </td>
                                <td className="py-3 text-sm text-gray-500">
                                  {formatCurrency(stats.p75)}
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {tab === "compliance" && (
            <div className="space-y-6">
              {complianceLoading ? (
                <div className="flex h-32 items-center justify-center">
                  <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
                </div>
              ) : (
                <>
                  <Card>
                    <CardContent className="p-6">
                      <h3 className="mb-4 text-lg font-semibold text-gray-900">
                        Compliance Report
                      </h3>
                      <p className="mb-4 text-sm text-gray-500">
                        Generated:{" "}
                        {compliance.generatedAt
                          ? new Date(compliance.generatedAt).toLocaleDateString("en-IN")
                          : "N/A"}
                      </p>

                      <div className="mb-6">
                        <h4 className="mb-2 text-sm font-semibold text-gray-700">Findings</h4>
                        <ul className="space-y-2">
                          {(compliance.findings || []).map((f: string, i: number) => (
                            <li
                              key={i}
                              className="flex items-start gap-2 rounded-lg bg-gray-50 p-3 text-sm"
                            >
                              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-yellow-500" />
                              {f}
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div>
                        <h4 className="mb-2 text-sm font-semibold text-gray-700">
                          Recommendations
                        </h4>
                        {/* #170 — The recommendation items were rendered in
                            blue-on-light-blue with a link-style icon, which
                            read as hyperlinks even though they were plain
                            informational copy. Switch to a neutral callout
                            (gray text on a soft amber background) so the
                            copy doesn't look actionable when it isn't. */}
                        <ul className="space-y-2">
                          {(compliance.recommendations || []).map((r: string, i: number) => (
                            <li
                              key={i}
                              className="flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-gray-700"
                            >
                              <FileText className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                              <span>{r}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </CardContent>
                  </Card>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
