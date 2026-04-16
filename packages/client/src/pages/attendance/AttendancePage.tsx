import { useState } from "react";
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
import { Upload, CalendarDays, UserCheck, UserX, Clock, Loader2, PlusCircle } from "lucide-react";
import toast from "react-hot-toast";

const now = new Date();
const currentMonth = now.getMonth() + 1;
const currentYear = now.getFullYear();
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

export function AttendancePage() {
  const qc = useQueryClient();
  const { data: empRes, isLoading: empLoading } = useEmployees({ limit: 1000 });
  const employees = empRes?.data?.data || [];
  const [markAllOpen, setMarkAllOpen] = useState(false);
  const [markSingleOpen, setMarkSingleOpen] = useState(false);
  const [marking, setMarking] = useState(false);

  // Fetch attendance for all employees in bulk
  const { data: attendanceData, isLoading: attLoading } = useQuery({
    queryKey: ["attendance-all", currentMonth, currentYear],
    queryFn: async () => {
      const res = await apiGet<any>("/attendance/summary/bulk", {
        month: currentMonth,
        year: currentYear,
      });
      const records = res.data?.data || [];
      // Enrich with employee names from employees list
      const empMap = new Map<number, any>(employees.map((e: any) => [e.id, e]));
      return records.map((r: any) => {
        const emp = empMap.get(r.empcloud_user_id);
        return {
          ...r,
          employee_name: emp
            ? `${emp.first_name} ${emp.last_name}`
            : `${r.first_name || ""} ${r.last_name || ""}`.trim() ||
              `Employee #${r.empcloud_user_id}`,
        };
      });
    },
    enabled: employees.length > 0,
  });

  const attendance = attendanceData || [];
  const isLoading = empLoading || attLoading;

  const totalPresent = attendance.reduce((s: number, a: any) => s + Number(a.present_days || 0), 0);
  const totalAbsent = attendance.reduce((s: number, a: any) => s + Number(a.absent_days || 0), 0);
  const totalLop = attendance.reduce((s: number, a: any) => s + Number(a.lop_days || 0), 0);
  const totalOT = attendance.reduce((s: number, a: any) => s + Number(a.overtime_hours || 0), 0);

  const columns = [
    {
      key: "employee_name",
      header: "Employee",
      render: (row: any) => <span className="font-medium text-gray-900">{row.employee_name}</span>,
    },
    {
      key: "total_days",
      header: "Working Days",
      render: (row: any) => row.total_days,
    },
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
        description={`${MONTHS[currentMonth]} ${currentYear} attendance summary`}
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
        <DataTable columns={columns} data={attendance} />
      )}

      {/* Mark All Present Modal — bulk marks every active employee as present */}
      <Modal
        open={markAllOpen}
        onClose={() => setMarkAllOpen(false)}
        title="Mark All Present"
        description={`Bulk mark all employees as present for ${MONTHS[currentMonth]} ${currentYear}`}
        className="max-w-lg"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const totalDaysRaw = Number(fd.get("totalDays"));
            const totalDays = Math.floor(totalDaysRaw);
            if (!Number.isFinite(totalDays) || totalDays < 1 || totalDays > 31) {
              toast.error("Working days must be a whole number between 1 and 31");
              return;
            }
            setMarking(true);
            try {
              const records = employees.map((emp: any) => ({
                employeeId: emp.id,
                totalDays,
                presentDays: totalDays,
                absentDays: 0,
                lopDays: 0,
                overtimeHours: 0,
                holidays: 0,
                weekoffs: 0,
              }));
              await apiPost("/attendance/import", {
                month: currentMonth,
                year: currentYear,
                records,
              });
              toast.success(
                `Marked ${employees.length} employees as present for ${totalDays} days`,
              );
              setMarkAllOpen(false);
              qc.invalidateQueries({ queryKey: ["attendance-all"] });
            } catch (err: any) {
              toast.error(err.response?.data?.error?.message || "Failed to mark attendance");
            } finally {
              setMarking(false);
            }
          }}
          className="space-y-4"
        >
          <Input
            id="totalDays"
            name="totalDays"
            label="Working Days in Month"
            type="number"
            min={1}
            max={31}
            step={1}
            defaultValue="22"
            required
          />
          <p className="text-sm text-gray-500">
            This will mark all {employees.length} active employees as present for the full month.
            You can edit individual records afterwards.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setMarkAllOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={marking}>
              Mark All Present
            </Button>
          </div>
        </form>
      </Modal>

      {/* Mark Attendance Modal — record attendance for a single employee */}
      <Modal
        open={markSingleOpen}
        onClose={() => setMarkSingleOpen(false)}
        title="Mark Attendance"
        description={`Record attendance for a single employee — ${MONTHS[currentMonth]} ${currentYear}`}
        className="max-w-lg"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const employeeId = String(fd.get("employeeId") || "");
            const totalDaysRaw = Number(fd.get("totalDays"));
            const totalDays = Math.floor(totalDaysRaw);
            const presentDays = Number(fd.get("presentDays"));
            const absentDays = Number(fd.get("absentDays") || 0);
            const lopDays = Number(fd.get("lopDays") || 0);
            const overtimeHours = Number(fd.get("overtimeHours") || 0);

            if (!employeeId) {
              toast.error("Please select an employee");
              return;
            }
            if (!Number.isFinite(totalDays) || totalDays < 1 || totalDays > 31) {
              toast.error("Working days must be a whole number between 1 and 31");
              return;
            }
            if (!Number.isFinite(presentDays) || presentDays < 0 || presentDays > totalDays) {
              toast.error("Present days must be between 0 and working days");
              return;
            }

            setMarking(true);
            try {
              await apiPost("/attendance/import", {
                month: currentMonth,
                year: currentYear,
                records: [
                  {
                    employeeId,
                    totalDays,
                    presentDays,
                    absentDays,
                    lopDays,
                    overtimeHours,
                    holidays: 0,
                    weekoffs: 0,
                  },
                ],
              });
              toast.success("Attendance recorded");
              setMarkSingleOpen(false);
              qc.invalidateQueries({ queryKey: ["attendance-all"] });
            } catch (err: any) {
              toast.error(err.response?.data?.error?.message || "Failed to mark attendance");
            } finally {
              setMarking(false);
            }
          }}
          className="space-y-4"
        >
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
              defaultValue="22"
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
              defaultValue="22"
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
            <Button variant="outline" type="button" onClick={() => setMarkSingleOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={marking}>
              Save Attendance
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
