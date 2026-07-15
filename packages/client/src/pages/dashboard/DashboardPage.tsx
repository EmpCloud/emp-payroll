import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatCurrency, formatAxisAmount } from "@/lib/utils";
import { useEmployees, usePayrollRuns } from "@/api/hooks";
import { getUser } from "@/api/auth";
import { apiGet } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import {
  Users,
  Wallet,
  TrendingUp,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ArrowRight,
  Loader2,
  Clock,
  UserPlus,
  Play,
  CreditCard,
  Settings,
  Building2,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";

const COLORS = ["#6366F1", "#818CF8", "#A5B4FC", "#C7D2FE", "#E0E7FF", "#EEF2FF"];
const GROSS_COLOR = "#6366F1";
const NET_COLOR = "#C7D2FE";
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

export function DashboardPage() {
  const navigate = useNavigate();
  const { data: empRes, isLoading: empLoading } = useEmployees({ limit: 1000 });
  const { data: runsRes, isLoading: runsLoading } = usePayrollRuns();

  if (empLoading || runsLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
      </div>
    );
  }

  const employees = empRes?.data?.data || [];
  const totalEmployees = empRes?.data?.total || employees.length;
  const runs = runsRes?.data?.data || [];
  // BUG-012 — "Last Payroll" was previously the most recent run with
  // status === "paid", which made the dashboard stale: a freshly
  // computed/approved May run was ignored in favour of the previously
  // paid April one even though May's numbers are what HR cares about.
  // Pick the latest run by (year, month) regardless of status, with a
  // tie-break preferring `paid > approved > computed > draft`. Also
  // surface the run's status alongside the figures so HR can see at a
  // glance whether they're looking at the in-flight or signed-off
  // numbers.
  const STATUS_RANK: Record<string, number> = { paid: 4, approved: 3, computed: 2, draft: 1 };
  const sortedRuns = runs.slice().sort((a: any, b: any) => {
    if (a.year !== b.year) return Number(b.year) - Number(a.year);
    if (a.month !== b.month) return Number(b.month) - Number(a.month);
    return (STATUS_RANK[b.status] || 0) - (STATUS_RANK[a.status] || 0);
  });
  const paidRuns = runs.filter((r: any) => r.status === "paid");
  const lastRun = sortedRuns[0] || paidRuns[0];

  // Department headcount
  // BUG-32 — employees with no department previously bucketed under the
  // literal key "null"/"undefined", which rendered a "null" slice on the
  // Headcount-by-Department chart. Fall back to a human-readable
  // "Unassigned" bucket instead.
  const deptMap: Record<string, number> = {};
  for (const emp of employees) {
    const dept = emp.department && String(emp.department).trim() ? emp.department : "Unassigned";
    deptMap[dept] = (deptMap[dept] || 0) + 1;
  }
  const departmentHeadcount = Object.entries(deptMap).map(([department, count]) => ({
    department,
    count,
  }));
  // Largest departments first so the donut and its legend read top-down.
  const sortedDept = [...departmentHeadcount].sort((a, b) => b.count - a.count);
  const totalHeadcount = sortedDept.reduce((s, d) => s + d.count, 0);

  // Monthly payroll trend.
  // #1655 — Filter out any rows whose period is in the future. Until the
  // future-period guard rolled out, tenants could end up with bogus
  // "Paid" runs for months that hadn't started; those polluted the chart.
  // BUG-012 — Include `computed` and `approved` runs alongside `paid`
  // here too. Using only paid runs meant the trend chart hid the
  // current month until HR clicked "Mark Paid", so the dashboard's
  // x-axis often lagged by one month even when fresh data existed.
  const _now = new Date();
  const _currentPeriodKey = _now.getFullYear() * 12 + _now.getMonth();
  const trendableStatuses = new Set(["paid", "approved", "computed"]);
  const trendData = sortedRuns
    .filter(
      (r: any) =>
        trendableStatuses.has(r.status) &&
        Number(r.year) * 12 + (Number(r.month) - 1) <= _currentPeriodKey,
    )
    .slice(0, 6)
    .reverse()
    .map((r: any) => ({
      month: `${MONTHS[r.month]} ${r.year}`,
      gross: Number(r.total_gross),
      net: Number(r.total_net),
    }));

  // Month-over-month deltas for the KPI cards, derived from the two most
  // recent trend points so the figures always match the chart.
  const tLen = trendData.length;
  const pctDelta = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
  const grossDelta =
    tLen >= 2 ? pctDelta(trendData[tLen - 1].gross, trendData[tLen - 2].gross) : null;
  const netDelta = tLen >= 2 ? pctDelta(trendData[tLen - 1].net, trendData[tLen - 2].net) : null;
  const asTrend = (d: number | null) =>
    d == null ? undefined : { value: `${Math.abs(d).toFixed(1)}% MoM`, positive: d >= 0 };

  const now = new Date();
  const currentMonth = `${MONTHS[now.getMonth() + 1]} ${now.getFullYear()}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payroll Dashboard"
        description={`Overview for ${currentMonth}`}
        actions={
          <Button onClick={() => navigate("/payroll/runs")}>
            Run Payroll <ArrowRight className="h-4 w-4" />
          </Button>
        }
      />

      {/* Quick actions — the primary "Run Payroll" CTA lives in the page
          header; these tiles are navigation shortcuts (issue #52 / #95),
          restyled as consistent white cards with a coloured icon chip so
          they read as one cohesive row rather than five colour blocks. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          {
            label: "Add Employee",
            icon: UserPlus,
            path: "/employees/new",
            chip: "bg-emerald-50 text-emerald-600",
          },
          {
            label: "View Reports",
            icon: TrendingUp,
            path: "/reports",
            chip: "bg-amber-50 text-amber-600",
          },
          {
            label: "Payslips",
            icon: CreditCard,
            path: "/payslips",
            chip: "bg-purple-50 text-purple-600",
          },
          {
            label: "Attendance",
            icon: Clock,
            path: "/attendance",
            chip: "bg-sky-50 text-sky-600",
          },
          {
            label: "Settings",
            icon: Settings,
            path: "/settings",
            chip: "bg-gray-100 text-gray-600",
          },
        ].map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.path}
              onClick={() => navigate(action.path)}
              className="hover:border-brand-200 focus-visible:ring-brand-500 group flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2"
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${action.chip}`}
              >
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="text-sm font-medium text-gray-700">{action.label}</span>
            </button>
          );
        })}
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {/* #54 — Active Employees card links through to the employees list
            pre-filtered to status=active. Wrapped in a Link and given
            hover/focus affordances so it's discoverable as a clickable
            surface. */}
        <Link
          to="/employees?status=active"
          className="focus-visible:ring-brand-500 rounded-xl focus:outline-none focus-visible:ring-2"
          aria-label="View active employees"
        >
          <StatCard
            title="Active Employees"
            value={String(totalEmployees)}
            subtitle={`${totalEmployees} total`}
            icon={Users}
            className="h-full cursor-pointer"
          />
        </Link>
        <StatCard
          title="Last Payroll (Gross)"
          value={lastRun ? formatCurrency(lastRun.total_gross) : "—"}
          subtitle={lastRun ? `${MONTHS[lastRun.month]} ${lastRun.year}` : "No payroll yet"}
          icon={Wallet}
          accentClassName="bg-emerald-50 text-emerald-600"
          trend={asTrend(grossDelta)}
          to={lastRun ? `/payroll/runs/${lastRun.id}` : "/payroll/runs"}
          className="h-full"
        />
        <StatCard
          title="Last Payroll (Net)"
          value={lastRun ? formatCurrency(lastRun.total_net) : "—"}
          subtitle={lastRun ? `${MONTHS[lastRun.month]} ${lastRun.year}` : "No payroll yet"}
          icon={TrendingUp}
          accentClassName="bg-sky-50 text-sky-600"
          trend={asTrend(netDelta)}
          to={lastRun ? `/payroll/runs/${lastRun.id}` : "/payroll/runs"}
          className="h-full"
        />
        {/* #314 — Card was previously inert; HR wanted it to drill into the
            breakdown. Link to the latest run's detail page where the per-
            component deduction split (PF / ESI / PT / TDS) is rendered. */}
        {lastRun ? (
          <Link
            to={`/payroll/runs/${lastRun.id}`}
            aria-label="View total deductions breakdown for the latest payroll run"
          >
            <StatCard
              title="Total Deductions"
              value={formatCurrency(lastRun.total_deductions)}
              subtitle="PF + ESI + PT + TDS"
              icon={AlertCircle}
              accentClassName="bg-amber-50 text-amber-600"
              className="h-full cursor-pointer"
            />
          </Link>
        ) : (
          <StatCard
            title="Total Deductions"
            value="—"
            subtitle="PF + ESI + PT + TDS"
            icon={AlertCircle}
            accentClassName="bg-amber-50 text-amber-600"
          />
        )}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Payroll trend */}
        <Card className="lg:col-span-2">
          <CardHeader className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>Monthly Payroll Trend</CardTitle>
              <p className="mt-0.5 text-sm text-gray-500">
                {trendData.length > 0
                  ? `Gross vs net over the last ${trendData.length} ${
                      trendData.length === 1 ? "month" : "months"
                    }`
                  : "Gross vs net payroll cost"}
              </p>
            </div>
            <div className="hidden items-center gap-4 sm:flex">
              <LegendDot color={GROSS_COLOR} label="Gross" />
              <LegendDot color={NET_COLOR} label="Net" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={trendData}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                    barGap={6}
                    barCategoryGap="24%"
                  >
                    <defs>
                      <linearGradient id="grossGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366F1" stopOpacity={1} />
                        <stop offset="100%" stopColor="#818CF8" stopOpacity={0.85} />
                      </linearGradient>
                      <linearGradient id="netGrad" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#C7D2FE" stopOpacity={1} />
                        <stop offset="100%" stopColor="#E0E7FF" stopOpacity={0.9} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#eef0f4" vertical={false} />
                    <XAxis
                      dataKey="month"
                      tick={{ fontSize: 12, fill: "#94a3b8" }}
                      axisLine={false}
                      tickLine={false}
                      dy={8}
                    />
                    <YAxis
                      tick={{ fontSize: 12, fill: "#94a3b8" }}
                      tickFormatter={formatAxisAmount}
                      axisLine={false}
                      tickLine={false}
                      width={52}
                    />
                    <Tooltip
                      content={<PayrollChartTooltip />}
                      cursor={{ fill: "rgba(99,102,241,0.06)" }}
                    />
                    <Bar
                      dataKey="gross"
                      name="Gross"
                      fill="url(#grossGrad)"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={46}
                    />
                    <Bar
                      dataKey="net"
                      name="Net"
                      fill="url(#netGrad)"
                      radius={[6, 6, 0, 0]}
                      maxBarSize={46}
                    />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
                  <div className="rounded-full bg-gray-50 p-3">
                    <TrendingUp className="h-6 w-6 text-gray-300" />
                  </div>
                  <p className="text-sm text-gray-400">
                    No payroll data yet. Run your first payroll to see trends.
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Department headcount */}
        <Card>
          <CardHeader>
            <CardTitle>Headcount by Department</CardTitle>
          </CardHeader>
          <CardContent>
            {sortedDept.length > 0 ? (
              <>
                <div className="relative mx-auto h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      {/* activeIndex=-1 + cursor=false suppress recharts'
                          default click highlight, which painted a translucent
                          rectangle behind the active slice (#252). */}
                      <Pie
                        data={sortedDept}
                        dataKey="count"
                        nameKey="department"
                        cx="50%"
                        cy="50%"
                        outerRadius={82}
                        innerRadius={56}
                        paddingAngle={sortedDept.length > 1 ? 2 : 0}
                        stroke="none"
                        activeIndex={-1}
                        isAnimationActive={false}
                      >
                        {sortedDept.map((_, i) => (
                          <Cell key={i} fill={COLORS[i % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        cursor={false}
                        formatter={(value: number, name: string) => [`${value} employees`, name]}
                        contentStyle={{
                          borderRadius: 8,
                          border: "1px solid rgb(229 231 235)",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                          fontSize: 12,
                        }}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                  {/* Center total — the donut hole doubles as a KPI. */}
                  <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-2xl font-bold text-gray-900">{totalHeadcount}</span>
                    <span className="text-xs font-medium text-gray-400">Employees</span>
                  </div>
                </div>
                <ul className="mt-5 space-y-2.5">
                  {sortedDept.slice(0, 6).map((d, i) => {
                    const pct = totalHeadcount ? Math.round((d.count / totalHeadcount) * 100) : 0;
                    return (
                      <li
                        key={d.department}
                        className="flex items-center justify-between gap-3 text-sm"
                      >
                        <span className="flex min-w-0 items-center gap-2 text-gray-600">
                          <span
                            className="h-2.5 w-2.5 shrink-0 rounded-sm"
                            style={{ background: COLORS[i % COLORS.length] }}
                          />
                          <span className="truncate">{d.department}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-gray-500">
                          <span className="font-semibold text-gray-900">{d.count}</span>
                          <span className="ml-1 text-xs text-gray-400">({pct}%)</span>
                        </span>
                      </li>
                    );
                  })}
                  {sortedDept.length > 6 && (
                    <li className="pt-0.5 text-xs text-gray-400">
                      +{sortedDept.length - 6} more departments
                    </li>
                  )}
                </ul>
              </>
            ) : (
              <div className="flex h-64 flex-col items-center justify-center gap-2 text-center">
                <div className="rounded-full bg-gray-50 p-3">
                  <Building2 className="h-6 w-6 text-gray-300" />
                </div>
                <p className="text-sm text-gray-400">No employees to chart yet.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Activity & Compliance */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RecentActivity />

        {/* Compliance */}
        <Card>
          <CardHeader>
            <CardTitle>
              Compliance Status {lastRun ? `— ${MONTHS[lastRun.month]} ${lastRun.year}` : ""}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {/* #300 — Compliance card sits in a 2-col grid at lg+ so its
                width is narrow. Forcing 4 columns on `sm` then made
                "Provident Fund" / "Professional Tax" / "TDS (Form 24Q)"
                push the icon and badge past the card border. Drop the
                `sm:grid-cols-4` step and add `min-w-0 truncate` so the
                label shrinks rather than overflowing. */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {(
                [
                  { label: "Provident Fund", filed: true },
                  { label: "ESI", filed: true },
                  { label: "Professional Tax", filed: true },
                  { label: "TDS (Form 24Q)", filed: false },
                ] as const
              ).map((item) => (
                <div
                  key={item.label}
                  className={`flex items-center gap-3 rounded-lg border p-4 transition-colors ${
                    item.filed ? "border-gray-100 bg-white" : "border-amber-100 bg-amber-50/50"
                  }`}
                >
                  {item.filed ? (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-50">
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    </span>
                  ) : (
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-50">
                      <XCircle className="h-5 w-5 text-red-400" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-gray-900">{item.label}</p>
                    <Badge variant={item.filed ? "approved" : "pending"}>
                      {item.filed ? "Filed" : "Pending"}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/** Small colour swatch + label used in the trend-chart header legend. */
function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs font-medium text-gray-500">
      <span className="h-2.5 w-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  );
}

/** Styled Recharts tooltip for the payroll trend chart. */
function PayrollChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white px-3 py-2 shadow-lg">
      <p className="mb-1.5 text-xs font-semibold text-gray-900">{label}</p>
      <div className="space-y-1">
        {payload.map((p: any) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-6 text-xs">
            <span className="flex items-center gap-1.5 text-gray-500">
              <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
              {p.name}
            </span>
            <span className="font-semibold tabular-nums text-gray-900">
              {formatCurrency(p.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

const ACTIVITY_ICONS: Record<string, any> = {
  "employee.created": UserPlus,
  "payroll.created": Play,
  "payroll.computed": Play,
  "payroll.approved": CheckCircle2,
  "payroll.paid": CreditCard,
  "payslip.sent": Wallet,
};

function RecentActivity() {
  const user = getUser();
  const { data: res } = useQuery({
    queryKey: ["activity", user?.orgId],
    queryFn: () => apiGet<any>(`/organizations/${user?.orgId}/activity`, { limit: 10 }),
    enabled: !!user?.orgId,
  });

  const activities = (res?.data?.data?.data || res?.data?.data || []) as any[];

  // BUG-027 — Drop the seeded "Payroll computed for 10 employees /
  // 10 employees onboarded / System initialized" placeholder list.
  // It was indistinguishable from real activity for tenants who had
  // never wired up the audit log, and several customers escalated
  // the bogus "10 employees" line as a real metric inconsistency.
  // Render real audit rows when present; otherwise show an honest
  // empty state so users know there's simply nothing to display yet
  // rather than seeing demo data dressed up as production.
  const ACTION_LABELS: Record<string, string> = {
    "payroll_run.created": "Payroll run created",
    "payroll_run.computed": "Payroll computed",
    "payroll_run.approved": "Payroll approved",
    "payroll_run.paid": "Payroll marked paid",
    "payroll_run.cancelled": "Payroll cancelled",
    "payroll_run.reverted_to_draft": "Payroll reverted to draft",
    "payroll_run.rerun": "Payroll re-run",
    "payroll_run.deleted": "Payroll run deleted",
  };
  const items = activities.map((a: any) => ({
    icon: ACTIVITY_ICONS[a.action] || Clock,
    text: ACTION_LABELS[a.action] || String(a.action || "Activity").replace(/\./g, " → "),
    time: a.created_at
      ? new Date(a.created_at).toLocaleString("en-IN", {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        })
      : "—",
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" /> Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
            <div className="rounded-full bg-gray-50 p-3">
              <Clock className="h-6 w-6 text-gray-300" />
            </div>
            <p className="text-sm text-gray-400">No recent activity yet.</p>
          </div>
        ) : (
          <ul className="-my-1">
            {items.slice(0, 8).map((item: any, i: number) => {
              const Icon = item.icon;
              const isLast = i === Math.min(items.length, 8) - 1;
              return (
                <li key={i} className="relative flex gap-3 pb-4 last:pb-0">
                  {/* Timeline rail connecting the activity dots. */}
                  {!isLast && (
                    <span className="absolute left-[15px] top-8 h-[calc(100%-1.5rem)] w-px bg-gray-100" />
                  )}
                  <div className="z-10 mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 ring-4 ring-white">
                    <Icon className="h-3.5 w-3.5 text-gray-500" />
                  </div>
                  <div className="flex-1 pt-1">
                    <p className="text-sm capitalize text-gray-700">{item.text}</p>
                    <p className="text-xs text-gray-400">{item.time}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
