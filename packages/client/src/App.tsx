import { lazy, Suspense, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getUser, saveAuth, extractSSOToken } from "@/api/auth";
import { apiPost } from "@/api/client";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { KeyboardHelp } from "@/components/ui/KeyboardHelp";
import { ThemeProvider } from "@/lib/theme";
import { Loader2 } from "lucide-react";

// Layouts (eagerly loaded — always needed)
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { SelfServiceLayout } from "@/components/layout/SelfServiceLayout";

// Lazy-loaded pages
const LoginPage = lazy(() =>
  import("@/pages/auth/LoginPage").then((m) => ({ default: m.LoginPage })),
);
const DashboardPage = lazy(() =>
  import("@/pages/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })),
);
const EmployeeListPage = lazy(() =>
  import("@/pages/employees/EmployeeListPage").then((m) => ({ default: m.EmployeeListPage })),
);
const EmployeeDetailPage = lazy(() =>
  import("@/pages/employees/EmployeeDetailPage").then((m) => ({ default: m.EmployeeDetailPage })),
);
const EmployeeCreatePage = lazy(() =>
  import("@/pages/employees/EmployeeCreatePage").then((m) => ({ default: m.EmployeeCreatePage })),
);
const EmployeeImportPage = lazy(() =>
  import("@/pages/employees/EmployeeImportPage").then((m) => ({ default: m.EmployeeImportPage })),
);
const SalaryStructuresPage = lazy(() =>
  import("@/pages/payroll/SalaryStructuresPage").then((m) => ({ default: m.SalaryStructuresPage })),
);
const PayrollRunsPage = lazy(() =>
  import("@/pages/payroll/PayrollRunsPage").then((m) => ({ default: m.PayrollRunsPage })),
);
const PayrollRunDetailPage = lazy(() =>
  import("@/pages/payroll/PayrollRunDetailPage").then((m) => ({ default: m.PayrollRunDetailPage })),
);
const PayrollAnalyticsPage = lazy(() =>
  import("@/pages/payroll/PayrollAnalyticsPage").then((m) => ({ default: m.PayrollAnalyticsPage })),
);
const PayslipListPage = lazy(() =>
  import("@/pages/payslips/PayslipListPage").then((m) => ({ default: m.PayslipListPage })),
);
const TaxOverviewPage = lazy(() =>
  import("@/pages/tax/TaxOverviewPage").then((m) => ({ default: m.TaxOverviewPage })),
);
const AttendancePage = lazy(() =>
  import("@/pages/attendance/AttendancePage").then((m) => ({ default: m.AttendancePage })),
);
const SettingsPage = lazy(() =>
  import("@/pages/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })),
);
const AuditLogPage = lazy(() =>
  import("@/pages/audit/AuditLogPage").then((m) => ({ default: m.AuditLogPage })),
);
const NotFoundPage = lazy(() =>
  import("@/pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage })),
);
const ReportsPage = lazy(() =>
  import("@/pages/reports/ReportsPage").then((m) => ({ default: m.ReportsPage })),
);
const OnboardingPage = lazy(() =>
  import("@/pages/onboarding/OnboardingPage").then((m) => ({ default: m.OnboardingPage })),
);
const ReimbursementsPage = lazy(() =>
  import("@/pages/reimbursements/ReimbursementsPage").then((m) => ({
    default: m.ReimbursementsPage,
  })),
);
const HolidaysPage = lazy(() =>
  import("@/pages/holidays/HolidaysPage").then((m) => ({ default: m.HolidaysPage })),
);
const LeavesPage = lazy(() =>
  import("@/pages/leaves/LeaveManagementPage").then((m) => ({ default: m.LeaveManagementPage })),
);
const MyLeavesPage = lazy(() =>
  import("@/pages/self-service/MyLeavesPage").then((m) => ({ default: m.MyLeavesPage })),
);
const SystemHealthPage = lazy(() =>
  import("@/pages/system/SystemHealthPage").then((m) => ({ default: m.SystemHealthPage })),
);
const OrgChartPage = lazy(() =>
  import("@/pages/employees/OrgChartPage").then((m) => ({ default: m.OrgChartPage })),
);
const LoansPage = lazy(() =>
  import("@/pages/loans/LoansPage").then((m) => ({ default: m.LoansPage })),
);
const AnnouncementsPage = lazy(() =>
  import("@/pages/announcements/AnnouncementsPage").then((m) => ({ default: m.AnnouncementsPage })),
);
const ExitManagementPage = lazy(() =>
  import("@/pages/exits/ExitManagementPage").then((m) => ({ default: m.ExitManagementPage })),
);
const SelfServiceDashboard = lazy(() =>
  import("@/pages/self-service/SelfServiceDashboard").then((m) => ({
    default: m.SelfServiceDashboard,
  })),
);
const MyPayslipsPage = lazy(() =>
  import("@/pages/self-service/MyPayslipsPage").then((m) => ({ default: m.MyPayslipsPage })),
);
const MySalaryPage = lazy(() =>
  import("@/pages/self-service/MySalaryPage").then((m) => ({ default: m.MySalaryPage })),
);
const MyTaxPage = lazy(() =>
  import("@/pages/self-service/MyTaxPage").then((m) => ({ default: m.MyTaxPage })),
);
const MyDeclarationsPage = lazy(() =>
  import("@/pages/self-service/MyDeclarationsPage").then((m) => ({
    default: m.MyDeclarationsPage,
  })),
);
const MyProfilePage = lazy(() =>
  import("@/pages/self-service/MyProfilePage").then((m) => ({ default: m.MyProfilePage })),
);
const MyReimbursementsPage = lazy(() =>
  import("@/pages/self-service/MyReimbursementsPage").then((m) => ({
    default: m.MyReimbursementsPage,
  })),
);
const BenefitsPage = lazy(() =>
  import("@/pages/benefits/BenefitsPage").then((m) => ({ default: m.BenefitsPage })),
);
const GLAccountingPage = lazy(() =>
  import("@/pages/gl-accounting/GLAccountingPage").then((m) => ({ default: m.GLAccountingPage })),
);
const PayEquityPage = lazy(() =>
  import("@/pages/pay-equity/PayEquityPage").then((m) => ({ default: m.PayEquityPage })),
);
const BenchmarksPage = lazy(() =>
  import("@/pages/benchmarks/BenchmarksPage").then((m) => ({ default: m.BenchmarksPage })),
);
const TotalRewardsPage = lazy(() =>
  import("@/pages/total-rewards/TotalRewardsPage").then((m) => ({ default: m.TotalRewardsPage })),
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000, retry: 1 },
  },
});

function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
    </div>
  );
}

function RoleRedirect() {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role === "hr_admin" || user.role === "hr_manager") {
    return <Navigate to="/dashboard" replace />;
  }
  return <Navigate to="/my" replace />;
}

function AdminGuard({ children }: { children: React.ReactNode }) {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== "hr_admin" && user.role !== "hr_manager") {
    return <Navigate to="/my" replace />;
  }
  return <>{children}</>;
}

function AuthGuard({ children }: { children: React.ReactNode }) {
  const user = getUser();
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function SSOGate({ children }: { children: React.ReactNode }) {
  const [ssoToken] = useState(() => extractSSOToken());
  const [ready, setReady] = useState(!ssoToken);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ssoToken) return;

    let cancelled = false;

    (async () => {
      try {
        const res = await apiPost<{
          user: any;
          tokens: { accessToken: string; refreshToken: string };
        }>("/auth/sso", { token: ssoToken });

        if (cancelled) return;

        saveAuth(res.data);

        // Redirect to dashboard after SSO login
        if (window.location.pathname === "/" || window.location.pathname === "/login") {
          window.location.replace("/dashboard");
          return;
        }
        setReady(true);
      } catch (err: any) {
        if (cancelled) return;
        console.error("SSO exchange failed:", err);
        setError("SSO login failed. Please try logging in manually.");
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ssoToken]);

  if (!ready) return <PageLoader />;
  if (error) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <p className="mb-4 text-red-600">{error}</p>
          <a href="/login" className="text-brand-600 underline">
            Go to login
          </a>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <SSOGate>
            <BrowserRouter>
              <CommandPalette />
              <KeyboardHelp />
              <Suspense fallback={<PageLoader />}>
                <Routes>
                  <Route element={<AuthLayout />}>
                    <Route path="/login" element={<LoginPage />} />
                  </Route>

                  <Route path="/" element={<RoleRedirect />} />

                  <Route
                    element={
                      <AdminGuard>
                        <DashboardLayout />
                      </AdminGuard>
                    }
                  >
                    <Route path="/dashboard" element={<DashboardPage />} />
                    <Route path="/employees" element={<EmployeeListPage />} />
                    <Route path="/employees/new" element={<EmployeeCreatePage />} />
                    <Route path="/employees/import" element={<EmployeeImportPage />} />
                    <Route path="/employees/:id" element={<EmployeeDetailPage />} />
                    <Route path="/employees/org-chart" element={<OrgChartPage />} />
                    <Route path="/payroll/structures" element={<SalaryStructuresPage />} />
                    <Route path="/payroll/runs" element={<PayrollRunsPage />} />
                    <Route path="/payroll/runs/:id" element={<PayrollRunDetailPage />} />
                    <Route path="/payroll/analytics" element={<PayrollAnalyticsPage />} />
                    <Route path="/payslips" element={<PayslipListPage />} />
                    <Route path="/tax" element={<TaxOverviewPage />} />
                    <Route path="/attendance" element={<AttendancePage />} />
                    <Route path="/reimbursements" element={<ReimbursementsPage />} />
                    <Route path="/holidays" element={<HolidaysPage />} />
                    <Route path="/loans" element={<LoansPage />} />
                    <Route path="/leaves" element={<LeavesPage />} />
                    <Route path="/reports" element={<ReportsPage />} />
                    <Route path="/settings" element={<SettingsPage />} />
                    <Route path="/audit" element={<AuditLogPage />} />
                    <Route path="/system" element={<SystemHealthPage />} />
                    <Route path="/announcements" element={<AnnouncementsPage />} />
                    <Route path="/exits" element={<ExitManagementPage />} />
                    <Route path="/benefits" element={<BenefitsPage />} />
                    <Route path="/gl-accounting" element={<GLAccountingPage />} />
                    <Route path="/pay-equity" element={<PayEquityPage />} />
                    <Route path="/benchmarks" element={<BenchmarksPage />} />
                    <Route path="/total-rewards" element={<TotalRewardsPage />} />
                  </Route>

                  <Route
                    element={
                      <AuthGuard>
                        <SelfServiceLayout />
                      </AuthGuard>
                    }
                  >
                    <Route path="/my" element={<SelfServiceDashboard />} />
                    <Route path="/my/payslips" element={<MyPayslipsPage />} />
                    <Route path="/my/salary" element={<MySalaryPage />} />
                    <Route path="/my/tax" element={<MyTaxPage />} />
                    <Route path="/my/declarations" element={<MyDeclarationsPage />} />
                    <Route path="/my/reimbursements" element={<MyReimbursementsPage />} />
                    <Route path="/my/leaves" element={<MyLeavesPage />} />
                    <Route path="/my/profile" element={<MyProfilePage />} />
                  </Route>

                  <Route path="/onboarding" element={<OnboardingPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </SSOGate>
        </QueryClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
