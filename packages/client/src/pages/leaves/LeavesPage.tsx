import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { apiGet } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Calendar, TreePalm, Heart, Stethoscope } from "lucide-react";

const LEAVE_ICONS: Record<string, any> = {
  earned: TreePalm,
  casual: Calendar,
  sick: Stethoscope,
};

const LEAVE_COLORS: Record<string, string> = {
  earned: "text-green-600",
  casual: "text-blue-600",
  sick: "text-orange-600",
};

export function LeavesPage() {
  const { data: res, isLoading } = useQuery({
    queryKey: ["org-leaves"],
    queryFn: () => apiGet<any>("/leaves"),
  });

  const employees = res?.data || [];

  // Aggregate totals per leave type
  const totals: Record<string, { total: number; used: number; available: number }> = {};
  for (const emp of employees) {
    for (const bal of emp.balances) {
      if (!totals[bal.leave_type]) totals[bal.leave_type] = { total: 0, used: 0, available: 0 };
      totals[bal.leave_type].total += Number(bal.accrued);
      totals[bal.leave_type].used += Number(bal.used);
      totals[bal.leave_type].available += Number(bal.closing_balance);
    }
  }

  const columns = [
    {
      key: "employee",
      header: "Employee",
      render: (r: any) => (
        <div>
          <p className="font-medium text-gray-900">{r.employeeName}</p>
          <p className="text-xs text-gray-500">{r.employeeCode} &middot; {r.department}</p>
        </div>
      ),
    },
    ...["earned", "casual", "sick"].map((type) => ({
      key: type,
      header: type.charAt(0).toUpperCase() + type.slice(1),
      render: (r: any) => {
        const bal = r.balances.find((b: any) => b.leave_type === type);
        if (!bal) return <span className="text-gray-300">—</span>;
        const used = Number(bal.used);
        const total = Number(bal.accrued);
        const available = Number(bal.closing_balance);
        return (
          <div className="text-sm">
            <span className="font-medium">{available}</span>
            <span className="text-gray-400">/{total}</span>
            {used > 0 && <span className="ml-1 text-xs text-red-500">({used} used)</span>}
          </div>
        );
      },
    })),
    {
      key: "total",
      header: "Total Available",
      render: (r: any) => {
        const total = r.balances.reduce((s: number, b: any) => s + Number(b.closing_balance), 0);
        return <span className="font-semibold text-brand-700">{total} days</span>;
      },
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave Balances"
        description="Employee leave balance tracker for current financial year"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        {Object.entries(totals).map(([type, data]) => {
          const Icon = LEAVE_ICONS[type] || Calendar;
          const color = LEAVE_COLORS[type] || "text-gray-600";
          return (
            <Card key={type}>
              <CardContent className="py-4">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-gray-100 p-2">
                    <Icon className={`h-5 w-5 ${color}`} />
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase text-gray-500">{type} Leave</p>
                    <p className="text-lg font-bold">{data.available} <span className="text-sm font-normal text-gray-400">available</span></p>
                    <p className="text-xs text-gray-400">{data.used} used of {data.total} total (org-wide)</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>
      ) : (
        <Card>
          <CardHeader><CardTitle>Employee Leave Balances</CardTitle></CardHeader>
          <CardContent className="p-0">
            <DataTable columns={columns} data={employees} emptyMessage="No employees found" />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
