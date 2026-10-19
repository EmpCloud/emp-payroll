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
import { useTranslation } from "react-i18next";

export function HolidaysPage() {
  const { t, i18n } = useTranslation();
  const qc = useQueryClient();
  const [showAdd, setShowAdd] = useState(false);
  const [year] = useState(new Date().getFullYear());
  const locale = i18n.resolvedLanguage || i18n.language || "en";

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
    const name = ((fd.get("name") as string) || "").trim();
    const date = (fd.get("date") as string) || "";
    const type = (fd.get("type") as string) || "national";

    // #29 — Reject purely numeric / symbol names (e.g. "123", "-"). At least
    // one alphabet character is required. Server re-validates with the same
    // regex, but we catch it here so the user doesn't round-trip.
    if (!name) {
      toast.error(t("holidaysPage.messages.nameRequired"));
      return;
    }
    if (!/\p{L}/u.test(name)) {
      toast.error(t("holidaysPage.messages.nameLetter"));
      return;
    }

    try {
      await apiPost("/holidays", { name, date, type });
      toast.success(t("holidaysPage.messages.added"));
      qc.invalidateQueries({ queryKey: ["holidays"] });
      setShowAdd(false);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || t("holidaysPage.messages.addFailed"));
    }
  }

  async function removeHoliday(id: string) {
    try {
      await apiDelete(`/holidays/${id}`);
      toast.success(t("holidaysPage.messages.removed"));
      qc.invalidateQueries({ queryKey: ["holidays"] });
    } catch {
      toast.error(t("holidaysPage.messages.removeFailed"));
    }
  }

  const columns = [
    {
      key: "name",
      header: t("holidaysPage.columns.holiday"),
      render: (r: any) => <span className="font-medium text-gray-900">{r.name}</span>,
    },
    {
      key: "date",
      header: t("holidaysPage.columns.date"),
      render: (r: any) => (
        <span>
          {new Date(r.date).toLocaleDateString(locale, {
            day: "numeric",
            month: "short",
            year: "numeric",
          })}
        </span>
      ),
    },
    {
      key: "day",
      header: t("holidaysPage.columns.day"),
      render: (r: any) => new Date(r.date).toLocaleDateString(locale, { weekday: "long" }),
    },
    {
      key: "type",
      header: t("holidaysPage.columns.type"),
      render: (r: any) => (
        <Badge
          variant={r.type === "national" ? "approved" : r.type === "regional" ? "pending" : "draft"}
        >
          {t(`holidaysPage.types.${r.type}`, { defaultValue: r.type })}
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
          title={t("holidaysPage.actions.remove")}
          aria-label={t("holidaysPage.actions.remove")}
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
        title={t("holidaysPage.title")}
        description={t("holidaysPage.configured", { year, count: holidays.length })}
        actions={
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" /> {t("holidaysPage.actions.add")}
          </Button>
        }
      />

      {/* Calendar overview */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {months.map((month) => {
          const monthHolidays = holidays.filter((h: any) => new Date(h.date).getMonth() === month);
          const monthName = new Date(year, month).toLocaleString(locale, { month: "long" });
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
                  <p className="mt-2 text-xs text-gray-300">{t("holidaysPage.noHolidays")}</p>
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
              <Calendar className="h-5 w-5" /> {t("holidaysPage.upcoming")}
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
            <CardTitle>{t("holidaysPage.past")}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <DataTable columns={columns} data={past} />
          </CardContent>
        </Card>
      )}

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title={t("holidaysPage.modal.title")}>
        <form onSubmit={addHoliday} className="space-y-4">
          <Input
            id="name"
            name="name"
            label={t("holidaysPage.modal.name")}
            placeholder={t("holidaysPage.modal.namePlaceholder")}
            required
            pattern=".*\p{L}.*"
            title={t("holidaysPage.modal.nameTitle")}
          />
          <Input id="date" name="date" label={t("holidaysPage.modal.date")} type="date" required />
          <SelectField
            id="type"
            name="type"
            label={t("holidaysPage.modal.type")}
            options={[
              { value: "national", label: t("holidaysPage.types.national") },
              { value: "regional", label: t("holidaysPage.types.regional") },
              { value: "optional", label: t("holidaysPage.types.optional") },
            ]}
          />
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setShowAdd(false)}>
              {t("holidaysPage.actions.cancel")}
            </Button>
            <Button type="submit">{t("holidaysPage.actions.add")}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
