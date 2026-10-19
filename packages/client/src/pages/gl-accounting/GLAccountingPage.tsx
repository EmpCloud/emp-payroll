import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { StatCard } from "@/components/ui/StatCard";
import { apiGet, apiPost, apiPut, apiDelete } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, BookOpen, FileText, Download, ArrowRightLeft, Loader2, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

export function GLAccountingPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language;
  const formatCount = (value: number) => new Intl.NumberFormat(language).format(value);
  const formatAccountingCurrency = (value: number) =>
    new Intl.NumberFormat(language, {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 0,
    }).format(Number(value) || 0);
  const formatAccountingDate = (value: string | Date) =>
    new Intl.DateTimeFormat(language, {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(value));

  // #174 — "Exported" stat card now drills into a dedicated sub-tab that
  // lists only journals with status="exported". "Total Approved" card was
  // removed — it was always 0 in practice and had no meaningful drill-in.
  const [tab, setTab] = useState<"mappings" | "journals" | "exported">("mappings");
  const [showCreateMapping, setShowCreateMapping] = useState(false);
  const [showGenerateJournal, setShowGenerateJournal] = useState(false);
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();

  const { data: mappingsRes, isLoading: mappingsLoading } = useQuery({
    queryKey: ["gl-mappings"],
    queryFn: () => apiGet<any>("/gl/mappings"),
  });

  const { data: journalsRes, isLoading: journalsLoading } = useQuery({
    queryKey: ["gl-journals"],
    queryFn: () => apiGet<any>("/gl/journals"),
  });

  const { data: runsRes } = useQuery({
    queryKey: ["payroll-runs"],
    queryFn: () => apiGet<any>("/payroll"),
  });

  const mappings = mappingsRes?.data || [];
  const journals = journalsRes?.data || [];
  // /payroll returns { success, data: { data: [...], total } } — one extra level of nesting
  const runs = runsRes?.data?.data || [];

  async function handleCreateMapping(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const glAccountCode = String(fd.get("glAccountCode") || "").trim();

    // #107 — Account codes are accounting ledger identifiers (e.g. 4001, 5100).
    // Negative or non-numeric values have no accounting meaning, so reject
    // them client-side before hitting the API.
    if (!/^[0-9]+$/.test(glAccountCode)) {
      toast.error(t("glAccountingPage.validation.accountCode"));
      return;
    }

    setCreating(true);
    try {
      await apiPost("/gl/mappings", {
        payComponent: fd.get("payComponent"),
        glAccountCode,
        glAccountName: fd.get("glAccountName"),
        description: fd.get("description"),
      });
      toast.success(t("glAccountingPage.messages.mappingCreated"));
      setShowCreateMapping(false);
      qc.invalidateQueries({ queryKey: ["gl-mappings"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("glAccountingPage.messages.failed"));
    } finally {
      setCreating(false);
    }
  }

  async function handleGenerateJournal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    const fd = new FormData(e.currentTarget);
    try {
      await apiPost("/gl/journals/generate", {
        payrollRunId: fd.get("payrollRunId"),
      });
      toast.success(t("glAccountingPage.messages.journalGenerated"));
      setShowGenerateJournal(false);
      qc.invalidateQueries({ queryKey: ["gl-journals"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("glAccountingPage.messages.failed"));
    } finally {
      setCreating(false);
    }
  }

  async function deleteMapping(id: string) {
    try {
      await apiDelete(`/gl/mappings/${id}`);
      toast.success(t("glAccountingPage.messages.mappingDeleted"));
      qc.invalidateQueries({ queryKey: ["gl-mappings"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("glAccountingPage.messages.failed"));
    }
  }

  function exportJournal(id: string, format: string) {
    const token = localStorage.getItem("access_token");
    const base = import.meta.env.VITE_API_URL || "/api/v1";
    window.open(`${base}/gl/journals/${id}/export/${format}?token=${token}`, "_blank");
  }

  const mappingColumns = [
    {
      key: "pay_component",
      header: t("glAccountingPage.mappingTable.payComponent"),
      render: (r: any) => <span className="font-medium text-gray-900">{r.pay_component}</span>,
    },
    {
      key: "gl_account_code",
      header: t("glAccountingPage.mappingTable.accountCode"),
      render: (r: any) => (
        <code className="rounded bg-gray-100 px-2 py-0.5 text-sm">{r.gl_account_code}</code>
      ),
    },
    { key: "gl_account_name", header: t("glAccountingPage.mappingTable.accountName") },
    { key: "description", header: t("glAccountingPage.mappingTable.description") },
    {
      key: "actions",
      header: "",
      render: (r: any) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => deleteMapping(r.id)}
          className="text-red-600"
          title={t("glAccountingPage.actions.deleteMapping")}
          aria-label={t("glAccountingPage.actions.deleteMapping")}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const journalColumns = [
    {
      key: "entry_date",
      header: t("glAccountingPage.journalTable.date"),
      render: (r: any) => formatAccountingDate(r.entry_date),
    },
    {
      key: "payroll_run_id",
      header: t("glAccountingPage.journalTable.payrollRun"),
      render: (r: any) => (
        <span className="font-mono text-xs">{r.payroll_run_id?.slice(0, 8)}...</span>
      ),
    },
    {
      key: "total_debit",
      header: t("glAccountingPage.journalTable.totalDebit"),
      render: (r: any) => formatAccountingCurrency(r.total_debit),
    },
    {
      key: "total_credit",
      header: t("glAccountingPage.journalTable.totalCredit"),
      render: (r: any) => formatAccountingCurrency(r.total_credit),
    },
    {
      key: "status",
      header: t("glAccountingPage.journalTable.status"),
      render: (r: any) => (
        <Badge
          variant={
            r.status === "exported" ? "approved" : r.status === "posted" ? "active" : "draft"
          }
        >
          {t(`glAccountingPage.statuses.${r.status}`, { defaultValue: r.status })}
        </Badge>
      ),
    },
    {
      key: "export",
      header: t("glAccountingPage.journalTable.export"),
      render: (r: any) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => exportJournal(r.id, "tally")}
            title={t("glAccountingPage.exports.tallyTitle")}
          >
            <Download className="mr-1 h-3 w-3" /> Tally
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => exportJournal(r.id, "quickbooks")}
            title={t("glAccountingPage.exports.quickbooksTitle")}
          >
            QB
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => exportJournal(r.id, "zoho")}
            title={t("glAccountingPage.exports.zohoTitle")}
          >
            Zoho
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("glAccountingPage.title")}
        description={t("glAccountingPage.description")}
        actions={
          <div className="flex gap-2">
            <Button onClick={() => setShowGenerateJournal(true)}>
              <FileText className="mr-2 h-4 w-4" />
              {t("glAccountingPage.actions.generateJournal")}
            </Button>
            <Button onClick={() => setShowCreateMapping(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t("glAccountingPage.actions.addMapping")}
            </Button>
          </div>
        }
      />

      {/* Stats — cards drill into matching tab (#105, #174). "Approved" was
          removed — it was always 0 in this org's data and had no useful
          destination. "Exported" now opens its own Exported tab sitting
          beside Journal Entries so users can find just those rows. */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          title={t("glAccountingPage.stats.mappings")}
          value={formatCount(mappings.length)}
          icon={ArrowRightLeft}
          onClick={() => setTab("mappings")}
        />
        <StatCard
          title={t("glAccountingPage.stats.journals")}
          value={formatCount(journals.length)}
          icon={BookOpen}
          onClick={() => setTab("journals")}
        />
        <StatCard
          title={t("glAccountingPage.stats.exported")}
          value={formatCount(journals.filter((j: any) => j.status === "exported").length)}
          icon={Download}
          onClick={() => setTab("exported")}
        />
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setTab("mappings")}
          className={`px-4 py-2 text-sm font-medium ${tab === "mappings" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          {t("glAccountingPage.tabs.mappings")} ({formatCount(mappings.length)})
        </button>
        <button
          onClick={() => setTab("journals")}
          className={`px-4 py-2 text-sm font-medium ${tab === "journals" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          {t("glAccountingPage.tabs.journals")} ({formatCount(journals.length)})
        </button>
        <button
          onClick={() => setTab("exported")}
          className={`px-4 py-2 text-sm font-medium ${tab === "exported" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          {t("glAccountingPage.tabs.exported")} (
          {formatCount(journals.filter((j: any) => j.status === "exported").length)})
        </button>
      </div>

      {tab === "mappings" && (
        <Card>
          <CardContent className="p-0">
            {mappingsLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
              </div>
            ) : (
              <DataTable
                columns={mappingColumns}
                data={mappings}
                emptyMessage={t("glAccountingPage.empty.mappings")}
              />
            )}
          </CardContent>
        </Card>
      )}

      {tab === "journals" && (
        <Card>
          <CardContent className="p-0">
            {journalsLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
              </div>
            ) : (
              <DataTable
                columns={journalColumns}
                data={journals}
                emptyMessage={t("glAccountingPage.empty.journals")}
              />
            )}
          </CardContent>
        </Card>
      )}

      {tab === "exported" && (
        <Card>
          <CardContent className="p-0">
            {journalsLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
              </div>
            ) : (
              <DataTable
                columns={journalColumns}
                data={journals.filter((j: any) => j.status === "exported")}
                emptyMessage={t("glAccountingPage.empty.exported")}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Create Mapping Modal */}
      <Modal
        open={showCreateMapping}
        onClose={() => setShowCreateMapping(false)}
        title={t("glAccountingPage.mappingModal.title")}
      >
        <form onSubmit={handleCreateMapping} className="space-y-4">
          <Input
            label={t("glAccountingPage.mappingModal.payComponentCode")}
            name="payComponent"
            placeholder={t("glAccountingPage.mappingModal.payComponentPlaceholder")}
            required
          />
          <Input
            label={t("glAccountingPage.mappingModal.accountCode")}
            name="glAccountCode"
            placeholder={t("glAccountingPage.mappingModal.accountCodePlaceholder")}
            required
          />
          <Input
            label={t("glAccountingPage.mappingModal.accountName")}
            name="glAccountName"
            placeholder={t("glAccountingPage.mappingModal.accountNamePlaceholder")}
            required
          />
          <Input label={t("glAccountingPage.mappingModal.description")} name="description" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowCreateMapping(false)}>
              {t("glAccountingPage.actions.cancel")}
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("glAccountingPage.actions.saveMapping")}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Generate Journal Modal */}
      <Modal
        open={showGenerateJournal}
        onClose={() => setShowGenerateJournal(false)}
        title={t("glAccountingPage.journalModal.title")}
      >
        <form onSubmit={handleGenerateJournal} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">
              {t("glAccountingPage.journalModal.payrollRun")}
            </label>
            <select
              name="payrollRunId"
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">{t("glAccountingPage.journalModal.selectRun")}</option>
              {runs.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.name} — {t(`payrollRuns.statuses.${r.status}`, { defaultValue: r.status })} (
                  {formatAccountingCurrency(r.total_net)})
                </option>
              ))}
            </select>
          </div>
          <p className="text-sm text-gray-500">{t("glAccountingPage.journalModal.help")}</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowGenerateJournal(false)}>
              {t("glAccountingPage.actions.cancel")}
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("glAccountingPage.actions.generate")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
