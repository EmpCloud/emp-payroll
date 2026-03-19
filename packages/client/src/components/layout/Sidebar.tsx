import { NavLink } from "react-router-dom";
import { getUser, logout } from "@/api/auth";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Users,
  Wallet,
  Play,
  FileText,
  Calculator,
  CalendarDays,
  Settings,
  LogOut,
  DollarSign,
  BarChart3,
  ScrollText,
  Receipt,
  Calendar,
  TreePalm,
  Network,
  Activity,
  Banknote,
  User,
  IndianRupee,
  ClipboardList,
  Megaphone,
  UserMinus,
} from "lucide-react";

type Role = "hr_admin" | "hr_manager" | "employee";

interface NavItem {
  to: string;
  label: string;
  icon: any;
  roles?: Role[]; // if undefined, visible to all
  section?: string;
}

const navItems: NavItem[] = [
  // Admin items
  {
    to: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: ["hr_admin", "hr_manager"],
  },
  {
    to: "/employees",
    label: "Employees",
    icon: Users,
    roles: ["hr_admin", "hr_manager"],
    section: "People",
  },
  {
    to: "/employees/org-chart",
    label: "Org Chart",
    icon: Network,
    roles: ["hr_admin", "hr_manager"],
  },
  {
    to: "/payroll/structures",
    label: "Structures",
    icon: Wallet,
    roles: ["hr_admin", "hr_manager"],
    section: "Payroll",
  },
  { to: "/payroll/runs", label: "Payroll Runs", icon: Play, roles: ["hr_admin", "hr_manager"] },
  {
    to: "/payroll/analytics",
    label: "Analytics",
    icon: BarChart3,
    roles: ["hr_admin", "hr_manager"],
  },
  { to: "/payslips", label: "Payslips", icon: FileText, roles: ["hr_admin", "hr_manager"] },
  {
    to: "/tax",
    label: "Tax",
    icon: Calculator,
    roles: ["hr_admin", "hr_manager"],
    section: "Compliance",
  },
  { to: "/attendance", label: "Attendance", icon: CalendarDays, roles: ["hr_admin", "hr_manager"] },
  { to: "/leaves", label: "Leaves", icon: TreePalm, roles: ["hr_admin", "hr_manager"] },
  {
    to: "/reimbursements",
    label: "Reimbursements",
    icon: Receipt,
    roles: ["hr_admin", "hr_manager"],
  },
  { to: "/loans", label: "Loans", icon: Banknote, roles: ["hr_admin", "hr_manager"] },
  { to: "/holidays", label: "Holidays", icon: Calendar, roles: ["hr_admin", "hr_manager"] },
  {
    to: "/announcements",
    label: "Announcements",
    icon: Megaphone,
    roles: ["hr_admin", "hr_manager"],
  },
  { to: "/exits", label: "Exits / FnF", icon: UserMinus, roles: ["hr_admin", "hr_manager"] },
  {
    to: "/reports",
    label: "Reports",
    icon: FileText,
    roles: ["hr_admin", "hr_manager"],
    section: "Admin",
  },
  { to: "/audit", label: "Audit Log", icon: ScrollText, roles: ["hr_admin"] },
  { to: "/system", label: "System", icon: Activity, roles: ["hr_admin"] },
  { to: "/settings", label: "Settings", icon: Settings, roles: ["hr_admin"] },

  // Self-service items (for employees — also visible to admins under "My" section)
  { to: "/my", label: "My Dashboard", icon: LayoutDashboard, section: "Self-Service" },
  { to: "/my/payslips", label: "My Payslips", icon: FileText },
  { to: "/my/salary", label: "My Salary", icon: IndianRupee },
  { to: "/my/tax", label: "My Tax", icon: Calculator },
  { to: "/my/declarations", label: "Declarations", icon: ClipboardList },
  { to: "/my/reimbursements", label: "My Claims", icon: Receipt },
  { to: "/my/profile", label: "My Profile", icon: User },
];

export function Sidebar() {
  const user = getUser();
  const role = (user?.role || "employee") as Role;

  const visibleItems = navItems.filter((item) => {
    if (!item.roles) return true; // visible to all
    return item.roles.includes(role);
  });

  // Group by section
  let lastSection = "";

  return (
    <aside className="flex h-screen w-64 flex-col border-r border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 border-b border-gray-100 px-6 dark:border-gray-800">
        <div className="bg-brand-600 flex h-9 w-9 items-center justify-center rounded-lg">
          <DollarSign className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900 dark:text-white">EMP Payroll</p>
          <p className="text-xs text-gray-400">
            {role === "hr_admin" ? "Admin" : role === "hr_manager" ? "Manager" : "Employee"}
          </p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {visibleItems.map((item) => {
          const showSection = item.section && item.section !== lastSection;
          if (item.section) lastSection = item.section;
          return (
            <div key={item.to}>
              {showSection && (
                <p className="mb-1 mt-4 px-3 text-[10px] font-semibold uppercase tracking-wider text-gray-400 first:mt-0">
                  {item.section}
                </p>
              )}
              <NavLink
                to={item.to}
                end={item.to === "/my"}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-brand-50 text-brand-700 dark:bg-brand-950 dark:text-brand-400"
                      : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-white",
                  )
                }
              >
                <item.icon className="h-4.5 w-4.5 shrink-0" />
                {item.label}
              </NavLink>
            </div>
          );
        })}
      </nav>

      {/* User info + Logout */}
      <div className="border-t border-gray-100 p-3 dark:border-gray-800">
        {user && (
          <div className="mb-2 px-3 py-1">
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              {user.firstName} {user.lastName}
            </p>
            <p className="text-xs text-gray-400">{user.email}</p>
          </div>
        )}
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-900"
        >
          <LogOut className="h-4.5 w-4.5" />
          Logout
        </button>
      </div>
    </aside>
  );
}
