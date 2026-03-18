import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { formatCurrency } from "@/lib/utils";
import { usePayrollRuns } from "@/api/hooks";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend, AreaChart, Area,
} from "recharts";
import { TrendingUp, TrendingDown, Users, Wallet, Loader2 } from "lucide-react";

const MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function PayrollAnalyticsPage() {
  const { data: res, isLoading } = usePayrollRuns();

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>;
  }

  const runs = (res?.data?.data || [])
    .filter((r: any) => r.status === "paid" || r.status === "computed" || r.status === "approved")
    .sort((a: any, b: any) => a.year === b.year ? a.month - b.month : a.year - b.year);

  const trendData = runs.map((r: any) => ({
    period: `${MONTHS[r.month]} ${r.year}`,
    gross: Number(r.total_gross),
    deductions: Number(r.total_deductions),
    net: Number(r.total_net),
    employees: r.employee_count || 0,
    employerCost: Number(r.total_gross) + Number(r.total_employer_contributions || 0),
  }));

  // Calculate stats
  const latest = runs[runs.length - 1];
  const prev = runs[runs.length - 2];
  const grossChange = latest && prev ? ((Number(latest.total_gross) - Number(prev.total_gross)) / Number(prev.total_gross) * 100) : 0;
  const netChange = latest && prev ? ((Number(latest.total_net) - Number(prev.total_net)) / Number(prev.total_net) * 100) : 0;
  const avgPerEmployee = latest ? Math.round(Number(latest.total_net) / (latest.employee_count || 1)) : 0;
  const deductionRate = latest ? Math.round(Number(latest.total_deductions) / Number(latest.total_gross) * 100) : 0;

  // Cost breakdown for latest
  const costBreakdown = latest ? [
    { name: "Net Pay", value: Number(latest.total_net), fill: "#6366F1" },
    { name: "Deductions", value: Number(latest.total_deductions), fill: "#F59E0B" },
    { name: "Employer Contributions", value: Number(latest.total_employer_contributions || 0), fill: "#10B981" },
  ] : [];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Payroll Analytics"
        description="Cost trends, comparisons, and insights"
      />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Avg Net Pay / Employee"
          value={formatCurrency(avgPerEmployee)}
          subtitle={latest ? `${latest.employee_count} employees` : "—"}
          icon={Users}
        />
        <StatCard
          title="Gross Pay Change"
          value={`${grossChange >= 0 ? "+" : ""}${grossChange.toFixed(1)}%`}
          subtitle="vs previous month"
          icon={grossChange >= 0 ? TrendingUp : TrendingDown}
        />
        <StatCard
          title="Net Pay Change"
          value={`${netChange >= 0 ? "+" : ""}${netChange.toFixed(1)}%`}
          subtitle="vs previous month"
          icon={netChange >= 0 ? TrendingUp : TrendingDown}
        />
        <StatCard
          title="Deduction Rate"
          value={`${deductionRate}%`}
          subtitle="of gross pay"
          icon={Wallet}
        />
      </div>

      {/* Payroll trend */}
      <Card>
        <CardHeader><CardTitle>Payroll Cost Trend</CardTitle></CardHeader>
        <CardContent>
          <div className="h-80">
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                  <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={(v: number) => `${(v / 100000).toFixed(0)}L`} />
                  <Tooltip formatter={(value: number) => formatCurrency(value)} />
                  <Legend />
                  <Area type="monotone" dataKey="gross" name="Gross" stroke="#6366F1" fill="#6366F1" fillOpacity={0.1} />
                  <Area type="monotone" dataKey="net" name="Net" stroke="#10B981" fill="#10B981" fillOpacity={0.1} />
                  <Area type="monotone" dataKey="deductions" name="Deductions" stroke="#F59E0B" fill="#F59E0B" fillOpacity={0.1} />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-gray-400">
                Need at least 1 completed payroll run for analytics
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Cost breakdown */}
        <Card>
          <CardHeader><CardTitle>Cost Breakdown (Latest)</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64">
              {costBreakdown.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={costBreakdown} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis type="number" tickFormatter={(v: number) => `${(v / 100000).toFixed(1)}L`} />
                    <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value: number) => formatCurrency(value)} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                      {costBreakdown.map((entry, i) => (
                        <rect key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-gray-400">No data</div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Employee count trend */}
        <Card>
          <CardHeader><CardTitle>Headcount Trend</CardTitle></CardHeader>
          <CardContent>
            <div className="h-64">
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                    <XAxis dataKey="period" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="employees" name="Employees" stroke="#6366F1" strokeWidth={2} dot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-gray-400">No data</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Month comparison table */}
      {runs.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Month-over-Month Comparison</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50">
                    <th className="px-6 py-3 text-left font-medium text-gray-500">Period</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">Employees</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">Gross Pay</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">Deductions</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">Net Pay</th>
                    <th className="px-6 py-3 text-right font-medium text-gray-500">Avg/Employee</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {runs.slice().reverse().map((r: any) => (
                    <tr key={r.id} className="hover:bg-gray-50">
                      <td className="px-6 py-3 font-medium">{MONTHS[r.month]} {r.year}</td>
                      <td className="px-6 py-3 text-right">{r.employee_count}</td>
                      <td className="px-6 py-3 text-right">{formatCurrency(r.total_gross)}</td>
                      <td className="px-6 py-3 text-right text-red-600">{formatCurrency(r.total_deductions)}</td>
                      <td className="px-6 py-3 text-right font-semibold">{formatCurrency(r.total_net)}</td>
                      <td className="px-6 py-3 text-right">{formatCurrency(Math.round(Number(r.total_net) / (r.employee_count || 1)))}</td>
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
