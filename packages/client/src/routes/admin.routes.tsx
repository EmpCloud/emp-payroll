import { lazy } from "react";
import { Route, Navigate } from "react-router-dom";

const NotificationsPage = lazy(() =>
  import("@/pages/NotificationsPage").then((m) => ({ default: m.NotificationsPage })),
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
  import("@/pages/payroll/PayrollAnalyticsPage").then((m) => ({
    default: m.PayrollAnalyticsPage,
  })),
);
const PayslipListPage = lazy(() =>
  import("@/pages/payslips/PayslipListPage").then((m) => ({ default: m.PayslipListPage })),
);
const TaxOverviewPage = lazy(() =>
  import("@/pages/tax/TaxOverviewPage").then((m) => ({ default: m.TaxOverviewPage })),
);
const AdminDeclarationsPage = lazy(() =>
  import("@/pages/tax/AdminDeclarationsPage").then((m) => ({ default: m.AdminDeclarationsPage })),
);
const TaxCalculatorPage = lazy(() =>
  import("@/pages/tax/TaxCalculatorPage").then((m) => ({ default: m.TaxCalculatorPage })),
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
const ReportsPage = lazy(() =>
  import("@/pages/reports/ReportsPage").then((m) => ({ default: m.ReportsPage })),
);
const ReimbursementsPage = lazy(() =>
  import("@/pages/reimbursements/ReimbursementsPage").then((m) => ({
    default: m.ReimbursementsPage,
  })),
);
const HolidaysPage = lazy(() =>
  import("@/pages/holidays/HolidaysPage").then((m) => ({ default: m.HolidaysPage })),
);
// /leaves is owned by EmpCloud (HRMS); the payroll-side leave pages were
// removed. Leave data still feeds payroll via the EmpCloud DB read path
// in payroll.service.ts -- there's just no admin UI for it here anymore.
const SystemHealthPage = lazy(() =>
  import("@/pages/system/SystemHealthPage").then((m) => ({ default: m.SystemHealthPage })),
);
const OrgChartPage = lazy(() =>
  import("@/pages/employees/OrgChartPage").then((m) => ({ default: m.OrgChartPage })),
);
const DepartmentsPage = lazy(() =>
  import("@/pages/departments/DepartmentsPage").then((m) => ({ default: m.DepartmentsPage })),
);
const LoansPage = lazy(() =>
  import("@/pages/loans/LoansPage").then((m) => ({ default: m.LoansPage })),
);
const AnnouncementsPage = lazy(() =>
  import("@/pages/announcements/AnnouncementsPage").then((m) => ({
    default: m.AnnouncementsPage,
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
const EarnedWagePage = lazy(() =>
  import("@/pages/earned-wage/EarnedWagePage").then((m) => ({ default: m.EarnedWagePage })),
);
const InsurancePage = lazy(() =>
  import("@/pages/insurance/InsurancePage").then((m) => ({ default: m.InsurancePage })),
);
const GlobalDashboardPage = lazy(() =>
  import("@/pages/global-payroll/GlobalDashboardPage").then((m) => ({
    default: m.GlobalDashboardPage,
  })),
);
const GlobalEmployeesPage = lazy(() =>
  import("@/pages/global-payroll/GlobalEmployeesPage").then((m) => ({
    default: m.GlobalEmployeesPage,
  })),
);
const GlobalEmployeeDetailPage = lazy(() =>
  import("@/pages/global-payroll/GlobalEmployeeDetailPage").then((m) => ({
    default: m.GlobalEmployeeDetailPage,
  })),
);
const GlobalPayrollRunsPage = lazy(() =>
  import("@/pages/global-payroll/GlobalPayrollRunsPage").then((m) => ({
    default: m.GlobalPayrollRunsPage,
  })),
);
const ContractorInvoicesPage = lazy(() =>
  import("@/pages/global-payroll/ContractorInvoicesPage").then((m) => ({
    default: m.ContractorInvoicesPage,
  })),
);
const CountryCompliancePage = lazy(() =>
  import("@/pages/global-payroll/CountryCompliancePage").then((m) => ({
    default: m.CountryCompliancePage,
  })),
);

export function AdminRoutes() {
  return (
    <>
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/employees" element={<EmployeeListPage />} />
      <Route path="/employees/new" element={<EmployeeCreatePage />} />
      <Route path="/employees/import" element={<EmployeeImportPage />} />
      <Route path="/employees/:id" element={<EmployeeDetailPage />} />
      <Route path="/employees/org-chart" element={<OrgChartPage />} />
      <Route path="/departments" element={<DepartmentsPage />} />
      <Route path="/payroll" element={<Navigate to="/payroll/runs" replace />} />
      <Route path="/payroll/structures" element={<SalaryStructuresPage />} />
      <Route path="/payroll/runs" element={<PayrollRunsPage />} />
      <Route path="/payroll/runs/:id" element={<PayrollRunDetailPage />} />
      <Route path="/payroll/analytics" element={<PayrollAnalyticsPage />} />
      <Route path="/payslips" element={<PayslipListPage />} />
      <Route path="/tax" element={<TaxOverviewPage />} />
      <Route path="/tax/calculator" element={<TaxCalculatorPage />} />
      <Route path="/tax/declarations" element={<AdminDeclarationsPage />} />
      <Route path="/attendance" element={<AttendancePage />} />
      <Route path="/reimbursements" element={<ReimbursementsPage />} />
      <Route path="/holidays" element={<HolidaysPage />} />
      <Route path="/loans" element={<LoansPage />} />
      <Route path="/reports" element={<ReportsPage />} />
      <Route path="/settings" element={<SettingsPage />} />
      <Route path="/audit" element={<AuditLogPage />} />
      <Route path="/system" element={<SystemHealthPage />} />
      <Route path="/announcements" element={<AnnouncementsPage />} />
      <Route path="/benefits" element={<BenefitsPage />} />
      <Route path="/gl-accounting" element={<GLAccountingPage />} />
      <Route path="/pay-equity" element={<PayEquityPage />} />
      <Route path="/benchmarks" element={<BenchmarksPage />} />
      <Route path="/total-rewards" element={<TotalRewardsPage />} />
      <Route path="/earned-wage" element={<EarnedWagePage />} />
      <Route path="/insurance" element={<InsurancePage />} />
      <Route path="/global-payroll" element={<GlobalDashboardPage />} />
      <Route path="/global-payroll/employees" element={<GlobalEmployeesPage />} />
      <Route path="/global-payroll/employees/:id" element={<GlobalEmployeeDetailPage />} />
      <Route path="/global-payroll/runs" element={<GlobalPayrollRunsPage />} />
      <Route path="/global-payroll/invoices" element={<ContractorInvoicesPage />} />
      <Route path="/global-payroll/compliance" element={<CountryCompliancePage />} />
      <Route path="/notifications" element={<NotificationsPage />} />
    </>
  );
}
