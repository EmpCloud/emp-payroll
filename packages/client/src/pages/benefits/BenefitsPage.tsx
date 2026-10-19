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
import { formatCurrency } from "@/lib/utils";
import { apiGet, apiPost, apiPut, apiDelete } from "@/api/client";
import { useEmployees } from "@/api/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Heart,
  Shield,
  Users,
  DollarSign,
  UserPlus,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

const PLAN_TYPES = ["health", "dental", "vision", "life", "disability", "retirement"];

const COVERAGE_TYPES = ["individual", "family", "individual_plus_spouse"];

export function BenefitsPage() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"plans" | "enrollments" | "pending">("plans");
  const [showCreatePlan, setShowCreatePlan] = useState(false);
  const [showEnroll, setShowEnroll] = useState(false);
  const [creating, setCreating] = useState(false);
  // When set, the plan modal re-purposes as edit (#16).
  const [editingPlan, setEditingPlan] = useState<any>(null);
  const qc = useQueryClient();
  const { data: empRes } = useEmployees({ limit: 200 });

  const { data: dashRes } = useQuery({
    queryKey: ["benefits-dashboard"],
    queryFn: () => apiGet<any>("/benefits/dashboard"),
  });

  const { data: plansRes, isLoading: plansLoading } = useQuery({
    queryKey: ["benefit-plans"],
    queryFn: () => apiGet<any>("/benefits/plans"),
  });

  const { data: enrollRes, isLoading: enrollLoading } = useQuery({
    queryKey: ["benefit-enrollments"],
    queryFn: () => apiGet<any>("/benefits/enrollments"),
  });

  const stats = dashRes?.data || {};
  const plans = plansRes?.data || [];
  const enrollments = enrollRes?.data || [];
  const employees = empRes?.data?.data || [];

  function closePlanModal() {
    setShowCreatePlan(false);
    setEditingPlan(null);
  }

  async function handlePlanSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const start = String(fd.get("enrollmentPeriodStart") || "");
    const end = String(fd.get("enrollmentPeriodEnd") || "");
    // Client-side guard for #15 — server also rejects, but we fail fast.
    if (start && end && new Date(end).getTime() < new Date(start).getTime()) {
      toast.error(t("benefitsPage.messages.invalidEnrollmentDates"));
      return;
    }
    setCreating(true);
    const payload = {
      name: fd.get("name"),
      type: fd.get("type"),
      provider: fd.get("provider"),
      description: fd.get("description"),
      premiumAmount: Number(fd.get("premiumAmount") || 0),
      employerContribution: Number(fd.get("employerContribution") || 0),
      enrollmentPeriodStart: start || undefined,
      enrollmentPeriodEnd: end || undefined,
    };
    try {
      if (editingPlan) {
        await apiPut(`/benefits/plans/${editingPlan.id}`, payload);
        toast.success(t("benefitsPage.messages.planUpdated"));
      } else {
        await apiPost("/benefits/plans", payload);
        toast.success(t("benefitsPage.messages.planCreated"));
      }
      closePlanModal();
      qc.invalidateQueries({ queryKey: ["benefit-plans"] });
      qc.invalidateQueries({ queryKey: ["benefits-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("benefitsPage.messages.savePlanFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function deletePlan(id: string) {
    if (!confirm(t("benefitsPage.messages.deactivateConfirm"))) return;
    try {
      await apiDelete(`/benefits/plans/${id}`);
      toast.success(t("benefitsPage.messages.planDeactivated"));
      qc.invalidateQueries({ queryKey: ["benefit-plans"] });
      qc.invalidateQueries({ queryKey: ["benefits-dashboard"] });
    } catch (err: any) {
      toast.error(
        err.response?.data?.error?.message || t("benefitsPage.messages.deactivateFailed"),
      );
    }
  }

  async function handleEnroll(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    const fd = new FormData(e.currentTarget);
    try {
      await apiPost("/benefits/enroll", {
        employeeId: fd.get("employeeId"),
        planId: fd.get("planId"),
        coverageType: fd.get("coverageType"),
        startDate: fd.get("startDate"),
        status: "enrolled",
        premiumEmployeeShare: Number(fd.get("premiumEmployeeShare") || 0),
        premiumEmployerShare: Number(fd.get("premiumEmployerShare") || 0),
      });
      toast.success(t("benefitsPage.messages.employeeEnrolled"));
      setShowEnroll(false);
      qc.invalidateQueries({ queryKey: ["benefit-enrollments"] });
      qc.invalidateQueries({ queryKey: ["benefits-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("benefitsPage.messages.enrollFailed"));
    } finally {
      setCreating(false);
    }
  }

  async function cancelEnrollment(id: string) {
    try {
      await apiPost(`/benefits/enrollments/${id}/cancel`);
      toast.success(t("benefitsPage.messages.enrollmentCancelled"));
      qc.invalidateQueries({ queryKey: ["benefit-enrollments"] });
      qc.invalidateQueries({ queryKey: ["benefits-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("benefitsPage.messages.actionFailed"));
    }
  }

  const planColumns = [
    {
      key: "name",
      header: t("benefitsPage.columns.planName"),
      render: (r: any) => <span className="font-medium text-gray-900">{r.name}</span>,
    },
    {
      key: "type",
      header: t("benefitsPage.columns.type"),
      render: (r: any) => (
        <Badge variant="draft">
          {t(`benefitsPage.planTypes.${String(r.type).toLowerCase()}`, {
            defaultValue: r.type,
          })}
        </Badge>
      ),
    },
    { key: "provider", header: t("benefitsPage.columns.provider") },
    {
      key: "premium_amount",
      header: t("benefitsPage.columns.premium"),
      render: (r: any) => formatCurrency(r.premium_amount),
    },
    {
      key: "employer_contribution",
      header: t("benefitsPage.columns.employerShare"),
      render: (r: any) => formatCurrency(r.employer_contribution),
    },
    {
      key: "status",
      header: t("benefitsPage.columns.status"),
      render: (r: any) => (
        <Badge variant={r.is_active ? "active" : "inactive"}>
          {r.is_active ? t("benefitsPage.status.active") : t("benefitsPage.status.inactive")}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r: any) => (
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            title={t("benefitsPage.actions.edit")}
            onClick={() => {
              setEditingPlan(r);
              setShowCreatePlan(true);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          {/* #168 — MySQL tinyint(1) comes back as 0/1; `0 && <Button/>`
              renders the literal "0" next to the pencil icon on inactive
              rows. Coerce to a real boolean so React skips the falsy
              branch cleanly instead of printing a stray digit. */}
          {!!r.is_active && (
            <Button
              variant="ghost"
              size="sm"
              title={t("benefitsPage.actions.deactivate")}
              onClick={() => deletePlan(r.id)}
              className="text-red-600"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    },
  ];

  // #312 — enrollments only showed `#<id>`, no name. Build a quick lookup off
  // the already-loaded employees list and resolve names at render time.
  const employeeById: Record<string, any> = {};
  for (const e of employees) {
    if (e.id != null) employeeById[String(e.id)] = e;
    if (e.empcloud_user_id != null) employeeById[String(e.empcloud_user_id)] = e;
  }

  const enrollColumns = [
    {
      key: "employee",
      header: t("benefitsPage.columns.employee"),
      render: (r: any) => {
        const emp = employeeById[String(r.empcloud_user_id)];
        const fullName = emp
          ? `${emp.first_name || emp.firstName || ""} ${emp.last_name || emp.lastName || ""}`.trim()
          : "";
        return (
          <div>
            <p className="font-medium text-gray-900">
              {fullName || t("benefitsPage.fallbackUser", { id: r.empcloud_user_id })}
            </p>
            {(emp?.employee_code || emp?.emp_code) && (
              <p className="text-xs text-gray-500">{emp.employee_code || emp.emp_code}</p>
            )}
          </div>
        );
      },
    },
    {
      key: "plan",
      header: t("benefitsPage.columns.plan"),
      render: (r: any) => {
        const plan = plans.find((p: any) => p.id === r.plan_id);
        return plan?.name || r.plan_id?.slice(0, 8);
      },
    },
    {
      key: "coverage_type",
      header: t("benefitsPage.columns.coverage"),
      render: (r: any) => (
        <Badge variant="draft">
          {t(`benefitsPage.coverageTypes.${String(r.coverage_type).toLowerCase()}`, {
            defaultValue: String(r.coverage_type).replace(/_/g, " "),
          })}
        </Badge>
      ),
    },
    {
      key: "premium_employee_share",
      header: t("benefitsPage.columns.employeeShare"),
      render: (r: any) => formatCurrency(r.premium_employee_share),
    },
    {
      key: "premium_employer_share",
      header: t("benefitsPage.columns.employerShare"),
      render: (r: any) => formatCurrency(r.premium_employer_share),
    },
    {
      key: "status",
      header: t("benefitsPage.columns.status"),
      render: (r: any) => (
        <Badge
          variant={
            r.status === "enrolled" ? "active" : r.status === "pending" ? "draft" : "inactive"
          }
        >
          {t(`benefitsPage.status.${String(r.status).toLowerCase()}`, {
            defaultValue: r.status,
          })}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r: any) =>
        r.status !== "cancelled" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => cancelEnrollment(r.id)}
            className="text-red-600"
          >
            {t("benefitsPage.actions.cancel")}
          </Button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("benefitsPage.title")}
        description={t("benefitsPage.description")}
        actions={
          <div className="flex gap-2">
            <Button onClick={() => setShowEnroll(true)}>
              <UserPlus className="mr-2 h-4 w-4" /> {t("benefitsPage.enrollEmployee")}
            </Button>
            <Button onClick={() => setShowCreatePlan(true)}>
              <Plus className="mr-2 h-4 w-4" /> {t("benefitsPage.newPlan")}
            </Button>
          </div>
        }
      />

      {/* Stats — cards drill into the matching tab (#84) */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("benefitsPage.stats.activePlans")}
          value={stats.totalPlans || 0}
          icon={Shield}
          onClick={() => setTab("plans")}
        />
        <StatCard
          title={t("benefitsPage.stats.enrolled")}
          value={stats.totalEnrolled || 0}
          icon={Users}
          onClick={() => setTab("enrollments")}
        />
        <StatCard
          title={t("benefitsPage.stats.pending")}
          value={stats.totalPending || 0}
          icon={Heart}
          onClick={() => setTab("pending")}
        />
        {/* Monthly Employer Cost is a summary number — clicking it used to
            jump back to Plans even when the user already had Enrollments/
            Pending open, swapping their context for no good reason. Render
            as a plain non-interactive card so the value is informative
            without redirecting (#233). */}
        <StatCard
          title={t("benefitsPage.stats.monthlyEmployerCost")}
          value={formatCurrency(stats.totalEmployerCost || 0)}
          icon={DollarSign}
        />
      </div>

      {/* Tabs */}
      {/* #148 — Pending tab added so the Pending card has a drill-in
          destination that filters enrollments to status="pending". Previously
          it routed to the full Enrollments tab, which hid the distinction. */}
      <div className="mb-4 flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setTab("plans")}
          className={`px-4 py-2 text-sm font-medium ${tab === "plans" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          {t("benefitsPage.tabs.plans", { count: plans.length })}
        </button>
        <button
          onClick={() => setTab("enrollments")}
          className={`px-4 py-2 text-sm font-medium ${tab === "enrollments" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          {t("benefitsPage.tabs.enrollments", { count: enrollments.length })}
        </button>
        <button
          onClick={() => setTab("pending")}
          className={`px-4 py-2 text-sm font-medium ${tab === "pending" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          {t("benefitsPage.tabs.pending", { count: stats.totalPending || 0 })}
        </button>
      </div>

      {tab === "plans" && (
        <Card>
          <CardContent className="p-0">
            {plansLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
              </div>
            ) : (
              <DataTable
                columns={planColumns}
                data={plans}
                emptyMessage={t("benefitsPage.empty.plans")}
              />
            )}
          </CardContent>
        </Card>
      )}

      {tab === "enrollments" && (
        <Card>
          <CardContent className="p-0">
            {enrollLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
              </div>
            ) : (
              <DataTable
                columns={enrollColumns}
                data={enrollments}
                emptyMessage={t("benefitsPage.empty.enrollments")}
              />
            )}
          </CardContent>
        </Card>
      )}

      {tab === "pending" && (
        <Card>
          <CardContent className="p-0">
            {enrollLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
              </div>
            ) : (
              <DataTable
                columns={enrollColumns}
                data={enrollments.filter((e: any) => e.status === "pending")}
                emptyMessage={t("benefitsPage.empty.pending")}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Create / Edit Plan Modal — one form for both flows (#16). */}
      <Modal
        open={showCreatePlan}
        onClose={closePlanModal}
        title={
          editingPlan
            ? t("benefitsPage.planModal.editTitle")
            : t("benefitsPage.planModal.createTitle")
        }
        key={editingPlan?.id || "new-plan"}
      >
        <form onSubmit={handlePlanSubmit} className="space-y-4">
          <Input
            label={t("benefitsPage.planModal.planName")}
            name="name"
            defaultValue={editingPlan?.name || ""}
            required
          />
          <SelectField
            label={t("benefitsPage.planModal.type")}
            name="type"
            options={PLAN_TYPES.map((value) => ({
              value,
              label: t(`benefitsPage.planTypes.${value}`),
            }))}
            defaultValue={editingPlan?.type || ""}
            required
          />
          <Input
            label={t("benefitsPage.planModal.provider")}
            name="provider"
            defaultValue={editingPlan?.provider || ""}
          />
          <Input
            label={t("benefitsPage.planModal.description")}
            name="description"
            defaultValue={editingPlan?.description || ""}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t("benefitsPage.planModal.monthlyPremium")}
              name="premiumAmount"
              type="number"
              step="0.01"
              min={0}
              defaultValue={editingPlan?.premium_amount ?? ""}
            />
            <Input
              label={t("benefitsPage.planModal.employerContribution")}
              name="employerContribution"
              type="number"
              step="0.01"
              min={0}
              defaultValue={editingPlan?.employer_contribution ?? ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t("benefitsPage.planModal.enrollmentStart")}
              name="enrollmentPeriodStart"
              type="date"
              defaultValue={
                editingPlan?.enrollment_period_start
                  ? String(editingPlan.enrollment_period_start).slice(0, 10)
                  : ""
              }
              onChange={(e) => {
                // Push the selected start date as the minimum for the end date input,
                // so the browser's date picker blocks earlier selections (#15).
                const form = (e.currentTarget as HTMLInputElement).form;
                const endInput = form?.elements.namedItem(
                  "enrollmentPeriodEnd",
                ) as HTMLInputElement | null;
                if (endInput) endInput.min = e.currentTarget.value;
              }}
            />
            <Input
              label={t("benefitsPage.planModal.enrollmentEnd")}
              name="enrollmentPeriodEnd"
              type="date"
              defaultValue={
                editingPlan?.enrollment_period_end
                  ? String(editingPlan.enrollment_period_end).slice(0, 10)
                  : ""
              }
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closePlanModal}>
              {t("benefitsPage.planModal.cancel")}
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingPlan
                ? t("benefitsPage.planModal.updatePlan")
                : t("benefitsPage.planModal.createPlan")}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Enroll Modal */}
      <Modal
        open={showEnroll}
        onClose={() => setShowEnroll(false)}
        title={t("benefitsPage.enrollModal.title")}
      >
        <form onSubmit={handleEnroll} className="space-y-4">
          <SelectField
            label={t("benefitsPage.enrollModal.employee")}
            name="employeeId"
            options={employees.map((e: any) => ({
              value: String(e.empcloud_user_id || e.id),
              label: `${e.first_name || e.firstName} ${e.last_name || e.lastName}`,
            }))}
            required
          />
          <SelectField
            label={t("benefitsPage.enrollModal.benefitPlan")}
            name="planId"
            options={plans
              .filter((p: any) => p.is_active)
              .map((p: any) => ({
                value: p.id,
                label: `${p.name} (${t(`benefitsPage.planTypes.${String(p.type).toLowerCase()}`, {
                  defaultValue: p.type,
                })})`,
              }))}
            required
          />
          <SelectField
            label={t("benefitsPage.enrollModal.coverageType")}
            name="coverageType"
            options={COVERAGE_TYPES.map((value) => ({
              value,
              label: t(`benefitsPage.coverageTypes.${value}`),
            }))}
            required
          />
          <Input
            label={t("benefitsPage.enrollModal.startDate")}
            name="startDate"
            type="date"
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t("benefitsPage.enrollModal.employeePremiumShare")}
              name="premiumEmployeeShare"
              type="number"
              step="0.01"
              defaultValue="0"
            />
            <Input
              label={t("benefitsPage.enrollModal.employerPremiumShare")}
              name="premiumEmployerShare"
              type="number"
              step="0.01"
              defaultValue="0"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowEnroll(false)}>
              {t("benefitsPage.enrollModal.cancel")}
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("benefitsPage.enrollModal.submit")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
