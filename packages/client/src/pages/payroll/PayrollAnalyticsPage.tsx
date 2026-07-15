import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { StatCard } from "@/components/ui/StatCard";
import { formatCurrency, formatAxisAmount, cn } from "@/lib/utils";
import { usePayrollRuns } from "@/api/hooks";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  AreaChart,
  Area,
  Cell,
} from "recharts";
import {
  TrendingUp,
  TrendingDown,
  Users,
  Wallet,
  Loader2,
  Info,
  Building2,
  BarChart3,
} from "lucide-react";

/** Coloured icon chip for card titles (matches the rest of the app). */
function SectionIcon({ icon: Icon, className }: { icon: any; className?: string }) {
  return (
    <span
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg",
        className ?? "bg-brand-50 text-brand-600",
      )}
    >
      <Icon className="h-[18px] w-[18px]" />
    </span>
  );
}

/** Styled recharts tooltip. Pass `formatter` (e.g. formatCurrency) for money. */
function ChartTooltip({ active, payload, label, formatter }: any) {
  if (!active || !payload?.length) return null;
  const fmt = formatter || ((v: number) => v);
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg">
      {label && <p className="mb-1.5 text-xs font-semibold text-gray-900">{label}</p>}
      <div className="space-y-1">
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-6 text-xs">
            <span className="flex items-center gap-1.5 text-gray-500">
              <span
                className="h-2 w-2 rounded-full"
                style={{ background: p.color || p.payload?.fill || p.fill }}
              />
              {p.name}
            </span>
            <span className="font-semibold tabular-nums text-gray-900">{fmt(p.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Muted legend label to match the chart tooltips. */
const legendLabel = (v: string) => <span className="text-xs text-gray-500">{v}</span>;

/** Centered icon-bubble placeholder for empty charts. */
function ChartEmpty({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
      <div className="rounded-full bg-gray-50 p-3">
        <Icon className="h-6 w-6 text-gray-300" />
      </div>
      <p className="text-sm text-gray-400">{text}</p>
    </div>
  );
}

const MONTHS = [
  "",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function PayrollAnalyticsPage() {
  const { data: res, isLoading } = usePayrollRuns();

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
      </div>
    );
  }

  const runs = (res?.data?.data || [])
    .filter((r: any) => r.status === "paid" || r.status === "computed" || r.status === "approved")
    .sort((a: any, b: any) => (a.year === b.year ? a.month - b.month : a.year - b.year));

  const trendData = runs.map((r: any) => ({
    period: `${MONTHS[r.month]} ${r.year}`,
    gross: Number(r.total_gross),
    deductions: Number(r.total_deductions),
    net: Number(r.total_net),
    employees: r.employee_count || 0,
    employerCost: Number(r.total_gross) + Number(r.total_employer_contributions || 0),
  }));

  // Safe percent-of helper — returns null when the denominator is zero
  // or non-finite so the caller can render a dash instead of Infinity/NaN.
  // Issues #47 and #50: the first payroll run has no prior run, and when
  // any run has total_gross = 0 the old inline math produced Infinity%
  // in the summary cards and the per-row Gross%/Net% columns.
  const safePct = (numerator: number, denominator: number): number | null => {
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
      return null;
    }
    return (numerator / denominator) * 100;
  };

  // Calculate stats
  const latest = runs[runs.length - 1];
  const prev = runs[runs.length - 2];

  // BUG-017 — Suppress month-over-month % when the employee count
  // changed by more than 25%. A run that paid 1 employee last month and
  // 14 this month produces "+1318% Gross" which is technically true but
  // useless as a signal (it's hiring, not a cost spike). When the
  // headcount delta is too large to compare apples-to-apples we render
  // "—" with a tooltip explaining why instead.
  const COUNT_DRIFT_THRESHOLD = 0.25;
  const headcountUnstable =
    latest && prev
      ? Math.abs(Number(latest.employee_count || 0) - Number(prev.employee_count || 0)) /
          Math.max(1, Number(prev.employee_count || 0)) >
        COUNT_DRIFT_THRESHOLD
      : false;

  const grossChange =
    latest && prev && !headcountUnstable
      ? safePct(Number(latest.total_gross) - Number(prev.total_gross), Number(prev.total_gross))
      : null;
  const netChange =
    latest && prev && !headcountUnstable
      ? safePct(Number(latest.total_net) - Number(prev.total_net), Number(prev.total_net))
      : null;
  const avgPerEmployee = latest
    ? Math.round(Number(latest.total_net) / (latest.employee_count || 1))
    : 0;
  const deductionRate = latest
    ? safePct(Number(latest.total_deductions), Number(latest.total_gross))
    : null;

  // Cost breakdown for latest
  const costBreakdown = latest
    ? [
        { name: "Net Pay", value: Number(latest.total_net), fill: "#6366F1" },
        { name: "Deductions", value: Number(latest.total_deductions), fill: "#F59E0B" },
        {
          name: "Employer Contributions",
          value: Number(latest.total_employer_contributions || 0),
          fill: "#10B981",
        },
      ]
    : [];

  return (
    <div className="space-y-8">
      <PageHeader title="Payroll Analytics" description="Cost trends, comparisons, and insights" />
      {/* BUG-022 — Distortion banner. Headcount on this page is the
          number of employees who APPEAR in each payroll run, not the
          org's total active headcount. Employees skipped during compute
          (no salary structure, joined after the period, exited before
          the period, etc.) don't show up here, so the "Headcount Trend"
          line and "Avg Net Pay / Employee" can dip sharply across
          consecutive months even when actual hiring is flat. The
          subtitle is more reliable than removing the chart -- HR still
          wants the comparison, they just need the caveat. */}
      <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-900">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
        <span>
          Numbers below reflect employees included in each payroll run. Employees skipped during
          compute (no active salary structure, hired after the pay period, exited before it) are not
          counted, so headcount and per-employee averages can shift between months independently of
          actual hiring activity.
        </span>
      </div>

      {/* BUG-017 — Identify the source run on every KPI subtitle. The
          stats below are computed from the most recent run available
          (paid OR computed OR approved). Without telling HR WHICH run,
          the Deduction Rate / Avg Net Pay numbers shifted between
          page loads (during a recompute) with no explanation. The
          subtitle now spells out the period AND status so HR can
          correlate the figure with a specific run row. */}
      {(() => {
        const sourceLabel = latest
          ? `${MONTHS[latest.month]} ${latest.year} · ${latest.status}`
          : "no runs yet";
        return (
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard
              title="Avg Net Pay / Employee"
              value={formatCurrency(avgPerEmployee)}
              subtitle={
                latest ? `${latest.employee_count} employees · ${sourceLabel}` : sourceLabel
              }
              icon={Users}
              accentClassName="bg-emerald-50 text-emerald-600"
            />
            <StatCard
              title="Gross Pay Change"
              value={
                grossChange === null
                  ? "—"
                  : `${grossChange >= 0 ? "+" : ""}${grossChange.toFixed(1)}%`
              }
              subtitle={
                headcountUnstable
                  ? "headcount changed >25% — comparison suppressed"
                  : `vs previous month · ${sourceLabel}`
              }
              icon={(grossChange ?? 0) >= 0 ? TrendingUp : TrendingDown}
            />
            <StatCard
              title="Net Pay Change"
              value={
                netChange === null ? "—" : `${netChange >= 0 ? "+" : ""}${netChange.toFixed(1)}%`
              }
              subtitle={
                headcountUnstable
                  ? "headcount changed >25% — comparison suppressed"
                  : `vs previous month · ${sourceLabel}`
              }
              icon={(netChange ?? 0) >= 0 ? TrendingUp : TrendingDown}
            />
            <StatCard
              title="Deduction Rate"
              value={deductionRate === null ? "—" : `${Math.round(deductionRate)}%`}
              subtitle={`of gross pay · ${sourceLabel}`}
              icon={Wallet}
              accentClassName="bg-amber-50 text-amber-600"
            />
          </div>
        );
      })()}

      {/* Payroll trend */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SectionIcon icon={TrendingUp} /> Payroll Cost Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            {trendData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="aGross" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366F1" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#6366F1" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="aNet" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10B981" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#10B981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="aDed" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.25} />
                      <stop offset="100%" stopColor="#F59E0B" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" vertical={false} />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 12, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    dy={6}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={formatAxisAmount}
                    width={52}
                  />
                  <Tooltip content={<ChartTooltip formatter={formatCurrency} />} />
                  <Legend iconType="circle" formatter={legendLabel} />
                  <Area
                    type="monotone"
                    dataKey="gross"
                    name="Gross"
                    stroke="#6366F1"
                    strokeWidth={2}
                    fill="url(#aGross)"
                    dot={{ r: 3, strokeWidth: 0, fill: "#6366F1" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="net"
                    name="Net"
                    stroke="#10B981"
                    strokeWidth={2}
                    fill="url(#aNet)"
                    dot={{ r: 3, strokeWidth: 0, fill: "#10B981" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="deductions"
                    name="Deductions"
                    stroke="#F59E0B"
                    strokeWidth={2}
                    fill="url(#aDed)"
                    dot={{ r: 3, strokeWidth: 0, fill: "#F59E0B" }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <ChartEmpty
                icon={TrendingUp}
                text="Need at least 1 completed payroll run for analytics"
              />
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Cost breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SectionIcon icon={Wallet} className="bg-amber-50 text-amber-600" /> Cost Breakdown
              (Latest)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {costBreakdown.some((s) => s.value > 0) ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={costBreakdown}
                    layout="vertical"
                    margin={{ top: 4, right: 16, left: 8, bottom: 4 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" horizontal={false} />
                    <XAxis
                      type="number"
                      tickFormatter={formatAxisAmount}
                      tick={{ fontSize: 12, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={150}
                      tick={{ fontSize: 12, fill: "#64748b" }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <Tooltip
                      content={<ChartTooltip formatter={formatCurrency} />}
                      cursor={{ fill: "rgba(99,102,241,0.06)" }}
                    />
                    <Bar dataKey="value" name="Amount" radius={[0, 6, 6, 0]} maxBarSize={30}>
                      {costBreakdown.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmpty icon={Wallet} text="No data yet" />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Employee count trend */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SectionIcon icon={Users} className="bg-sky-50 text-sky-600" /> Headcount Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" vertical={false} />
                    <XAxis
                      dataKey="period"
                      tick={{ fontSize: 12, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                      dy={6}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                      allowDecimals={false}
                      width={36}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Line
                      type="monotone"
                      dataKey="employees"
                      name="Employees"
                      stroke="#6366F1"
                      strokeWidth={2.5}
                      dot={{ r: 3, fill: "#6366F1", strokeWidth: 0 }}
                      activeDot={{ r: 5 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <ChartEmpty icon={Users} text="No data yet" />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Month comparison table with variance */}
      {runs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SectionIcon icon={BarChart3} /> Month-over-Month Comparison
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50 text-xs uppercase tracking-wide text-gray-400">
                    <th className="px-6 py-3 text-left font-semibold">Period</th>
                    <th className="px-6 py-3 text-right font-semibold">Employees</th>
                    <th className="px-6 py-3 text-right font-semibold">Gross Pay</th>
                    <th className="px-6 py-3 text-right font-semibold">Deductions</th>
                    <th className="px-6 py-3 text-right font-semibold">Net Pay</th>
                    <th className="px-6 py-3 text-right font-semibold">Avg/Employee</th>
                    <th className="px-6 py-3 text-right font-semibold">Gross %</th>
                    <th className="px-6 py-3 text-right font-semibold">Net %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {runs
                    .slice()
                    .reverse()
                    .map((r: any, idx: number) => {
                      const reversed = runs.slice().reverse();
                      const prevRun = reversed[idx + 1];
                      // Use safePct so a prev run with zero gross/net
                      // renders "—" instead of Infinity/NaN (#47, #50).
                      const grossPct = prevRun
                        ? safePct(
                            Number(r.total_gross) - Number(prevRun.total_gross),
                            Number(prevRun.total_gross),
                          )
                        : null;
                      const netPct = prevRun
                        ? safePct(
                            Number(r.total_net) - Number(prevRun.total_net),
                            Number(prevRun.total_net),
                          )
                        : null;
                      return (
                        <tr key={r.id} className="transition-colors hover:bg-gray-50/70">
                          <td className="whitespace-nowrap px-6 py-3 font-medium text-gray-900">
                            {MONTHS[r.month]} {r.year}
                          </td>
                          <td className="px-6 py-3 text-right tabular-nums">{r.employee_count}</td>
                          <td className="px-6 py-3 text-right tabular-nums">
                            {formatCurrency(r.total_gross)}
                          </td>
                          <td className="px-6 py-3 text-right tabular-nums text-rose-600">
                            {formatCurrency(r.total_deductions)}
                          </td>
                          <td className="px-6 py-3 text-right font-semibold tabular-nums text-gray-900">
                            {formatCurrency(r.total_net)}
                          </td>
                          <td className="px-6 py-3 text-right tabular-nums">
                            {formatCurrency(
                              Math.round(Number(r.total_net) / (r.employee_count || 1)),
                            )}
                          </td>
                          <td className="px-6 py-3 text-right tabular-nums">
                            {grossPct !== null ? (
                              <span className={grossPct >= 0 ? "text-rose-500" : "text-green-600"}>
                                {grossPct >= 0 ? "+" : ""}
                                {grossPct.toFixed(1)}%
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                          <td className="px-6 py-3 text-right tabular-nums">
                            {netPct !== null ? (
                              <span className={netPct >= 0 ? "text-green-600" : "text-rose-500"}>
                                {netPct >= 0 ? "+" : ""}
                                {netPct.toFixed(1)}%
                              </span>
                            ) : (
                              <span className="text-gray-300">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Employer total cost trend */}
      {trendData.length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <SectionIcon icon={Building2} className="bg-emerald-50 text-emerald-600" /> Total
              Employer Cost (Gross + Contributions)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={trendData}
                  margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  barGap={6}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" vertical={false} />
                  <XAxis
                    dataKey="period"
                    tick={{ fontSize: 12, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    dy={6}
                  />
                  <YAxis
                    tick={{ fontSize: 12, fill: "#94a3b8" }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={formatAxisAmount}
                    width={52}
                  />
                  <Tooltip
                    content={<ChartTooltip formatter={formatCurrency} />}
                    cursor={{ fill: "rgba(99,102,241,0.06)" }}
                  />
                  <Legend iconType="circle" formatter={legendLabel} />
                  <Bar dataKey="net" name="Net Pay" stackId="a" fill="#6366F1" maxBarSize={40} />
                  <Bar
                    dataKey="deductions"
                    name="Deductions"
                    stackId="a"
                    fill="#F59E0B"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={40}
                  />
                  <Bar
                    dataKey="employerCost"
                    name="Employer Cost"
                    fill="#10B981"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={40}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
