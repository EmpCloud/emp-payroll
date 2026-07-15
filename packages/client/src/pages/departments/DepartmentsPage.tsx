import { useState, useMemo } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { Avatar } from "@/components/ui/Avatar";
import {
  useDepartments,
  useCreateDepartment,
  useDeleteDepartment,
  useEmployees,
} from "@/api/hooks";
import { formatDate } from "@/lib/utils";
import { Plus, Trash2, Loader2, Building2, Users, Search } from "lucide-react";
import toast from "react-hot-toast";

// #48 — Departments management page (list + create + delete).
// Backed by /api/v1/departments which wraps EmpCloud's
// organization_departments table scoped to the caller's org. Headcount and
// member avatars are joined client-side from the employee list (UI-only).

const UNASSIGNED = "Unassigned";
function deptKey(dept?: string | null): string {
  return dept && String(dept).trim() ? String(dept).trim() : UNASSIGNED;
}

// Deterministic colour per department name so a team reads with a consistent
// hue here, matching the org chart.
const DEPT_STYLES = [
  { grad: "from-indigo-200 to-violet-200", chip: "bg-indigo-50 text-indigo-600" },
  { grad: "from-sky-200 to-cyan-200", chip: "bg-sky-50 text-sky-600" },
  { grad: "from-emerald-200 to-teal-200", chip: "bg-emerald-50 text-emerald-600" },
  { grad: "from-amber-200 to-orange-200", chip: "bg-amber-50 text-amber-600" },
  { grad: "from-rose-200 to-pink-200", chip: "bg-rose-50 text-rose-600" },
  { grad: "from-purple-200 to-fuchsia-200", chip: "bg-purple-50 text-purple-600" },
];
function deptStyle(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return DEPT_STYLES[Math.abs(hash) % DEPT_STYLES.length];
}

interface Dept {
  id: string;
  name: string;
  createdAt?: string;
}

export function DepartmentsPage() {
  const { data: res, isLoading } = useDepartments();
  const { data: empRes } = useEmployees({ limit: 500 });
  const createMut = useCreateDepartment();
  const deleteMut = useDeleteDepartment();

  const [showAdd, setShowAdd] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Dept | null>(null);
  const [search, setSearch] = useState("");

  const departments: Dept[] = res?.data || [];
  const employees: any[] = empRes?.data?.data || [];

  // department name -> members (also fills an "Unassigned" bucket).
  const membersByDept = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const e of employees) {
      const key = deptKey(e.department);
      const arr = m.get(key);
      if (arr) arr.push(e);
      else m.set(key, [e]);
    }
    return m;
  }, [employees]);

  const unassigned = membersByDept.get(UNASSIGNED) || [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return departments;
    return departments.filter((d) => d.name.toLowerCase().includes(q));
  }, [departments, search]);

  async function handleAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = ((fd.get("name") as string) || "").trim();
    if (!name) {
      toast.error("Department name is required");
      return;
    }
    try {
      await createMut.mutateAsync({ name });
      toast.success("Department added");
      setShowAdd(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || "Failed to add department");
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteMut.mutateAsync(deleteTarget.id);
      toast.success("Department removed");
      setDeleteTarget(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || "Failed to remove department");
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Departments"
        description={`${departments.length} department${departments.length === 1 ? "" : "s"} · ${employees.length} employee${employees.length === 1 ? "" : "s"} · from EmpCloud`}
        actions={
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" /> Add Department
          </Button>
        }
      />

      {departments.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white py-20 text-center">
          <div className="rounded-full bg-gray-50 p-3">
            <Building2 className="h-6 w-6 text-gray-300" />
          </div>
          <p className="text-sm text-gray-500">No departments yet.</p>
          <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" /> Add your first department
          </Button>
        </div>
      ) : (
        <>
          {departments.length > 6 && (
            <div className="relative max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search departments…"
                aria-label="Search departments"
                className="focus:border-brand-300 focus:ring-brand-100 w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none transition focus:ring-2"
              />
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((d) => {
              const members = membersByDept.get(d.name) || [];
              const style = deptStyle(d.name);
              return (
                <DeptCard
                  key={d.id}
                  name={d.name}
                  count={members.length}
                  members={members}
                  createdAt={d.createdAt}
                  grad={style.grad}
                  chip={style.chip}
                  onDelete={() => setDeleteTarget(d)}
                />
              );
            })}

            {/* Unassigned — read-only surface so HR can see who still needs a
                department. Not a real EmpCloud row, so it can't be deleted. */}
            {unassigned.length > 0 && !search && (
              <DeptCard
                name={UNASSIGNED}
                count={unassigned.length}
                members={unassigned}
                grad="from-gray-200 to-gray-300"
                chip="bg-gray-100 text-gray-500"
                muted
              />
            )}
          </div>

          {filtered.length === 0 && (
            <div className="rounded-xl border border-gray-200 bg-white py-12 text-center text-sm text-gray-400">
              No departments match “{search}”.
            </div>
          )}
        </>
      )}

      {/* Add department */}
      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title="Add Department"
        description="Syncs to EmpCloud and becomes selectable on employee profiles, the org chart, and reports."
      >
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
            <span className="bg-brand-50 text-brand-600 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
              <Building2 className="h-[18px] w-[18px]" />
            </span>
            <p className="text-xs text-gray-500">
              Names should be unique within your organization. You can remove a department later
              without affecting existing payroll records.
            </p>
          </div>
          <Input
            id="dept_name"
            name="name"
            label="Department Name"
            placeholder="e.g. Engineering"
            required
            autoFocus
          />
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={createMut.isPending}>
              <Plus className="h-4 w-4" /> Add Department
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete confirm */}
      <Modal
        open={!!deleteTarget}
        onClose={() => !deleteMut.isPending && setDeleteTarget(null)}
        title="Remove department?"
        description={
          deleteTarget
            ? `“${deleteTarget.name}” will be removed from your organization.`
            : undefined
        }
        className="max-w-md"
      >
        {deleteTarget && (membersByDept.get(deleteTarget.name)?.length ?? 0) > 0 && (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-800">
            <Users className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>
              <strong className="tabular-nums">
                {membersByDept.get(deleteTarget.name)!.length}
              </strong>{" "}
              {membersByDept.get(deleteTarget.name)!.length === 1 ? "employee is" : "employees are"}{" "}
              currently in this department. Their records are kept, but they’ll show no department
              until reassigned.
            </span>
          </div>
        )}
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => setDeleteTarget(null)}
            disabled={deleteMut.isPending}
          >
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDelete} loading={deleteMut.isPending}>
            <Trash2 className="h-4 w-4" /> Remove
          </Button>
        </div>
      </Modal>
    </div>
  );
}

function DeptCard({
  name,
  count,
  members,
  createdAt,
  grad,
  chip,
  muted,
  onDelete,
}: {
  name: string;
  count: number;
  members: any[];
  createdAt?: string;
  grad: string;
  chip: string;
  muted?: boolean;
  onDelete?: () => void;
}) {
  const shown = members.slice(0, 5);
  const extra = count - shown.length;
  return (
    <div className="group overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md">
      <div className={`h-1 w-full bg-gradient-to-r ${grad}`} />
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${chip}`}
            >
              <Building2 className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0">
              <p
                className={`truncate font-semibold ${muted ? "text-gray-500" : "text-gray-900"}`}
                title={name}
              >
                {name}
              </p>
              <p className="text-xs tabular-nums text-gray-500">
                {count} {count === 1 ? "employee" : "employees"}
              </p>
            </div>
          </div>
          {onDelete && (
            <button
              onClick={onDelete}
              aria-label={`Remove ${name}`}
              className="focus-visible:ring-brand-500 shrink-0 rounded p-1.5 text-gray-300 opacity-0 transition hover:bg-red-50 hover:text-red-600 focus:opacity-100 focus:outline-none focus-visible:opacity-100 focus-visible:ring-2 group-hover:opacity-100"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-3 flex min-h-[2rem] items-center">
          {count === 0 ? (
            <span className="flex items-center gap-1.5 text-xs text-gray-400">
              <Users className="h-3.5 w-3.5" /> No members yet
            </span>
          ) : (
            <div className="flex items-center">
              <div className="flex -space-x-2">
                {shown.map((e: any) => (
                  <Avatar
                    key={e.id}
                    name={`${e.first_name} ${e.last_name}`}
                    size="sm"
                    className="ring-2 ring-white"
                  />
                ))}
              </div>
              {extra > 0 && (
                <span className="ml-2 text-xs font-medium tabular-nums text-gray-400">
                  +{extra}
                </span>
              )}
            </div>
          )}
        </div>

        {createdAt && (
          <p className="mt-3 text-[11px] text-gray-400">Created {formatDate(createdAt)}</p>
        )}
      </div>
    </div>
  );
}
