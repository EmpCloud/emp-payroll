import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { apiGet } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { getUser } from "@/api/auth";
import { Megaphone, Pin, Loader2, Clock, ExternalLink } from "lucide-react";
import { formatDate } from "@/lib/utils";

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

// EmpCloud is the source of truth for company announcements. This page is
// read-only: admins manage announcements over in EmpCloud, employees just
// see them here.
const EMPCLOUD_ANNOUNCEMENTS_URL = "https://app.empcloud.com/announcements";

export function AnnouncementsPage() {
  const user = getUser();
  const isAdmin =
    user?.role === "hr_admin" || user?.role === "hr_manager" || user?.role === "super_admin";

  const { data: res, isLoading } = useQuery({
    queryKey: ["announcements"],
    queryFn: () => apiGet<any>("/announcements", isAdmin ? { all: "true" } : {}),
  });

  const announcements = res?.data || [];

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
        description="Company-wide notices, posted from EmpCloud"
        actions={
          isAdmin ? (
            <a
              href={EMPCLOUD_ANNOUNCEMENTS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-brand-600 hover:bg-brand-700 inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
            >
              Manage in EmpCloud <ExternalLink className="h-4 w-4" />
            </a>
          ) : undefined
        }
      />

      {announcements.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Megaphone className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-4 text-gray-500">No announcements yet</p>
            {isAdmin && (
              <a
                href={EMPCLOUD_ANNOUNCEMENTS_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="text-brand-600 mt-2 inline-flex items-center gap-1 text-sm hover:underline"
              >
                Post one from EmpCloud <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {announcements.map((a: any) => (
            <Card key={a.id} className={a.is_pinned ? "border-brand-200 bg-brand-50/30" : ""}>
              <CardContent className="py-5">
                <div className="flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    {/* #297 — `is_pinned` arrives as MySQL TINYINT (0/1);
                        bare `a.is_pinned && <Pin/>` renders the literal "0"
                        on every unpinned card. Coerce to boolean. */}
                    {!!a.is_pinned && <Pin className="text-brand-600 h-4 w-4" />}
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
