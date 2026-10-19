import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/SelectField";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { apiGet, apiPost } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, Eye, Check, DollarSign } from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

const STATUS_BADGE: Record<string, "active" | "draft" | "inactive"> = {
  draft: "draft",
  processing: "draft",
  approved: "active",
  paid: "active",
  cancelled: "inactive",
};

const MONTH_NUMBERS = Array.from({ length: 12 }, (_, index) => index + 1);

export function GlobalPayrollRunsPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language;
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [countryId, setCountryId] = useState("");
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [statusFilter, setStatusFilter] = useState("");

  const { data: countriesRes } = useQuery({
    queryKey: ["global-countries"],
    queryFn: () => apiGet<any>("/global/countries"),
  });

  // #154 — Filter the Create Run country picker down to only countries that
  // actually have active EOR/direct-hire employees. Without this, users
  // could select a country with no payable employees and hit the server's
  // "No active EOR/direct-hire employees found in <Country>" error after
  // the fact. Pulling the employee list up-front lets us prune the
  // dropdown instead.
  const { data: globalEmployeesRes } = useQuery({
    queryKey: ["global-employees-for-runs"],
    queryFn: () => apiGet<any>("/global/employees"),
  });

  const { data: runsRes, isLoading } = useQuery({
    queryKey: ["global-payroll-runs", statusFilter],
    queryFn: () =>
      apiGet<any>("/global/payroll-runs", {
        status: statusFilter || undefined,
      }),
  });

  const { data: detailRes, isLoading: detailLoading } = useQuery({
    queryKey: ["global-payroll-run", showDetail],
    queryFn: () => apiGet<any>(`/global/payroll-runs/${showDetail}`),
    enabled: !!showDetail,
  });

  const countries = countriesRes?.data || [];
  const runs = runsRes?.data || [];
  const runDetail = detailRes?.data;
  const monthOptions = MONTH_NUMBERS.map((monthNumber) => ({
    value: String(monthNumber),
    label: new Intl.DateTimeFormat(language, { month: "long" }).format(
      new Date(2020, monthNumber - 1, 1),
    ),
  }));
  const formatAmount = (value: number | string) => (Number(value) / 100).toLocaleString(language);
  const formatPeriod = (periodMonth: number, periodYear: number) =>
    new Intl.DateTimeFormat(language, { month: "long", year: "numeric" }).format(
      new Date(periodYear, periodMonth - 1, 1),
    );

  // Country IDs where we have at least one active employee. Originally
  // narrowed to EOR/direct-hire only (#154), but that excluded countries
  // where the org had only contractors and meant 'India' was the only
  // pickable option for orgs with non-Indian contractors (#210). Show
  // every country with any active global employee; the backend still
  // returns a clear error if the country has no payable employees.
  const globalEmployees: any[] = globalEmployeesRes?.data || [];
  const payableCountryIds = new Set(
    globalEmployees.filter((e) => e.status === "active").map((e) => e.country_id),
  );

  const countryOptions = countries
    .filter((c: any) => payableCountryIds.has(c.id))
    .map((c: any) => ({
      value: c.id,
      label: `${c.name} (${c.currency})`,
    }));

  const yearOptions = Array.from({ length: 5 }, (_, i) => {
    const y = new Date().getFullYear() - 1 + i;
    return { value: String(y), label: String(y) };
  });

  const handleCreate = async () => {
    if (!countryId) {
      toast.error(t("globalPayrollRuns.messages.selectCountry"));
      return;
    }
    setSaving(true);
    try {
      await apiPost("/global/payroll-runs", {
        countryId,
        month: Number(month),
        year: Number(year),
      });
      toast.success(t("payrollRuns.created"));
      setShowCreate(false);
      qc.invalidateQueries({ queryKey: ["global-payroll-runs"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("payrollRuns.createFailed"));
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (runId: string) => {
    try {
      await apiPost(`/global/payroll-runs/${runId}/approve`);
      toast.success(t("globalPayrollRuns.messages.approved"));
      qc.invalidateQueries({ queryKey: ["global-payroll-runs"] });
      qc.invalidateQueries({ queryKey: ["global-payroll-run", runId] });
    } catch (err: any) {
      toast.error(
        err.response?.data?.error?.message || t("globalPayrollRuns.messages.approveFailed"),
      );
    }
  };

  const handleMarkPaid = async (runId: string) => {
    try {
      await apiPost(`/global/payroll-runs/${runId}/paid`);
      toast.success(t("globalPayrollRuns.messages.markedPaid"));
      qc.invalidateQueries({ queryKey: ["global-payroll-runs"] });
      qc.invalidateQueries({ queryKey: ["global-payroll-run", runId] });
    } catch (err: any) {
      toast.error(
        err.response?.data?.error?.message || t("globalPayrollRuns.messages.markPaidFailed"),
      );
    }
  };

  const columns = [
    {
      key: "country",
      header: t("globalPayrollRuns.columns.country"),
      render: (row: any) => <span className="font-medium">{row.country_name}</span>,
    },
    {
      key: "period",
      header: t("globalPayrollRuns.columns.period"),
      render: (row: any) => formatPeriod(row.period_month, row.period_year),
    },
    {
      key: "status",
      header: t("globalPayrollRuns.columns.status"),
      render: (row: any) => (
        <Badge variant={STATUS_BADGE[row.status] || "draft"}>
          {t(`payrollRuns.statuses.${row.status}`, { defaultValue: row.status })}
        </Badge>
      ),
    },
    {
      key: "total_gross",
      header: t("globalPayrollRuns.columns.gross"),
      render: (row: any) => (
        <span className="font-mono text-sm">
          {row.currency_symbol || row.currency} {formatAmount(row.total_gross)}
        </span>
      ),
    },
    {
      key: "total_net",
      header: t("globalPayrollRuns.columns.net"),
      render: (row: any) => (
        <span className="font-mono text-sm text-green-600">
          {row.currency_symbol || row.currency} {formatAmount(row.total_net)}
        </span>
      ),
    },
    {
      key: "total_employer_cost",
      header: t("globalPayrollRuns.columns.employerCost"),
      render: (row: any) => (
        <span className="font-mono text-sm text-red-600">
          {row.currency_symbol || row.currency} {formatAmount(row.total_employer_cost)}
        </span>
      ),
    },
    {
      key: "actions",
      header: t("globalPayrollRuns.columns.actions"),
      render: (row: any) => (
        <div className="flex gap-1">
          <Button
            size="sm"
            variant="outline"
            aria-label={t("globalPayrollRuns.actions.view")}
            title={t("globalPayrollRuns.actions.view")}
            onClick={() => setShowDetail(row.id)}
          >
            <Eye className="h-3 w-3" />
          </Button>
          {row.status === "draft" && (
            <Button size="sm" variant="outline" onClick={() => handleApprove(row.id)}>
              <Check className="mr-1 h-3 w-3" />
              {t("globalPayrollRuns.actions.approve")}
            </Button>
          )}
          {row.status === "approved" && (
            <Button size="sm" variant="outline" onClick={() => handleMarkPaid(row.id)}>
              <DollarSign className="mr-1 h-3 w-3" />
              {t("globalPayrollRuns.actions.markPaid")}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title={t("globalPayrollRuns.title")}
        description={t("globalPayrollRuns.description")}
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t("payrollRuns.createRun")}
          </Button>
        }
      />

      {/* Filters */}
      <Card>
        <CardContent className="flex items-center gap-3 p-4">
          <SelectField
            className="w-40"
            aria-label={t("globalPayrollRuns.statusFilter")}
            options={[
              { value: "", label: t("globalPayrollRuns.allStatuses") },
              { value: "draft", label: t("payrollRuns.statuses.draft") },
              { value: "approved", label: t("payrollRuns.statuses.approved") },
              { value: "paid", label: t("payrollRuns.statuses.paid") },
              { value: "cancelled", label: t("payrollRuns.statuses.cancelled") },
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
        <DataTable columns={columns} data={runs} emptyMessage={t("globalPayrollRuns.empty")} />
      )}

      {/* Create Run Modal */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title={t("globalPayrollRuns.createModal.title")}
      >
        <div className="space-y-4">
          {/* #118/#154 — When there are no *payable* countries (i.e. none
              with an active EOR or direct-hire employee), keep the dropdown
              empty with an explanatory label so users don't submit into
              "no employees in <country>" errors. */}
          <SelectField
            label={t("globalPayrollRuns.createModal.country")}
            options={[
              {
                value: "",
                label:
                  countryOptions.length > 0
                    ? t("globalPayrollRuns.createModal.selectCountry")
                    : t("globalPayrollRuns.createModal.noCountries"),
              },
              ...countryOptions,
            ]}
            value={countryId}
            onChange={(e) => setCountryId(e.target.value)}
            disabled={countryOptions.length === 0}
          />
          <div className="grid grid-cols-2 gap-4">
            <SelectField
              label={t("payrollRuns.month")}
              options={monthOptions}
              value={month}
              onChange={(e) => setMonth(e.target.value)}
            />
            <SelectField
              label={t("payrollRuns.year")}
              options={yearOptions}
              value={year}
              onChange={(e) => setYear(e.target.value)}
            />
          </div>
          <p className="text-xs text-gray-500">
            {t("globalPayrollRuns.createModal.calculationNotice")}
          </p>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              {t("payrollRuns.cancel")}
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("payrollRuns.createRun")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Run Detail Modal */}
      <Modal
        open={!!showDetail}
        onClose={() => setShowDetail(null)}
        title={t("globalPayrollRuns.detailModal.title", {
          country: runDetail?.country_name || "",
        })}
      >
        {detailLoading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
          </div>
        ) : runDetail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-4 text-center">
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                <p className="text-xs text-gray-500">{t("globalPayrollRuns.columns.gross")}</p>
                <p className="text-sm font-bold">
                  {runDetail.currency_symbol} {formatAmount(runDetail.total_gross)}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                <p className="text-xs text-gray-500">{t("globalPayrollRuns.columns.deductions")}</p>
                <p className="text-sm font-bold text-orange-600">
                  {runDetail.currency_symbol} {formatAmount(runDetail.total_deductions)}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                <p className="text-xs text-gray-500">{t("globalPayrollRuns.detailModal.netPay")}</p>
                <p className="text-sm font-bold text-green-600">
                  {runDetail.currency_symbol} {formatAmount(runDetail.total_net)}
                </p>
              </div>
              <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
                <p className="text-xs text-gray-500">
                  {t("globalPayrollRuns.columns.employerCost")}
                </p>
                <p className="text-sm font-bold text-red-600">
                  {runDetail.currency_symbol} {formatAmount(runDetail.total_employer_cost)}
                </p>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="pb-2 font-medium text-gray-500">
                      {t("globalPayrollRuns.detailModal.employee")}
                    </th>
                    <th className="pb-2 text-right font-medium text-gray-500">
                      {t("globalPayrollRuns.columns.gross")}
                    </th>
                    <th className="pb-2 text-right font-medium text-gray-500">
                      {t("globalPayrollRuns.detailModal.tax")}
                    </th>
                    <th className="pb-2 text-right font-medium text-gray-500">
                      {t("globalPayrollRuns.detailModal.socialSecurityEmployee")}
                    </th>
                    <th className="pb-2 text-right font-medium text-gray-500">
                      {t("globalPayrollRuns.detailModal.pensionEmployee")}
                    </th>
                    <th className="pb-2 text-right font-medium text-gray-500">
                      {t("globalPayrollRuns.columns.net")}
                    </th>
                    <th className="pb-2 text-right font-medium text-gray-500">
                      {t("globalPayrollRuns.columns.employerCost")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {runDetail.items?.map((item: any) => (
                    <tr key={item.id} className="border-b border-gray-100 dark:border-gray-800">
                      <td className="py-2">
                        <p className="font-medium">{item.employee_name}</p>
                        <p className="text-gray-400">{item.employee_email}</p>
                      </td>
                      <td className="py-2 text-right font-mono">
                        {formatAmount(item.gross_salary)}
                      </td>
                      <td className="py-2 text-right font-mono text-orange-600">
                        {formatAmount(item.tax_amount)}
                      </td>
                      <td className="py-2 text-right font-mono">
                        {formatAmount(item.social_security_employee)}
                      </td>
                      <td className="py-2 text-right font-mono">
                        {formatAmount(item.pension_employee)}
                      </td>
                      <td className="py-2 text-right font-mono text-green-600">
                        {formatAmount(item.net_salary)}
                      </td>
                      <td className="py-2 text-right font-mono font-bold text-red-600">
                        {formatAmount(item.total_employer_cost)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              {runDetail.status === "draft" && (
                <Button
                  size="sm"
                  onClick={() => {
                    handleApprove(runDetail.id);
                    setShowDetail(null);
                  }}
                >
                  <Check className="mr-1 h-3 w-3" />
                  {t("globalPayrollRuns.actions.approve")}
                </Button>
              )}
              {runDetail.status === "approved" && (
                <Button
                  size="sm"
                  onClick={() => {
                    handleMarkPaid(runDetail.id);
                    setShowDetail(null);
                  }}
                >
                  <DollarSign className="mr-1 h-3 w-3" />
                  {t("globalPayrollRuns.actions.markPaid")}
                </Button>
              )}
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
