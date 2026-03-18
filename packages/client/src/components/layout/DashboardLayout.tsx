import { useState, useRef, useEffect } from "react";
import { Outlet, Navigate, useNavigate, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { Search, Loader2, Menu } from "lucide-react";
import { NotificationBell } from "@/components/ui/NotificationBell";
import { ThemeToggle } from "@/components/ui/ThemeToggle";
import { Avatar } from "@/components/ui/Avatar";
import { isLoggedIn, getUser } from "@/api/auth";
import { apiGet } from "@/api/client";

export function DashboardLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();

  if (!isLoggedIn()) return <Navigate to="/login" replace />;

  // Close mobile sidebar on navigation
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);

  const user = getUser();
  const displayName = user ? `${user.firstName} ${user.lastName}` : "User";
  const roleLabel = user?.role === "hr_admin" ? "HR Admin" : user?.role === "hr_manager" ? "HR Manager" : "Employee";

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Desktop sidebar */}
      <div className="hidden lg:block">
        <Sidebar />
      </div>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-black/50" onClick={() => setMobileOpen(false)} />
          <div className="fixed left-0 top-0 z-50 h-full">
            <Sidebar />
          </div>
        </div>
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top bar */}
        <header className="flex h-16 items-center justify-between border-b border-gray-200 bg-white px-4 lg:px-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 lg:hidden"
            >
              <Menu className="h-5 w-5" />
            </button>
            <GlobalSearch />
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <NotificationBell />
            <div className="flex items-center gap-3">
              <Avatar name={displayName} size="sm" />
              <div className="hidden md:block">
                <p className="text-sm font-medium text-gray-900">{displayName}</p>
                <p className="text-xs text-gray-500">{roleLabel}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-8">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  function handleChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (value.length < 2) { setResults([]); setOpen(false); return; }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await apiGet<any>("/employees", { limit: 10 });
        const employees = res.data?.data || [];
        const q = value.toLowerCase();
        const filtered = employees.filter((e: any) =>
          `${e.first_name} ${e.last_name}`.toLowerCase().includes(q) ||
          e.email.toLowerCase().includes(q) ||
          e.employee_code.toLowerCase().includes(q) ||
          e.department.toLowerCase().includes(q)
        );
        setResults(filtered.slice(0, 5));
        setOpen(true);
      } catch { /* ignore */ }
      setLoading(false);
    }, 300);
  }

  return (
    <div className="relative hidden sm:block" ref={ref}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input
        type="text"
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => results.length > 0 && setOpen(true)}
        placeholder="Search employees... (Ctrl+K)"
        className="h-9 w-64 rounded-lg border border-gray-200 bg-gray-50 pl-10 pr-4 text-sm placeholder:text-gray-400 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 lg:w-80"
      />
      {loading && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-gray-400" />}

      {open && results.length > 0 && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg lg:w-80">
          {results.map((emp: any) => (
            <button
              key={emp.id}
              onClick={() => { navigate(`/employees/${emp.id}`); setOpen(false); setQuery(""); }}
              className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50"
            >
              <Avatar name={`${emp.first_name} ${emp.last_name}`} size="sm" />
              <div>
                <p className="text-sm font-medium text-gray-900">{emp.first_name} {emp.last_name}</p>
                <p className="text-xs text-gray-500">{emp.employee_code} &middot; {emp.department}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      {open && query.length >= 2 && results.length === 0 && !loading && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-gray-200 bg-white p-4 text-center text-sm text-gray-400 shadow-lg lg:w-80">
          No results found
        </div>
      )}
    </div>
  );
}
