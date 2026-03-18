import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { DataTable } from "@/components/ui/DataTable";
import { CSVImportModal } from "@/components/ui/CSVImportModal";
import { formatCurrency } from "@/lib/utils";
import { useEmployees } from "@/api/hooks";
import { api } from "@/api/client";
import { Plus, Download, Upload, Loader2, Search } from "lucide-react";
import toast from "react-hot-toast";

const columns = [
  {
    key: "name",
    header: "Employee",
    render: (row: any) => (
      <div className="flex items-center gap-3">
        <Avatar name={`${row.first_name} ${row.last_name}`} size="sm" />
        <div>
          <p className="font-medium text-gray-900">{row.first_name} {row.last_name}</p>
          <p className="text-xs text-gray-500">{row.employee_code}</p>
        </div>
      </div>
    ),
  },
  {
    key: "designation",
    header: "Designation",
    render: (row: any) => (
      <div>
        <p className="text-gray-900">{row.designation}</p>
        <p className="text-xs text-gray-500">{row.department}</p>
      </div>
    ),
  },
  {
    key: "email",
    header: "Email",
    render: (row: any) => <span className="text-gray-600">{row.email}</span>,
  },
  {
    key: "date_of_joining",
    header: "Joined",
    render: (row: any) => new Date(row.date_of_joining).toLocaleDateString("en-IN"),
  },
  {
    key: "status",
    header: "Status",
    render: (row: any) => (
      <Badge variant={row.is_active ? "active" : "inactive"}>
        {row.is_active ? "Active" : "Inactive"}
      </Badge>
    ),
  },
];

export function EmployeeListPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: res, isLoading } = useEmployees({ limit: 100 });
  const [showImport, setShowImport] = useState(false);
  const [deptFilter, setDeptFilter] = useState("");
  const [search, setSearch] = useState("");

  const allEmployees = res?.data?.data || [];
  const departments = Array.from(new Set<string>(allEmployees.map((e: any) => e.department))).sort();
  const filtered = deptFilter ? allEmployees.filter((e: any) => e.department === deptFilter) : allEmployees;
  const employees = search
    ? filtered.filter((e: any) => {
        const q = search.toLowerCase();
        return `${e.first_name} ${e.last_name}`.toLowerCase().includes(q) ||
               e.email?.toLowerCase().includes(q) ||
               e.employee_code?.toLowerCase().includes(q) ||
               e.designation?.toLowerCase().includes(q);
      })
    : filtered;
  const total = res?.data?.total || allEmployees.length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Employees"
        description={isLoading ? "Loading..." : `${employees.length}${deptFilter ? ` in ${deptFilter}` : ""} of ${total} employees`}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
              <Upload className="h-4 w-4" /> Import
            </Button>
            <Button variant="outline" size="sm" onClick={async () => {
              try {
                const { data } = await api.get("/employees/export", { responseType: "blob" });
                const url = URL.createObjectURL(new Blob([data]));
                const a = document.createElement("a"); a.href = url; a.download = "employees.csv"; a.click();
                URL.revokeObjectURL(url);
                toast.success("Exported employees CSV");
              } catch { toast.error("Export failed"); }
            }}>
              <Download className="h-4 w-4" /> Export
            </Button>
            <Button size="sm" onClick={() => navigate("/employees/new")}>
              <Plus className="h-4 w-4" /> Add Employee
            </Button>
          </>
        }
      />

      {/* Search */}
      {!isLoading && allEmployees.length > 0 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, email, code, or designation..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          />
        </div>
      )}

      {/* Department filters */}
      {!isLoading && departments.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-gray-500">Filter:</span>
          <button
            onClick={() => setDeptFilter("")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              !deptFilter ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
            }`}
          >
            All
          </button>
          {departments.map((dept: string) => (
            <button
              key={dept}
              onClick={() => setDeptFilter(deptFilter === dept ? "" : dept)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                deptFilter === dept ? "bg-brand-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300"
              }`}
            >
              {dept}
            </button>
          ))}
        </div>
      )}

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={employees}
          onRowClick={(row) => navigate(`/employees/${row.id}`)}
        />
      )}

      <CSVImportModal
        open={showImport}
        onClose={() => setShowImport(false)}
        onSuccess={() => qc.invalidateQueries({ queryKey: ["employees"] })}
      />
    </div>
  );
}
