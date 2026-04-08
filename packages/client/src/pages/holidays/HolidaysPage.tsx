import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { Plus, Calendar, Trash2, Loader2 } from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiGet, apiPost, apiDelete } from "@/api/client";
import toast from "react-hot-toast";

export function HolidaysPage() {
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [year] = useState(new Date().getFullYear());

  const { data: holidayRes, isLoading } = useQuery({
    queryKey: ["holidays", year],
    queryFn: () => apiGet<any>("/holidays", { year }),
  });

  const holidays = holidayRes?.data || [];

  const upcoming = holidays
    .filter((h: any) => new Date(h.date) >= new Date())
    .sort((a: any, b: any) => new Date(a.date).getTime() - new Date(b.date).getTime());

  const past = holidays
    .filter((h: any) => new Date(h.date) < new Date())
    .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());

  async function addHoliday(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await apiPost("/holidays", {
        name: fd.get("name") as string,
        date: fd.get("date") as string,
        type: fd.get("type") as string,
      });
      toast.success("Holiday added");
      qc.invalidateQueries({ queryKey: ["holidays"] });
      setShowAdd(false);
    } catch {
      toast.error("Failed to add holiday");
    }
  }

  async function removeHoliday(id: string) {
    try {
      await apiDelete(`/holidays/${id}`);
      toast.success("Holiday removed");
      qc.invalidateQueries({ queryKey: ["holidays"] });
    } catch {
      toast.error("Failed to remove holiday");
    }
  }

  const columns = [
    {
      key: "name",
      header: "Holiday",
      render: (r: any) => <span className="font-medium text-gray-900">{r.name}</span>,
    },
    {
      key: "date",
      header: "Date",
      render: (r: any) => (
        <span>
          {new Date(r.date).toLocaleDateString("en-IN", {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
      ),
    },
    {
      key: "day",
      header: "Day",
    },
    {
      key: "type",
      header: "Type",
      render: (r: any) => (
        <Badge
          variant={r.type === "national" ? "approved" : r.type === "regional" ? "pending" : "draft"}
        >
          {r.type}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r: any) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => removeHoliday(r.id)}
          className="text-red-400 hover:text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const months = Array.from({ length: 12 }, (_, i) => i);

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
        title="Holiday Calendar"
        description={`${year} — ${holidays.length} holidays configured`}
        actions={
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" /> Add Holiday
          </Button>
        }
      />

      {/* Calendar overview */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {months.map((month) => {
          const monthHolidays = holidays.filter((h: any) => new Date(h.date).getMonth() === month);
          const monthName = new Date(year, month).toLocaleString("en-US", { month: "long" });
          return (
            <Card key={month} className={monthHolidays.length > 0 ? "border-brand-200" : ""}>
              <CardContent className="py-3">
                <p className="text-xs font-semibold text-gray-500">{monthName}</p>
                {monthHolidays.length > 0 ? (
                  <div className="mt-2 space-y-1">
                    {monthHolidays.map((h: any) => (
                      <div key={h.id} className="flex items-center gap-1.5">
                        <span className="bg-brand-500 h-1.5 w-1.5 rounded-full" />
                        <span className="text-xs text-gray-700">{h.name}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-gray-300">No holidays</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Calendar className="h-5 w-5" /> Upcoming Holidays
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable columns={columns} data={upcoming} />
          </CardContent>
        </Card>
      )}

      {/* Past */}
      {past.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Past Holidays</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable columns={columns} data={past} />
          </CardContent>
        </Card>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="Add Holiday">
        <form onSubmit={addHoliday} className="space-y-4">
          <Input id="name" name="name" label="Holiday Name" placeholder="e.g. Diwali" required />
          <Input id="date" name="date" label="Date" type="date" required />
          <SelectField
            id="type"
            name="type"
            label="Type"
            options={[
              { value: "national", label: "National" },
              { value: "regional", label: "Regional" },
              { value: "optional", label: "Optional / Restricted" },
            ]}
          />
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setShowAdd(false)}>
              Cancel
            </Button>
            <Button type="submit">Add Holiday</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
