import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { apiGet, apiPost } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Check, X, DollarSign } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

const STATUS_BADGE: Record<string, "active" | "draft" | "inactive"> = {
  pending: "draft",
  approved: "active",
  paid: "active",
  rejected: "inactive",
};

export function ContractorInvoicesPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language;
  const qc = useQueryClient();
  const [showSubmit, setShowSubmit] = useState(false);
  const [saving, setSaving] = useState(false);
  // Seed filter from URL so the dashboard's "Pending Invoices" card actually
  // lands the user on a pending-only view instead of all statuses (#236).
  const [searchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "");

  const [form, setForm] = useState({
    globalEmployeeId: "",
    amount: "",
    description: "",
    periodStart: "",
    periodEnd: "",
  });

  const { data: invoicesRes, isLoading } = useQuery({
    queryKey: ["global-invoices", statusFilter],
    queryFn: () =>
      apiGet<any>("/global/invoices", {
        status: statusFilter || undefined,
      }),
  });

  // Get contractor employees for the dropdown
  const { data: empRes } = useQuery({
    queryKey: ["global-employees-contractors"],
    queryFn: () => apiGet<any>("/global/employees", { employmentType: "contractor" }),
  });

  const invoices = invoicesRes?.data || [];
  const contractors = empRes?.data || [];

  const contractorOptions = contractors.map((c: any) => ({
    value: c.id,
    label: `${c.first_name} ${c.last_name} (${c.country_name})`,
  }));

  // Resolve the selected contractor's currency so the amount input can
  // show its symbol/code instead of a bare number (#217).
  const selectedContractor = contractors.find((c: any) => c.id === form.globalEmployeeId);
  const amountCurrency = selectedContractor?.currency_symbol || selectedContractor?.currency || "";

  const handleSubmit = async () => {
    if (!form.globalEmployeeId || !form.amount || !form.periodStart || !form.periodEnd) {
      toast.error(t("contractorInvoicesPage.validation.required"));
      return;
    }
    // #120 — Invoice amounts must be positive. A negative or zero invoice
    // is an accounting mistake — block it before hitting the API.
    const amtNum = Number(form.amount);
    if (!Number.isFinite(amtNum) || amtNum <= 0) {
      toast.error(t("contractorInvoicesPage.validation.positiveAmount"));
      return;
    }
    // #121 — End date must be on or after start date; an invoice for a
    // negative-length period is invalid.
    if (new Date(form.periodEnd).getTime() < new Date(form.periodStart).getTime()) {
      toast.error(t("contractorInvoicesPage.validation.invalidPeriod"));
      return;
    }
    setSaving(true);
    try {
      await apiPost("/global/invoices", {
        globalEmployeeId: form.globalEmployeeId,
        amount: Math.round(amtNum * 100),
        description: form.description || undefined,
        periodStart: form.periodStart,
        periodEnd: form.periodEnd,
      });
      toast.success(t("contractorInvoicesPage.messages.submitted"));
      setShowSubmit(false);
      setForm({
        globalEmployeeId: "",
        amount: "",
        description: "",
        periodStart: "",
        periodEnd: "",
      });
      qc.invalidateQueries({ queryKey: ["global-invoices"] });
    } catch (err: any) {
      toast.error(
        err.response?.data?.error?.message || t("contractorInvoicesPage.messages.submitFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (invoiceId: string) => {
    try {
      await apiPost(`/global/invoices/${invoiceId}/approve`);
      toast.success(t("contractorInvoicesPage.messages.approved"));
      qc.invalidateQueries({ queryKey: ["global-invoices"] });
    } catch (err: any) {
      toast.error(
        err.response?.data?.error?.message || t("contractorInvoicesPage.messages.approveFailed"),
      );
    }
  };

  const handleReject = async (invoiceId: string) => {
    if (!confirm(t("contractorInvoicesPage.messages.rejectConfirm"))) return;
    try {
      await apiPost(`/global/invoices/${invoiceId}/reject`);
      toast.success(t("contractorInvoicesPage.messages.rejected"));
      qc.invalidateQueries({ queryKey: ["global-invoices"] });
    } catch (err: any) {
      toast.error(
        err.response?.data?.error?.message || t("contractorInvoicesPage.messages.rejectFailed"),
      );
    }
  };

  const handleMarkPaid = async (invoiceId: string) => {
    try {
      await apiPost(`/global/invoices/${invoiceId}/paid`);
      toast.success(t("contractorInvoicesPage.messages.paid"));
      qc.invalidateQueries({ queryKey: ["global-invoices"] });
    } catch (err: any) {
      toast.error(
        err.response?.data?.error?.message || t("contractorInvoicesPage.messages.paidFailed"),
      );
    }
  };

  const columns = [
    {
      key: "invoice_number",
      header: t("contractorInvoicesPage.table.invoiceNumber"),
      render: (row: any) => <span className="font-mono text-sm">{row.invoice_number}</span>,
    },
    {
      key: "contractor",
      header: t("contractorInvoicesPage.table.contractor"),
      render: (row: any) => (
        <div>
          <p className="font-medium">{row.contractor_name}</p>
          <p className="text-xs text-gray-400">{row.contractor_email}</p>
        </div>
      ),
    },
    {
      key: "period",
      header: t("contractorInvoicesPage.table.period"),
      render: (row: any) => (
        <span className="text-sm">
          {new Date(row.period_start).toLocaleDateString(language)} -{" "}
          {new Date(row.period_end).toLocaleDateString(language)}
        </span>
      ),
    },
    {
      key: "amount",
      header: t("contractorInvoicesPage.table.amount"),
      render: (row: any) => (
        <span className="font-mono font-medium">
          {row.currency} {(Number(row.amount) / 100).toLocaleString(language)}
        </span>
      ),
    },
    {
      key: "status",
      header: t("contractorInvoicesPage.table.status"),
      render: (row: any) => (
        <Badge variant={STATUS_BADGE[row.status] || "draft"}>
          {t(`contractorInvoicesPage.statuses.${row.status}`, { defaultValue: row.status })}
        </Badge>
      ),
    },
    {
      key: "submitted_at",
      header: t("contractorInvoicesPage.table.submitted"),
      render: (row: any) => new Date(row.submitted_at).toLocaleDateString(language),
    },
    {
      key: "actions",
      header: t("contractorInvoicesPage.table.actions"),
      render: (row: any) => (
        <div className="flex gap-1">
          {row.status === "pending" && (
            <>
              <Button size="sm" variant="outline" onClick={() => handleApprove(row.id)}>
                <Check className="mr-1 h-3 w-3" />
                {t("contractorInvoicesPage.actions.approve")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-red-600"
                onClick={() => handleReject(row.id)}
                aria-label={t("contractorInvoicesPage.actions.reject")}
                title={t("contractorInvoicesPage.actions.reject")}
              >
                <X className="h-3 w-3" />
              </Button>
            </>
          )}
          {row.status === "approved" && (
            <Button size="sm" variant="outline" onClick={() => handleMarkPaid(row.id)}>
              <DollarSign className="mr-1 h-3 w-3" />
              {t("contractorInvoicesPage.actions.markPaid")}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("contractorInvoicesPage.title")}
        description={t("contractorInvoicesPage.description")}
        actions={
          <Button onClick={() => setShowSubmit(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t("contractorInvoicesPage.actions.submitInvoice")}
          </Button>
        }
      />

      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <SelectField
            className="w-40"
            options={[
              { value: "", label: t("contractorInvoicesPage.filters.allStatuses") },
              { value: "pending", label: t("contractorInvoicesPage.statuses.pending") },
              { value: "approved", label: t("contractorInvoicesPage.statuses.approved") },
              { value: "paid", label: t("contractorInvoicesPage.statuses.paid") },
              { value: "rejected", label: t("contractorInvoicesPage.statuses.rejected") },
            ]}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          />
        </CardContent>
      </Card>

      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={invoices}
          emptyMessage={t("contractorInvoicesPage.empty")}
        />
      )}

      {/* Submit Invoice Modal */}
      <Modal
        open={showSubmit}
        onClose={() => setShowSubmit(false)}
        title={t("contractorInvoicesPage.modal.title")}
      >
        <div className="space-y-4">
          {/* #120 — When the org has no contractor-type global employees, the
              dropdown was empty with no explanation. Show a clear empty state
              pointing to the right place to add contractors. */}
          <SelectField
            label={t("contractorInvoicesPage.modal.contractorLabel")}
            options={[
              {
                value: "",
                label:
                  contractorOptions.length > 0
                    ? t("contractorInvoicesPage.modal.selectContractor")
                    : t("contractorInvoicesPage.modal.noContractors"),
              },
              ...contractorOptions,
            ]}
            value={form.globalEmployeeId}
            onChange={(e) => setForm({ ...form, globalEmployeeId: e.target.value })}
            disabled={contractorOptions.length === 0}
          />
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t("contractorInvoicesPage.modal.amountLabel")}{" "}
              <span className="text-red-500">*</span>{" "}
              <span className="text-xs font-normal text-gray-400">
                ({t("contractorInvoicesPage.modal.amountUnitHint")})
              </span>
            </label>
            <div className="flex">
              <span className="inline-flex w-14 items-center justify-center rounded-l-md border border-r-0 border-gray-300 bg-gray-50 text-sm font-medium text-gray-600">
                {amountCurrency || "—"}
              </span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                className="focus:border-brand-500 focus:ring-brand-500 block w-full rounded-r-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1"
                placeholder="0.00"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t("contractorInvoicesPage.modal.periodStart")}
              type="date"
              value={form.periodStart}
              onChange={(e) => setForm({ ...form, periodStart: e.target.value })}
            />
            <Input
              label={t("contractorInvoicesPage.modal.periodEnd")}
              type="date"
              min={form.periodStart || undefined}
              value={form.periodEnd}
              onChange={(e) => setForm({ ...form, periodEnd: e.target.value })}
            />
          </div>
          <Input
            label={t("contractorInvoicesPage.modal.description")}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setShowSubmit(false)}>
              {t("contractorInvoicesPage.actions.cancel")}
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("contractorInvoicesPage.actions.submitInvoice")}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
