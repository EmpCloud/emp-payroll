import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SearchableSelect, type SearchableOption } from "@/components/ui/SearchableSelect";
import { StatCard } from "@/components/ui/StatCard";
import { formatCurrency } from "@/lib/utils";
import { apiGet } from "@/api/client";
import { useEmployees } from "@/api/hooks";
import { useQuery } from "@tanstack/react-query";
import {
  Award,
  DollarSign,
  Heart,
  FileText,
  Loader2,
  ExternalLink,
  Wallet,
  Gift,
} from "lucide-react";

export function TotalRewardsPage() {
  const [selectedEmpId, setSelectedEmpId] = useState("");
  const { data: empRes } = useEmployees({ limit: 200 });
  const employees = empRes?.data?.data || [];

  const employeeOptions: SearchableOption[] = useMemo(
    () =>
      employees.map((e: any) => {
        const name =
          `${e.first_name || e.firstName || ""} ${e.last_name || e.lastName || ""}`.trim();
        return {
          value: String(e.empcloud_user_id || e.id),
          label: name || "Unnamed employee",
          sublabel:
            [e.designation, e.emp_code || e.empCode].filter(Boolean).join(" · ") || undefined,
        };
      }),
    [employees],
  );

  const { data: statementRes, isLoading } = useQuery({
    queryKey: ["total-rewards", selectedEmpId],
    queryFn: () => apiGet<any>(`/total-rewards/employee/${selectedEmpId}`),
    enabled: !!selectedEmpId,
  });

  const statement = statementRes?.data || null;

  function openPrintView() {
    const token = localStorage.getItem("access_token");
    const base = import.meta.env.VITE_API_URL || "/api/v1";
    window.open(`${base}/total-rewards/employee/${selectedEmpId}/html?token=${token}`, "_blank");
  }

  return (
    <div>
      <PageHeader
        title="Total Rewards Statements"
        description="Generate comprehensive compensation and benefits statements for employees"
        actions={
          statement ? (
            <Button onClick={openPrintView}>
              <ExternalLink className="mr-2 h-4 w-4" /> Print / PDF
            </Button>
          ) : undefined
        }
      />

      {/* Employee Selector */}
      <Card className="mb-6 dark:border-gray-800 dark:bg-gray-900">
        <CardContent className="p-4">
          <div className="max-w-xl">
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
              Select Employee
            </label>
            <SearchableSelect
              options={employeeOptions}
              value={selectedEmpId}
              onChange={setSelectedEmpId}
              placeholder="Choose an employee…"
              searchPlaceholder="Search by name, designation or code…"
              emptyText="No employees match your search"
            />
            <p className="mt-1.5 text-xs text-gray-500 dark:text-gray-400">
              {employeeOptions.length} employee{employeeOptions.length === 1 ? "" : "s"} available
            </p>
          </div>
        </CardContent>
      </Card>

      {isLoading && (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
        </div>
      )}

      {statement && !isLoading && (
        <>
          {/* Grand Total */}
          <div className="from-brand-600 mb-6 rounded-xl bg-gradient-to-r to-purple-600 p-8 text-center text-white">
            <p className="text-sm uppercase tracking-wider opacity-80">Total Rewards Value</p>
            <p className="mt-1 text-4xl font-bold">
              {formatCurrency(statement.totalRewards?.grandTotal || 0)}
            </p>
            <p className="mt-2 text-sm opacity-80">
              {statement.employee.name} | FY {statement.financialYear}
            </p>
          </div>

          {/* Summary Stats — #91 cards scroll to the matching breakdown
              section below. Each card anchors to its own <section> via a
              CSS-scroll id so users see how each total is composed. */}
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Direct Compensation"
              value={formatCurrency(statement.totalRewards?.directCompensation || 0)}
              icon={DollarSign}
              onClick={() =>
                document
                  .getElementById("breakdown-salary")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            />
            <StatCard
              title="Benefits Value"
              value={formatCurrency(statement.totalRewards?.benefitsValue || 0)}
              icon={Heart}
              onClick={() =>
                document
                  .getElementById("breakdown-benefits")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            />
            <StatCard
              title="YTD Net Pay"
              value={formatCurrency(statement.ytdEarnings?.netPay || 0)}
              icon={Wallet}
              onClick={() =>
                document
                  .getElementById("breakdown-ytd")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            />
            <StatCard
              title="Reimbursements"
              value={formatCurrency(statement.totalRewards?.reimbursements || 0)}
              icon={Gift}
              onClick={() =>
                document
                  .getElementById("breakdown-reimbursements")
                  ?.scrollIntoView({ behavior: "smooth", block: "start" })
              }
            />
          </div>

          {/* Salary Components */}
          <div id="breakdown-salary" className="mb-6 grid scroll-mt-6 gap-6 lg:grid-cols-2">
            <Card className="dark:border-gray-800 dark:bg-gray-900">
              <CardContent className="p-6">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                  <DollarSign className="text-brand-600 h-5 w-5" /> Salary Breakdown
                </h3>
                <div className="space-y-2">
                  {(statement.compensation?.components || []).map((c: any) => (
                    <div
                      key={c.code}
                      className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2.5 dark:bg-gray-800/60"
                    >
                      <span className="text-sm text-gray-700 dark:text-gray-300">{c.name}</span>
                      <div className="text-right">
                        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                          {formatCurrency(c.monthlyAmount)}
                        </span>
                        <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">/mo</span>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t-2 border-gray-200 px-4 py-3 dark:border-gray-700">
                    <span className="font-semibold text-gray-900 dark:text-gray-100">
                      Annual CTC
                    </span>
                    <span className="font-bold text-gray-900 dark:text-gray-100">
                      {formatCurrency(statement.compensation?.annualCTC || 0)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Benefits */}
            <Card
              id="breakdown-benefits"
              className="scroll-mt-6 dark:border-gray-800 dark:bg-gray-900"
            >
              <CardContent className="p-6">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                  <Heart className="h-5 w-5 text-pink-600" /> Benefits Enrollment
                </h3>
                {(statement.benefits?.plans || []).length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                    No benefits enrolled
                  </p>
                ) : (
                  <div className="space-y-2">
                    {statement.benefits.plans.map((b: any, i: number) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2.5 dark:bg-gray-800/60"
                      >
                        <div>
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {b.planName}
                          </span>
                          <div className="flex gap-2">
                            <Badge variant="draft">{b.type}</Badge>
                            <Badge variant="active">{b.coverageType.replace(/_/g, " ")}</Badge>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                            {formatCurrency(b.annualEmployerShare)}
                          </span>
                          <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">/yr</span>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center justify-between border-t-2 border-gray-200 px-4 py-3 dark:border-gray-700">
                      <span className="font-semibold text-gray-900 dark:text-gray-100">
                        Total Employer Contribution
                      </span>
                      <span className="font-bold text-gray-900 dark:text-gray-100">
                        {formatCurrency(statement.benefits?.totalAnnualEmployerContribution || 0)}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* YTD Earnings */}
          <Card
            id="breakdown-ytd"
            className="mb-6 scroll-mt-6 dark:border-gray-800 dark:bg-gray-900"
          >
            <CardContent className="p-6">
              <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-gray-100">
                <FileText className="h-5 w-5 text-blue-600" /> Year-to-Date Earnings
                <span className="text-sm font-normal text-gray-500 dark:text-gray-400">
                  ({statement.ytdEarnings?.monthsProcessed || 0} months processed)
                </span>
              </h3>
              <div className="grid gap-4 sm:grid-cols-4">
                <div className="rounded-lg bg-green-50 p-4 text-center dark:bg-green-950/30">
                  <p className="text-xs text-green-600 dark:text-green-400">Gross Earnings</p>
                  <p className="mt-1 text-lg font-bold text-green-800 dark:text-green-300">
                    {formatCurrency(statement.ytdEarnings?.grossEarnings || 0)}
                  </p>
                </div>
                <div className="rounded-lg bg-red-50 p-4 text-center dark:bg-red-950/30">
                  <p className="text-xs text-red-600 dark:text-red-400">Total Deductions</p>
                  <p className="mt-1 text-lg font-bold text-red-800 dark:text-red-300">
                    {formatCurrency(statement.ytdEarnings?.totalDeductions || 0)}
                  </p>
                </div>
                <div className="rounded-lg bg-blue-50 p-4 text-center dark:bg-blue-950/30">
                  <p className="text-xs text-blue-600 dark:text-blue-400">Net Pay</p>
                  <p className="mt-1 text-lg font-bold text-blue-800 dark:text-blue-300">
                    {formatCurrency(statement.ytdEarnings?.netPay || 0)}
                  </p>
                </div>
                <div className="rounded-lg bg-purple-50 p-4 text-center dark:bg-purple-950/30">
                  <p className="text-xs text-purple-600 dark:text-purple-400">Tax Paid</p>
                  <p className="mt-1 text-lg font-bold text-purple-800 dark:text-purple-300">
                    {formatCurrency(statement.ytdEarnings?.taxPaid || 0)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Active Loans */}
          {(statement.loans?.active || []).length > 0 && (
            <Card className="mb-6 dark:border-gray-800 dark:bg-gray-900">
              <CardContent className="p-6">
                <h3 className="mb-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
                  Active Loans
                </h3>
                <div className="space-y-2">
                  {statement.loans.active.map((l: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2.5 dark:bg-gray-800/60"
                    >
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {l.type.replace(/_/g, " ")}
                      </span>
                      <div className="text-right">
                        <span className="text-sm text-gray-500 dark:text-gray-400">
                          Outstanding:{" "}
                        </span>
                        <span className="font-medium text-orange-600 dark:text-orange-400">
                          {formatCurrency(l.outstandingAmount)}
                        </span>
                        <span className="ml-3 text-sm text-gray-500 dark:text-gray-400">EMI: </span>
                        <span className="font-medium text-gray-900 dark:text-gray-100">
                          {formatCurrency(l.emiAmount)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {!selectedEmpId && !isLoading && (
        <div className="flex h-64 flex-col items-center justify-center text-gray-400 dark:text-gray-500">
          <Award className="mb-4 h-12 w-12" />
          <p className="text-lg">Select an employee to generate their Total Rewards Statement</p>
        </div>
      )}
    </div>
  );
}
