import { Outlet, NavLink, Navigate, useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  FileText,
  Wallet,
  Calculator,
  ClipboardList,
  User,
  LogOut,
  DollarSign,
  ArrowLeft,
  Receipt,
  CalendarDays,
} from "lucide-react";
import { Avatar } from "@/components/ui/Avatar";
import { isLoggedIn, getUser, logout } from "@/api/auth";

const navItems = [
  { to: "/my", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/my/payslips", label: "My Payslips", icon: FileText },
  { to: "/my/salary", label: "My Salary", icon: Wallet },
  { to: "/my/tax", label: "My Tax", icon: Calculator },
  { to: "/my/declarations", label: "Declarations", icon: ClipboardList },
  { to: "/my/leaves", label: "My Leaves", icon: CalendarDays },
  { to: "/my/reimbursements", label: "Reimbursements", icon: Receipt },
  { to: "/my/profile", label: "Profile", icon: User },
];

export function SelfServiceLayout() {
  const navigate = useNavigate();

  if (!isLoggedIn()) return <Navigate to="/login" replace />;

  const user = getUser();
  const displayName = user ? `${user.firstName} ${user.lastName}` : "User";
  const subtitle = user ? `${user.department}` : "";
  const isAdmin = user && ["org_admin", "hr_admin", "hr_manager"].includes(user.role);

  return (
    <div className="flex h-screen bg-gray-50">
      <aside className="flex h-screen w-64 flex-col border-r border-gray-200 bg-white">
        {/* Logo */}
        <div className="flex h-16 items-center gap-2.5 border-b border-gray-100 px-6">
          <div className="bg-brand-600 flex h-9 w-9 items-center justify-center rounded-lg">
            <DollarSign className="h-5 w-5 text-white" />
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900">EMP Payroll</p>
            <p className="text-xs text-gray-400">Employee Portal</p>
          </div>
        </div>

        {/* Employee info */}
        <div className="border-b border-gray-100 px-4 py-4">
          <div className="flex items-center gap-3">
            <Avatar name={displayName} />
            <div>
              <p className="text-sm font-medium text-gray-900">{displayName}</p>
              <p className="text-xs text-gray-500">{subtitle}</p>
            </div>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
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
        <div className="space-y-1 border-t border-gray-100 p-3">
          {isAdmin && (
            <button
              onClick={() => navigate("/dashboard")}
              className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
            >
              <ArrowLeft className="h-5 w-5" />
              Admin Panel
            </button>
          )}
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
          >
            <LogOut className="h-5 w-5" />
            Logout
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
