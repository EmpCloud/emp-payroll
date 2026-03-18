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
const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function AttendancePage() {
  const qc = useQueryClient();
  const { data: empRes, isLoading: empLoading } = useEmployees({ limit: 1000 });
  const employees = empRes?.data?.data || [];
  const [markOpen, setMarkOpen] = useState(false);
  const [marking, setMarking] = useState(false);

  // Fetch attendance for each employee for current month
  const { data: attendanceData, isLoading: attLoading } = useQuery({
    queryKey: ["attendance-all", currentMonth, currentYear],
    queryFn: async () => {
      const results = [];
      for (const emp of employees) {
        try {
          const res = await apiGet<any>(`/attendance/summary/${emp.id}`, { month: currentMonth, year: currentYear });
          if (res.data) {
            results.push({ ...res.data, employee_name: `${emp.first_name} ${emp.last_name}` });
          }
        } catch {
          // No attendance record for this employee
        }
      }
      return results;
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
        <span className={Number(row.absent_days) > 0 ? "font-medium text-red-600" : "text-gray-400"}>{row.absent_days}</span>
      ),
    },
    {
      key: "lop_days",
      header: "LOP Days",
      render: (row: any) => (
        Number(row.lop_days) > 0
          ? <Badge variant="danger">{row.lop_days} LOP</Badge>
          : <span className="text-gray-400">0</span>
      ),
    },
    {
      key: "overtime_hours",
      header: "Overtime (hrs)",
      render: (row: any) => (
        Number(row.overtime_hours) > 0
          ? <span className="font-medium text-blue-600">{row.overtime_hours}h</span>
          : <span className="text-gray-400">—</span>
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
            <Button variant="outline" size="sm" onClick={() => setMarkOpen(true)}>
              <PlusCircle className="h-4 w-4" /> Mark All Present
            </Button>
            <Button size="sm" onClick={() => setMarkOpen(true)}>
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
          <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
        </div>
      ) : (
        <DataTable columns={columns} data={attendance} />
      )}

      {/* Mark Attendance Modal */}
      <Modal open={markOpen} onClose={() => setMarkOpen(false)} title="Mark Attendance" description={`${MONTHS[currentMonth]} ${currentYear}`} className="max-w-lg">
        <form onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const totalDays = Number(fd.get("totalDays"));
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
            await apiPost("/attendance/import", { month: currentMonth, year: currentYear, records });
            toast.success(`Marked ${employees.length} employees as present for ${totalDays} days`);
            setMarkOpen(false);
            qc.invalidateQueries({ queryKey: ["attendance-all"] });
          } catch (err: any) {
            toast.error(err.response?.data?.error?.message || "Failed to mark attendance");
          } finally {
            setMarking(false);
          }
        }} className="space-y-4">
          <Input
            id="totalDays"
            name="totalDays"
            label="Working Days in Month"
            type="number"
            defaultValue="22"
            required
          />
          <p className="text-sm text-gray-500">
            This will mark all {employees.length} active employees as present for the full month.
            You can edit individual records afterwards.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setMarkOpen(false)}>Cancel</Button>
            <Button type="submit" loading={marking}>Mark All Present</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
