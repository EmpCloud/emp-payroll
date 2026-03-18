import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getUser } from "@/api/auth";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { ThemeProvider } from "@/lib/theme";

// Layouts
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { AuthLayout } from "@/components/layout/AuthLayout";
import { SelfServiceLayout } from "@/components/layout/SelfServiceLayout";

// Auth pages
import { LoginPage } from "@/pages/auth/LoginPage";

// Admin / HR pages
import { DashboardPage } from "@/pages/dashboard/DashboardPage";
import { EmployeeListPage } from "@/pages/employees/EmployeeListPage";
import { EmployeeDetailPage } from "@/pages/employees/EmployeeDetailPage";
import { EmployeeCreatePage } from "@/pages/employees/EmployeeCreatePage";
import { SalaryStructuresPage } from "@/pages/payroll/SalaryStructuresPage";
import { PayrollRunsPage } from "@/pages/payroll/PayrollRunsPage";
import { PayrollRunDetailPage } from "@/pages/payroll/PayrollRunDetailPage";
import { PayslipListPage } from "@/pages/payslips/PayslipListPage";
import { TaxOverviewPage } from "@/pages/tax/TaxOverviewPage";
import { AttendancePage } from "@/pages/attendance/AttendancePage";
import { SettingsPage } from "@/pages/settings/SettingsPage";
import { PayrollAnalyticsPage } from "@/pages/payroll/PayrollAnalyticsPage";
import { NotFoundPage } from "@/pages/NotFoundPage";
import { AuditLogPage } from "@/pages/audit/AuditLogPage";

// Employee self-service pages
import { SelfServiceDashboard } from "@/pages/self-service/SelfServiceDashboard";
import { MyPayslipsPage } from "@/pages/self-service/MyPayslipsPage";
import { MySalaryPage } from "@/pages/self-service/MySalaryPage";
import { MyTaxPage } from "@/pages/self-service/MyTaxPage";
import { MyDeclarationsPage } from "@/pages/self-service/MyDeclarationsPage";
import { MyProfilePage } from "@/pages/self-service/MyProfilePage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 5 * 60 * 1000, retry: 1 },
  },
});

/** Redirects based on role: admins → /dashboard, employees → /my */
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
        <Routes>
          {/* ----- Auth ----- */}
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>

          {/* ----- Root redirect ----- */}
          <Route path="/" element={<RoleRedirect />} />

          {/* ----- Admin / HR Dashboard ----- */}
          <Route element={<DashboardLayout />}>
            <Route path="/dashboard" element={<DashboardPage />} />

            {/* Employees */}
            <Route path="/employees" element={<EmployeeListPage />} />
            <Route path="/employees/new" element={<EmployeeCreatePage />} />
            <Route path="/employees/:id" element={<EmployeeDetailPage />} />

            {/* Payroll */}
            <Route path="/payroll/structures" element={<SalaryStructuresPage />} />
            <Route path="/payroll/runs" element={<PayrollRunsPage />} />
            <Route path="/payroll/runs/:id" element={<PayrollRunDetailPage />} />
            <Route path="/payroll/analytics" element={<PayrollAnalyticsPage />} />

            {/* Payslips */}
            <Route path="/payslips" element={<PayslipListPage />} />

            {/* Tax */}
            <Route path="/tax" element={<TaxOverviewPage />} />

            {/* Attendance */}
            <Route path="/attendance" element={<AttendancePage />} />

            {/* Settings & Audit */}
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/audit" element={<AuditLogPage />} />
          </Route>

          {/* ----- Employee Self-Service Portal ----- */}
          <Route element={<SelfServiceLayout />}>
            <Route path="/my" element={<SelfServiceDashboard />} />
            <Route path="/my/payslips" element={<MyPayslipsPage />} />
            <Route path="/my/salary" element={<MySalaryPage />} />
            <Route path="/my/tax" element={<MyTaxPage />} />
            <Route path="/my/declarations" element={<MyDeclarationsPage />} />
            <Route path="/my/profile" element={<MyProfilePage />} />
          </Route>
          {/* 404 Catch-all */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
    </ThemeProvider>
    </ErrorBoundary>
  );
}
