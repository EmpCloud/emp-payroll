import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatCurrency } from "@/lib/utils";
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
  const paidRuns = runs.filter((r: any) => r.status === "paid");
  const lastRun = paidRuns[0];

  // Department headcount
  const deptMap: Record<string, number> = {};
  for (const emp of employees) {
    deptMap[emp.department] = (deptMap[emp.department] || 0) + 1;
  }
  const departmentHeadcount = Object.entries(deptMap).map(([department, count]) => ({
    department,
    count,
  }));

  // Monthly payroll trend from paid runs
  const trendData = paidRuns
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
        <StatCard
          title="Total Deductions"
          value={lastRun ? formatCurrency(lastRun.total_deductions) : "—"}
          subtitle="PF + ESI + PT + TDS"
          icon={AlertCircle}
        />
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
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickFormatter={(v: number) => `${(v / 100000).toFixed(0)}L`}
                    />
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
                  <Pie
                    data={departmentHeadcount}
                    dataKey="count"
                    nameKey="department"
                    cx="50%"
                    cy="45%"
                    outerRadius={60}
                    innerRadius={30}
                  >
                    {departmentHeadcount.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number, name: string) => [`${value} employees`, name]}
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
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
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
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-400" />
                  )}
                  <div>
                    <p className="text-sm font-medium text-gray-900">{item.label}</p>
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

  const activities = res?.data?.data || [];

  // If no audit logs yet, show a placeholder timeline
  const items =
    activities.length > 0
      ? activities.map((a: any) => ({
          icon: ACTIVITY_ICONS[a.action] || Clock,
          text: a.action.replace(".", " → "),
          time: new Date(a.created_at).toLocaleString("en-IN", {
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
          }),
        }))
      : [
          { icon: CreditCard, text: "Payroll paid for last month", time: "Recently" },
          { icon: CheckCircle2, text: "Payroll approved", time: "Recently" },
          { icon: Play, text: "Payroll computed for 10 employees", time: "Recently" },
          { icon: UserPlus, text: "10 employees onboarded", time: "Recently" },
          { icon: Clock, text: "System initialized", time: "Recently" },
        ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" /> Recent Activity
        </CardTitle>
      </CardHeader>
      <CardContent>
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
      </CardContent>
    </Card>
  );
}
