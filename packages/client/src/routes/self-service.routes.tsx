import { lazy } from "react";
import { Route } from "react-router-dom";

const SelfServiceDashboard = lazy(() =>
  import("@/pages/self-service/SelfServiceDashboard").then((m) => ({
    default: m.SelfServiceDashboard,
  })),
);
const NotificationsPage = lazy(() =>
  import("@/pages/NotificationsPage").then((m) => ({ default: m.NotificationsPage })),
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
// MyLeavesPage was deleted -- self-service leaves are owned by EmpCloud's
// HRMS app. Employees use the EmpCloud portal for apply / view balance /
// cancel; payroll only consumes the resulting leave_applications rows
// during compute.

export function SelfServiceRoutes() {
  return (
    <>
      <Route path="/my" element={<SelfServiceDashboard />} />
      <Route path="/my/payslips" element={<MyPayslipsPage />} />
      <Route path="/my/salary" element={<MySalaryPage />} />
      <Route path="/my/tax" element={<MyTaxPage />} />
      <Route path="/my/declarations" element={<MyDeclarationsPage />} />
      <Route path="/my/reimbursements" element={<MyReimbursementsPage />} />
      <Route path="/my/profile" element={<MyProfilePage />} />
      <Route path="/notifications" element={<NotificationsPage />} />
    </>
  );
}
