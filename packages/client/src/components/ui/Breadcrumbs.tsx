import { Link, useLocation } from "react-router-dom";
import { ChevronRight, Home } from "lucide-react";
import { useTranslation } from "react-i18next";

const ROUTE_LABELS: Record<string, string> = {
  dashboard: "sidebar.items.dashboard",
  employees: "sidebar.items.employees",
  "org-chart": "sidebar.items.orgChart",
  new: "breadcrumbs.addNew",
  payroll: "sidebar.sections.payroll",
  structures: "breadcrumbs.salaryStructures",
  runs: "sidebar.items.payrollRuns",
  analytics: "sidebar.items.analytics",
  payslips: "sidebar.items.payslips",
  tax: "sidebar.items.tax",
  calculator: "sidebar.items.taxCalculator",
  attendance: "sidebar.items.attendance",
  reports: "sidebar.items.reports",
  reimbursements: "sidebar.items.reimbursements",
  audit: "sidebar.items.auditLog",
  settings: "sidebar.items.settings",
  my: "breadcrumbs.myPortal",
  salary: "breadcrumbs.salary",
  declarations: "sidebar.items.declarations",
  profile: "breadcrumbs.profile",
  onboarding: "breadcrumbs.setup",
  "global-payroll": "sidebar.sections.globalPayroll",
  invoices: "sidebar.items.contractorInvoices",
  compliance: "sidebar.items.countryCompliance",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NUMERIC_ID_RE = /^\d+$/;

function isIdSegment(seg: string): boolean {
  return UUID_RE.test(seg) || NUMERIC_ID_RE.test(seg);
}

export function Breadcrumbs() {
  const { t } = useTranslation();
  const location = useLocation();
  const allSegments = location.pathname.split("/").filter(Boolean);
  const segments = allSegments.filter((seg) => !isIdSegment(seg));

  if (segments.length <= 1) return null;

  const crumbs = segments.map((seg, i) => {
    const path = "/" + segments.slice(0, i + 1).join("/");
    const label = ROUTE_LABELS[seg]
      ? t(ROUTE_LABELS[seg])
      : seg.length > 8
        ? `${seg.slice(0, 8)}...`
        : seg;
    const isLast = i === segments.length - 1;
    return { path, label, isLast };
  });

  return (
    <nav
      aria-label={t("breadcrumbs.home")}
      className="mb-4 flex items-center gap-1 text-sm text-gray-500"
    >
      <Link
        to="/"
        aria-label={t("breadcrumbs.home")}
        className="flex items-center gap-1 hover:text-gray-700"
      >
        <Home className="h-3.5 w-3.5" />
      </Link>
      {crumbs.map((crumb) => (
        <span key={crumb.path} className="flex items-center gap-1">
          <ChevronRight className="h-3.5 w-3.5 text-gray-300" />
          {crumb.isLast ? (
            <span className="font-medium text-gray-900 dark:text-gray-100">{crumb.label}</span>
          ) : (
            <Link to={crumb.path} className="hover:text-gray-700 dark:hover:text-gray-300">
              {crumb.label}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
