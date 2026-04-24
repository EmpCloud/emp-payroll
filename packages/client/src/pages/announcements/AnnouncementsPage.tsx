import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SelectField } from "@/components/ui/SelectField";
import { apiGet, apiPost, apiPut, apiDelete } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getUser } from "@/api/auth";
import { Megaphone, Plus, Pin, Pencil, Trash2, Loader2, Clock, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";
import { formatDate } from "@/lib/utils";

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "normal", label: "Normal" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

const CATEGORIES = [
  { value: "general", label: "General" },
  { value: "hr", label: "HR" },
  { value: "policy", label: "Policy" },
  { value: "event", label: "Event" },
  { value: "holiday", label: "Holiday" },
  { value: "maintenance", label: "Maintenance" },
];

const priorityColors: Record<string, string> = {
  low: "bg-gray-100 text-gray-700",
  normal: "bg-blue-100 text-blue-700",
  high: "bg-orange-100 text-orange-700",
  urgent: "bg-red-100 text-red-700",
};

const categoryColors: Record<string, string> = {
  general: "bg-gray-100 text-gray-600",
  hr: "bg-purple-100 text-purple-700",
  policy: "bg-indigo-100 text-indigo-700",
  event: "bg-green-100 text-green-700",
  holiday: "bg-amber-100 text-amber-700",
  maintenance: "bg-slate-100 text-slate-700",
};

export function AnnouncementsPage() {
  const user = getUser();
  const qc = useQueryClient();
  const isAdmin =
    user?.role === "hr_admin" || user?.role === "hr_manager" || user?.role === "super_admin";
  const [createOpen, setCreateOpen] = useState(false);
  const [editItem, setEditItem] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);

  const { data: res, isLoading } = useQuery({
    queryKey: ["announcements"],
    queryFn: () => apiGet<any>("/announcements", isAdmin ? { all: "true" } : {}),
  });

  const announcements = res?.data || [];

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSubmitting(true);
    try {
      await apiPost("/announcements", {
        title: fd.get("title"),
        content: fd.get("content"),
        priority: fd.get("priority"),
        category: fd.get("category"),
        isPinned: fd.get("isPinned") === "on",
        expiresAt: fd.get("expiresAt") || undefined,
      });
      toast.success("Announcement published");
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ["announcements"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSubmitting(true);
    try {
      await apiPut(`/announcements/${editItem.id}`, {
        title: fd.get("title"),
        content: fd.get("content"),
        priority: fd.get("priority"),
        category: fd.get("category"),
        isPinned: fd.get("isPinned") === "on",
        expiresAt: fd.get("expiresAt") || undefined,
      });
      toast.success("Announcement updated");
      setEditItem(null);
      qc.invalidateQueries({ queryKey: ["announcements"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this announcement?")) return;
    try {
      await apiDelete(`/announcements/${id}`);
      toast.success("Announcement deleted");
      qc.invalidateQueries({ queryKey: ["announcements"] });
    } catch {
      toast.error("Failed to delete");
    }
  }

  async function togglePin(item: any) {
    try {
      await apiPut(`/announcements/${item.id}`, { isPinned: !item.is_pinned });
      qc.invalidateQueries({ queryKey: ["announcements"] });
    } catch {
      toast.error("Failed to update");
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
        title="Announcements"
        description="Company-wide notices and announcements"
        actions={
          isAdmin ? (
            <Button onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" /> New Announcement
            </Button>
          ) : undefined
        }
      />

      {announcements.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Megaphone className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-4 text-gray-500">No announcements yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {announcements.map((a: any) => (
            <Card key={a.id} className={a.is_pinned ? "border-brand-200 bg-brand-50/30" : ""}>
              <CardContent className="py-5">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      {a.is_pinned && <Pin className="text-brand-600 h-4 w-4" />}
                      <h3 className="text-lg font-semibold text-gray-900">{a.title}</h3>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${priorityColors[a.priority] || priorityColors.normal}`}
                      >
                        {a.priority}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${categoryColors[a.category] || categoryColors.general}`}
                      >
                        {a.category}
                      </span>
                      {a.source === "empcloud" && (
                        <span
                          className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700"
                          title="Posted from EmpCloud — manage it there"
                        >
                          EmpCloud
                        </span>
                      )}
                      {!a.is_active && <Badge variant="inactive">Archived</Badge>}
                    </div>
                    <p className="whitespace-pre-wrap text-sm text-gray-700">{a.content}</p>
                    <div className="mt-3 flex items-center gap-4 text-xs text-gray-400">
                      <span>By {a.author_name || "Unknown"}</span>
                      <span>{formatDate(a.created_at)}</span>
                      {a.expires_at && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Expires {formatDate(a.expires_at)}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* EmpCloud-sourced rows are read-only here — manage them
                       in EmpCloud. Hide the action cluster entirely. */}
                  {isAdmin && a.source !== "empcloud" && (
                    <div className="ml-4 flex items-center gap-1">
                      <button
                        onClick={() => togglePin(a)}
                        className="hover:text-brand-600 p-1 text-gray-400"
                        title={a.is_pinned ? "Unpin" : "Pin"}
                      >
                        <Pin className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => setEditItem(a)}
                        className="p-1 text-gray-400 hover:text-blue-600"
                        title="Edit"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(a.id)}
                        className="p-1 text-gray-400 hover:text-red-600"
                        title="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create Modal */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="New Announcement"
        className="max-w-lg"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            id="title"
            name="title"
            label="Title"
            required
            placeholder="e.g. Office Closure Notice"
          />
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Content</label>
            <textarea
              name="content"
              required
              rows={4}
              placeholder="Write your announcement here..."
              className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <SelectField id="priority" name="priority" label="Priority" options={PRIORITIES} />
            <SelectField id="category" name="category" label="Category" options={CATEGORIES} />
          </div>
          <Input
            id="expiresAt"
            name="expiresAt"
            label="Expires At (optional)"
            type="datetime-local"
          />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="isPinned" className="rounded border-gray-300" />
            Pin to top
          </label>
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={submitting}>
              Publish
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        open={!!editItem}
        onClose={() => setEditItem(null)}
        title="Edit Announcement"
        className="max-w-lg"
      >
        {editItem && (
          <form onSubmit={handleUpdate} className="space-y-4">
            <Input id="title" name="title" label="Title" required defaultValue={editItem.title} />
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Content</label>
              <textarea
                name="content"
                required
                rows={4}
                defaultValue={editItem.content}
                className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <SelectField
                id="priority"
                name="priority"
                label="Priority"
                options={PRIORITIES}
                defaultValue={editItem.priority}
              />
              <SelectField
                id="category"
                name="category"
                label="Category"
                options={CATEGORIES}
                defaultValue={editItem.category}
              />
            </div>
            <Input
              id="expiresAt"
              name="expiresAt"
              label="Expires At"
              type="datetime-local"
              defaultValue={editItem.expires_at?.slice(0, 16)}
            />
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="isPinned"
                defaultChecked={editItem.is_pinned}
                className="rounded border-gray-300"
              />
              Pin to top
            </label>
            <div className="flex justify-end gap-3">
              <Button variant="outline" type="button" onClick={() => setEditItem(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={submitting}>
                Update
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
