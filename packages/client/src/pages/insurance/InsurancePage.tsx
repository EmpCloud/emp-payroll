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
  ShieldCheck,
  Users,
  FileText,
  DollarSign,
  Plus,
  UserPlus,
  AlertCircle,
  Loader2,
  CheckCircle,
  XCircle,
  CreditCard,
  Pencil,
  Trash2,
} from "lucide-react";
import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

const POLICY_TYPES = ["group_health", "group_life", "disability", "accidental", "travel"];

// #100 — The claim-type dropdown used to list only medical-specific categories
// (hospitalization, outpatient, etc.) even though policies could be Group Life,
// Accidental, Travel, Disability — so a Group Life policy holder couldn't find
// a matching claim type. Union the policy types into the options, grouped
// so the common ones still lead.
const CLAIM_TYPES = [
  "hospitalization",
  "outpatient",
  "dental",
  "vision",
  "life",
  "disability",
  "accidental",
  "travel",
  "group_health",
  "group_life",
];

const STATUS_BADGE: Record<string, "active" | "draft" | "inactive"> = {
  active: "active",
  expired: "inactive",
  cancelled: "inactive",
  submitted: "draft",
  under_review: "draft",
  approved: "active",
  rejected: "inactive",
  settled: "active",
  inactive: "inactive",
  claimed: "draft",
};

export function InsurancePage() {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<"policies" | "enrollments" | "claims">("policies");
  const [showCreatePolicy, setShowCreatePolicy] = useState(false);
  const [showEnroll, setShowEnroll] = useState(false);
  const [showSubmitClaim, setShowSubmitClaim] = useState(false);
  const [saving, setSaving] = useState(false);
  // When set, the policy modal acts as Edit (#14).
  const [editingPolicy, setEditingPolicy] = useState<any>(null);
  const qc = useQueryClient();
  const { data: empRes } = useEmployees({ limit: 200 });

  // --- Data ---
  const { data: dashRes } = useQuery({
    queryKey: ["insurance-dashboard"],
    queryFn: () => apiGet<any>("/insurance/dashboard"),
  });

  const { data: policiesRes, isLoading: policiesLoading } = useQuery({
    queryKey: ["insurance-policies"],
    queryFn: () => apiGet<any>("/insurance/policies"),
  });

  const { data: enrollRes, isLoading: enrollLoading } = useQuery({
    queryKey: ["insurance-enrollments"],
    queryFn: () => apiGet<any>("/insurance/enrollments"),
  });

  const { data: claimsRes, isLoading: claimsLoading } = useQuery({
    queryKey: ["insurance-claims"],
    queryFn: () => apiGet<any>("/insurance/claims"),
  });

  const stats = dashRes?.data || {};
  const policies = policiesRes?.data || [];
  // #103 — /insurance/enrollments returns the paginated envelope
  // { data: [...], total, page, ... } unlike /insurance/policies which
  // returns the bare array. The old one-level lookup was always undefined
  // (object, not an array), so the Enrollments tab showed zero rows even
  // when the dashboard said "1 active enrollment". Drill into `.data.data`.
  const enrollments = Array.isArray(enrollRes?.data) ? enrollRes.data : enrollRes?.data?.data || [];
  const claims = claimsRes?.data || [];
  const employees = empRes?.data?.data || [];

  // --- Handlers ---
  function closePolicyModal() {
    setShowCreatePolicy(false);
    setEditingPolicy(null);
  }

  async function handlePolicySubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const start = String(fd.get("startDate") || "");
    const end = String(fd.get("endDate") || "");
    const renewal = String(fd.get("renewalDate") || "");
    // Client-side guard for #13 — server rejects too but we fail fast.
    if (start && end && new Date(end).getTime() < new Date(start).getTime()) {
      toast.error(t("insurancePage.messages.invalidEndDate"));
      return;
    }
    // #98 — Renewal date is meaningful only after the policy ends. It can't
    // be in the past, and must be on/after the end date (or the start date
    // if there's no explicit end).
    if (renewal) {
      const renewTime = new Date(renewal).getTime();
      const today = new Date().setHours(0, 0, 0, 0);
      if (renewTime < today) {
        toast.error(t("insurancePage.messages.renewalInPast"));
        return;
      }
      const floor = end ? new Date(end).getTime() : start ? new Date(start).getTime() : 0;
      if (floor && renewTime < floor) {
        toast.error(t("insurancePage.messages.invalidRenewalDate"));
        return;
      }
    }
    // #221 — Policy numbers are identifiers (e.g. "POL-2024-001"), never
    // negative figures. Reject a leading "-" or a pure-negative value
    // before sending so HR can't accidentally save a malformed id.
    const policyNumber = String(fd.get("policyNumber") || "").trim();
    if (policyNumber && (policyNumber.startsWith("-") || /^-\d/.test(policyNumber))) {
      toast.error(t("insurancePage.messages.invalidPolicyNumber"));
      return;
    }
    setSaving(true);
    const payload = {
      name: fd.get("name"),
      policyNumber: policyNumber || undefined,
      provider: fd.get("provider"),
      type: fd.get("type"),
      premiumTotal: Number(fd.get("premiumTotal") || 0),
      premiumPerEmployee: Number(fd.get("premiumPerEmployee") || 0),
      coverageAmount: Number(fd.get("coverageAmount") || 0),
      startDate: start,
      endDate: end || undefined,
      renewalDate: fd.get("renewalDate") || undefined,
      terms: fd.get("terms") || undefined,
    };
    try {
      if (editingPolicy) {
        await apiPut(`/insurance/policies/${editingPolicy.id}`, payload);
        toast.success(t("insurancePage.messages.policyUpdated"));
      } else {
        await apiPost("/insurance/policies", payload);
        toast.success(t("insurancePage.messages.policyCreated"));
      }
      closePolicyModal();
      qc.invalidateQueries({ queryKey: ["insurance-policies"] });
      qc.invalidateQueries({ queryKey: ["insurance-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("insurancePage.messages.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function deletePolicy(id: string) {
    if (!confirm(t("insurancePage.messages.deactivateConfirm"))) return;
    try {
      await apiDelete(`/insurance/policies/${id}`);
      toast.success(t("insurancePage.messages.policyDeactivated"));
      qc.invalidateQueries({ queryKey: ["insurance-policies"] });
      qc.invalidateQueries({ queryKey: ["insurance-dashboard"] });
    } catch (err: any) {
      toast.error(
        err.response?.data?.error?.message || t("insurancePage.messages.deactivateFailed"),
      );
    }
  }

  async function handleEnroll(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    try {
      await apiPost("/insurance/enroll", {
        policyId: fd.get("policyId"),
        employeeId: fd.get("employeeId"),
        sumInsured: Number(fd.get("sumInsured") || 0),
        premiumShare: Number(fd.get("premiumShare") || 0),
        nomineeName: fd.get("nomineeName") || undefined,
        nomineeRelationship: fd.get("nomineeRelationship") || undefined,
      });
      toast.success(t("insurancePage.messages.employeeEnrolled"));
      setShowEnroll(false);
      qc.invalidateQueries({ queryKey: ["insurance-enrollments"] });
      qc.invalidateQueries({ queryKey: ["insurance-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("insurancePage.messages.enrollFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitClaim(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSaving(true);
    const fd = new FormData(e.currentTarget);
    try {
      await apiPost("/insurance/claims", {
        policyId: fd.get("policyId"),
        claimType: fd.get("claimType"),
        amountClaimed: Number(fd.get("amountClaimed")),
        description: fd.get("description") || undefined,
        notes: fd.get("notes") || undefined,
      });
      toast.success(t("insurancePage.messages.claimSubmitted"));
      setShowSubmitClaim(false);
      qc.invalidateQueries({ queryKey: ["insurance-claims"] });
      qc.invalidateQueries({ queryKey: ["insurance-dashboard"] });
    } catch (err: any) {
      toast.error(
        err.response?.data?.error?.message || t("insurancePage.messages.claimSubmitFailed"),
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleApproveClaim(id: string) {
    const amountStr = prompt(t("insurancePage.messages.approvedAmountPrompt"));
    try {
      await apiPost(`/insurance/claims/${id}/approve`, {
        amountApproved: amountStr ? Number(amountStr) : undefined,
      });
      toast.success(t("insurancePage.messages.claimApproved"));
      qc.invalidateQueries({ queryKey: ["insurance-claims"] });
      qc.invalidateQueries({ queryKey: ["insurance-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("insurancePage.messages.actionFailed"));
    }
  }

  async function handleRejectClaim(id: string) {
    const reason = prompt(t("insurancePage.messages.rejectionReason"));
    try {
      await apiPost(`/insurance/claims/${id}/reject`, { rejectionReason: reason });
      toast.success(t("insurancePage.messages.claimRejected"));
      qc.invalidateQueries({ queryKey: ["insurance-claims"] });
      qc.invalidateQueries({ queryKey: ["insurance-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("insurancePage.messages.actionFailed"));
    }
  }

  async function handleSettleClaim(id: string) {
    try {
      await apiPost(`/insurance/claims/${id}/settle`);
      toast.success(t("insurancePage.messages.claimSettled"));
      qc.invalidateQueries({ queryKey: ["insurance-claims"] });
      qc.invalidateQueries({ queryKey: ["insurance-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("insurancePage.messages.actionFailed"));
    }
  }

  async function cancelEnrollment(id: string) {
    try {
      await apiPost(`/insurance/enrollments/${id}/cancel`);
      toast.success(t("insurancePage.messages.enrollmentCancelled"));
      qc.invalidateQueries({ queryKey: ["insurance-enrollments"] });
      qc.invalidateQueries({ queryKey: ["insurance-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || t("insurancePage.messages.actionFailed"));
    }
  }

  // --- Table columns ---
  const policyColumns = [
    {
      key: "name",
      header: t("insurancePage.columns.policyName"),
      render: (r: any) => <span className="font-medium text-gray-900">{r.name}</span>,
    },
    {
      key: "policy_number",
      header: t("insurancePage.columns.number"),
      render: (r: any) => r.policy_number || "-",
    },
    { key: "provider", header: t("insurancePage.columns.provider") },
    {
      key: "type",
      header: t("insurancePage.columns.type"),
      render: (r: any) => (
        <Badge variant="draft">
          {t(`insurancePage.policyTypes.${String(r.type).toLowerCase()}`, {
            defaultValue: String(r.type).replace(/_/g, " "),
          })}
        </Badge>
      ),
    },
    {
      key: "coverage_amount",
      header: t("insurancePage.columns.coverage"),
      render: (r: any) => formatCurrency(Number(r.coverage_amount)),
    },
    {
      key: "premium_per_employee",
      header: t("insurancePage.columns.premiumPerEmployee"),
      render: (r: any) => formatCurrency(Number(r.premium_per_employee)),
    },
    {
      key: "status",
      header: t("insurancePage.columns.status"),
      render: (r: any) => (
        <Badge variant={STATUS_BADGE[r.status] || "draft"}>
          {t(`insurancePage.status.${String(r.status).toLowerCase()}`, {
            defaultValue: r.status,
          })}
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
            title={t("insurancePage.actions.edit")}
            onClick={() => {
              setEditingPolicy(r);
              setShowCreatePolicy(true);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          {r.status === "active" && (
            <Button
              variant="ghost"
              size="sm"
              title={t("insurancePage.actions.deactivate")}
              onClick={() => deletePolicy(r.id)}
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
      key: "employee_name",
      header: t("insurancePage.columns.employee"),
      render: (r: any) => <span className="font-medium text-gray-900">{r.employee_name}</span>,
    },
    {
      key: "policy_name",
      header: t("insurancePage.columns.policy"),
      render: (r: any) => r.policy_name,
    },
    {
      key: "policy_type",
      header: t("insurancePage.columns.type"),
      render: (r: any) => (
        <Badge variant="draft">
          {t(`insurancePage.policyTypes.${String(r.policy_type).toLowerCase()}`, {
            defaultValue: String(r.policy_type || "").replace(/_/g, " "),
          })}
        </Badge>
      ),
    },
    {
      key: "sum_insured",
      header: t("insurancePage.columns.sumInsured"),
      render: (r: any) => formatCurrency(Number(r.sum_insured)),
    },
    {
      key: "premium_share",
      header: t("insurancePage.columns.premiumShare"),
      render: (r: any) => formatCurrency(Number(r.premium_share)),
    },
    {
      key: "nominee_name",
      header: t("insurancePage.columns.nominee"),
      render: (r: any) =>
        r.nominee_name ? `${r.nominee_name} (${r.nominee_relationship || ""})` : "-",
    },
    {
      key: "status",
      header: t("insurancePage.columns.status"),
      render: (r: any) => (
        <Badge variant={STATUS_BADGE[r.status] || "draft"}>
          {t(`insurancePage.status.${String(r.status).toLowerCase()}`, {
            defaultValue: r.status,
          })}
        </Badge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (r: any) =>
        r.status === "active" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => cancelEnrollment(r.id)}
            className="text-red-600"
          >
            {t("insurancePage.actions.cancel")}
          </Button>
        ) : null,
    },
  ];

  const claimColumns = [
    {
      key: "claim_number",
      header: t("insurancePage.columns.claimNumber"),
      render: (r: any) => <span className="font-mono text-sm font-medium">{r.claim_number}</span>,
    },
    {
      key: "employee_name",
      header: t("insurancePage.columns.employee"),
      render: (r: any) => <span className="font-medium">{r.employee_name}</span>,
    },
    {
      key: "claim_type",
      header: t("insurancePage.columns.type"),
      render: (r: any) => (
        <Badge variant="draft">
          {t(`insurancePage.claimTypes.${String(r.claim_type).toLowerCase()}`, {
            defaultValue: r.claim_type,
          })}
        </Badge>
      ),
    },
    {
      key: "amount_claimed",
      header: t("insurancePage.columns.claimed"),
      render: (r: any) => formatCurrency(Number(r.amount_claimed)),
    },
    {
      key: "amount_approved",
      header: t("insurancePage.columns.approved"),
      render: (r: any) =>
        r.amount_approved != null ? formatCurrency(Number(r.amount_approved)) : "-",
    },
    {
      key: "status",
      header: t("insurancePage.columns.status"),
      render: (r: any) => (
        <Badge variant={STATUS_BADGE[r.status] || "draft"}>
          {t(`insurancePage.status.${String(r.status).toLowerCase()}`, {
            defaultValue: String(r.status).replace(/_/g, " "),
          })}
        </Badge>
      ),
    },
    {
      key: "submitted_at",
      header: t("insurancePage.columns.submitted"),
      render: (r: any) =>
        r.submitted_at
          ? new Date(r.submitted_at).toLocaleDateString(i18n.resolvedLanguage || i18n.language)
          : "-",
    },
    {
      key: "actions",
      header: "",
      render: (r: any) => {
        if (r.status === "submitted" || r.status === "under_review") {
          return (
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                title={t("insurancePage.actions.approve")}
                onClick={() => handleApproveClaim(r.id)}
              >
                <CheckCircle className="mr-1 h-4 w-4 text-green-600" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                title={t("insurancePage.actions.reject")}
                onClick={() => handleRejectClaim(r.id)}
              >
                <XCircle className="mr-1 h-4 w-4 text-red-600" />
              </Button>
            </div>
          );
        }
        if (r.status === "approved") {
          return (
            <Button variant="ghost" size="sm" onClick={() => handleSettleClaim(r.id)}>
              <CreditCard className="mr-1 h-4 w-4" /> {t("insurancePage.actions.settle")}
            </Button>
          );
        }
        return null;
      },
    },
  ];

  return (
    <div>
      <PageHeader
        title={t("insurancePage.title")}
        description={t("insurancePage.description")}
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowSubmitClaim(true)}>
              <FileText className="mr-2 h-4 w-4" /> {t("insurancePage.actions.submitClaim")}
            </Button>
            <Button variant="outline" onClick={() => setShowEnroll(true)}>
              <UserPlus className="mr-2 h-4 w-4" /> {t("insurancePage.actions.enrollEmployee")}
            </Button>
            <Button onClick={() => setShowCreatePolicy(true)}>
              <Plus className="mr-2 h-4 w-4" /> {t("insurancePage.actions.newPolicy")}
            </Button>
          </div>
        }
      />

      {/* Stats — cards drill into the matching tab (#96) */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("insurancePage.stats.activePolicies")}
          value={stats.totalPolicies || 0}
          icon={ShieldCheck}
          onClick={() => setTab("policies")}
        />
        <StatCard
          title={t("insurancePage.stats.activeEnrollments")}
          value={stats.totalEnrollments || 0}
          icon={Users}
          onClick={() => setTab("enrollments")}
        />
        <StatCard
          title={t("insurancePage.stats.pendingClaims")}
          value={stats.pendingClaims || 0}
          icon={AlertCircle}
          onClick={() => setTab("claims")}
        />
        <StatCard
          title={t("insurancePage.stats.totalApproved")}
          value={formatCurrency(stats.totalApprovedAmount || 0)}
          icon={DollarSign}
          onClick={() => setTab("claims")}
        />
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setTab("policies")}
          className={`px-4 py-2 text-sm font-medium ${tab === "policies" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          {t("insurancePage.tabs.policies", { count: policies.length })}
        </button>
        <button
          onClick={() => setTab("enrollments")}
          className={`px-4 py-2 text-sm font-medium ${tab === "enrollments" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          {t("insurancePage.tabs.enrollments", { count: enrollments.length })}
        </button>
        <button
          onClick={() => setTab("claims")}
          className={`px-4 py-2 text-sm font-medium ${tab === "claims" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          {t("insurancePage.tabs.claims", { count: claims.length })}
        </button>
      </div>

      {/* Policies Tab */}
      {tab === "policies" && (
        <Card>
          <CardContent className="p-0">
            {policiesLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
              </div>
            ) : (
              <DataTable
                columns={policyColumns}
                data={policies}
                emptyMessage={t("insurancePage.empty.policies")}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Enrollments Tab */}
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
                emptyMessage={t("insurancePage.empty.enrollments")}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Claims Tab */}
      {tab === "claims" && (
        <Card>
          <CardContent className="p-0">
            {claimsLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
              </div>
            ) : (
              <DataTable
                columns={claimColumns}
                data={claims}
                emptyMessage={t("insurancePage.empty.claims")}
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Create / Edit Policy Modal — one form serves both flows (#14).
          End-date input has a dynamic `min` based on the picked start date
          so the native date picker blocks invalid earlier choices (#13). */}
      <Modal
        open={showCreatePolicy}
        onClose={closePolicyModal}
        title={
          editingPolicy
            ? t("insurancePage.policyModal.editTitle")
            : t("insurancePage.policyModal.createTitle")
        }
        key={editingPolicy?.id || "new-policy"}
      >
        <form onSubmit={handlePolicySubmit} className="space-y-4">
          <Input
            label={t("insurancePage.policyModal.policyName")}
            name="name"
            defaultValue={editingPolicy?.name || ""}
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label={t("insurancePage.policyModal.policyNumber")}
              name="policyNumber"
              defaultValue={editingPolicy?.policy_number || ""}
              pattern="[^\-].*"
              title={t("insurancePage.messages.invalidPolicyNumber")}
              placeholder={t("insurancePage.policyModal.policyNumberPlaceholder")}
            />
            <Input
              label={t("insurancePage.policyModal.provider")}
              name="provider"
              defaultValue={editingPolicy?.provider || ""}
              required
            />
          </div>
          <SelectField
            label={t("insurancePage.policyModal.type")}
            name="type"
            options={POLICY_TYPES.map((value) => ({
              value,
              label: t(`insurancePage.policyTypes.${value}`),
            }))}
            defaultValue={editingPolicy?.type || ""}
            required
          />
          <div className="grid grid-cols-3 gap-4">
            {/* #97 — use placeholder "0" instead of defaultValue "0" on create
                so users don't have to manually clear the leading zero. In
                edit mode we still pre-fill with the existing value. */}
            <Input
              label={t("insurancePage.policyModal.totalPremium")}
              name="premiumTotal"
              type="number"
              min={0}
              placeholder="0"
              defaultValue={editingPolicy?.premium_total ?? ""}
            />
            <Input
              label={t("insurancePage.policyModal.premiumPerEmployee")}
              name="premiumPerEmployee"
              type="number"
              min={0}
              placeholder="0"
              defaultValue={editingPolicy?.premium_per_employee ?? ""}
            />
            <Input
              label={t("insurancePage.policyModal.coverageAmount")}
              name="coverageAmount"
              type="number"
              min={0}
              placeholder="0"
              defaultValue={editingPolicy?.coverage_amount ?? ""}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input
              label={t("insurancePage.policyModal.startDate")}
              name="startDate"
              type="date"
              defaultValue={
                editingPolicy?.start_date ? String(editingPolicy.start_date).slice(0, 10) : ""
              }
              required
              onChange={(e) => {
                const form = (e.currentTarget as HTMLInputElement).form;
                const endInput = form?.elements.namedItem("endDate") as HTMLInputElement | null;
                if (endInput) endInput.min = e.currentTarget.value;
              }}
            />
            <Input
              label={t("insurancePage.policyModal.endDate")}
              name="endDate"
              type="date"
              defaultValue={
                editingPolicy?.end_date ? String(editingPolicy.end_date).slice(0, 10) : ""
              }
              min={
                editingPolicy?.start_date
                  ? String(editingPolicy.start_date).slice(0, 10)
                  : undefined
              }
              onChange={(e) => {
                const form = (e.currentTarget as HTMLInputElement).form;
                const renewalInput = form?.elements.namedItem(
                  "renewalDate",
                ) as HTMLInputElement | null;
                if (renewalInput) renewalInput.min = e.currentTarget.value;
              }}
            />
            <Input
              label={t("insurancePage.policyModal.renewalDate")}
              name="renewalDate"
              type="date"
              defaultValue={
                editingPolicy?.renewal_date ? String(editingPolicy.renewal_date).slice(0, 10) : ""
              }
              min={
                editingPolicy?.end_date
                  ? String(editingPolicy.end_date).slice(0, 10)
                  : editingPolicy?.start_date
                    ? String(editingPolicy.start_date).slice(0, 10)
                    : new Date().toISOString().slice(0, 10)
              }
            />
          </div>
          <Input
            label={t("insurancePage.policyModal.terms")}
            name="terms"
            defaultValue={editingPolicy?.terms || ""}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closePolicyModal}>
              {t("insurancePage.policyModal.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingPolicy
                ? t("insurancePage.policyModal.updatePolicy")
                : t("insurancePage.policyModal.createPolicy")}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Enroll Modal */}
      <Modal
        open={showEnroll}
        onClose={() => setShowEnroll(false)}
        title={t("insurancePage.enrollModal.title")}
      >
        <form onSubmit={handleEnroll} className="space-y-4">
          <SelectField
            label={t("insurancePage.enrollModal.employee")}
            name="employeeId"
            options={employees.map((e: any) => ({
              value: String(e.empcloud_user_id || e.id),
              label: `${e.first_name || e.firstName} ${e.last_name || e.lastName}`,
            }))}
            required
          />
          <SelectField
            label={t("insurancePage.enrollModal.policy")}
            name="policyId"
            options={policies
              .filter((p: any) => p.status === "active")
              .map((p: any) => ({
                value: p.id,
                label: `${p.name} (${t(
                  `insurancePage.policyTypes.${String(p.type).toLowerCase()}`,
                  { defaultValue: String(p.type).replace(/_/g, " ") },
                )})`,
              }))}
            required
          />
          <div className="grid grid-cols-2 gap-4">
            {/* #97 — placeholder instead of defaultValue so users don't have to
                backspace the "0" before typing; min="0" also blocks negatives. */}
            <Input
              label={t("insurancePage.enrollModal.sumInsured")}
              name="sumInsured"
              type="number"
              min="0"
              placeholder="0"
            />
            <Input
              label={t("insurancePage.enrollModal.premiumShare")}
              name="premiumShare"
              type="number"
              min="0"
              placeholder="0"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label={t("insurancePage.enrollModal.nomineeName")} name="nomineeName" />
            <Input
              label={t("insurancePage.enrollModal.nomineeRelationship")}
              name="nomineeRelationship"
              placeholder={t("insurancePage.enrollModal.relationshipPlaceholder")}
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowEnroll(false)}>
              {t("insurancePage.enrollModal.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("insurancePage.enrollModal.submit")}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Submit Claim Modal */}
      <Modal
        open={showSubmitClaim}
        onClose={() => setShowSubmitClaim(false)}
        title={t("insurancePage.claimModal.title")}
      >
        <form onSubmit={handleSubmitClaim} className="space-y-4">
          <SelectField
            label={t("insurancePage.claimModal.policy")}
            name="policyId"
            options={policies
              .filter((p: any) => p.status === "active")
              .map((p: any) => ({
                value: p.id,
                label: `${p.name} (${t(
                  `insurancePage.policyTypes.${String(p.type).toLowerCase()}`,
                  { defaultValue: String(p.type).replace(/_/g, " ") },
                )})`,
              }))}
            required
          />
          <SelectField
            label={t("insurancePage.claimModal.claimType")}
            name="claimType"
            options={CLAIM_TYPES.map((value) => ({
              value,
              label: t(`insurancePage.claimTypes.${value}`),
            }))}
            required
          />
          <Input
            label={t("insurancePage.claimModal.amountClaimed")}
            name="amountClaimed"
            type="number"
            required
            min={1}
          />
          <Input
            label={t("insurancePage.claimModal.description")}
            name="description"
            placeholder={t("insurancePage.claimModal.descriptionPlaceholder")}
          />
          <Input label={t("insurancePage.claimModal.notes")} name="notes" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowSubmitClaim(false)}>
              {t("insurancePage.claimModal.cancel")}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {t("insurancePage.claimModal.submit")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
