import { useMemo, useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { StatCard } from "@/components/ui/StatCard";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { useEmployees } from "@/api/hooks";
import { apiGet, apiPost } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Upload,
  CalendarDays,
  UserCheck,
  UserX,
  Clock,
  Loader2,
  PlusCircle,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import toast from "react-hot-toast";

const MONTHS = [
  "",
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

// Default workdays count for a month, used as the prefilled value on the
// Mark All / Mark Attendance modals. Skips weekends; HR can override.
function defaultWorkdays(month: number, year: number): number {
  const daysInMonth = new Date(year, month, 0).getDate();
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month - 1, d).getDay();
    if (dow !== 0 && dow !== 6) count++;
  }
  return count;
}

export function AttendancePage() {
  const qc = useQueryClient();
  const { data: empRes, isLoading: empLoading } = useEmployees({ limit: 1000 });
  const employees = empRes?.data?.data || [];

  // Period selection — default to "today's" month/year. The previous code
  // pinned the values to module load time, so a user keeping the page open
  // across midnight of month-end would silently shift periods. Picking
  // them in component state makes the filter explicit + survives across
  // months without surprises.
  const _today = new Date();
  const [month, setMonth] = useState<number>(_today.getMonth() + 1);
  const [year, setYear] = useState<number>(_today.getFullYear());

  // Filter state
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<string>("");
  const [locationFilter, setLocationFilter] = useState<string>("");

  // Mark modals — prefilled with the currently-selected month/year and
  // a fresh "what happens to this set of records" working-days default.
  const [markAllOpen, setMarkAllOpen] = useState(false);
  const [markSingleOpen, setMarkSingleOpen] = useState(false);
  const [marking, setMarking] = useState(false);

  function shiftMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 1) {
      m = 12;
      y -= 1;
    } else if (m > 12) {
      m = 1;
      y += 1;
    }
    setMonth(m);
    setYear(y);
  }

  // Fetch attendance for all employees in bulk for the SELECTED period.
  const { data: attendanceData, isLoading: attLoading } = useQuery({
    queryKey: ["attendance-all", month, year],
    queryFn: async () => {
      const res = await apiGet<any>("/attendance/summary/bulk", { month, year });
      const records = res.data?.data || [];
      // Enrich with name + department + location from the employees list
      // so the table + filter dropdowns can read everything off one row.
      const empMap = new Map<number, any>(employees.map((e: any) => [e.id, e]));
      return records.map((r: any) => {
        const emp = empMap.get(r.empcloud_user_id);
        return {
          ...r,
          employee_name: emp
            ? `${emp.first_name} ${emp.last_name}`
            : `${r.first_name || ""} ${r.last_name || ""}`.trim() ||
              `Employee #${r.empcloud_user_id}`,
          department: emp?.department || null,
          location: emp?.location || emp?.location_name || null,
          emp_code: emp?.emp_code || r.emp_code || null,
        };
      });
    },
    enabled: employees.length > 0,
  });

  const attendance = attendanceData || [];

  // Distinct departments + locations for filter dropdowns -- read off the
  // attendance rows since the dashboard only shows employees who have a
  // record this period. Prevents the dropdown from showing departments
  // that don't have any employee in the current view.
  const departments = useMemo(() => {
    const set = new Set<string>();
    for (const r of attendance) if (r.department) set.add(r.department);
    return [...set].sort();
  }, [attendance]);
  const locations = useMemo(() => {
    const set = new Set<string>();
    for (const r of attendance) if (r.location) set.add(r.location);
    return [...set].sort();
  }, [attendance]);

  // Apply all filters together — search by name OR emp_code (case-
  // insensitive), department, location.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return attendance.filter((r: any) => {
      if (q) {
        const name = String(r.employee_name || "").toLowerCase();
        const code = String(r.emp_code || "").toLowerCase();
        if (!name.includes(q) && !code.includes(q)) return false;
      }
      if (departmentFilter && r.department !== departmentFilter) return false;
      if (locationFilter && r.location !== locationFilter) return false;
      return true;
    });
  }, [attendance, search, departmentFilter, locationFilter]);

  const isLoading = empLoading || attLoading;

  const totalPresent = filtered.reduce((s: number, a: any) => s + Number(a.present_days || 0), 0);
  const totalAbsent = filtered.reduce((s: number, a: any) => s + Number(a.absent_days || 0), 0);
  const totalLop = filtered.reduce((s: number, a: any) => s + Number(a.lop_days || 0), 0);
  const totalOT = filtered.reduce((s: number, a: any) => s + Number(a.overtime_hours || 0), 0);

  const columns = [
    {
      key: "employee_name",
      header: "Employee",
      render: (row: any) => (
        <div>
          <p className="font-medium text-gray-900">{row.employee_name}</p>
          {(row.emp_code || row.department || row.location) && (
            <p className="text-xs text-gray-500">
              {[row.emp_code, row.department, row.location].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      ),
    },
    { key: "total_days", header: "Working Days", render: (row: any) => row.total_days },
    {
      key: "present_days",
      header: "Present",
      render: (row: any) => <span className="font-medium text-green-600">{row.present_days}</span>,
    },
    {
      key: "absent_days",
      header: "Absent",
      render: (row: any) => (
        <span
          className={Number(row.absent_days) > 0 ? "font-medium text-red-600" : "text-gray-400"}
        >
          {row.absent_days}
        </span>
      ),
    },
    {
      key: "lop_days",
      header: "LOP Days",
      render: (row: any) =>
        Number(row.lop_days) > 0 ? (
          <Badge variant="danger">{row.lop_days} LOP</Badge>
        ) : (
          <span className="text-gray-400">0</span>
        ),
    },
    {
      key: "overtime_hours",
      header: "Overtime (hrs)",
      render: (row: any) =>
        Number(row.overtime_hours) > 0 ? (
          <span className="font-medium text-blue-600">{row.overtime_hours}h</span>
        ) : (
          <span className="text-gray-400">—</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description={`${MONTHS[month]} ${year} attendance summary`}
        actions={
          <div className="flex gap-3">
            <Button variant="outline" size="sm" onClick={() => setMarkAllOpen(true)}>
              <PlusCircle className="h-4 w-4" /> Mark All Present
            </Button>
            <Button size="sm" onClick={() => setMarkSingleOpen(true)}>
              <Upload className="h-4 w-4" /> Mark Attendance
            </Button>
          </div>
        }
      />

      {/* Filter bar — month nav, search, department, location */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => shiftMonth(-1)}
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[140px] text-center text-sm font-medium text-gray-900">
            {MONTHS[month]} {year}
          </span>
          <Button variant="outline" size="sm" onClick={() => shiftMonth(1)} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="search"
            placeholder="Search by name or code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="focus:border-brand-500 focus:ring-brand-500 block w-full rounded-md border border-gray-300 py-2 pl-9 pr-3 text-sm shadow-sm focus:outline-none focus:ring-1"
          />
        </div>

        <select
          value={departmentFilter}
          onChange={(e) => setDepartmentFilter(e.target.value)}
          className="focus:border-brand-500 focus:ring-brand-500 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1"
          aria-label="Filter by department"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        <select
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          className="focus:border-brand-500 focus:ring-brand-500 rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1"
          aria-label="Filter by location"
        >
          <option value="">All locations</option>
          {locations.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>

        {(search || departmentFilter || locationFilter) && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSearch("");
              setDepartmentFilter("");
              setLocationFilter("");
            }}
          >
            Clear filters
          </Button>
        )}

        <span className="ml-auto text-xs text-gray-500">
          {filtered.length} of {attendance.length} employees
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Total Present Days" value={String(totalPresent)} icon={UserCheck} />
        <StatCard title="Total Absent Days" value={String(totalAbsent)} icon={UserX} />
        <StatCard title="LOP Days" value={String(totalLop)} icon={CalendarDays} />
        <StatCard title="Overtime Hours" value={`${totalOT}h`} icon={Clock} />
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
        </div>
      ) : (
        <DataTable columns={columns} data={filtered} />
      )}

      {/* Mark All Present Modal — bulk marks every active employee as present.
          Now asks for the target month/year explicitly so HR can backfill
          historical periods or pre-fill upcoming ones. Defaults to the
          currently-selected dashboard period. */}
      <Modal
        open={markAllOpen}
        onClose={() => setMarkAllOpen(false)}
        title="Mark All Present"
        description="Bulk mark all employees as present for the chosen month."
        className="max-w-lg"
      >
        <MarkAllForm
          employees={employees}
          defaultMonth={month}
          defaultYear={year}
          marking={marking}
          setMarking={setMarking}
          onClose={() => setMarkAllOpen(false)}
          onSuccess={() => qc.invalidateQueries({ queryKey: ["attendance-all"] })}
        />
      </Modal>

      {/* Mark Attendance Modal — record attendance for a single employee. */}
      <Modal
        open={markSingleOpen}
        onClose={() => setMarkSingleOpen(false)}
        title="Mark Attendance"
        description="Record attendance for a single employee."
        className="max-w-lg"
      >
        <MarkSingleForm
          employees={employees}
          defaultMonth={month}
          defaultYear={year}
          marking={marking}
          setMarking={setMarking}
          onClose={() => setMarkSingleOpen(false)}
          onSuccess={() => qc.invalidateQueries({ queryKey: ["attendance-all"] })}
        />
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mark All Present form — extracted so the month/year inputs reset on open
// (mounting fresh inside the Modal each time the user clicks the button).
// ---------------------------------------------------------------------------
function MarkAllForm({
  employees,
  defaultMonth,
  defaultYear,
  marking,
  setMarking,
  onClose,
  onSuccess,
}: {
  employees: any[];
  defaultMonth: number;
  defaultYear: number;
  marking: boolean;
  setMarking: (v: boolean) => void;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [month, setMonth] = useState(defaultMonth);
  const [year, setYear] = useState(defaultYear);
  const [totalDays, setTotalDays] = useState(defaultWorkdays(defaultMonth, defaultYear));

  // Recompute the workdays default whenever month/year changes -- HR
  // explicitly chose a different period, the previous default is stale.
  function setMonthYear(m: number, y: number) {
    setMonth(m);
    setYear(y);
    setTotalDays(defaultWorkdays(m, y));
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const td = Math.floor(Number(totalDays));
        if (!Number.isFinite(td) || td < 1 || td > 31) {
          toast.error("Working days must be a whole number between 1 and 31");
          return;
        }
        if (employees.length === 0) {
          toast.error(
            "No employees found in payroll. Apply EmpCloud users to payroll first (Settings > Employees).",
          );
          return;
        }
        setMarking(true);
        try {
          const records = employees.map((emp: any) => ({
            employeeId: emp.id,
            totalDays: td,
            presentDays: td,
            absentDays: 0,
            lopDays: 0,
            overtimeHours: 0,
            holidays: 0,
            weekoffs: 0,
          }));
          await apiPost("/attendance/import", { month, year, records });
          toast.success(
            `Marked ${employees.length} employees as present for ${td} days in ${MONTHS[month]} ${year}`,
          );
          onClose();
          onSuccess();
        } catch (err: any) {
          toast.error(err.response?.data?.error?.message || "Failed to mark attendance");
        } finally {
          setMarking(false);
        }
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="markAllMonth" className="mb-1 block text-sm font-medium text-gray-700">
            Month
          </label>
          <select
            id="markAllMonth"
            value={month}
            onChange={(e) => setMonthYear(Number(e.target.value), year)}
            className="focus:border-brand-500 focus:ring-brand-500 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1"
          >
            {MONTHS.slice(1).map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <Input
          id="markAllYear"
          label="Year"
          type="number"
          value={year}
          min={2000}
          max={2099}
          onChange={(e) => setMonthYear(month, Number(e.target.value))}
        />
      </div>
      <Input
        id="totalDays"
        name="totalDays"
        label="Working Days in Month"
        type="number"
        min={1}
        max={31}
        step={1}
        value={totalDays}
        onChange={(e) => setTotalDays(Number(e.target.value))}
        required
      />
      <p className="text-sm text-gray-500">
        This will mark all {employees.length} active employees as present for {totalDays} days in{" "}
        {MONTHS[month]} {year}. You can edit individual records afterwards.
      </p>
      <div className="flex justify-end gap-3">
        <Button variant="outline" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={marking}>
          Mark All Present
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Mark single-employee form — month/year picker + employee dropdown + counts.
// ---------------------------------------------------------------------------
function MarkSingleForm({
  employees,
  defaultMonth,
  defaultYear,
  marking,
  setMarking,
  onClose,
  onSuccess,
}: {
  employees: any[];
  defaultMonth: number;
  defaultYear: number;
  marking: boolean;
  setMarking: (v: boolean) => void;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [month, setMonth] = useState(defaultMonth);
  const [year, setYear] = useState(defaultYear);
  const [totalDays, setTotalDays] = useState(defaultWorkdays(defaultMonth, defaultYear));
  const [presentDays, setPresentDays] = useState(defaultWorkdays(defaultMonth, defaultYear));

  function setMonthYear(m: number, y: number) {
    setMonth(m);
    setYear(y);
    const wd = defaultWorkdays(m, y);
    setTotalDays(wd);
    setPresentDays(wd);
  }

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const employeeId = String(fd.get("employeeId") || "");
        const td = Math.floor(Number(totalDays));
        const pd = Number(presentDays);
        const absentDays = Number(fd.get("absentDays") || 0);
        const lopDays = Number(fd.get("lopDays") || 0);
        const overtimeHours = Number(fd.get("overtimeHours") || 0);

        if (!employeeId) {
          toast.error("Please select an employee");
          return;
        }
        if (!Number.isFinite(td) || td < 1 || td > 31) {
          toast.error("Working days must be a whole number between 1 and 31");
          return;
        }
        if (!Number.isFinite(pd) || pd < 0 || pd > td) {
          toast.error("Present days must be between 0 and working days");
          return;
        }

        setMarking(true);
        try {
          await apiPost("/attendance/import", {
            month,
            year,
            records: [
              {
                employeeId,
                totalDays: td,
                presentDays: pd,
                absentDays,
                lopDays,
                overtimeHours,
                holidays: 0,
                weekoffs: 0,
              },
            ],
          });
          toast.success(`Attendance recorded for ${MONTHS[month]} ${year}`);
          onClose();
          onSuccess();
        } catch (err: any) {
          toast.error(err.response?.data?.error?.message || "Failed to mark attendance");
        } finally {
          setMarking(false);
        }
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="markSingleMonth" className="mb-1 block text-sm font-medium text-gray-700">
            Month
          </label>
          <select
            id="markSingleMonth"
            value={month}
            onChange={(e) => setMonthYear(Number(e.target.value), year)}
            className="focus:border-brand-500 focus:ring-brand-500 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1"
          >
            {MONTHS.slice(1).map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <Input
          id="markSingleYear"
          label="Year"
          type="number"
          value={year}
          min={2000}
          max={2099}
          onChange={(e) => setMonthYear(month, Number(e.target.value))}
        />
      </div>
      <div>
        <label htmlFor="employeeId" className="mb-1 block text-sm font-medium text-gray-700">
          Employee
        </label>
        <select
          id="employeeId"
          name="employeeId"
          required
          defaultValue=""
          className="focus:border-brand-500 focus:ring-brand-500 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1"
        >
          <option value="" disabled>
            Select an employee
          </option>
          {employees.map((emp: any) => (
            <option key={emp.id} value={emp.id}>
              {emp.first_name} {emp.last_name}
              {emp.emp_code ? ` (${emp.emp_code})` : ""}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input
          id="totalDays"
          name="totalDays"
          label="Working Days"
          type="number"
          min={1}
          max={31}
          step={1}
          value={totalDays}
          onChange={(e) => setTotalDays(Number(e.target.value))}
          required
        />
        <Input
          id="presentDays"
          name="presentDays"
          label="Present Days"
          type="number"
          min={0}
          max={31}
          step={1}
          value={presentDays}
          onChange={(e) => setPresentDays(Number(e.target.value))}
          required
        />
        <Input
          id="absentDays"
          name="absentDays"
          label="Absent Days"
          type="number"
          min={0}
          max={31}
          step={1}
          defaultValue="0"
        />
        <Input
          id="lopDays"
          name="lopDays"
          label="LOP Days"
          type="number"
          min={0}
          max={31}
          step={1}
          defaultValue="0"
        />
        <Input
          id="overtimeHours"
          name="overtimeHours"
          label="Overtime Hours"
          type="number"
          min={0}
          step="0.1"
          defaultValue="0"
        />
      </div>
      <div className="flex justify-end gap-3">
        <Button variant="outline" type="button" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" loading={marking}>
          Save Attendance
        </Button>
      </div>
    </form>
  );
}
