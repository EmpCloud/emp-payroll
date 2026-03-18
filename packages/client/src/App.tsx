import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getUser } from "@/api/auth";
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
const LoginPage = lazy(() => import("@/pages/auth/LoginPage").then((m) => ({ default: m.LoginPage })));
const DashboardPage = lazy(() => import("@/pages/dashboard/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const EmployeeListPage = lazy(() => import("@/pages/employees/EmployeeListPage").then((m) => ({ default: m.EmployeeListPage })));
const EmployeeDetailPage = lazy(() => import("@/pages/employees/EmployeeDetailPage").then((m) => ({ default: m.EmployeeDetailPage })));
const EmployeeCreatePage = lazy(() => import("@/pages/employees/EmployeeCreatePage").then((m) => ({ default: m.EmployeeCreatePage })));
const SalaryStructuresPage = lazy(() => import("@/pages/payroll/SalaryStructuresPage").then((m) => ({ default: m.SalaryStructuresPage })));
const PayrollRunsPage = lazy(() => import("@/pages/payroll/PayrollRunsPage").then((m) => ({ default: m.PayrollRunsPage })));
const PayrollRunDetailPage = lazy(() => import("@/pages/payroll/PayrollRunDetailPage").then((m) => ({ default: m.PayrollRunDetailPage })));
const PayrollAnalyticsPage = lazy(() => import("@/pages/payroll/PayrollAnalyticsPage").then((m) => ({ default: m.PayrollAnalyticsPage })));
const PayslipListPage = lazy(() => import("@/pages/payslips/PayslipListPage").then((m) => ({ default: m.PayslipListPage })));
const TaxOverviewPage = lazy(() => import("@/pages/tax/TaxOverviewPage").then((m) => ({ default: m.TaxOverviewPage })));
const AttendancePage = lazy(() => import("@/pages/attendance/AttendancePage").then((m) => ({ default: m.AttendancePage })));
const SettingsPage = lazy(() => import("@/pages/settings/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const AuditLogPage = lazy(() => import("@/pages/audit/AuditLogPage").then((m) => ({ default: m.AuditLogPage })));
const NotFoundPage = lazy(() => import("@/pages/NotFoundPage").then((m) => ({ default: m.NotFoundPage })));
const ReportsPage = lazy(() => import("@/pages/reports/ReportsPage").then((m) => ({ default: m.ReportsPage })));
const OnboardingPage = lazy(() => import("@/pages/onboarding/OnboardingPage").then((m) => ({ default: m.OnboardingPage })));
const ReimbursementsPage = lazy(() => import("@/pages/reimbursements/ReimbursementsPage").then((m) => ({ default: m.ReimbursementsPage })));
const HolidaysPage = lazy(() => import("@/pages/holidays/HolidaysPage").then((m) => ({ default: m.HolidaysPage })));
const LeavesPage = lazy(() => import("@/pages/leaves/LeavesPage").then((m) => ({ default: m.LeavesPage })));
const SystemHealthPage = lazy(() => import("@/pages/system/SystemHealthPage").then((m) => ({ default: m.SystemHealthPage })));
const OrgChartPage = lazy(() => import("@/pages/employees/OrgChartPage").then((m) => ({ default: m.OrgChartPage })));
const SelfServiceDashboard = lazy(() => import("@/pages/self-service/SelfServiceDashboard").then((m) => ({ default: m.SelfServiceDashboard })));
const MyPayslipsPage = lazy(() => import("@/pages/self-service/MyPayslipsPage").then((m) => ({ default: m.MyPayslipsPage })));
const MySalaryPage = lazy(() => import("@/pages/self-service/MySalaryPage").then((m) => ({ default: m.MySalaryPage })));
const MyTaxPage = lazy(() => import("@/pages/self-service/MyTaxPage").then((m) => ({ default: m.MyTaxPage })));
const MyDeclarationsPage = lazy(() => import("@/pages/self-service/MyDeclarationsPage").then((m) => ({ default: m.MyDeclarationsPage })));
const MyProfilePage = lazy(() => import("@/pages/self-service/MyProfilePage").then((m) => ({ default: m.MyProfilePage })));
const MyReimbursementsPage = lazy(() => import("@/pages/self-service/MyReimbursementsPage").then((m) => ({ default: m.MyReimbursementsPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000, retry: 1 },
  },
});

function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
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

export default function App() {
  return (
    <ErrorBoundary>
    <ThemeProvider>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <CommandPalette />
        <KeyboardHelp />
        <Suspense fallback={<PageLoader />}>
        <Routes>
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>

          <Route path="/" element={<RoleRedirect />} />

          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/employees" element={<EmployeeListPage />} />
            <Route path="/employees/new" element={<EmployeeCreatePage />} />
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
            <Route path="/leaves" element={<LeavesPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/audit" element={<AuditLogPage />} />
            <Route path="/system" element={<SystemHealthPage />} />
          </Route>

          <Route element={<SelfServiceLayout />}>
            <Route path="/my" element={<SelfServiceDashboard />} />
            <Route path="/my/payslips" element={<MyPayslipsPage />} />
            <Route path="/my/salary" element={<MySalaryPage />} />
            <Route path="/my/tax" element={<MyTaxPage />} />
            <Route path="/my/declarations" element={<MyDeclarationsPage />} />
            <Route path="/my/reimbursements" element={<MyReimbursementsPage />} />
            <Route path="/my/profile" element={<MyProfilePage />} />
          </Route>

          <Route path="/onboarding" element={<OnboardingPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </Suspense>
      </BrowserRouter>
    </QueryClientProvider>
    </ThemeProvider>
    </ErrorBoundary>
  );
}
