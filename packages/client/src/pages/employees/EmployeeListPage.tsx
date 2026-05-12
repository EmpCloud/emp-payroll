import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { DataTable } from "@/components/ui/DataTable";
import { CSVImportModal } from "@/components/ui/CSVImportModal";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { Pagination } from "@/components/ui/Pagination";
import { useEmployees, useDepartments, useLocations } from "@/api/hooks";
import { api, apiGet, apiPost } from "@/api/client";
import { Plus, Download, Upload, Loader2, Search, AlertCircle, Check, X } from "lucide-react";
import toast from "react-hot-toast";
import { BulkSalaryUpdateModal } from "@/pages/payroll/BulkSalaryUpdateModal";
import { BulkSalaryCSVModal } from "@/components/ui/BulkSalaryCSVModal";

const PAGE_SIZE = 20;

export function EmployeeListPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const [showImport, setShowImport] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showBulkSalary, setShowBulkSalary] = useState(false);
  const [showBulkSalaryCSV, setShowBulkSalaryCSV] = useState(false);

  // Debounce search input so the server isn't hammered on every keystroke
  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

  // Reset to page 1 whenever any filter changes
  useEffect(() => {
    setPage(1);
  }, [search, departmentId, locationId]);

  const { data: deptRes } = useDepartments();
  const { data: locRes } = useLocations();
  const departments: { id: string; name: string }[] = Array.isArray(deptRes?.data)
    ? deptRes.data
    : [];
  const locations: { id: string; name: string }[] = Array.isArray(locRes?.data) ? locRes.data : [];

  const queryParams: Record<string, any> = { page, limit: PAGE_SIZE };
  if (search) queryParams.q = search;
  if (departmentId) queryParams.department_id = departmentId;
  if (locationId) queryParams.location_id = locationId;

  const { data: res, isLoading, isFetching } = useEmployees(queryParams);

  const employees = Array.isArray(res?.data?.data) ? res.data.data : [];
  const total = Number(res?.data?.total ?? 0);
  const totalPages = Number(res?.data?.totalPages ?? 1);

  // ?status=active|inactive deep-link from the dashboard. Active employees
  // are the only ones the EmpCloud users join returns (status=1), so the
  // "inactive" branch is intentionally a no-op for now -- the server does
  // not surface deactivated payroll seats yet.
  const statusFilter = searchParams.get("status");

  // Pending bank update requests
  const { data: bankReqRes } = useQuery({
    queryKey: ["bank-update-requests", "pending"],
    queryFn: () => apiGet<any>("/employees/bank-update-requests", { status: "pending" }),
  });
  const pendingBankReqs = bankReqRes?.data?.data || [];

  async function handleBankReqAction(reqId: string, action: "approve" | "reject") {
    try {
      await apiPost(`/employees/bank-update-requests/${reqId}/${action}`, {});
      toast.success(action === "approve" ? "Bank details updated" : "Request rejected");
      qc.invalidateQueries({ queryKey: ["bank-update-requests"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || `Failed to ${action}`);
    }
  }

  const columns = [
    {
      key: "select",
      header: "",
      render: (row: any) => (
        <input
          type="checkbox"
          checked={selectedIds.has(String(row.id))}
          onChange={(e) => {
            const next = new Set(selectedIds);
            e.target.checked ? next.add(String(row.id)) : next.delete(String(row.id));
            setSelectedIds(next);
          }}
          onClick={(e) => e.stopPropagation()}
          className="cursor-pointer rounded border-gray-300"
        />
      ),
    },
    {
      key: "name",
      header: "Employee",
      render: (row: any) => (
        <div className="flex items-center gap-3">
          <Avatar name={`${row.first_name} ${row.last_name}`} size="sm" />
          <div>
            <p className="font-medium text-gray-900">
              {row.first_name} {row.last_name}
            </p>
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
      key: "location",
      header: "Location",
      render: (row: any) => (
        <span className="text-gray-600">{row.location || row.location_name || "—"}</span>
      ),
    },
    {
      key: "date_of_joining",
      header: "Joined",
      render: (row: any) =>
        row.date_of_joining ? new Date(row.date_of_joining).toLocaleDateString("en-IN") : "—",
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

  const selectedEmployeeNames = employees
    .filter((e: any) => selectedIds.has(String(e.id)))
    .map((e: any) => `${e.first_name} ${e.last_name}`);

  const description = isLoading
    ? "Loading..."
    : `${employees.length} of ${total} employee${total === 1 ? "" : "s"}` +
      (statusFilter ? ` · ${statusFilter}` : "");

  return (
    <ErrorBoundary>
      <div className="space-y-6">
        {/* Pending Bank Update Requests */}
        {pendingBankReqs.length > 0 && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
            <div className="mb-3 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-600" />
              <h3 className="font-semibold text-amber-800 dark:text-amber-200">
                Pending Bank Update Requests ({pendingBankReqs.length})
              </h3>
            </div>
            <div className="space-y-2">
              {pendingBankReqs.map((r: any) => (
                <div
                  key={r.id}
                  className="flex items-center justify-between rounded-lg bg-white p-3 text-sm dark:bg-gray-800"
                >
                  <div>
                    <span className="font-medium text-gray-900">{r.employee_name}</span>
                    <span className="ml-2 text-gray-500">{r.emp_code}</span>
                    <span className="mx-2 text-gray-300">|</span>
                    <span className="text-gray-600">
                      {r.requested_details?.bankName} — A/C {r.requested_details?.accountNumber} —
                      IFSC {r.requested_details?.ifscCode}
                    </span>
                    {r.reason && <span className="ml-2 text-xs text-gray-400">({r.reason})</span>}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleBankReqAction(r.id, "approve")}
                      className="text-green-600 hover:text-green-700"
                    >
                      <Check className="h-3.5 w-3.5" /> Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleBankReqAction(r.id, "reject")}
                      className="text-red-500 hover:text-red-600"
                    >
                      <X className="h-3.5 w-3.5" /> Reject
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <PageHeader
          title="Employees"
          description={description}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
                <Upload className="h-4 w-4" /> Import
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    const { data } = await api.get("/employees/export", { responseType: "blob" });
                    const url = URL.createObjectURL(new Blob([data]));
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = "employees.csv";
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success("Exported employees CSV");
                  } catch {
                    toast.error("Export failed");
                  }
                }}
              >
                <Download className="h-4 w-4" /> Export
              </Button>
              <Button size="sm" variant="outline" onClick={() => navigate("/employees/import")}>
                <Upload className="h-4 w-4" /> Import CSV
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowBulkSalaryCSV(true)}
                title="Bulk update salary from CSV file"
              >
                <Upload className="h-4 w-4" /> Bulk Salary
              </Button>
              <Button size="sm" onClick={() => navigate("/employees/new")}>
                <Plus className="h-4 w-4" /> Add Employee
              </Button>
            </>
          }
        />

        {/* Search + filters */}
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_220px_220px]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search by name, email, code, or designation..."
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 bg-white py-2.5 pl-10 pr-4 text-sm focus:outline-none focus:ring-1 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </div>
          <select
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className="focus:border-brand-500 focus:ring-brand-500 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-1 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            aria-label="Filter by department"
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="focus:border-brand-500 focus:ring-brand-500 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm focus:outline-none focus:ring-1 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            aria-label="Filter by location"
          >
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>

        {(search || departmentId || locationId) && (
          <button
            type="button"
            onClick={() => {
              setSearchInput("");
              setSearch("");
              setDepartmentId("");
              setLocationId("");
            }}
            className="text-xs text-gray-500 underline hover:text-gray-700"
          >
            Clear filters
          </button>
        )}

        {/* Bulk salary update action bar */}
        {selectedIds.size > 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3">
            <span className="text-sm font-medium text-indigo-700">
              {selectedIds.size} employee(s) selected
            </span>
            <Button size="sm" onClick={() => setShowBulkSalary(true)}>
              Update Salary
            </Button>
            <button
              className="ml-auto text-xs text-gray-500 hover:text-gray-700"
              onClick={() => setSelectedIds(new Set())}
            >
              Clear
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="flex h-64 items-center justify-center">
            <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
            <DataTable
              columns={columns}
              data={employees}
              onRowClick={(row) => navigate(`/employees/${row.id}`)}
            />
            <Pagination
              page={page}
              totalPages={totalPages}
              total={total}
              limit={PAGE_SIZE}
              onChange={setPage}
              disabled={isFetching}
            />
          </div>
        )}

        <CSVImportModal
          open={showImport}
          onClose={() => setShowImport(false)}
          onSuccess={() => qc.invalidateQueries({ queryKey: ["employees"] })}
        />

        <BulkSalaryUpdateModal
          open={showBulkSalary}
          onClose={() => {
            setShowBulkSalary(false);
            setSelectedIds(new Set());
          }}
          employeeIds={[...selectedIds]}
          employeeNames={selectedEmployeeNames}
        />

        <BulkSalaryCSVModal
          open={showBulkSalaryCSV}
          onClose={() => setShowBulkSalaryCSV(false)}
          onSuccess={() => {
            qc.invalidateQueries({ queryKey: ["employees"] });
            qc.invalidateQueries({ queryKey: ["employee-salary"] });
          }}
        />
      </div>
    </ErrorBoundary>
  );
}
