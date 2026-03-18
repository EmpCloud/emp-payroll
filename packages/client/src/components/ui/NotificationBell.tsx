import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, CheckCircle2, AlertCircle, FileText, Users, CreditCard } from "lucide-react";
import { getUser } from "@/api/auth";

interface Notification {
  id: string;
  icon: any;
  title: string;
  description: string;
  time: string;
  read: boolean;
  link?: string;
}

function getNotifications(): Notification[] {
  const user = getUser();
  const isAdmin = user?.role === "hr_admin" || user?.role === "hr_manager";
  const now = new Date();
  const month = now.toLocaleString("en-IN", { month: "long" });

  if (isAdmin) {
    return [
      { id: "1", icon: AlertCircle, title: "TDS Filing Due", description: `Form 24Q for Q4 FY 2025-26 is due soon`, time: "Action needed", read: false, link: "/tax" },
      { id: "2", icon: CreditCard, title: `${month} Payroll Pending`, description: "Create and run this month's payroll", time: "This month", read: false, link: "/payroll/runs" },
      { id: "3", icon: CheckCircle2, title: "Last Payroll Completed", description: "All payslips generated and paid", time: "Last month", read: true, link: "/payroll/runs" },
      { id: "4", icon: Users, title: "10 Active Employees", description: "All statutory registrations up to date", time: "System", read: true, link: "/employees" },
    ];
  }

  return [
    { id: "1", icon: FileText, title: "Payslip Available", description: "Your latest payslip is ready to view", time: "Recently", read: false, link: "/my/payslips" },
    { id: "2", icon: AlertCircle, title: "Tax Declaration Reminder", description: "Submit your investment proofs before deadline", time: "This quarter", read: false, link: "/my/declarations" },
    { id: "3", icon: CheckCircle2, title: "Salary Credited", description: "Your salary has been credited to your bank account", time: "Last month", read: true },
  ];
}

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const [notifications] = useState(getNotifications);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const unread = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="relative rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
            {unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl">
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
            {unread > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-600">
                {unread} new
              </span>
            )}
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.map((n) => {
              const Icon = n.icon;
              return (
                <button
                  key={n.id}
                  onClick={() => { if (n.link) navigate(n.link); setOpen(false); }}
                  className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-50 ${
                    !n.read ? "bg-brand-50/30" : ""
                  }`}
                >
                  <div className={`mt-0.5 rounded-full p-1.5 ${!n.read ? "bg-brand-100" : "bg-gray-100"}`}>
                    <Icon className={`h-4 w-4 ${!n.read ? "text-brand-600" : "text-gray-400"}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${!n.read ? "font-semibold text-gray-900" : "font-medium text-gray-700"}`}>
                      {n.title}
                    </p>
                    <p className="text-xs text-gray-500 truncate">{n.description}</p>
                    <p className="mt-0.5 text-xs text-gray-400">{n.time}</p>
                  </div>
                  {!n.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-brand-500" />}
                </button>
              );
            })}
          </div>

          <div className="border-t border-gray-100 p-2">
            <button className="w-full rounded-lg px-3 py-2 text-center text-xs font-medium text-brand-600 hover:bg-brand-50">
              View all notifications
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
