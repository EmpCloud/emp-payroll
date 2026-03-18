import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { apiGet } from "@/api/client";
import { getUser, isLoggedIn } from "@/api/auth";
import { Avatar } from "./Avatar";
import {
  Search, LayoutDashboard, Users, Wallet, Play, FileText,
  Calculator, CalendarDays, Settings, User, ArrowRight,
} from "lucide-react";

interface CommandItem {
  id: string;
  label: string;
  sublabel?: string;
  icon: any;
  action: () => void;
  category: string;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [employees, setEmployees] = useState<any[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Keyboard shortcut
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  // Focus input when opened
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
      inputRef.current?.focus();
      // Load employees for search
      if (isLoggedIn() && employees.length === 0) {
        apiGet<any>("/employees", { limit: 100 }).then((res) => {
          setEmployees(res.data?.data || []);
        }).catch(() => {});
      }
    }
  }, [open]);

  const user = getUser();
  const isAdmin = user?.role === "hr_admin" || user?.role === "hr_manager";

  function go(path: string) { navigate(path); setOpen(false); }

  const pages: CommandItem[] = [
    ...(isAdmin ? [
      { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, action: () => go("/dashboard"), category: "Pages" },
      { id: "employees", label: "Employees", icon: Users, action: () => go("/employees"), category: "Pages" },
      { id: "add-employee", label: "Add Employee", icon: Users, action: () => go("/employees/new"), category: "Actions" },
      { id: "salary-structures", label: "Salary Structures", icon: Wallet, action: () => go("/payroll/structures"), category: "Pages" },
      { id: "payroll-runs", label: "Payroll Runs", icon: Play, action: () => go("/payroll/runs"), category: "Pages" },
      { id: "payroll-analytics", label: "Payroll Analytics", icon: Play, action: () => go("/payroll/analytics"), category: "Pages" },
      { id: "payslips", label: "Payslips", icon: FileText, action: () => go("/payslips"), category: "Pages" },
      { id: "tax", label: "Tax Overview", icon: Calculator, action: () => go("/tax"), category: "Pages" },
      { id: "attendance", label: "Attendance", icon: CalendarDays, action: () => go("/attendance"), category: "Pages" },
      { id: "settings", label: "Settings", icon: Settings, action: () => go("/settings"), category: "Pages" },
    ] : []),
    { id: "my-dashboard", label: "My Dashboard", icon: LayoutDashboard, action: () => go("/my"), category: "Self-Service" },
    { id: "my-payslips", label: "My Payslips", icon: FileText, action: () => go("/my/payslips"), category: "Self-Service" },
    { id: "my-salary", label: "My Salary", icon: Wallet, action: () => go("/my/salary"), category: "Self-Service" },
    { id: "my-tax", label: "My Tax", icon: Calculator, action: () => go("/my/tax"), category: "Self-Service" },
    { id: "my-profile", label: "My Profile", icon: User, action: () => go("/my/profile"), category: "Self-Service" },
  ];

  const empItems: CommandItem[] = employees
    .filter((e: any) => {
      if (!query) return false;
      const q = query.toLowerCase();
      return `${e.first_name} ${e.last_name}`.toLowerCase().includes(q) ||
        e.email.toLowerCase().includes(q) ||
        e.employee_code.toLowerCase().includes(q);
    })
    .slice(0, 5)
    .map((e: any) => ({
      id: `emp-${e.id}`,
      label: `${e.first_name} ${e.last_name}`,
      sublabel: `${e.employee_code} · ${e.department}`,
      icon: User,
      action: () => go(`/employees/${e.id}`),
      category: "Employees",
    }));

  const q = query.toLowerCase();
  const filtered = [
    ...empItems,
    ...pages.filter((p) => !query || p.label.toLowerCase().includes(q)),
  ];

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelected((s) => Math.max(s - 1, 0)); }
    if (e.key === "Enter" && filtered[selected]) { filtered[selected].action(); }
  }

  if (!open) return null;

  // Group by category
  const categories: Record<string, CommandItem[]> = {};
  for (const item of filtered) {
    if (!categories[item.category]) categories[item.category] = [];
    categories[item.category].push(item);
  }

  let idx = -1;

  return (
    <div className="fixed inset-0 z-[100]">
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
      <div className="fixed left-1/2 top-[20%] w-full max-w-lg -translate-x-1/2">
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl">
          <div className="flex items-center gap-3 border-b border-gray-200 px-4">
            <Search className="h-5 w-5 text-gray-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setSelected(0); }}
              onKeyDown={handleKeyDown}
              placeholder="Search pages, employees..."
              className="h-12 flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
            />
            <kbd className="rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-400">ESC</kbd>
          </div>

          <div className="max-h-80 overflow-y-auto p-2">
            {filtered.length === 0 && (
              <p className="py-8 text-center text-sm text-gray-400">No results found</p>
            )}
            {Object.entries(categories).map(([category, items]) => (
              <div key={category}>
                <p className="px-3 py-1.5 text-xs font-medium text-gray-400">{category}</p>
                {items.map((item) => {
                  idx++;
                  const i = idx;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      onClick={item.action}
                      onMouseEnter={() => setSelected(i)}
                      className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                        i === selected ? "bg-brand-50 text-brand-700" : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      <div className="flex-1">
                        <span className="font-medium">{item.label}</span>
                        {item.sublabel && <span className="ml-2 text-xs text-gray-400">{item.sublabel}</span>}
                      </div>
                      <ArrowRight className="h-3 w-3 text-gray-300" />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">
            <span className="mr-3"><kbd className="rounded border px-1">↑↓</kbd> navigate</span>
            <span className="mr-3"><kbd className="rounded border px-1">↵</kbd> select</span>
            <span><kbd className="rounded border px-1">esc</kbd> close</span>
          </div>
        </div>
      </div>
    </div>
  );
}
