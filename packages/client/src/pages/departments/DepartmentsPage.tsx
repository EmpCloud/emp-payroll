import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { useDepartments, useCreateDepartment, useDeleteDepartment } from "@/api/hooks";
import { Plus, Trash2, Loader2, Network } from "lucide-react";
import toast from "react-hot-toast";

// #48 — Minimal Departments management page (list + create + delete).
// Backed by /api/v1/departments which wraps EmpCloud's
// organization_departments table scoped to the caller's org.
export function DepartmentsPage() {
  const { data: res, isLoading } = useDepartments();
  const createMut = useCreateDepartment();
  const deleteMut = useDeleteDepartment();
  const [showAdd, setShowAdd] = useState(false);

  const departments: { id: string; name: string; createdAt?: string }[] = res?.data || [];

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

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remove department "${name}"?`)) return;
    try {
      await deleteMut.mutateAsync(id);
      toast.success("Department removed");
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || "Failed to remove department");
    }
  }

  const columns = [
    {
      key: "name",
      header: "Department",
      render: (row: any) => (
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-gray-400" />
          <span className="font-medium text-gray-900">{row.name}</span>
        </div>
      ),
    },
    {
      key: "createdAt",
      header: "Created",
      render: (row: any) =>
        row.createdAt ? new Date(row.createdAt).toLocaleDateString("en-IN") : "—",
    },
    {
      key: "actions",
      header: "",
      render: (row: any) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleDelete(row.id, row.name)}
          className="text-red-400 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ];

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
        description={`${departments.length} department${departments.length === 1 ? "" : "s"}`}
        actions={
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" /> Add Department
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          {departments.length > 0 ? (
            <DataTable columns={columns} data={departments} />
          ) : (
            <div className="p-10 text-center text-sm text-gray-500">
              No departments yet. Add one to get started.
            </div>
          )}
        </CardContent>
      </Card>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Department">
        <form onSubmit={handleAdd} className="space-y-4">
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
              Add Department
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
