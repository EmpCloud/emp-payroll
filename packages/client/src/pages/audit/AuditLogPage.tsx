import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { apiGet } from "@/api/client";
import { getUser } from "@/api/auth";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Clock, UserPlus, Play, CheckCircle2, CreditCard, Settings, FileText, Users } from "lucide-react";

const ACTION_CONFIG: Record<string, { icon: any; color: string; label: string }> = {
  "employee.created": { icon: UserPlus, color: "text-green-600", label: "Employee Created" },
  "employee.updated": { icon: Users, color: "text-blue-600", label: "Employee Updated" },
  "payroll.created": { icon: Play, color: "text-purple-600", label: "Payroll Created" },
  "payroll.computed": { icon: Play, color: "text-indigo-600", label: "Payroll Computed" },
  "payroll.approved": { icon: CheckCircle2, color: "text-green-600", label: "Payroll Approved" },
  "payroll.paid": { icon: CreditCard, color: "text-emerald-600", label: "Payroll Paid" },
  "salary.assigned": { icon: FileText, color: "text-blue-600", label: "Salary Assigned" },
  "settings.updated": { icon: Settings, color: "text-gray-600", label: "Settings Updated" },
};

const columns = [
  {
    key: "action",
    header: "Action",
    render: (row: any) => {
      const config = ACTION_CONFIG[row.action] || { icon: Clock, color: "text-gray-500", label: row.action };
      const Icon = config.icon;
      return (
        <div className="flex items-center gap-2">
          <Icon className={`h-4 w-4 ${config.color}`} />
          <span className="font-medium">{config.label}</span>
        </div>
      );
    },
  },
  {
    key: "entity_type",
    header: "Entity",
    render: (row: any) => (
      <Badge variant="draft">{row.entity_type}</Badge>
    ),
  },
  {
    key: "entity_id",
    header: "Entity ID",
    render: (row: any) => (
      <span className="font-mono text-xs text-gray-500">{row.entity_id?.slice(0, 8) || "—"}</span>
    ),
  },
  {
    key: "user_id",
    header: "User",
    render: (row: any) => (
      <span className="font-mono text-xs text-gray-500">{row.user_id?.slice(0, 8)}...</span>
    ),
  },
  {
    key: "ip_address",
    header: "IP",
    render: (row: any) => row.ip_address || "—",
  },
  {
    key: "created_at",
    header: "Time",
    render: (row: any) => (
      <span className="text-sm text-gray-500">
        {new Date(row.created_at).toLocaleString("en-IN", {
          month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
        })}
      </span>
    ),
  },
];

export function AuditLogPage() {
  const user = getUser();
  const { data: res, isLoading } = useQuery({
    queryKey: ["audit-logs", user?.orgId],
    queryFn: () => apiGet<any>(`/organizations/${user?.orgId}/activity`, { limit: 100 }),
    enabled: !!user?.orgId,
  });

  const logs = res?.data?.data || [];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Log"
        description="Track all actions and changes in your organization"
      />

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
        </div>
      ) : logs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Clock className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-4 text-gray-500">No audit logs yet</p>
            <p className="mt-1 text-sm text-gray-400">Actions like creating employees, running payroll, and changing settings will appear here.</p>
          </CardContent>
        </Card>
      ) : (
        <DataTable columns={columns} data={logs} pageSize={15} />
      )}
    </div>
  );
}
