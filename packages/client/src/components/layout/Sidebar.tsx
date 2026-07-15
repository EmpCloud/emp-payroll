import { useEffect, useMemo, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
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
  Network,
  Activity,
  Banknote,
  User,
  IndianRupee,
  ClipboardList,
  Megaphone,
  UserMinus,
  Heart,
  BookOpen,
  Scale,
  Target,
  Award,
  HandCoins,
  ShieldCheck,
  Globe,
  FileSignature,
  MapPinned,
  ChevronDown,
  Search,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from "lucide-react";

type Role = "org_admin" | "hr_admin" | "hr_manager" | "employee";

interface NavItem {
  to: string;
  label: string;
  icon: any;
  roles?: Role[]; // if undefined, visible to all
  section: string;
}

const APP_VERSION = "v1.0";

// Workflow-oriented IA. Attendance sits under People (operational HR), not
// Compliance. Every item belongs to exactly one section so the nav renders as a
// small set of collapsible groups rather than one long scroll.
const SECTION_ORDER = [
  "Overview",
  "People",
  "Payroll",
  "Compliance",
  "Pay & Benefits",
  "Workplace",
  "Global Payroll",
  "Admin",
  "Self-Service",
] as const;

const SECTION_ICONS: Record<string, any> = {
  Overview: LayoutDashboard,
  People: Users,
  Payroll: Wallet,
  Compliance: ShieldCheck,
  "Pay & Benefits": HandCoins,
  Workplace: Calendar,
  "Global Payroll": Globe,
  Admin: Settings,
  "Self-Service": User,
};

const ADMIN_ROLES: Role[] = ["org_admin", "hr_admin", "hr_manager"];

const navItems: NavItem[] = [
  {
    to: "/dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    roles: ADMIN_ROLES,
    section: "Overview",
  },

  { to: "/employees", label: "Employees", icon: Users, roles: ADMIN_ROLES, section: "People" },
  {
    to: "/employees/org-chart",
    label: "Org Chart",
    icon: Network,
    roles: ADMIN_ROLES,
    section: "People",
  },
  {
    to: "/departments",
    label: "Departments",
    icon: Network,
    roles: ADMIN_ROLES,
    section: "People",
  },
  {
    to: "/attendance",
    label: "Attendance",
    icon: CalendarDays,
    roles: ADMIN_ROLES,
    section: "People",
  },

  {
    to: "/payroll/structures",
    label: "Structures",
    icon: Wallet,
    roles: ADMIN_ROLES,
    section: "Payroll",
  },
  {
    to: "/payroll/runs",
    label: "Payroll Runs",
    icon: Play,
    roles: ADMIN_ROLES,
    section: "Payroll",
  },
  {
    to: "/payroll/analytics",
    label: "Analytics",
    icon: BarChart3,
    roles: ADMIN_ROLES,
    section: "Payroll",
  },
  { to: "/payslips", label: "Payslips", icon: FileText, roles: ADMIN_ROLES, section: "Payroll" },

  { to: "/tax", label: "Tax", icon: Calculator, roles: ADMIN_ROLES, section: "Compliance" },
  {
    to: "/tax/calculator",
    label: "Tax Calculator",
    icon: Calculator,
    roles: ADMIN_ROLES,
    section: "Compliance",
  },
  {
    to: "/tax/declarations",
    label: "Tax Declarations",
    icon: ClipboardList,
    roles: ADMIN_ROLES,
    section: "Compliance",
  },

  {
    to: "/reimbursements",
    label: "Reimbursements",
    icon: Receipt,
    roles: ADMIN_ROLES,
    section: "Pay & Benefits",
  },
  { to: "/loans", label: "Loans", icon: Banknote, roles: ADMIN_ROLES, section: "Pay & Benefits" },
  {
    to: "/benefits",
    label: "Benefits",
    icon: Heart,
    roles: ADMIN_ROLES,
    section: "Pay & Benefits",
  },
  {
    to: "/benchmarks",
    label: "Benchmarks",
    icon: Target,
    roles: ADMIN_ROLES,
    section: "Pay & Benefits",
  },
  {
    to: "/pay-equity",
    label: "Pay Equity",
    icon: Scale,
    roles: ["org_admin", "hr_admin"],
    section: "Pay & Benefits",
  },
  {
    to: "/total-rewards",
    label: "Total Rewards",
    icon: Award,
    roles: ADMIN_ROLES,
    section: "Pay & Benefits",
  },
  {
    to: "/earned-wage",
    label: "Earned Wage Access",
    icon: HandCoins,
    roles: ADMIN_ROLES,
    section: "Pay & Benefits",
  },
  {
    to: "/insurance",
    label: "Insurance",
    icon: ShieldCheck,
    roles: ADMIN_ROLES,
    section: "Pay & Benefits",
  },

  { to: "/holidays", label: "Holidays", icon: Calendar, roles: ADMIN_ROLES, section: "Workplace" },
  {
    to: "/announcements",
    label: "Announcements",
    icon: Megaphone,
    roles: ADMIN_ROLES,
    section: "Workplace",
  },
  { to: "/exits", label: "Exits / FnF", icon: UserMinus, roles: ADMIN_ROLES, section: "Workplace" },

  {
    to: "/global-payroll",
    label: "Global Dashboard",
    icon: Globe,
    roles: ADMIN_ROLES,
    section: "Global Payroll",
  },
  {
    to: "/global-payroll/employees",
    label: "Global Employees",
    icon: Users,
    roles: ADMIN_ROLES,
    section: "Global Payroll",
  },
  {
    to: "/global-payroll/runs",
    label: "Payroll Runs",
    icon: Play,
    roles: ADMIN_ROLES,
    section: "Global Payroll",
  },
  {
    to: "/global-payroll/invoices",
    label: "Contractor Invoices",
    icon: FileSignature,
    roles: ADMIN_ROLES,
    section: "Global Payroll",
  },
  {
    to: "/global-payroll/compliance",
    label: "Country Compliance",
    icon: MapPinned,
    roles: ADMIN_ROLES,
    section: "Global Payroll",
  },

  {
    to: "/gl-accounting",
    label: "GL / Accounting",
    icon: BookOpen,
    roles: ["org_admin", "hr_admin"],
    section: "Admin",
  },
  { to: "/reports", label: "Reports", icon: FileText, roles: ADMIN_ROLES, section: "Admin" },
  {
    to: "/audit",
    label: "Audit Log",
    icon: ScrollText,
    roles: ["org_admin", "hr_admin"],
    section: "Admin",
  },
  {
    to: "/system",
    label: "System",
    icon: Activity,
    roles: ["org_admin", "hr_admin"],
    section: "Admin",
  },
  {
    to: "/settings",
    label: "Settings",
    icon: Settings,
    roles: ["org_admin", "hr_admin"],
    section: "Admin",
  },

  { to: "/my", label: "My Dashboard", icon: LayoutDashboard, section: "Self-Service" },
  { to: "/my/payslips", label: "My Payslips", icon: FileText, section: "Self-Service" },
  { to: "/my/salary", label: "My Salary", icon: IndianRupee, section: "Self-Service" },
  { to: "/my/tax", label: "My Tax", icon: Calculator, section: "Self-Service" },
  { to: "/my/declarations", label: "Declarations", icon: ClipboardList, section: "Self-Service" },
  { to: "/my/reimbursements", label: "My Claims", icon: Receipt, section: "Self-Service" },
  { to: "/my/profile", label: "My Profile", icon: User, section: "Self-Service" },
];

const COLLAPSE_KEY = "payroll.sidebar.collapsed";
const RAIL_KEY = "payroll.sidebar.rail";

// Thin, subtle, hover-revealed scrollbar — keeps the rail/nav clean.
const SCROLLBAR =
  "[scrollbar-width:thin] [scrollbar-color:transparent_transparent] hover:[scrollbar-color:theme(colors.gray.300)_transparent] " +
  "[&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-transparent " +
  "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-transparent " +
  "hover:[&::-webkit-scrollbar-thumb]:bg-gray-300 dark:hover:[&::-webkit-scrollbar-thumb]:bg-gray-700";

const FOCUS =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-1 dark:focus-visible:ring-offset-gray-900";

const roleLabel = (role: Role) =>
  role === "org_admin"
    ? "Org Admin"
    : role === "hr_admin"
      ? "Admin"
      : role === "hr_manager"
        ? "Manager"
        : "Employee";

function initials(first?: string, last?: string) {
  return `${(first?.[0] ?? "").toUpperCase()}${(last?.[0] ?? "").toUpperCase()}` || "U";
}

// Fixed 20×20 optical box so differently-shaped icons never make labels "jump".
function Glyph({ icon: Icon, className }: { icon: any; className?: string }) {
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center">
      <Icon className={cn("h-5 w-5", className)} />
    </span>
  );
}

export function Sidebar() {
  const user = getUser();
  const role = (user?.role || "employee") as Role;
  const { pathname } = useLocation();

  const visibleItems = useMemo(
    () => navItems.filter((item) => !item.roles || item.roles.includes(role)),
    [role],
  );

  const activeTo = useMemo(() => {
    let best: string | null = null;
    for (const item of visibleItems) {
      if (pathname === item.to || pathname.startsWith(item.to + "/")) {
        if (!best || item.to.length > best.length) best = item.to;
      }
    }
    return best;
  }, [visibleItems, pathname]);
  const activeSection = visibleItems.find((i) => i.to === activeTo)?.section;

  const sections = useMemo(
    () =>
      SECTION_ORDER.map((name) => ({
        name,
        items: visibleItems.filter((i) => i.section === name),
      })).filter((s) => s.items.length > 0),
    [visibleItems],
  );

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    let saved: Record<string, boolean> = {};
    try {
      saved = JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "{}");
    } catch {
      saved = {};
    }
    const init: Record<string, boolean> = {};
    for (const s of SECTION_ORDER) init[s] = s in saved ? saved[s] : s !== activeSection;
    return init;
  });
  const toggleSection = (name: string) =>
    setCollapsed((prev) => {
      const next = { ...prev, [name]: !prev[name] };
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  const [rail, setRail] = useState<boolean>(() => {
    try {
      return localStorage.getItem(RAIL_KEY) === "1";
    } catch {
      return false;
    }
  });
  const toggleRail = () =>
    setRail((r) => {
      const next = !r;
      try {
        localStorage.setItem(RAIL_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });

  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing =
        target?.tagName === "INPUT" || target?.tagName === "TEXTAREA" || target?.isContentEditable;
      // ⌘K / Ctrl+K opens search from anywhere; "/" only when not already typing.
      const cmdK = (e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey);
      if (cmdK || (e.key === "/" && !typing)) {
        e.preventDefault();
        if (rail) toggleRail();
        setTimeout(() => searchRef.current?.focus(), 0);
      } else if (e.key === "Escape" && document.activeElement === searchRef.current) {
        setQuery("");
        searchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rail]);

  const q = query.trim().toLowerCase();
  const searchResults = q
    ? visibleItems.filter(
        (i) => i.label.toLowerCase().includes(q) || i.section.toLowerCase().includes(q),
      )
    : null;

  const itemClass = (isActive: boolean) =>
    cn(
      "group flex h-11 items-center gap-3 rounded-md border-l-2 pl-2.5 pr-3 text-[15px] font-medium transition-colors",
      FOCUS,
      isActive
        ? "border-brand-600 bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
        : "border-transparent text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800/70 dark:hover:text-white",
    );
  const glyphClass = (isActive: boolean) =>
    isActive
      ? "text-brand-600 dark:text-brand-300"
      : "text-gray-500 transition-colors group-hover:text-gray-700 dark:text-gray-400 dark:group-hover:text-gray-100";

  return (
    <aside
      className={cn(
        "flex h-screen flex-col border-r border-gray-200 bg-white transition-[width] duration-200 dark:border-gray-800 dark:bg-[#111827]",
        rail ? "w-[76px]" : "w-[300px]",
      )}
    >
      {/* Logo + rail toggle */}
      <div
        className={cn(
          "flex h-[68px] items-center border-b border-gray-100 dark:border-gray-800",
          rail ? "justify-center px-2" : "gap-3 px-5",
        )}
      >
        <div className="bg-brand-600 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
          <DollarSign className="h-5 w-5 text-white" />
        </div>
        {!rail && (
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-bold leading-tight text-gray-900 dark:text-white">
              EMP Payroll
            </p>
            <p className="truncate text-xs text-gray-500 dark:text-gray-400">{roleLabel(role)}</p>
          </div>
        )}
        {!rail && (
          <button
            type="button"
            onClick={toggleRail}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className={cn(
              "rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200",
              FOCUS,
            )}
          >
            <PanelLeftClose className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Search */}
      {!rail && (
        <div className="px-3 pt-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search menu…"
              className={cn(
                "focus:border-brand-400 focus:ring-brand-100 h-11 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-14 text-sm text-gray-900 placeholder-gray-400 outline-none transition-colors focus:bg-white focus:ring-2 dark:border-gray-700 dark:bg-gray-800/60 dark:text-white dark:placeholder-gray-500 dark:focus:bg-gray-800",
              )}
            />
            {query ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className={cn(
                  "absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200",
                  FOCUS,
                )}
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : (
              <kbd className="absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-400 sm:block dark:border-gray-700">
                ⌘K
              </kbd>
            )}
          </div>
        </div>
      )}

      {/* Nav */}
      <nav
        className={cn(
          "flex-1 overflow-y-auto px-3 py-3",
          SCROLLBAR,
          rail ? "space-y-1" : "space-y-2",
        )}
      >
        {rail ? (
          sections.map((section, si) => (
            <div
              key={section.name}
              className={cn(si > 0 && "mt-1 border-t border-gray-100 pt-1 dark:border-gray-800")}
            >
              {section.items.map((item) => {
                const isActive = activeTo === item.to;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end
                    className={cn(
                      "group/rail relative my-0.5 flex h-11 items-center justify-center rounded-md border-l-2 transition-colors",
                      FOCUS,
                      isActive
                        ? "border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300"
                        : "border-transparent text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800/70 dark:hover:text-white",
                    )}
                  >
                    <item.icon className="h-5 w-5 shrink-0" />
                    {/* Hover tooltip */}
                    <span className="pointer-events-none absolute left-full z-50 ml-2 whitespace-nowrap rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white opacity-0 shadow-lg transition-opacity delay-150 duration-150 group-hover/rail:opacity-100 dark:bg-gray-700">
                      {item.label}
                    </span>
                  </NavLink>
                );
              })}
            </div>
          ))
        ) : searchResults ? (
          searchResults.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-gray-400">
              No matches for “{query.trim()}”
            </p>
          ) : (
            searchResults.map((item) => {
              const isActive = activeTo === item.to;
              return (
                <NavLink key={item.to} to={item.to} end className={itemClass(isActive)}>
                  <Glyph icon={item.icon} className={glyphClass(isActive)} />
                  <span className="flex-1 truncate">{item.label}</span>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-gray-400">
                    {item.section}
                  </span>
                </NavLink>
              );
            })
          )
        ) : (
          sections.map((section) => {
            const isCollapsed = collapsed[section.name];
            const hasActive = section.items.some((i) => i.to === activeTo);
            const SectionIcon = SECTION_ICONS[section.name] ?? LayoutDashboard;
            return (
              <div key={section.name}>
                <button
                  type="button"
                  onClick={() => toggleSection(section.name)}
                  aria-expanded={!isCollapsed}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md py-1.5 pl-2.5 pr-2 text-[10px] font-bold uppercase tracking-[0.14em] transition-colors",
                    FOCUS,
                    hasActive
                      ? "text-brand-600 dark:text-brand-400"
                      : "text-gray-400 hover:bg-gray-50 hover:text-gray-500 dark:hover:bg-gray-800/50 dark:hover:text-gray-300",
                  )}
                >
                  <SectionIcon
                    className={cn(
                      "h-4 w-4 shrink-0",
                      hasActive && "text-brand-600 dark:text-brand-400",
                    )}
                  />
                  <span className="flex-1 text-left">{section.name}</span>
                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 transition-transform duration-200",
                      isCollapsed && "-rotate-90",
                    )}
                  />
                </button>
                <div
                  className={cn(
                    "grid transition-[grid-template-rows] duration-200 ease-out",
                    isCollapsed ? "grid-rows-[0fr]" : "grid-rows-[1fr]",
                  )}
                >
                  <div className="overflow-hidden">
                    <div className="mb-1 ml-3.5 mt-0.5 space-y-0.5 border-l border-gray-100 pl-1.5 dark:border-gray-800">
                      {section.items.map((item) => {
                        const isActive = activeTo === item.to;
                        return (
                          <NavLink key={item.to} to={item.to} end className={itemClass(isActive)}>
                            <Glyph icon={item.icon} className={glyphClass(isActive)} />
                            <span className="truncate">{item.label}</span>
                          </NavLink>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </nav>

      {/* Footer hint / expand */}
      {rail ? (
        <button
          type="button"
          onClick={toggleRail}
          title="Expand sidebar"
          aria-label="Expand sidebar"
          className={cn(
            "mx-auto mb-1 mt-1 flex h-9 w-9 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200",
            FOCUS,
          )}
        >
          <PanelLeftOpen className="h-5 w-5" />
        </button>
      ) : (
        <div className="flex items-center justify-between px-4 py-1.5 text-[11px] text-gray-400">
          <span>
            Press <kbd className="rounded border border-gray-200 px-1 dark:border-gray-700">/</kbd>{" "}
            to search
          </span>
          <span className="font-medium">{APP_VERSION}</span>
        </div>
      )}

      {/* User profile + logout */}
      <div className="border-t border-gray-100 p-3 dark:border-gray-800">
        {user && (
          <div className={cn("mb-2 flex items-center gap-2.5", rail ? "justify-center" : "px-1")}>
            <div className="bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-300 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold">
              {initials(user.firstName, user.lastName)}
            </div>
            {!rail && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-gray-900 dark:text-white">
                  {user.firstName} {user.lastName}
                </p>
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                  {roleLabel(role)}
                </p>
              </div>
            )}
          </div>
        )}
        <button
          onClick={logout}
          title="Logout"
          className={cn(
            "flex h-10 items-center gap-3 rounded-lg text-[15px] font-medium text-gray-600 transition-colors hover:bg-red-50 hover:text-red-600 dark:text-gray-300 dark:hover:bg-red-500/10 dark:hover:text-red-400",
            FOCUS,
            rail ? "mx-auto w-10 justify-center" : "w-full px-3",
          )}
        >
          <LogOut className="h-5 w-5 shrink-0" />
          {!rail && "Logout"}
        </button>
      </div>
    </aside>
  );
}
