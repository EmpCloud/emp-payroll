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
  Legend,
} from "recharts";

const COLORS = ["#6366F1", "#818CF8", "#A5B4FC", "#C7D2FE", "#E0E7FF"];
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
  const deptMap: Record<string, number> = {};
  for (const emp of employees) {
    deptMap[emp.department] = (deptMap[emp.department] || 0) + 1;
  }
  const departmentHeadcount = Object.entries(deptMap).map(([department, count]) => ({
    department,
    count,
  }));

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

  const now = new Date();
  const currentMonth = `${MONTHS[now.getMonth() + 1]} ${now.getFullYear()}`;

  return (
    <div className="space-y-8">
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
          header; this tile is relabelled to "Payroll Runs" so it's a
          navigation shortcut to the runs history, not a duplicate action
          (issue #52). */}
      {/* #95 — "Payroll Runs" tile was redundant with the primary "Run
          Payroll" CTA in the page header (both navigated to /payroll/runs).
          Dropped the tile so the action lives in exactly one place. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {[
          {
            label: "Add Employee",
            icon: UserPlus,
            path: "/employees/new",
            color: "bg-green-50 text-green-700",
          },
          {
            label: "View Reports",
            icon: TrendingUp,
            path: "/reports",
            color: "bg-amber-50 text-amber-700",
          },
          {
            label: "Payslips",
            icon: CreditCard,
            path: "/payslips",
            color: "bg-purple-50 text-purple-700",
          },
          {
            label: "Attendance",
            icon: Clock,
            path: "/attendance",
            color: "bg-blue-50 text-blue-700",
          },
          {
            label: "Settings",
            icon: AlertCircle,
            path: "/settings",
            color: "bg-gray-50 text-gray-700",
          },
        ].map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.path}
              onClick={() => navigate(action.path)}
              className={`flex items-center gap-2.5 rounded-xl border border-gray-100 px-4 py-3 text-left transition-all hover:shadow-md dark:border-gray-700 ${action.color}`}
            >
              <Icon className="h-4 w-4" />
              <span className="text-sm font-medium">{action.label}</span>
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
          className="focus-visible:ring-brand-500 rounded-xl transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2"
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
        />
        <StatCard
          title="Last Payroll (Net)"
          value={lastRun ? formatCurrency(lastRun.total_net) : "—"}
          subtitle={lastRun ? `${MONTHS[lastRun.month]} ${lastRun.year}` : "No payroll yet"}
          icon={TrendingUp}
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
              className="h-full cursor-pointer"
            />
          </Link>
        ) : (
          <StatCard
            title="Total Deductions"
            value="—"
            subtitle="PF + ESI + PT + TDS"
            icon={AlertCircle}
          />
        )}
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Payroll trend */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Monthly Payroll Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              {trendData.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={formatAxisAmount} />
                    <Tooltip
                      formatter={(value: number) => formatCurrency(value)}
                      labelStyle={{ fontWeight: 600 }}
                    />
                    <Bar dataKey="gross" name="Gross" fill="#6366F1" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="net" name="Net" fill="#A5B4FC" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex h-full items-center justify-center text-gray-400">
                  No payroll data yet. Run your first payroll to see trends.
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
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  {/* activeIndex=-1 + cursor=false suppress recharts'
                      default click highlight, which painted a translucent
                      rectangle behind the active slice (#252). */}
                  <Pie
                    data={departmentHeadcount}
                    dataKey="count"
                    nameKey="department"
                    cx="50%"
                    cy="45%"
                    outerRadius={60}
                    innerRadius={30}
                    activeIndex={-1}
                    isAnimationActive={false}
                  >
                    {departmentHeadcount.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    cursor={false}
                    formatter={(value: number, name: string) => [`${value} employees`, name]}
                    contentStyle={{
                      borderRadius: 8,
                      border: "1px solid rgb(229 231 235)",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                    }}
                  />
                  <Legend
                    layout="horizontal"
                    verticalAlign="bottom"
                    align="center"
                    formatter={(value: string) => (
                      <span className="text-xs text-gray-600">{value}</span>
                    )}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
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
                  className="flex items-center gap-3 rounded-lg border border-gray-100 p-4"
                >
                  {item.filed ? (
                    <CheckCircle2 className="h-5 w-5 shrink-0 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 shrink-0 text-red-400" />
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
          <div className="py-6 text-center text-sm text-gray-400">No recent activity yet.</div>
        ) : (
          <div className="space-y-4">
            {items.slice(0, 8).map((item: any, i: number) => {
              const Icon = item.icon;
              return (
                <div key={i} className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full bg-gray-100 p-1.5">
                    <Icon className="h-3.5 w-3.5 text-gray-500" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm capitalize text-gray-700">{item.text}</p>
                    <p className="text-xs text-gray-400">{item.time}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
