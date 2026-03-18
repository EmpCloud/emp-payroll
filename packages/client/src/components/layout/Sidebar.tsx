import { NavLink } from "react-router-dom";
import { logout } from "@/api/auth";
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
} from "lucide-react";

const navItems = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/employees", label: "Employees", icon: Users },
  { to: "/employees/org-chart", label: "Org Chart", icon: Network },
  { to: "/payroll/structures", label: "Structures", icon: Wallet },
  { to: "/payroll/runs", label: "Payroll Runs", icon: Play },
  { to: "/payroll/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/payslips", label: "Payslips", icon: FileText },
  { to: "/tax", label: "Tax", icon: Calculator },
  { to: "/attendance", label: "Attendance", icon: CalendarDays },
  { to: "/leaves", label: "Leaves", icon: TreePalm },
  { to: "/reimbursements", label: "Reimbursements", icon: Receipt },
  { to: "/holidays", label: "Holidays", icon: Calendar },
  { to: "/reports", label: "Reports", icon: FileText },
  { to: "/audit", label: "Audit Log", icon: ScrollText },
  { to: "/system", label: "System", icon: Activity },
  { to: "/settings", label: "Settings", icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="flex h-screen w-64 flex-col border-r border-gray-200 bg-white">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 border-b border-gray-100 px-6">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600">
          <DollarSign className="h-5 w-5 text-white" />
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900">EMP Payroll</p>
          <p className="text-xs text-gray-400">Open Source HRMS</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-brand-50 text-brand-700"
                  : "text-gray-600 hover:bg-gray-50 hover:text-gray-900",
              )
            }
          >
            <item.icon className="h-5 w-5 shrink-0" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-gray-100 p-3">
        <button
          onClick={logout}
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
        >
          <LogOut className="h-5 w-5" />
          Logout
        </button>
      </div>
    </aside>
  );
}
