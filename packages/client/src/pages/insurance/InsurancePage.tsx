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

const POLICY_TYPES = [
  { value: "group_health", label: "Group Health" },
  { value: "group_life", label: "Group Life" },
  { value: "disability", label: "Disability" },
  { value: "accidental", label: "Accidental" },
  { value: "travel", label: "Travel" },
];

const CLAIM_TYPES = [
  { value: "hospitalization", label: "Hospitalization" },
  { value: "outpatient", label: "Outpatient" },
  { value: "dental", label: "Dental" },
  { value: "vision", label: "Vision" },
  { value: "life", label: "Life" },
  { value: "disability", label: "Disability" },
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
  const enrollments = enrollRes?.data || [];
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
    // Client-side guard for #13 — server rejects too but we fail fast.
    if (start && end && new Date(end).getTime() < new Date(start).getTime()) {
      toast.error("Policy end date cannot be before start date");
      return;
    }
    setSaving(true);
    const payload = {
      name: fd.get("name"),
      policyNumber: fd.get("policyNumber") || undefined,
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
        toast.success("Insurance policy updated");
      } else {
        await apiPost("/insurance/policies", payload);
        toast.success("Insurance policy created");
      }
      closePolicyModal();
      qc.invalidateQueries({ queryKey: ["insurance-policies"] });
      qc.invalidateQueries({ queryKey: ["insurance-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to save policy");
    } finally {
      setSaving(false);
    }
  }

  async function deletePolicy(id: string) {
    if (!confirm("Deactivate this insurance policy? Existing enrollments are unaffected.")) return;
    try {
      await apiDelete(`/insurance/policies/${id}`);
      toast.success("Insurance policy deactivated");
      qc.invalidateQueries({ queryKey: ["insurance-policies"] });
      qc.invalidateQueries({ queryKey: ["insurance-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to deactivate policy");
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
      toast.success("Employee enrolled in insurance");
      setShowEnroll(false);
      qc.invalidateQueries({ queryKey: ["insurance-enrollments"] });
      qc.invalidateQueries({ queryKey: ["insurance-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to enroll");
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
      toast.success("Claim submitted");
      setShowSubmitClaim(false);
      qc.invalidateQueries({ queryKey: ["insurance-claims"] });
      qc.invalidateQueries({ queryKey: ["insurance-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to submit claim");
    } finally {
      setSaving(false);
    }
  }

  async function handleApproveClaim(id: string) {
    const amountStr = prompt("Approved amount (leave blank for full amount):");
    try {
      await apiPost(`/insurance/claims/${id}/approve`, {
        amountApproved: amountStr ? Number(amountStr) : undefined,
      });
      toast.success("Claim approved");
      qc.invalidateQueries({ queryKey: ["insurance-claims"] });
      qc.invalidateQueries({ queryKey: ["insurance-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    }
  }

  async function handleRejectClaim(id: string) {
    const reason = prompt("Rejection reason:");
    try {
      await apiPost(`/insurance/claims/${id}/reject`, { rejectionReason: reason });
      toast.success("Claim rejected");
      qc.invalidateQueries({ queryKey: ["insurance-claims"] });
      qc.invalidateQueries({ queryKey: ["insurance-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    }
  }

  async function handleSettleClaim(id: string) {
    try {
      await apiPost(`/insurance/claims/${id}/settle`);
      toast.success("Claim settled");
      qc.invalidateQueries({ queryKey: ["insurance-claims"] });
      qc.invalidateQueries({ queryKey: ["insurance-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    }
  }

  async function cancelEnrollment(id: string) {
    try {
      await apiPost(`/insurance/enrollments/${id}/cancel`);
      toast.success("Enrollment cancelled");
      qc.invalidateQueries({ queryKey: ["insurance-enrollments"] });
      qc.invalidateQueries({ queryKey: ["insurance-dashboard"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    }
  }

  // --- Table columns ---
  const policyColumns = [
    {
      key: "name",
      header: "Policy Name",
      render: (r: any) => <span className="font-medium text-gray-900">{r.name}</span>,
    },
    {
      key: "policy_number",
      header: "Number",
      render: (r: any) => r.policy_number || "-",
    },
    { key: "provider", header: "Provider" },
    {
      key: "type",
      header: "Type",
      render: (r: any) => <Badge variant="draft">{r.type.replace(/_/g, " ")}</Badge>,
    },
    {
      key: "coverage_amount",
      header: "Coverage",
      render: (r: any) => formatCurrency(Number(r.coverage_amount)),
    },
    {
      key: "premium_per_employee",
      header: "Premium/Employee",
      render: (r: any) => formatCurrency(Number(r.premium_per_employee)),
    },
    {
      key: "status",
      header: "Status",
      render: (r: any) => <Badge variant={STATUS_BADGE[r.status] || "draft"}>{r.status}</Badge>,
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
              title="Deactivate"
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
      header: "Employee",
      render: (r: any) => <span className="font-medium text-gray-900">{r.employee_name}</span>,
    },
    {
      key: "policy_name",
      header: "Policy",
      render: (r: any) => r.policy_name,
    },
    {
      key: "policy_type",
      header: "Type",
      render: (r: any) => <Badge variant="draft">{(r.policy_type || "").replace(/_/g, " ")}</Badge>,
    },
    {
      key: "sum_insured",
      header: "Sum Insured",
      render: (r: any) => formatCurrency(Number(r.sum_insured)),
    },
    {
      key: "premium_share",
      header: "Premium Share",
      render: (r: any) => formatCurrency(Number(r.premium_share)),
    },
    {
      key: "nominee_name",
      header: "Nominee",
      render: (r: any) =>
        r.nominee_name ? `${r.nominee_name} (${r.nominee_relationship || ""})` : "-",
    },
    {
      key: "status",
      header: "Status",
      render: (r: any) => <Badge variant={STATUS_BADGE[r.status] || "draft"}>{r.status}</Badge>,
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
            Cancel
          </Button>
        ) : null,
    },
  ];

  const claimColumns = [
    {
      key: "claim_number",
      header: "Claim #",
      render: (r: any) => <span className="font-mono text-sm font-medium">{r.claim_number}</span>,
    },
    {
      key: "employee_name",
      header: "Employee",
      render: (r: any) => <span className="font-medium">{r.employee_name}</span>,
    },
    {
      key: "claim_type",
      header: "Type",
      render: (r: any) => <Badge variant="draft">{r.claim_type}</Badge>,
    },
    {
      key: "amount_claimed",
      header: "Claimed",
      render: (r: any) => formatCurrency(Number(r.amount_claimed)),
    },
    {
      key: "amount_approved",
      header: "Approved",
      render: (r: any) =>
        r.amount_approved != null ? formatCurrency(Number(r.amount_approved)) : "-",
    },
    {
      key: "status",
      header: "Status",
      render: (r: any) => (
        <Badge variant={STATUS_BADGE[r.status] || "draft"}>{r.status.replace(/_/g, " ")}</Badge>
      ),
    },
    {
      key: "submitted_at",
      header: "Submitted",
      render: (r: any) => (r.submitted_at ? new Date(r.submitted_at).toLocaleDateString() : "-"),
    },
    {
      key: "actions",
      header: "",
      render: (r: any) => {
        if (r.status === "submitted" || r.status === "under_review") {
          return (
            <div className="flex gap-1">
              <Button variant="ghost" size="sm" onClick={() => handleApproveClaim(r.id)}>
                <CheckCircle className="mr-1 h-4 w-4 text-green-600" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => handleRejectClaim(r.id)}>
                <XCircle className="mr-1 h-4 w-4 text-red-600" />
              </Button>
            </div>
          );
        }
        if (r.status === "approved") {
          return (
            <Button variant="ghost" size="sm" onClick={() => handleSettleClaim(r.id)}>
              <CreditCard className="mr-1 h-4 w-4" /> Settle
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
        title="Insurance Management"
        description="Manage group insurance policies, enrollments, and claims"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setShowSubmitClaim(true)}>
              <FileText className="mr-2 h-4 w-4" /> Submit Claim
            </Button>
            <Button variant="outline" onClick={() => setShowEnroll(true)}>
              <UserPlus className="mr-2 h-4 w-4" /> Enroll Employee
            </Button>
            <Button onClick={() => setShowCreatePolicy(true)}>
              <Plus className="mr-2 h-4 w-4" /> New Policy
            </Button>
          </div>
        }
      />

      {/* Stats */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard title="Active Policies" value={stats.totalPolicies || 0} icon={ShieldCheck} />
        <StatCard title="Active Enrollments" value={stats.totalEnrollments || 0} icon={Users} />
        <StatCard title="Pending Claims" value={stats.pendingClaims || 0} icon={AlertCircle} />
        <StatCard
          title="Total Approved"
          value={formatCurrency(stats.totalApprovedAmount || 0)}
          icon={DollarSign}
        />
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setTab("policies")}
          className={`px-4 py-2 text-sm font-medium ${tab === "policies" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          Policies ({policies.length})
        </button>
        <button
          onClick={() => setTab("enrollments")}
          className={`px-4 py-2 text-sm font-medium ${tab === "enrollments" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          Enrollments ({enrollments.length})
        </button>
        <button
          onClick={() => setTab("claims")}
          className={`px-4 py-2 text-sm font-medium ${tab === "claims" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          Claims ({claims.length})
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
                emptyMessage="No insurance policies created yet"
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
                emptyMessage="No enrollments yet"
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
                emptyMessage="No claims submitted yet"
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
        title={editingPolicy ? "Edit Insurance Policy" : "Create Insurance Policy"}
        key={editingPolicy?.id || "new-policy"}
      >
        <form onSubmit={handlePolicySubmit} className="space-y-4">
          <Input
            label="Policy Name"
            name="name"
            defaultValue={editingPolicy?.name || ""}
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="Policy Number"
              name="policyNumber"
              defaultValue={editingPolicy?.policy_number || ""}
            />
            <Input
              label="Provider"
              name="provider"
              defaultValue={editingPolicy?.provider || ""}
              required
            />
          </div>
          <SelectField
            label="Type"
            name="type"
            options={POLICY_TYPES}
            defaultValue={editingPolicy?.type || ""}
            required
          />
          <div className="grid grid-cols-3 gap-4">
            <Input
              label="Total Premium"
              name="premiumTotal"
              type="number"
              min={0}
              defaultValue={editingPolicy?.premium_total ?? "0"}
            />
            <Input
              label="Premium / Employee"
              name="premiumPerEmployee"
              type="number"
              min={0}
              defaultValue={editingPolicy?.premium_per_employee ?? "0"}
            />
            <Input
              label="Coverage Amount"
              name="coverageAmount"
              type="number"
              min={0}
              defaultValue={editingPolicy?.coverage_amount ?? "0"}
            />
          </div>
          <div className="grid grid-cols-3 gap-4">
            <Input
              label="Start Date"
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
              label="End Date"
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
            />
            <Input
              label="Renewal Date"
              name="renewalDate"
              type="date"
              defaultValue={
                editingPolicy?.renewal_date ? String(editingPolicy.renewal_date).slice(0, 10) : ""
              }
            />
          </div>
          <Input
            label="Terms & Conditions"
            name="terms"
            defaultValue={editingPolicy?.terms || ""}
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={closePolicyModal}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {editingPolicy ? "Update Policy" : "Create Policy"}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Enroll Modal */}
      <Modal
        open={showEnroll}
        onClose={() => setShowEnroll(false)}
        title="Enroll Employee in Insurance"
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
            label="Insurance Policy"
            name="policyId"
            options={policies
              .filter((p: any) => p.status === "active")
              .map((p: any) => ({
                value: p.id,
                label: `${p.name} (${p.type.replace(/_/g, " ")})`,
              }))}
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input label="Sum Insured" name="sumInsured" type="number" defaultValue="0" />
            <Input
              label="Employee Premium Share"
              name="premiumShare"
              type="number"
              defaultValue="0"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <Input label="Nominee Name" name="nomineeName" />
            <Input
              label="Nominee Relationship"
              name="nomineeRelationship"
              placeholder="e.g. Spouse, Parent"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowEnroll(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Enroll
            </Button>
          </div>
        </form>
      </Modal>

      {/* Submit Claim Modal */}
      <Modal
        open={showSubmitClaim}
        onClose={() => setShowSubmitClaim(false)}
        title="Submit Insurance Claim"
      >
        <form onSubmit={handleSubmitClaim} className="space-y-4">
          <SelectField
            label="Insurance Policy"
            name="policyId"
            options={policies
              .filter((p: any) => p.status === "active")
              .map((p: any) => ({
                value: p.id,
                label: `${p.name} (${p.type.replace(/_/g, " ")})`,
              }))}
            required
          />
          <SelectField label="Claim Type" name="claimType" options={CLAIM_TYPES} required />
          <Input label="Amount Claimed" name="amountClaimed" type="number" required min={1} />
          <Input label="Description" name="description" placeholder="Describe the claim" />
          <Input label="Notes" name="notes" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowSubmitClaim(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Submit Claim
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
