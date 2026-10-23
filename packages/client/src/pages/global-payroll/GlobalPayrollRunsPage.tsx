import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
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
import type { UaePeriodInput } from "@emp-payroll/shared";
import { Input } from "@/components/ui/Input";
import { UaePeriodForm } from "@/components/uae/UaePeriodForm";
import { UaeRunDetails } from "@/components/uae/UaeRunDetails";
import { UaeGratuityReport } from "@/components/uae/UaeGratuityReport";
import type { UaeExitPreparation } from "@/components/uae/UaeExitSettlement";
import { assertUaeFormValues, isUaeEmployeeForPeriod } from "@/lib/uae-payroll";

const STATUS_BADGE: Record<string, "active" | "draft" | "inactive"> = {
  draft: "draft",
  processing: "draft",
  locked: "draft",
  approved: "active",
  paid: "active",
  cancelled: "inactive",
};

const MONTH_NUMBERS = Array.from({ length: 12 }, (_, index) => index + 1);

export function GlobalPayrollRunsPage() {
  const { t, i18n } = useTranslation();
  const language = i18n.resolvedLanguage || i18n.language;
  const qc = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [showCreate, setShowCreate] = useState(false);
  const [showDetail, setShowDetail] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [countryId, setCountryId] = useState("");
  const [month, setMonth] = useState(String(new Date().getMonth() + 1));
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [statusFilter, setStatusFilter] = useState("");
  const [uaeInputs, setUaeInputs] = useState<Record<string, UaePeriodInput>>({});
  const [uaeEmployer, setUaeEmployer] = useState({ name: "", address: "", registrationNumber: "" });
  const [uaeSchedule, setUaeSchedule] = useState({
    lockDaysBeforeDue: 5,
    approvalDaysBeforeDue: 3,
  });
  const [dirtyUaeRun, setDirtyUaeRun] = useState<string | null>(null);
  useEffect(() => {
    const state = location.state as {
      uaeExitPreparation?: UaeExitPreparation;
      uaeRunId?: string;
    } | null;
    const prepared = state?.uaeExitPreparation;
    if (prepared?.runId || state?.uaeRunId) {
      setShowDetail(prepared?.runId || state?.uaeRunId || null);
    } else if (prepared) {
      setCountryId(String(prepared.countryId));
      setMonth(String(prepared.month));
      setYear(String(prepared.year));
      setUaeInputs({ [prepared.globalEmployeeId]: prepared.uaeInput });
      setShowCreate(true);
    } else return;
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, navigate]);

  const {
    data: countriesRes,
    isLoading: countriesLoading,
    isError: countriesError,
    refetch: refetchCountries,
  } = useQuery({
    queryKey: ["global-countries"],
    queryFn: () => apiGet<any>("/global/countries"),
  });

  // Employee records populate UAE period inputs; they do not define which
  // countries are available. The server validates payroll eligibility.
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
  const selectedCountry = countries.find(
    (country: any) => String(country.id) === String(countryId),
  );
  const isUaeCreate = selectedCountry?.code === "AE";
  const isUaeDetail = runDetail?.country_code === "AE";
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

  const globalEmployees: any[] = globalEmployeesRes?.data || [];
  const countryOptions = countries.map((country: any) => ({
    value: String(country.id),
    label: `${country.name} (${country.currency})`,
  }));
  const uaeEmployees = globalEmployees.filter(
    (employee) =>
      String(employee.country_id) === String(countryId) &&
      isUaeEmployeeForPeriod(employee, Number(month), Number(year)),
  );

  const yearOptions = Array.from({ length: 5 }, (_, i) => {
    const y = new Date().getFullYear() - 1 + i;
    return { value: String(y), label: String(y) };
  });

  const handleCreate = async () => {
    if (!selectedCountry) {
      toast.error(t("globalPayrollRuns.messages.selectCountry"));
      return;
    }
    setSaving(true);
    try {
      if (isUaeCreate) {
        if (!uaeEmployer.name.trim())
          throw new Error("Enter the employer’s legal name for payslips.");
        if (Number(year) < 2026 || (Number(year) === 2026 && Number(month) < 6))
          throw new Error("UAE payroll is supported from June 2026 onward.");
        assertUaeFormValues(uaeInputs);
      }
      await apiPost("/global/payroll-runs", {
        countryId,
        month: Number(month),
        year: Number(year),
        ...(isUaeCreate
          ? {
              uaeInputs: Object.fromEntries(
                uaeEmployees
                  .filter(
                    (employee) =>
                      employee.status === "active" || uaeInputs[employee.id]?.finalSettlement,
                  )
                  .map((employee) => [employee.id, uaeInputs[employee.id] || {}]),
              ),
              uaeEmployer,
              uaeSchedule,
            }
          : {}),
      });
      toast.success(t("payrollRuns.created"));
      setShowCreate(false);
      setUaeInputs({});
      qc.invalidateQueries({ queryKey: ["global-payroll-runs"] });
    } catch (err: any) {
      toast.error(
        err.response?.data?.error?.message || err.message || t("payrollRuns.createFailed"),
      );
    } finally {
      setSaving(false);
    }
  };

  const handleApprove = async (runId: string, expectedRevision?: number) => {
    try {
      await apiPost(
        `/global/payroll-runs/${runId}/approve`,
        expectedRevision == null ? undefined : { expectedRevision },
      );
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
      render: (row: any) => (
        <div>
          {formatPeriod(row.period_month, row.period_year)}
          {row.uae_calendar && (
            <p
              className={`mt-1 text-xs ${row.uae_calendar.isOverdue ? "text-amber-700" : "text-gray-500"}`}
            >
              Lock {row.uae_calendar.lockDate} · Approve {row.uae_calendar.approvalDate} · Pay{" "}
              {row.uae_calendar.paymentDueDate}
            </p>
          )}
        </div>
      ),
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
            onClick={() => {
              setShowDetail(row.id);
              setDirtyUaeRun(null);
            }}
          >
            <Eye className="h-3 w-3" />
          </Button>
          {(row.status === "draft" || (row.country_code === "AE" && row.status === "locked")) && (
            <Button
              size="sm"
              variant="outline"
              disabled={dirtyUaeRun === row.id}
              onClick={() =>
                row.country_code === "AE" ? setShowDetail(row.id) : handleApprove(row.id)
              }
            >
              <Check className="mr-1 h-3 w-3" />
              {row.country_code === "AE"
                ? row.status === "locked"
                  ? "Review and approve"
                  : "Review and lock"
                : t("globalPayrollRuns.actions.approve")}
            </Button>
          )}
          {row.status === "approved" && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                row.country_code === "AE" ? setShowDetail(row.id) : handleMarkPaid(row.id)
              }
            >
              <DollarSign className="mr-1 h-3 w-3" />
              {row.country_code === "AE"
                ? "Reconcile payments"
                : t("globalPayrollRuns.actions.markPaid")}
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
          <div className="flex flex-wrap gap-2">
            <UaeGratuityReport />
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="mr-2 h-4 w-4" />
              {t("payrollRuns.createRun")}
            </Button>
          </div>
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
              { value: "locked", label: "Locked" },
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
        className={isUaeCreate ? "max-w-4xl" : undefined}
      >
        <div className="space-y-4">
          <SelectField
            id="global-payroll-country"
            label={t("globalPayrollRuns.createModal.country")}
            options={[
              {
                value: "",
                label: countriesLoading
                  ? t("common.loading")
                  : countryOptions.length > 0
                    ? t("globalPayrollRuns.createModal.selectCountry")
                    : t(
                        "globalPayrollRuns.createModal.noCountriesAvailable",
                        "No active countries are available.",
                      ),
              },
              ...countryOptions,
            ]}
            value={countryId}
            onChange={(e) => setCountryId(e.target.value)}
            disabled={countriesLoading || countriesError || countryOptions.length === 0}
          />
          {countriesError && (
            <div role="alert" className="space-y-2 text-sm text-red-700">
              <p>
                {t(
                  "globalPayrollRuns.createModal.countriesLoadFailed",
                  "Could not load countries. Please try again.",
                )}
              </p>
              <Button variant="outline" onClick={() => void refetchCountries()}>
                {t("globalPayrollRuns.createModal.retryCountries", "Retry loading countries")}
              </Button>
            </div>
          )}
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
            {isUaeCreate
              ? "UAE payroll is supported from June 2026 onward. Review effective employee profiles and this period’s inputs before creating the draft."
              : t("globalPayrollRuns.createModal.calculationNotice")}
          </p>
          {isUaeCreate && (
            <div className="space-y-4">
              <fieldset className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
                <legend className="px-1 font-medium">Payroll cutoffs and reminders</legend>
                <Input
                  label="Lock inputs days before payment due"
                  aria-label="Lock inputs days before payment due"
                  type="number"
                  min="0"
                  max="31"
                  value={uaeSchedule.lockDaysBeforeDue}
                  onChange={(e) =>
                    setUaeSchedule({ ...uaeSchedule, lockDaysBeforeDue: Number(e.target.value) })
                  }
                />
                <Input
                  label="Approve days before payment due"
                  aria-label="Approve days before payment due"
                  type="number"
                  min="0"
                  max="31"
                  value={uaeSchedule.approvalDaysBeforeDue}
                  onChange={(e) =>
                    setUaeSchedule({
                      ...uaeSchedule,
                      approvalDaysBeforeDue: Number(e.target.value),
                    })
                  }
                />
              </fieldset>
              <fieldset className="space-y-3 rounded-lg border p-4">
                <legend className="px-1 font-medium">Employer identity on payslips</legend>
                <Input
                  label="Employer legal name"
                  aria-label="Employer legal name"
                  value={uaeEmployer.name}
                  onChange={(e) => setUaeEmployer({ ...uaeEmployer, name: e.target.value })}
                />
                <Input
                  label="Employer address"
                  aria-label="Employer address"
                  value={uaeEmployer.address}
                  onChange={(e) => setUaeEmployer({ ...uaeEmployer, address: e.target.value })}
                />
                <Input
                  label="Employer registration number"
                  aria-label="Employer registration number"
                  value={uaeEmployer.registrationNumber}
                  onChange={(e) =>
                    setUaeEmployer({ ...uaeEmployer, registrationNumber: e.target.value })
                  }
                />
              </fieldset>
              {uaeEmployees.map((employee) => (
                <details key={employee.id} className="space-y-3 rounded-lg border p-4">
                  <summary className="cursor-pointer text-sm font-medium">
                    {employee.first_name} {employee.last_name} · {employee.status}
                    {!employee.uae_profile
                      ? " · Needs UAE profile configuration"
                      : ` · ${employee.uae_profile.jurisdiction.toUpperCase()}`}
                  </summary>
                  {!employee.uae_profile && (
                    <p className="text-sm text-amber-800">
                      Configure this employee’s UAE profile before payroll.{" "}
                      <a
                        className="underline"
                        href={`/global-payroll/employees/${employee.id}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open employee profile
                      </a>
                    </p>
                  )}
                  {employee.status !== "active" && (
                    <p className="text-xs text-gray-500">
                      This employee is included only when Final settlement is selected below.
                    </p>
                  )}
                  <UaePeriodForm
                    value={uaeInputs[employee.id] || {}}
                    onChange={(input) => setUaeInputs({ ...uaeInputs, [employee.id]: input })}
                    year={Number(year)}
                    month={Number(month)}
                  />
                </details>
              ))}
            </div>
          )}
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setShowCreate(false)}>
              {t("payrollRuns.cancel")}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={saving || countriesLoading || countriesError || !selectedCountry}
            >
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t("payrollRuns.createRun")}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Run Detail Modal */}
      <Modal
        open={!!showDetail}
        onClose={() => {
          if (dirtyUaeRun === showDetail && !window.confirm("Discard unsaved UAE payroll inputs?"))
            return;
          setShowDetail(null);
          setDirtyUaeRun(null);
        }}
        title={t("globalPayrollRuns.detailModal.title", {
          country: runDetail?.country_name || "",
        })}
        className={isUaeDetail ? "max-w-5xl" : undefined}
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

            {!isUaeDetail && (
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
            )}

            {isUaeDetail && (
              <UaeRunDetails
                key={runDetail.id}
                run={runDetail}
                dirty={dirtyUaeRun === runDetail.id}
                onDirtyChange={(dirty) => setDirtyUaeRun(dirty ? runDetail.id : null)}
                onChanged={async () => {
                  await Promise.all([
                    qc.invalidateQueries({ queryKey: ["global-payroll-runs"] }),
                    qc.invalidateQueries({ queryKey: ["global-payroll-run", runDetail.id] }),
                  ]);
                }}
              />
            )}
            {dirtyUaeRun === runDetail.id && (
              <p className="text-sm text-amber-800">
                Save inputs and recalculate before approving this run.
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              {(isUaeDetail ? runDetail.status === "locked" : runDetail.status === "draft") && (
                <Button
                  size="sm"
                  disabled={
                    dirtyUaeRun === runDetail.id ||
                    (isUaeDetail &&
                      !runDetail.items?.every(
                        (item: any) => item.uae_calculation && item.uae_profile,
                      ))
                  }
                  onClick={() => {
                    handleApprove(
                      runDetail.id,
                      isUaeDetail ? Number(runDetail.uae_revision) : undefined,
                    );
                    setShowDetail(null);
                  }}
                >
                  <Check className="mr-1 h-3 w-3" />
                  {t("globalPayrollRuns.actions.approve")}
                </Button>
              )}
              {runDetail.status === "approved" && !isUaeDetail && (
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
