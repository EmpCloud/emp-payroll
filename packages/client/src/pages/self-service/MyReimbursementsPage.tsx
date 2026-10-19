import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { formatCurrency } from "@/lib/utils";
import { apiGet, apiPost } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Receipt, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

const CATEGORIES = ["medical", "travel", "food", "equipment", "internet", "books", "other"];

export function MyReimbursementsPage() {
  const { t, i18n } = useTranslation();
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | "pending" | "approved">("all");
  const qc = useQueryClient();
  const locale = i18n.resolvedLanguage || i18n.language || "en";

  // #1358 — Request a large page so client-side pagination has all records
  // to paginate through. Without per_page, backend caps at 20 and anything
  // past page 2 of the DataTable had no data to render.
  const { data: res, isLoading } = useQuery({
    queryKey: ["my-reimbursements"],
    queryFn: () => apiGet<any>("/self-service/reimbursements", { params: { per_page: 500 } }),
  });

  const claims = res?.data?.data || [];
  const totalPending = claims
    .filter((c: any) => c.status === "pending")
    .reduce((s: number, c: any) => s + Number(c.amount), 0);
  const totalApproved = claims
    .filter((c: any) => c.status === "approved" || c.status === "paid")
    .reduce((s: number, c: any) => s + Number(c.amount), 0);

  const visibleClaims =
    statusFilter === "all"
      ? claims
      : statusFilter === "pending"
        ? claims.filter((c: any) => c.status === "pending")
        : claims.filter((c: any) => c.status === "approved" || c.status === "paid");

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const amount = Number(fd.get("amount"));
    // #38 — guard against negative / NaN amounts before hitting the server
    if (!Number.isFinite(amount) || amount < 0) {
      toast.error(t("myReimbursementsPage.messages.invalidAmount"));
      return;
    }
    setSubmitting(true);
    try {
      await apiPost("/self-service/reimbursements", {
        category: fd.get("category"),
        description: fd.get("description"),
        amount,
        expenseDate: fd.get("date"),
      });
      toast.success(t("myReimbursementsPage.messages.submitted"));
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ["my-reimbursements"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("myReimbursementsPage.messages.failed"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("myReimbursementsPage.title")}
        description={t("myReimbursementsPage.description")}
        actions={
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" /> {t("myReimbursementsPage.newClaim")}
          </Button>
        }
      />

      {/* Stat cards double as filter buttons — clicking one narrows the
          claims list below to that status (#237). */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => setStatusFilter("all")}
          className={`text-left transition ${
            statusFilter === "all" ? "ring-brand-500 rounded-lg ring-2" : ""
          }`}
        >
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-gray-500">{t("myReimbursementsPage.stats.total")}</p>
              <p className="text-xl font-bold">{claims.length}</p>
            </CardContent>
          </Card>
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter("pending")}
          className={`text-left transition ${
            statusFilter === "pending" ? "ring-brand-500 rounded-lg ring-2" : ""
          }`}
        >
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-gray-500">{t("myReimbursementsPage.stats.pending")}</p>
              <p className="text-xl font-bold text-orange-600">{formatCurrency(totalPending)}</p>
            </CardContent>
          </Card>
        </button>
        <button
          type="button"
          onClick={() => setStatusFilter("approved")}
          className={`text-left transition ${
            statusFilter === "approved" ? "ring-brand-500 rounded-lg ring-2" : ""
          }`}
        >
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-gray-500">
                {t("myReimbursementsPage.stats.approvedPaid")}
              </p>
              <p className="text-xl font-bold text-green-600">{formatCurrency(totalApproved)}</p>
            </CardContent>
          </Card>
        </button>
      </div>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
        </div>
      ) : claims.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Receipt className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-4 text-gray-500">{t("myReimbursementsPage.empty.title")}</p>
            <p className="mt-1 text-sm text-gray-400">
              {t("myReimbursementsPage.empty.description")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <DataTable
          columns={[
            {
              key: "category",
              header: t("myReimbursementsPage.columns.category"),
              render: (r: any) => (
                <Badge variant="draft">
                  {t(`myReimbursementsPage.categories.${r.category}`, { defaultValue: r.category })}
                </Badge>
              ),
            },
            { key: "description", header: t("myReimbursementsPage.columns.description") },
            {
              key: "amount",
              header: t("myReimbursementsPage.columns.amount"),
              render: (r: any) => formatCurrency(r.amount),
            },
            {
              key: "expense_date",
              header: t("myReimbursementsPage.columns.date"),
              render: (r: any) => new Date(r.expense_date).toLocaleDateString(locale),
            },
            {
              key: "status",
              header: t("myReimbursementsPage.columns.status"),
              render: (r: any) => {
                const steps = ["pending", "approved", "paid"];
                const idx = steps.indexOf(r.status);
                return (
                  <div className="flex items-center gap-2">
                    <div className="flex gap-0.5">
                      {steps.map((step, i) => (
                        <div
                          key={step}
                          className={`h-1.5 w-5 rounded-full ${
                            r.status === "rejected"
                              ? "bg-red-400"
                              : i <= idx
                                ? "bg-green-500"
                                : "bg-gray-200"
                          }`}
                        />
                      ))}
                    </div>
                    <Badge variant={r.status}>
                      {t(`myReimbursementsPage.status.${r.status}`, { defaultValue: r.status })}
                    </Badge>
                  </div>
                );
              },
            },
          ]}
          data={visibleClaims}
        />
      )}

      <Modal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        title={t("myReimbursementsPage.modal.title")}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <SelectField
            id="category"
            name="category"
            label={t("myReimbursementsPage.modal.category")}
            options={CATEGORIES.map((category) => ({
              value: category,
              label: t(`myReimbursementsPage.categories.${category}`),
            }))}
          />
          <Input
            id="description"
            name="description"
            label={t("myReimbursementsPage.modal.description")}
            placeholder={t("myReimbursementsPage.modal.descriptionPlaceholder")}
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              id="amount"
              name="amount"
              label={t("myReimbursementsPage.modal.amount")}
              type="number"
              placeholder="1500"
              min="0"
              step="0.01"
              required
            />
            <Input
              id="date"
              name="date"
              label={t("myReimbursementsPage.modal.expenseDate")}
              type="date"
              required
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setShowAdd(false)}>
              {t("myReimbursementsPage.modal.cancel")}
            </Button>
            <Button type="submit" loading={submitting}>
              {t("myReimbursementsPage.modal.submit")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
