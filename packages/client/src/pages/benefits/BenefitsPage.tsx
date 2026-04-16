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

const PLAN_TYPES = [
  { value: "health", label: "Health" },
  { value: "dental", label: "Dental" },
  { value: "vision", label: "Vision" },
  { value: "life", label: "Life Insurance" },
  { value: "disability", label: "Disability" },
  { value: "retirement", label: "Retirement" },
];

const COVERAGE_TYPES = [
  { value: "individual", label: "Individual" },
  { value: "family", label: "Family" },
  { value: "individual_plus_spouse", label: "Individual + Spouse" },
];

export function BenefitsPage() {
  const [tab, setTab] = useState<"plans" | "enrollments">("plans");
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
      toast.error("Enrollment end date cannot be before start date");
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
        toast.success("Benefit plan updated");
      } else {
        await apiPost("/benefits/plans", payload);
        toast.success("Benefit plan created");
      }
      closePlanModal();
      qc.invalidateQueries({ queryKey: ["benefit-plans"] });
      qc.invalidateQueries({ queryKey: ["benefits-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to save plan");
    } finally {
      setCreating(false);
    }
  }

  async function deletePlan(id: string) {
    if (!confirm("Deactivate this benefit plan? Existing enrollments are unaffected.")) return;
    try {
      await apiDelete(`/benefits/plans/${id}`);
      toast.success("Benefit plan deactivated");
      qc.invalidateQueries({ queryKey: ["benefit-plans"] });
      qc.invalidateQueries({ queryKey: ["benefits-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to deactivate plan");
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
      toast.success("Employee enrolled in benefit plan");
      setShowEnroll(false);
      qc.invalidateQueries({ queryKey: ["benefit-enrollments"] });
      qc.invalidateQueries({ queryKey: ["benefits-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to enroll");
    } finally {
      setCreating(false);
    }
  }

  async function cancelEnrollment(id: string) {
    try {
      await apiPost(`/benefits/enrollments/${id}/cancel`);
      toast.success("Enrollment cancelled");
      qc.invalidateQueries({ queryKey: ["benefit-enrollments"] });
      qc.invalidateQueries({ queryKey: ["benefits-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    }
  }

  const planColumns = [
    {
      key: "name",
      header: "Plan Name",
      render: (r: any) => <span className="font-medium text-gray-900">{r.name}</span>,
    },
    {
      key: "type",
      header: "Type",
      render: (r: any) => <Badge variant="draft">{r.type}</Badge>,
    },
    { key: "provider", header: "Provider" },
    {
      key: "premium_amount",
      header: "Premium",
      render: (r: any) => formatCurrency(r.premium_amount),
    },
    {
      key: "employer_contribution",
      header: "Employer Share",
      render: (r: any) => formatCurrency(r.employer_contribution),
    },
    {
      key: "status",
      header: "Status",
      render: (r: any) => (
        <Badge variant={r.is_active ? "active" : "inactive"}>
          {r.is_active ? "Active" : "Inactive"}
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
            title="Edit"
            onClick={() => {
              setEditingPlan(r);
              setShowCreatePlan(true);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          {r.is_active && (
            <Button
              variant="ghost"
              size="sm"
              title="Deactivate"
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

  const enrollColumns = [
    {
      key: "employee",
      header: "Employee ID",
      render: (r: any) => <span className="font-medium">#{r.empcloud_user_id}</span>,
    },
    {
      key: "plan",
      header: "Plan",
      render: (r: any) => {
        const plan = plans.find((p: any) => p.id === r.plan_id);
        return plan?.name || r.plan_id?.slice(0, 8);
      },
    },
    {
      key: "coverage_type",
      header: "Coverage",
      render: (r: any) => <Badge variant="draft">{r.coverage_type.replace(/_/g, " ")}</Badge>,
    },
    {
      key: "premium_employee_share",
      header: "Employee Share",
      render: (r: any) => formatCurrency(r.premium_employee_share),
    },
    {
      key: "premium_employer_share",
      header: "Employer Share",
      render: (r: any) => formatCurrency(r.premium_employer_share),
    },
    {
      key: "status",
      header: "Status",
      render: (r: any) => (
        <Badge
          variant={
            r.status === "enrolled" ? "active" : r.status === "pending" ? "draft" : "inactive"
          }
        >
          {r.status}
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
            Cancel
          </Button>
        ) : null,
    },
  ];

  return (
    <div>
      <PageHeader
        title="Benefits Administration"
        description="Manage benefit plans and employee enrollments"
        actions={
          <div className="flex gap-2">
            <Button onClick={() => setShowEnroll(true)}>
              <UserPlus className="mr-2 h-4 w-4" /> Enroll Employee
            </Button>
            <Button onClick={() => setShowCreatePlan(true)}>
              <Plus className="mr-2 h-4 w-4" /> New Plan
            </Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Active Plans" value={stats.totalPlans || 0} icon={Shield} />
        <StatCard title="Enrolled" value={stats.totalEnrolled || 0} icon={Users} />
        <StatCard title="Pending" value={stats.totalPending || 0} icon={Heart} />
        <StatCard
          title="Monthly Employer Cost"
          value={formatCurrency(stats.totalEmployerCost || 0)}
          icon={DollarSign}
        />
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setTab("plans")}
          className={`px-4 py-2 text-sm font-medium ${tab === "plans" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          Plans ({plans.length})
        </button>
        <button
          onClick={() => setTab("enrollments")}
          className={`px-4 py-2 text-sm font-medium ${tab === "enrollments" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          Enrollments ({enrollments.length})
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
                emptyMessage="No benefit plans created yet"
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
                emptyMessage="No enrollments yet"
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Create / Edit Plan Modal — one form for both flows (#16). */}
      <Modal
        open={showCreatePlan}
        onClose={closePlanModal}
        title={editingPlan ? "Edit Benefit Plan" : "Create Benefit Plan"}
        key={editingPlan?.id || "new-plan"}
      >
        <form onSubmit={handlePlanSubmit} className="space-y-4">
          <Input label="Plan Name" name="name" defaultValue={editingPlan?.name || ""} required />
          <SelectField
            label="Type"
            name="type"
            options={PLAN_TYPES}
            defaultValue={editingPlan?.type || ""}
            required
          />
          <Input label="Provider" name="provider" defaultValue={editingPlan?.provider || ""} />
          <Input
            label="Description"
            name="description"
            defaultValue={editingPlan?.description || ""}
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Monthly Premium"
              name="premiumAmount"
              type="number"
              step="0.01"
              min={0}
              defaultValue={editingPlan?.premium_amount ?? ""}
            />
            <Input
              label="Employer Contribution"
              name="employerContribution"
              type="number"
              step="0.01"
              min={0}
              defaultValue={editingPlan?.employer_contribution ?? ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Enrollment Start"
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
              label="Enrollment End"
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
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingPlan ? "Update Plan" : "Create Plan"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Enroll Modal */}
      <Modal
        open={showEnroll}
        onClose={() => setShowEnroll(false)}
        title="Enroll Employee in Benefit Plan"
      >
        <form onSubmit={handleEnroll} className="space-y-4">
          <SelectField
            label="Employee"
            name="employeeId"
            options={employees.map((e: any) => ({
              value: String(e.empcloud_user_id || e.id),
              label: `${e.first_name || e.firstName} ${e.last_name || e.lastName}`,
            }))}
            required
          />
          <SelectField
            label="Benefit Plan"
            name="planId"
            options={plans
              .filter((p: any) => p.is_active)
              .map((p: any) => ({
                value: p.id,
                label: `${p.name} (${p.type})`,
              }))}
            required
          />
          <SelectField
            label="Coverage Type"
            name="coverageType"
            options={COVERAGE_TYPES}
            required
          />
          <Input label="Start Date" name="startDate" type="date" required />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Employee Premium Share"
              name="premiumEmployeeShare"
              type="number"
              step="0.01"
              defaultValue="0"
            />
            <Input
              label="Employer Premium Share"
              name="premiumEmployerShare"
              type="number"
              step="0.01"
              defaultValue="0"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowEnroll(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Enroll
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
