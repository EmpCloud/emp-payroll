import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { StatCard } from "@/components/ui/StatCard";
import { formatCurrency, formatDate } from "@/lib/utils";
import { apiGet, apiPost, apiPut, apiDelete } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDepartments } from "@/api/hooks";
import {
  Plus,
  BarChart3,
  Target,
  TrendingUp,
  TrendingDown,
  Minus,
  Loader2,
  Trash2,
  Pencil,
  FileUp,
} from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

export function BenchmarksPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"benchmarks" | "compa-ratio" | "below-market" | "above-market">(
    "benchmarks",
  );
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  // When set, the create modal re-purposes itself as an edit form pre-filled
  // with this row's values (issue #18 — edit button was missing entirely).
  const [editing, setEditing] = useState<any>(null);
  const qc = useQueryClient();

  const { data: benchRes, isLoading: benchLoading } = useQuery({
    queryKey: ["benchmarks"],
    queryFn: () => apiGet<any>("/benchmarks"),
  });

  const { data: compaRes, isLoading: compaLoading } = useQuery({
    queryKey: ["compa-ratio"],
    queryFn: () => apiGet<any>("/benchmarks/reports/compa-ratio"),
    // #150 — the Below/Above Market tabs drill into the same dataset, so we
    // need the compa-ratio fetch for any of those three tabs.
    enabled: tab === "compa-ratio" || tab === "below-market" || tab === "above-market",
  });

  const benchmarks = benchRes?.data || [];
  const compaData = compaRes?.data || {};
  const compaEmployees = compaData.employees || [];

  // #86 — pull real department list so Department is a dropdown (not a
  // free-text input where admins could type non-matching names).
  const { data: deptsData } = useDepartments();
  const departments: Array<{ id: number | string; name: string }> = deptsData?.data || [];
  const departmentOptions = departments.map((d) => ({ value: d.name, label: d.name }));

  function closeModal() {
    setShowCreate(false);
    setEditing(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const marketP25 = Number(fd.get("marketP25"));
    const marketP50 = Number(fd.get("marketP50"));
    const marketP75 = Number(fd.get("marketP75"));

    // #119 — Statistically the 25/50/75 percentiles must be ordered. Reject
    // the submit before hitting the API so the user sees the mistake inline
    // instead of a cryptic 400.
    if (!Number.isFinite(marketP25) || !Number.isFinite(marketP50) || !Number.isFinite(marketP75)) {
      toast.error(t("benchmarksPage.messages.validPercentiles"));
      return;
    }
    if (marketP25 < 0 || marketP50 < 0 || marketP75 < 0) {
      toast.error(t("benchmarksPage.messages.nonNegative"));
      return;
    }
    if (!(marketP25 <= marketP50 && marketP50 <= marketP75)) {
      toast.error(t("benchmarksPage.messages.ordered"));
      return;
    }

    setCreating(true);
    const payload = {
      jobTitle: fd.get("jobTitle"),
      department: fd.get("department"),
      location: fd.get("location"),
      marketP25,
      marketP50,
      marketP75,
      source: fd.get("source"),
      effectiveDate: fd.get("effectiveDate"),
    };
    try {
      if (editing) {
        await apiPut(`/benchmarks/${editing.id}`, payload);
        toast.success(t("benchmarksPage.messages.updated"));
      } else {
        await apiPost("/benchmarks", payload);
        toast.success(t("benchmarksPage.messages.created"));
      }
      closeModal();
      qc.invalidateQueries({ queryKey: ["benchmarks"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("benchmarksPage.messages.failed"));
    } finally {
      setCreating(false);
    }
  }

  async function deleteBenchmark(id: string) {
    try {
      await apiDelete(`/benchmarks/${id}`);
      toast.success(t("benchmarksPage.messages.deleted"));
      qc.invalidateQueries({ queryKey: ["benchmarks"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("benchmarksPage.messages.failed"));
    }
  }

  const benchColumns = [
    {
      key: "job_title",
      header: t("benchmarksPage.columns.jobTitle"),
      render: (r: any) => <span className="font-medium text-gray-900">{r.job_title}</span>,
    },
    { key: "department", header: t("benchmarksPage.columns.department") },
    { key: "location", header: t("benchmarksPage.columns.location") },
    { key: "market_p25", header: "P25", render: (r: any) => formatCurrency(r.market_p25) },
    {
      key: "market_p50",
      header: t("benchmarksPage.columns.p50Median"),
      render: (r: any) => <span className="font-semibold">{formatCurrency(r.market_p50)}</span>,
    },
    { key: "market_p75", header: "P75", render: (r: any) => formatCurrency(r.market_p75) },
    {
      key: "source",
      header: t("benchmarksPage.columns.source"),
      render: (r: any) => <span className="text-xs text-gray-500">{r.source || "—"}</span>,
    },
    {
      key: "effective_date",
      header: t("benchmarksPage.columns.effective"),
      render: (r: any) => formatDate(r.effective_date),
    },
    {
      key: "actions",
      header: "",
      render: (r: any) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            title={t("benchmarksPage.actions.edit")}
            onClick={() => {
              setEditing(r);
              setShowCreate(true);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            title={t("benchmarksPage.actions.delete")}
            onClick={() => deleteBenchmark(r.id)}
            className="text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const compaColumns = [
    {
      key: "name",
      header: t("benchmarksPage.columns.employee"),
      render: (r: any) => (
        <div>
          <p className="font-medium text-gray-900">
            {r.firstName} {r.lastName}
          </p>
          <p className="text-xs text-gray-500">{r.designation}</p>
        </div>
      ),
    },
    { key: "ctc", header: "CTC", render: (r: any) => formatCurrency(r.ctc) },
    {
      key: "benchmarkP50",
      header: t("benchmarksPage.columns.marketP50"),
      render: (r: any) =>
        r.benchmarkP50 ? (
          formatCurrency(r.benchmarkP50)
        ) : (
          <span className="text-gray-400">{t("benchmarksPage.labels.noBenchmark")}</span>
        ),
    },
    {
      key: "compaRatio",
      header: t("benchmarksPage.columns.compaRatio"),
      render: (r: any) => {
        if (r.compaRatio === null)
          return <span className="text-gray-400">{t("benchmarksPage.labels.notAvailable")}</span>;
        const color =
          r.compaRatio < 0.9
            ? "text-red-600"
            : r.compaRatio > 1.1
              ? "text-green-600"
              : "text-gray-900";
        return <span className={`font-semibold ${color}`}>{r.compaRatio.toFixed(2)}</span>;
      },
    },
    {
      key: "marketPosition",
      header: t("benchmarksPage.columns.position"),
      render: (r: any) => {
        if (r.marketPosition === "no_benchmark")
          return <Badge variant="draft">{t("benchmarksPage.labels.noData")}</Badge>;
        if (r.marketPosition === "below_market")
          return (
            <Badge variant="inactive">
              <TrendingDown className="mr-1 inline h-3 w-3" /> {t("benchmarksPage.labels.below")}
            </Badge>
          );
        if (r.marketPosition === "above_market")
          return (
            <Badge variant="approved">
              <TrendingUp className="mr-1 inline h-3 w-3" /> {t("benchmarksPage.labels.above")}
            </Badge>
          );
        return (
          <Badge variant="active">
            <Minus className="mr-1 inline h-3 w-3" /> {t("benchmarksPage.labels.atMarket")}
          </Badge>
        );
      },
    },
  ];

  const dist = compaData.distribution || {};

  return (
    <div>
      <PageHeader
        title={t("benchmarksPage.title")}
        description={t("benchmarksPage.description")}
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 h-4 w-4" /> {t("benchmarksPage.addBenchmark")}
          </Button>
        }
      />

      {/* Stats — cards drill into the matching tab (#85) */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("benchmarksPage.stats.benchmarks")}
          value={benchmarks.length}
          icon={BarChart3}
          onClick={() => setTab("benchmarks")}
        />
        <StatCard
          title={t("benchmarksPage.stats.avgCompaRatio")}
          value={compaData.averageCompaRatio?.toFixed(2) || "—"}
          icon={Target}
          onClick={() => setTab("compa-ratio")}
        />
        <StatCard
          title={t("benchmarksPage.stats.belowMarket")}
          value={dist.belowMarket || 0}
          icon={TrendingDown}
          onClick={() => setTab("below-market")}
        />
        <StatCard
          title={t("benchmarksPage.stats.aboveMarket")}
          value={dist.aboveMarket || 0}
          icon={TrendingUp}
          onClick={() => setTab("above-market")}
        />
      </div>

      {/* Tabs */}
      {/* #150 — Below/Above Market tabs added next to Compa-Ratio Report so
          the matching cards have a drill-in destination that scopes the table
          to just those employees. Counts reuse the same distribution numbers
          surfaced on the stat cards for consistency. */}
      <div className="mb-4 flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setTab("benchmarks")}
          className={`px-4 py-2 text-sm font-medium ${tab === "benchmarks" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          {t("benchmarksPage.tabs.marketBenchmarks", { count: benchmarks.length })}
        </button>
        <button
          onClick={() => setTab("compa-ratio")}
          className={`px-4 py-2 text-sm font-medium ${tab === "compa-ratio" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          {t("benchmarksPage.tabs.compaRatioReport")}
        </button>
        <button
          onClick={() => setTab("below-market")}
          className={`px-4 py-2 text-sm font-medium ${tab === "below-market" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          {t("benchmarksPage.tabs.belowMarket", { count: dist.belowMarket || 0 })}
        </button>
        <button
          onClick={() => setTab("above-market")}
          className={`px-4 py-2 text-sm font-medium ${tab === "above-market" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          {t("benchmarksPage.tabs.aboveMarket", { count: dist.aboveMarket || 0 })}
        </button>
      </div>

      {tab === "benchmarks" && (
        <Card>
          <CardContent className="p-0">
            {benchLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
              </div>
            ) : (
              <DataTable
                columns={benchColumns}
                data={benchmarks}
                emptyMessage={t("benchmarksPage.empty.benchmarks")}
              />
            )}
          </CardContent>
        </Card>
      )}

      {tab === "compa-ratio" && (
        <>
          {compaLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
            </div>
          ) : (
            <>
              {/* Distribution summary */}
              <Card className="mb-4">
                <CardContent className="p-4">
                  <div className="flex items-center gap-8 text-sm">
                    <span>
                      <strong>{compaData.totalEmployees || 0}</strong>{" "}
                      {t("benchmarksPage.summary.employeesTotal")}
                    </span>
                    <span>
                      <strong>{compaData.matchedToBenchmark || 0}</strong>{" "}
                      {t("benchmarksPage.summary.matchedToBenchmarks")}
                    </span>
                    <span>
                      <strong>{compaData.unmatchedCount || 0}</strong>{" "}
                      {t("benchmarksPage.summary.withoutBenchmarkData")}
                    </span>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-0">
                  <DataTable
                    columns={compaColumns}
                    data={compaEmployees}
                    emptyMessage={t("benchmarksPage.empty.employees")}
                  />
                </CardContent>
              </Card>
            </>
          )}
        </>
      )}

      {(tab === "below-market" || tab === "above-market") && (
        <>
          {compaLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
            </div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <DataTable
                  columns={compaColumns}
                  data={compaEmployees.filter(
                    (e: any) =>
                      e.marketPosition ===
                      (tab === "below-market" ? "below_market" : "above_market"),
                  )}
                  emptyMessage={
                    tab === "below-market"
                      ? t("benchmarksPage.empty.belowMarket")
                      : t("benchmarksPage.empty.aboveMarket")
                  }
                />
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Create / Edit Benchmark Modal — same form re-purposed as edit when
          `editing` is set. Issue #17: the P25/P50/P75 inputs now carry
          min=0 so the stepper can't decrement into negative salary values.
          Issue #18: the Edit button that populates `editing` and opens
          this modal was previously missing. */}
      <Modal
        open={showCreate}
        onClose={closeModal}
        title={editing ? t("benchmarksPage.modal.editTitle") : t("benchmarksPage.modal.addTitle")}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input
            label={t("benchmarksPage.modal.jobTitle")}
            name="jobTitle"
            placeholder={t("benchmarksPage.modal.jobTitlePlaceholder")}
            defaultValue={editing?.job_title || ""}
            required
          />
          <div className="grid grid-cols-2 gap-4">
            {/* #86 — was a free-text Input; now a SelectField wired to the
                org's real department list via useDepartments(). */}
            <SelectField
              label={t("benchmarksPage.modal.department")}
              name="department"
              defaultValue={editing?.department || ""}
              options={[
                {
                  value: "",
                  label:
                    departmentOptions.length > 0
                      ? t("benchmarksPage.modal.selectDepartment")
                      : t("benchmarksPage.modal.noDepartments"),
                },
                ...departmentOptions,
              ]}
            />
            <Input
              label={t("benchmarksPage.modal.location")}
              name="location"
              placeholder={t("benchmarksPage.modal.locationPlaceholder")}
              defaultValue={editing?.location || ""}
            />
          </div>
          {/* #87 — placeholders (e.g. 800000) make it obvious what shape
              the value takes, so users aren't left guessing whether to enter
              an annual total, lakhs, or a shorthand. min=1 + step=any on
              create forms nudges positive values. */}
          <div className="grid grid-cols-3 gap-4">
            <Input
              label={t("benchmarksPage.modal.p25Annual")}
              name="marketP25"
              type="number"
              min={0}
              step="any"
              placeholder={t("benchmarksPage.modal.p25Placeholder")}
              defaultValue={editing?.market_p25 ?? ""}
              required
            />
            <Input
              label={t("benchmarksPage.modal.p50Annual")}
              name="marketP50"
              type="number"
              min={0}
              step="any"
              placeholder={t("benchmarksPage.modal.p50Placeholder")}
              defaultValue={editing?.market_p50 ?? ""}
              required
            />
            <Input
              label={t("benchmarksPage.modal.p75Annual")}
              name="marketP75"
              type="number"
              min={0}
              step="any"
              placeholder={t("benchmarksPage.modal.p75Placeholder")}
              defaultValue={editing?.market_p75 ?? ""}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t("benchmarksPage.modal.source")}
              name="source"
              placeholder={t("benchmarksPage.modal.sourcePlaceholder")}
              defaultValue={editing?.source || ""}
            />
            <Input
              label={t("benchmarksPage.modal.effectiveDate")}
              name="effectiveDate"
              type="date"
              defaultValue={
                editing?.effective_date ? String(editing.effective_date).slice(0, 10) : ""
              }
              required
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closeModal}>
              {t("benchmarksPage.modal.cancel")}
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editing
                ? t("benchmarksPage.modal.updateBenchmark")
                : t("benchmarksPage.modal.saveBenchmark")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
