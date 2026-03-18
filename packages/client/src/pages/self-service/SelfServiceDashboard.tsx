import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { formatCurrency, formatMonth } from "@/lib/utils";
import { useSelfDashboard } from "@/api/hooks";
import { getUser } from "@/api/auth";
import { Wallet, IndianRupee, FileText, Calendar, ArrowRight, Loader2 } from "lucide-react";

export function SelfServiceDashboard() {
  const navigate = useNavigate();
  const { data: res, isLoading } = useSelfDashboard();
  const user = getUser();

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>;
  }

  const data = res?.data;
  const emp = data?.employee;
  const salary = data?.currentSalary;
  const latestPayslip = data?.latestPayslip;
  const taxInfo = emp ? (typeof emp.tax_info === "string" ? JSON.parse(emp.tax_info) : emp.tax_info) : {};

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome, ${user?.firstName || emp?.first_name || "User"}!`}
        description="Here's your payroll summary"
      />

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Monthly CTC" value={salary ? formatCurrency(Math.round(salary.ctc / 12)) : "—"} icon={Wallet} />
        <StatCard title="Net Pay (Latest)" value={latestPayslip ? formatCurrency(latestPayslip.net_pay) : "—"} icon={IndianRupee} />
        <StatCard title="Tax Regime" value={taxInfo?.regime === "old" ? "Old Regime" : "New Regime"} icon={FileText} />
        <StatCard
          title="Days at Company"
          value={emp ? `${Math.floor((Date.now() - new Date(emp.date_of_joining).getTime()) / 86400000)}` : "—"}
          icon={Calendar}
        />
      </div>

      {latestPayslip && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Latest Payslip — {formatMonth(latestPayslip.month, latestPayslip.year)}</CardTitle>
              <Badge variant={latestPayslip.status}>{latestPayslip.status}</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <p className="text-sm text-gray-500">Gross Pay</p>
                <p className="text-lg font-semibold text-gray-900">{formatCurrency(latestPayslip.gross_earnings)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Deductions</p>
                <p className="text-lg font-semibold text-red-600">-{formatCurrency(latestPayslip.total_deductions)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500">Net Pay</p>
                <p className="text-lg font-bold text-brand-700">{formatCurrency(latestPayslip.net_pay)}</p>
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
        ].map((link) => (
          <button
            key={link.to}
            onClick={() => navigate(link.to)}
            className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-4 text-left transition-colors hover:border-brand-200 hover:bg-brand-50"
          >
            <div className="rounded-lg bg-brand-50 p-2">
              <link.icon className="h-5 w-5 text-brand-600" />
            </div>
            <span className="text-sm font-medium text-gray-900">{link.label}</span>
            <ArrowRight className="ml-auto h-4 w-4 text-gray-400" />
          </button>
        ))}
      </div>
    </div>
  );
}
