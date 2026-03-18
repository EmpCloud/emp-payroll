import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { StatCard } from "@/components/ui/StatCard";
import { useEmployees } from "@/api/hooks";
import { apiGet } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { Upload, CalendarDays, UserCheck, UserX, Clock, Loader2 } from "lucide-react";

const now = new Date();
const currentMonth = now.getMonth() + 1;
const currentYear = now.getFullYear();
const MONTHS = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function AttendancePage() {
  const { data: empRes, isLoading: empLoading } = useEmployees({ limit: 1000 });
  const employees = empRes?.data?.data || [];

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
            <Button variant="outline" size="sm">
              <Upload className="h-4 w-4" /> Import CSV
            </Button>
            <Button size="sm">Sync from EmpMonitor</Button>
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
    </div>
  );
}
