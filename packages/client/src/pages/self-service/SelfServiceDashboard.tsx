import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Modal } from "@/components/ui/Modal";
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
import { formatDate, htmlToPlainText, sanitizeRichHtml } from "@/lib/utils";

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

const PRIORITY_COLORS: Record<string, string> = {
  low: "bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200",
  normal: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  high: "bg-orange-100 text-orange-700 dark:bg-orange-950/50 dark:text-orange-300",
  urgent: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
};

function AnnouncementsWidget() {
  const { data: res } = useQuery({
    queryKey: ["announcements-widget"],
    queryFn: () => apiGet<any>("/announcements", { limit: "5" }),
  });
  const [openAnn, setOpenAnn] = useState<any>(null);

  const announcements = res?.data || [];
  if (announcements.length === 0) return null;

  return (
    <Card className="dark:border-gray-800 dark:bg-gray-900">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 dark:text-gray-100">
          <Megaphone className="h-5 w-5" /> Company Announcements
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {announcements.map((a: any) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setOpenAnn(a)}
              className={`w-full rounded-lg border p-3 text-left transition-colors ${
                a.is_pinned
                  ? "border-brand-200 bg-brand-50/40 dark:border-brand-900 dark:bg-brand-950/30"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:hover:border-gray-700 dark:hover:bg-gray-800/50"
              }`}
            >
              <div className="mb-1 flex items-center gap-2">
                {/* #298 — is_pinned is a MySQL TINYINT, so the bare && renders "0". */}
                {!!a.is_pinned && (
                  <Pin className="text-brand-600 dark:text-brand-400 h-3.5 w-3.5 shrink-0" />
                )}
                <h4 className="flex-1 text-sm font-semibold text-gray-900 dark:text-gray-100">
                  {a.title}
                </h4>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[a.priority] || PRIORITY_COLORS.normal}`}
                >
                  {a.priority}
                </span>
              </div>
              <p className="line-clamp-2 text-sm text-gray-600 dark:text-gray-300">
                {htmlToPlainText(a.content)}
              </p>
              <div className="mt-1.5 flex items-center justify-between">
                <p className="text-xs text-gray-400 dark:text-gray-500">
                  {a.author_name} &middot; {formatDate(a.created_at)}
                </p>
                <span className="text-brand-600 dark:text-brand-400 inline-flex items-center gap-1 text-xs font-medium">
                  Read more <ArrowRight className="h-3 w-3" />
                </span>
              </div>
            </button>
          ))}
        </div>
      </CardContent>

      {/* Full announcement — a focused, readable view. Renders the sanitized
          rich content (formatting preserved, no leaked tags). */}
      <Modal
        open={!!openAnn}
        onClose={() => setOpenAnn(null)}
        title={openAnn?.title || "Announcement"}
        description={
          openAnn ? `${openAnn.author_name} · ${formatDate(openAnn.created_at)}` : undefined
        }
        className="max-w-2xl"
      >
        {openAnn && (
          <div>
            <span
              className={`mb-3 inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                PRIORITY_COLORS[openAnn.priority] || PRIORITY_COLORS.normal
              }`}
            >
              {openAnn.priority} priority
            </span>
            <div
              className="[&_a]:text-brand-600 text-sm leading-relaxed text-gray-700 dark:text-gray-200 [&_a]:underline [&_b]:font-semibold [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:font-semibold [&_ol]:mb-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:mb-2 [&_strong]:font-semibold [&_ul]:mb-2 [&_ul]:list-disc [&_ul]:pl-5"
              dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(openAnn.content) }}
            />
          </div>
        )}
      </Modal>
    </Card>
  );
}
