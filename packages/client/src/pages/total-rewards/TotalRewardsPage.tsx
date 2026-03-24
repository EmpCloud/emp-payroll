import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/SelectField";
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
      <Card className="mb-6">
        <CardContent className="p-4">
          <div className="flex items-end gap-4">
            <div className="flex-1">
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Select Employee
              </label>
              <select
                value={selectedEmpId}
                onChange={(e) => setSelectedEmpId(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Choose an employee...</option>
                {employees.map((e: any) => (
                  <option
                    key={e.empcloud_user_id || e.id}
                    value={String(e.empcloud_user_id || e.id)}
                  >
                    {e.first_name || e.firstName} {e.last_name || e.lastName} —{" "}
                    {e.designation || ""}
                  </option>
                ))}
              </select>
            </div>
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

          {/* Summary Stats */}
          <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Direct Compensation"
              value={formatCurrency(statement.totalRewards?.directCompensation || 0)}
              icon={DollarSign}
            />
            <StatCard
              title="Benefits Value"
              value={formatCurrency(statement.totalRewards?.benefitsValue || 0)}
              icon={Heart}
            />
            <StatCard
              title="YTD Net Pay"
              value={formatCurrency(statement.ytdEarnings?.netPay || 0)}
              icon={Wallet}
            />
            <StatCard
              title="Reimbursements"
              value={formatCurrency(statement.totalRewards?.reimbursements || 0)}
              icon={Gift}
            />
          </div>

          {/* Salary Components */}
          <div className="mb-6 grid gap-6 lg:grid-cols-2">
            <Card>
              <CardContent className="p-6">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
                  <DollarSign className="text-brand-600 h-5 w-5" /> Salary Breakdown
                </h3>
                <div className="space-y-2">
                  {(statement.compensation?.components || []).map((c: any) => (
                    <div
                      key={c.code}
                      className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2.5"
                    >
                      <span className="text-sm text-gray-700">{c.name}</span>
                      <div className="text-right">
                        <span className="text-sm font-medium text-gray-900">
                          {formatCurrency(c.monthlyAmount)}
                        </span>
                        <span className="ml-2 text-xs text-gray-500">/mo</span>
                      </div>
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t-2 border-gray-200 px-4 py-3">
                    <span className="font-semibold text-gray-900">Annual CTC</span>
                    <span className="font-bold text-gray-900">
                      {formatCurrency(statement.compensation?.annualCTC || 0)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Benefits */}
            <Card>
              <CardContent className="p-6">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
                  <Heart className="h-5 w-5 text-pink-600" /> Benefits Enrollment
                </h3>
                {(statement.benefits?.plans || []).length === 0 ? (
                  <p className="py-8 text-center text-sm text-gray-400">No benefits enrolled</p>
                ) : (
                  <div className="space-y-2">
                    {statement.benefits.plans.map((b: any, i: number) => (
                      <div
                        key={i}
                        className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2.5"
                      >
                        <div>
                          <span className="text-sm font-medium text-gray-900">{b.planName}</span>
                          <div className="flex gap-2">
                            <Badge variant="draft">{b.type}</Badge>
                            <Badge variant="active">{b.coverageType.replace(/_/g, " ")}</Badge>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="text-sm font-medium text-gray-900">
                            {formatCurrency(b.annualEmployerShare)}
                          </span>
                          <span className="ml-1 text-xs text-gray-500">/yr</span>
                        </div>
                      </div>
                    ))}
                    <div className="flex items-center justify-between border-t-2 border-gray-200 px-4 py-3">
                      <span className="font-semibold text-gray-900">
                        Total Employer Contribution
                      </span>
                      <span className="font-bold text-gray-900">
                        {formatCurrency(statement.benefits?.totalAnnualEmployerContribution || 0)}
                      </span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* YTD Earnings */}
          <Card className="mb-6">
            <CardContent className="p-6">
              <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900">
                <FileText className="h-5 w-5 text-blue-600" /> Year-to-Date Earnings
                <span className="text-sm font-normal text-gray-500">
                  ({statement.ytdEarnings?.monthsProcessed || 0} months processed)
                </span>
              </h3>
              <div className="grid gap-4 sm:grid-cols-4">
                <div className="rounded-lg bg-green-50 p-4 text-center">
                  <p className="text-xs text-green-600">Gross Earnings</p>
                  <p className="mt-1 text-lg font-bold text-green-800">
                    {formatCurrency(statement.ytdEarnings?.grossEarnings || 0)}
                  </p>
                </div>
                <div className="rounded-lg bg-red-50 p-4 text-center">
                  <p className="text-xs text-red-600">Total Deductions</p>
                  <p className="mt-1 text-lg font-bold text-red-800">
                    {formatCurrency(statement.ytdEarnings?.totalDeductions || 0)}
                  </p>
                </div>
                <div className="rounded-lg bg-blue-50 p-4 text-center">
                  <p className="text-xs text-blue-600">Net Pay</p>
                  <p className="mt-1 text-lg font-bold text-blue-800">
                    {formatCurrency(statement.ytdEarnings?.netPay || 0)}
                  </p>
                </div>
                <div className="rounded-lg bg-purple-50 p-4 text-center">
                  <p className="text-xs text-purple-600">Tax Paid</p>
                  <p className="mt-1 text-lg font-bold text-purple-800">
                    {formatCurrency(statement.ytdEarnings?.taxPaid || 0)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Active Loans */}
          {(statement.loans?.active || []).length > 0 && (
            <Card className="mb-6">
              <CardContent className="p-6">
                <h3 className="mb-4 text-lg font-semibold text-gray-900">Active Loans</h3>
                <div className="space-y-2">
                  {statement.loans.active.map((l: any, i: number) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-2.5"
                    >
                      <span className="text-sm text-gray-700">{l.type.replace(/_/g, " ")}</span>
                      <div className="text-right">
                        <span className="text-sm text-gray-500">Outstanding: </span>
                        <span className="font-medium text-orange-600">
                          {formatCurrency(l.outstandingAmount)}
                        </span>
                        <span className="ml-3 text-sm text-gray-500">EMI: </span>
                        <span className="font-medium text-gray-900">
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
        <div className="flex h-64 flex-col items-center justify-center text-gray-400">
          <Award className="mb-4 h-12 w-12" />
          <p className="text-lg">Select an employee to generate their Total Rewards Statement</p>
        </div>
      )}
    </div>
  );
}
