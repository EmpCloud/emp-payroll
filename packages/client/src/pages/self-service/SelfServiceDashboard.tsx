import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatCurrency, formatMonth } from "@/lib/utils";
import { useSelfDashboard } from "@/api/hooks";
import { getUser } from "@/api/auth";
import {
  Wallet,
  IndianRupee,
  FileText,
  Calendar,
  ArrowRight,
  Loader2,
  Receipt,
  User,
  Megaphone,
  Pin,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { apiGet } from "@/api/client";
import { formatDate } from "@/lib/utils";

export function SelfServiceDashboard() {
  const navigate = useNavigate();
  const { data: res, isLoading } = useSelfDashboard();
  const user = getUser();

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
      </div>
    );
  }

  const data = res?.data;
  const emp = data?.employee;
  const salary = data?.currentSalary;
  const latestPayslip = data?.latestPayslip;
  const taxInfo = emp
    ? typeof emp.tax_info === "string"
      ? JSON.parse(emp.tax_info)
      : emp.tax_info
    : {};

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.firstName || emp?.first_name || "User"}!`}
        description="Here's your payroll summary"
      />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Monthly CTC"
          value={salary ? formatCurrency(Math.round(salary.ctc / 12)) : "—"}
          icon={Wallet}
        />
        <StatCard
          title="Net Pay (Latest)"
          value={latestPayslip ? formatCurrency(latestPayslip.net_pay) : "—"}
          icon={IndianRupee}
        />
        <StatCard
          title="Tax Regime"
          value={taxInfo?.regime === "old" ? "Old Regime" : "New Regime"}
          icon={FileText}
        />
        <StatCard
          title="Days at Company"
          value={
            emp
              ? `${Math.floor((Date.now() - new Date(emp.date_of_joining).getTime()) / 86400000)}`
              : "—"
          }
          icon={Calendar}
        />
      </div>

      {latestPayslip && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>
                Latest Payslip — {formatMonth(latestPayslip.month, latestPayslip.year)}
              </CardTitle>
              <Badge variant={latestPayslip.status}>{latestPayslip.status}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-sm text-gray-500">Gross Pay</p>
                <p className="text-lg font-semibold text-gray-900">
                  {formatCurrency(latestPayslip.gross_earnings)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Deductions</p>
                <p className="text-lg font-semibold text-red-600">
                  -{formatCurrency(latestPayslip.total_deductions)}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Net Pay</p>
                <p className="text-brand-700 text-lg font-bold">
                  {formatCurrency(latestPayslip.net_pay)}
                </p>
              </div>
              <div className="flex items-end">
                <Button variant="outline" size="sm" onClick={() => navigate("/my/payslips")}>
                  View All <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: "View Salary Breakdown", to: "/my/salary", icon: Wallet },
          { label: "Tax Computation", to: "/my/tax", icon: IndianRupee },
          { label: "Submit Declarations", to: "/my/declarations", icon: FileText },
          { label: "Reimbursements", to: "/my/reimbursements", icon: Receipt },
          { label: "My Profile", to: "/my/profile", icon: User },
        ].map((link) => (
          <button
            key={link.to}
            onClick={() => navigate(link.to)}
            className="hover:border-brand-200 hover:bg-brand-50 flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left transition-colors"
          >
            <div className="bg-brand-50 rounded-lg p-2">
              <link.icon className="text-brand-600 h-5 w-5" />
            </div>
            <span className="text-sm font-medium text-gray-900">{link.label}</span>
            <ArrowRight className="ml-auto h-4 w-4 text-gray-400" />
          </button>
        ))}
      </div>

      {/* Announcements Widget */}
      <AnnouncementsWidget />
    </div>
  );
}

function AnnouncementsWidget() {
  const { data: res } = useQuery({
    queryKey: ["announcements-widget"],
    queryFn: () => apiGet<any>("/announcements", { limit: "5" }),
  });

  const announcements = res?.data || [];
  if (announcements.length === 0) return null;

  const priorityColors: Record<string, string> = {
    low: "bg-gray-100 text-gray-700",
    normal: "bg-blue-100 text-blue-700",
    high: "bg-orange-100 text-orange-700",
    urgent: "bg-red-100 text-red-700",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Megaphone className="h-5 w-5" /> Company Announcements
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {announcements.map((a: any) => (
            <div
              key={a.id}
              className={`rounded-lg border p-3 ${a.is_pinned ? "border-brand-200 bg-brand-50/30" : "border-gray-100"}`}
            >
              <div className="mb-1 flex items-center gap-2">
                {a.is_pinned && <Pin className="text-brand-600 h-3 w-3" />}
                <h4 className="text-sm font-semibold text-gray-900">{a.title}</h4>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${priorityColors[a.priority] || priorityColors.normal}`}
                >
                  {a.priority}
                </span>
              </div>
              <p className="line-clamp-2 text-xs text-gray-600">{a.content}</p>
              <p className="mt-1 text-xs text-gray-400">
                {a.author_name} &middot; {formatDate(a.created_at)}
              </p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
