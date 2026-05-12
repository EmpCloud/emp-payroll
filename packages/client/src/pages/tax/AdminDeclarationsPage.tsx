import { useEffect, useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Pagination } from "@/components/ui/Pagination";
import { formatCurrency } from "@/lib/utils";
import { useEmployees, useDepartments, useLocations } from "@/api/hooks";
import { apiGet, apiPost } from "@/api/client";
import {
  Search,
  Loader2,
  FileCheck,
  ExternalLink,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import toast from "react-hot-toast";

interface Declaration {
  id: string;
  financial_year: string;
  section: string;
  description: string;
  declared_amount: number;
  approved_amount: number | null;
  approval_status: "pending" | "approved" | "rejected";
  proof_path?: string | null;
  created_at?: string;
}

function statusBadgeVariant(status: string): "approved" | "pending" | "rejected" {
  if (status === "approved") return "approved";
  if (status === "rejected") return "rejected";
  return "pending";
}

function currentFY(): string {
  const now = new Date();
  const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${fyStart}-${fyStart + 1}`;
}

const PAGE_SIZE = 25;

export function AdminDeclarationsPage() {
  const qc = useQueryClient();
  const fy = currentFY();

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [page, setPage] = useState(1);
  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(id);
  }, [searchInput]);

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

  const { data: empRes, isLoading: empLoading, isFetching } = useEmployees(queryParams);

  // /employees returns { success, data: { data: [...], total, ... } } — two
  // levels deep. Falls back to empty array if either layer is missing or
  // non-array.
  const rawEmployees = empRes?.data?.data ?? empRes?.data;
  const employees: any[] = Array.isArray(rawEmployees) ? rawEmployees : [];
  const total = Number(empRes?.data?.total ?? employees.length);
  const totalPages = Number(empRes?.data?.totalPages ?? 1);

  const selectedEmp = employees.find((e) => String(e.empcloud_user_id ?? e.id) === selectedEmpId);

  const { data: declRes, isLoading: declLoading } = useQuery({
    queryKey: ["admin-declarations", selectedEmpId, fy],
    queryFn: () => apiGet<any>(`/tax/declarations/${selectedEmpId}`, { fy }),
    enabled: !!selectedEmpId,
  });
  // /tax/declarations/:empId returns the paginated envelope
  // { data: [...], total, page, limit, totalPages } so unwrap one more
  // level than the bare list endpoints. Also Array.isArray-guard against
  // an empty/error response so a transient 4xx can't crash the page.
  const rawDecl = declRes?.data?.data ?? declRes?.data;
  const declarations: Declaration[] = Array.isArray(rawDecl) ? rawDecl : [];
  const pendingCount = declarations.filter((d) => d.approval_status === "pending").length;
  const totalDeclared = declarations.reduce((s, d) => s + Number(d.declared_amount || 0), 0);
  const totalApproved = declarations.reduce((s, d) => s + Number(d.approved_amount || 0), 0);

  const approveAll = useMutation({
    mutationFn: () => apiPost<any>(`/tax/declarations/${selectedEmpId}/approve`, {}),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["admin-declarations", selectedEmpId, fy] });
      const n = Number(res?.data?.approved ?? 0);
      if (n === 0) {
        toast("No pending declarations to approve.", { icon: "ℹ️" });
      } else {
        toast.success(`Approved ${n} declaration${n === 1 ? "" : "s"}.`);
      }
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.error?.message || err?.message || "Failed to approve declarations";
      toast.error(msg);
    },
  });

  const approveOne = useMutation({
    mutationFn: (declId: string) =>
      apiPost<any>(`/tax/declarations/${selectedEmpId}/${declId}/approve`, {}),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ["admin-declarations", selectedEmpId, fy] });
      if (res?.data?.alreadyApproved) {
        toast("Already approved.", { icon: "ℹ️" });
      } else {
        toast.success("Declaration approved.");
      }
    },
    onError: (err: any) => {
      const msg =
        err?.response?.data?.error?.message || err?.message || "Failed to approve declaration";
      toast.error(msg);
    },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tax Declarations"
        description={`Review investment declarations submitted by employees for ${fy}.`}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
        {/* Employee picker */}
        <Card>
          <CardHeader>
            <CardTitle>Employees</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Name, email, or code"
                  className="pl-9"
                />
              </div>
              <select
                value={departmentId}
                onChange={(e) => setDepartmentId(e.target.value)}
                className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
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
                className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-1 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                aria-label="Filter by location"
              >
                <option value="">All locations</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
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
            </div>

            <div className="mt-4 max-h-[480px] space-y-1 overflow-y-auto">
              {empLoading ? (
                <div className="flex items-center justify-center gap-2 py-6 text-sm text-gray-400">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : employees.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">No matching employees.</p>
              ) : (
                employees.map((e) => {
                  const id = String(e.empcloud_user_id ?? e.id);
                  const isSel = id === selectedEmpId;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSelectedEmpId(id)}
                      className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                        isSel ? "bg-brand-50 text-brand-700" : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {e.first_name} {e.last_name}
                        </p>
                        <p className="truncate text-xs text-gray-400">
                          {e.email}
                          {e.department ? ` · ${e.department}` : ""}
                        </p>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            <div className="mt-4 flex items-center justify-between border-t border-gray-200 pt-3 text-xs text-gray-500 dark:border-gray-700">
              <span>
                {employees.length} of {total}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isFetching || page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </Button>
                <span>
                  {page} / {Math.max(1, totalPages)}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={isFetching || page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  aria-label="Next page"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Declarations panel */}
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle>
                  {selectedEmp
                    ? `${selectedEmp.first_name} ${selectedEmp.last_name}`
                    : "Pick an employee"}
                </CardTitle>
                {selectedEmp && (
                  <p className="mt-1 text-xs text-gray-500">
                    {selectedEmp.email} · {fy}
                  </p>
                )}
              </div>
              {selectedEmpId && pendingCount > 0 && (
                <Button
                  onClick={() => approveAll.mutate()}
                  disabled={approveAll.isPending}
                  size="sm"
                >
                  {approveAll.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Approving…
                    </>
                  ) : (
                    <>
                      <FileCheck className="h-4 w-4" /> Approve {pendingCount} pending
                    </>
                  )}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {!selectedEmpId ? (
              <div className="flex flex-col items-center justify-center gap-3 py-12 text-sm text-gray-400">
                <ClipboardList className="h-10 w-10" />
                <p>Select an employee from the list to view their tax declarations.</p>
              </div>
            ) : declLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading declarations…
              </div>
            ) : declarations.length === 0 ? (
              <p className="py-12 text-center text-sm text-gray-400">
                No declarations submitted for {fy}.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="text-xs text-gray-500">Declared</p>
                    <p className="mt-1 text-lg font-semibold text-gray-900">
                      {formatCurrency(totalDeclared)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-green-50 p-3">
                    <p className="text-xs text-green-700">Approved</p>
                    <p className="mt-1 text-lg font-semibold text-green-900">
                      {formatCurrency(totalApproved)}
                    </p>
                  </div>
                  <div className="rounded-lg bg-amber-50 p-3">
                    <p className="text-xs text-amber-700">Pending</p>
                    <p className="mt-1 text-lg font-semibold text-amber-900">{pendingCount}</p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-lg border border-gray-200">
                  <table className="min-w-full text-sm">
                    <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                      <tr>
                        <th className="px-4 py-3 text-left">Section</th>
                        <th className="px-4 py-3 text-left">Description</th>
                        <th className="px-4 py-3 text-right">Declared</th>
                        <th className="px-4 py-3 text-right">Approved</th>
                        <th className="px-4 py-3 text-left">Status</th>
                        <th className="px-4 py-3 text-left">Proof</th>
                        <th className="px-4 py-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {declarations.map((d) => {
                        const isPendingRow = d.approval_status === "pending";
                        const isThisRowApproving =
                          approveOne.isPending && approveOne.variables === d.id;
                        return (
                          <tr key={d.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 font-medium text-gray-900">{d.section}</td>
                            <td className="px-4 py-3 text-gray-600">{d.description}</td>
                            <td className="px-4 py-3 text-right text-gray-900">
                              {formatCurrency(Number(d.declared_amount || 0))}
                            </td>
                            <td className="px-4 py-3 text-right text-gray-900">
                              {d.approved_amount != null
                                ? formatCurrency(Number(d.approved_amount))
                                : "—"}
                            </td>
                            <td className="px-4 py-3">
                              <Badge variant={statusBadgeVariant(d.approval_status)}>
                                {d.approval_status}
                              </Badge>
                            </td>
                            <td className="px-4 py-3">
                              {d.proof_path ? (
                                <a
                                  href={`/api/v1${d.proof_path.startsWith("/") ? "" : "/"}${d.proof_path}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-brand-600 hover:text-brand-700 inline-flex items-center gap-1 text-xs"
                                >
                                  View <ExternalLink className="h-3 w-3" />
                                </a>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {isPendingRow ? (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => approveOne.mutate(d.id)}
                                  disabled={approveOne.isPending}
                                >
                                  {isThisRowApproving ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <FileCheck className="h-3 w-3" />
                                  )}
                                  Approve
                                </Button>
                              ) : (
                                <span className="text-xs text-gray-400">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default AdminDeclarationsPage;
