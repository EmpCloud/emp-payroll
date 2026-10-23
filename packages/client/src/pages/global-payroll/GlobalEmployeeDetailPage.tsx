import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { apiGet, apiPut, apiPost } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  CheckCircle,
  Circle,
  AlertTriangle,
  Loader2,
  User,
  Building,
  CreditCard,
  Shield,
  MapPin,
} from "lucide-react";
import toast from "react-hot-toast";
import { UaeProfileCard } from "@/components/uae/UaeProfileCard";

const STATUS_BADGE: Record<string, "active" | "draft" | "inactive"> = {
  active: "active",
  onboarding: "draft",
  offboarding: "draft",
  terminated: "inactive",
};

const CATEGORY_COLORS: Record<string, string> = {
  legal: "text-purple-600 bg-purple-50",
  tax: "text-blue-600 bg-blue-50",
  payroll: "text-green-600 bg-green-50",
  benefits: "text-orange-600 bg-orange-50",
  immigration: "text-red-600 bg-red-50",
};

export function GlobalEmployeeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [terminating, setTerminating] = useState(false);
  const [activating, setActivating] = useState(false);

  const { data: empRes, isLoading } = useQuery({
    queryKey: ["global-employee", id],
    queryFn: () => apiGet<any>(`/global/employees/${id}`),
    enabled: !!id,
  });

  const emp = empRes?.data;

  const handleToggleChecklist = async (itemId: string, currentlyCompleted: boolean) => {
    try {
      await apiPut(`/global/compliance/${itemId}`, {
        completed: !currentlyCompleted,
      });
      qc.invalidateQueries({ queryKey: ["global-employee", id] });
      toast.success(currentlyCompleted ? "Marked as incomplete" : "Marked as complete");
    } catch (err: any) {
      toast.error("Failed to update checklist item");
    }
  };

  const handleActivate = async () => {
    setActivating(true);
    try {
      await apiPut(`/global/employees/${id}`, { status: "active" });
      qc.invalidateQueries({ queryKey: ["global-employee", id] });
      qc.invalidateQueries({ queryKey: ["global-employees"] });
      toast.success("Employee activated");
    } catch (err: any) {
      toast.error("Failed to activate");
    } finally {
      setActivating(false);
    }
  };

  const handleTerminate = async () => {
    if (!confirm("Are you sure you want to start offboarding this employee?")) return;
    setTerminating(true);
    try {
      await apiPost(`/global/employees/${id}/terminate`, {
        reason: "Initiated from admin panel",
      });
      qc.invalidateQueries({ queryKey: ["global-employee", id] });
      qc.invalidateQueries({ queryKey: ["global-employees"] });
      toast.success("Offboarding started");
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to terminate");
    } finally {
      setTerminating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!emp) {
    return (
      <div className="py-12 text-center">
        <p className="text-gray-500">Employee not found.</p>
        <Button
          variant="outline"
          className="mt-4"
          onClick={() => navigate("/global-payroll/employees")}
        >
          Back to Employees
        </Button>
      </div>
    );
  }

  const complianceNotes = emp.country?.compliance_notes || {};

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="outline" size="sm" onClick={() => navigate("/global-payroll/employees")}>
          <ArrowLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
        <PageHeader
          title={`${emp.first_name} ${emp.last_name}`}
          description={`${emp.job_title} - ${emp.country?.name || "Unknown Country"}`}
        />
      </div>

      {/* Status & Actions Bar */}
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-4">
            <Badge variant={STATUS_BADGE[emp.status] || "draft"}>
              {emp.status.charAt(0).toUpperCase() + emp.status.slice(1)}
            </Badge>
            <Badge
              variant={
                emp.employment_type === "eor"
                  ? "active"
                  : emp.employment_type === "contractor"
                    ? "draft"
                    : "active"
              }
            >
              {emp.employment_type === "eor"
                ? "EOR"
                : emp.employment_type === "direct_hire"
                  ? "Direct Hire"
                  : "Contractor"}
            </Badge>
            <span className="text-sm text-gray-500">
              Compliance:{" "}
              <span
                className={
                  emp.compliance_percentage >= 80
                    ? "font-semibold text-green-600"
                    : "font-semibold text-orange-600"
                }
              >
                {emp.compliance_percentage}%
              </span>
            </span>
          </div>
          <div className="flex gap-2">
            {emp.status === "onboarding" && (
              <Button size="sm" onClick={handleActivate} disabled={activating}>
                {activating && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Activate
              </Button>
            )}
            {(emp.status === "active" || emp.status === "onboarding") && (
              <Button
                size="sm"
                variant="outline"
                className="text-red-600 hover:bg-red-50"
                onClick={handleTerminate}
                disabled={terminating}
              >
                {terminating && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                Terminate
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Employee Info */}
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardContent className="p-6">
              <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
                <User className="h-5 w-5" />
                Personal Information
              </h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Full Name</p>
                  <p className="font-medium">
                    {emp.first_name} {emp.last_name}
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Email</p>
                  <p className="font-medium">{emp.email}</p>
                </div>
                <div>
                  <p className="text-gray-500">Job Title</p>
                  <p className="font-medium">{emp.job_title}</p>
                </div>
                <div>
                  <p className="text-gray-500">Department</p>
                  <p className="font-medium">{emp.department || "-"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Contract Type</p>
                  <p className="font-medium capitalize">{emp.contract_type?.replace("_", " ")}</p>
                </div>
                <div>
                  <p className="text-gray-500">Tax ID</p>
                  <p className="font-medium">{emp.tax_id || "-"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Start Date</p>
                  <p className="font-medium">{new Date(emp.start_date).toLocaleDateString()}</p>
                </div>
                <div>
                  <p className="text-gray-500">End Date</p>
                  <p className="font-medium">
                    {emp.end_date ? new Date(emp.end_date).toLocaleDateString() : "-"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-6">
              <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
                <CreditCard className="h-5 w-5" />
                Compensation & Banking
              </h3>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-gray-500">Salary</p>
                  <p className="text-lg font-bold">
                    {emp.salary_currency} {(Number(emp.salary_amount) / 100).toLocaleString()}
                    <span className="text-sm font-normal text-gray-400">
                      /{emp.salary_frequency}
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-gray-500">Currency</p>
                  <p className="font-medium">{emp.salary_currency}</p>
                </div>
                <div>
                  <p className="text-gray-500">Bank Name</p>
                  <p className="font-medium">{emp.bank_name || "-"}</p>
                </div>
                <div>
                  <p className="text-gray-500">Bank Account</p>
                  <p className="font-medium">
                    {emp.bank_account ? `****${emp.bank_account.slice(-4)}` : "-"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {(emp.country?.code === "AE" || emp.country_code === "AE") && (
            <UaeProfileCard employee={emp} />
          )}

          {/* Country Compliance Rules */}
          {emp.country && emp.country.code !== "AE" && emp.country_code !== "AE" && (
            <Card>
              <CardContent className="p-6">
                <h3 className="mb-4 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
                  <MapPin className="h-5 w-5" />
                  {emp.country.name} - Compliance Rules
                </h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Notice Period</p>
                    <p className="font-medium">{emp.country.notice_period_days} days</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Probation</p>
                    <p className="font-medium">{emp.country.probation_months} months</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Annual Leave</p>
                    <p className="font-medium">{emp.country.annual_leave_days} days</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Public Holidays</p>
                    <p className="font-medium">{emp.country.public_holidays} days</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Max Work Hours/Week</p>
                    <p className="font-medium">{emp.country.max_work_hours_week} hrs</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Pay Frequency</p>
                    <p className="font-medium capitalize">{emp.country.payroll_frequency}</p>
                  </div>
                </div>
                {Object.keys(complianceNotes).length > 0 && (
                  <div className="mt-4 rounded-lg bg-gray-50 p-4 dark:bg-gray-800/50">
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
                      Tax & Social Security
                    </p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {Object.entries(complianceNotes).map(([key, value]) => (
                        <div key={key} className="flex justify-between">
                          <span className="capitalize text-gray-500">{key.replace(/_/g, " ")}</span>
                          <span className="font-medium">
                            {typeof value === "number" ? `${value}%` : String(value)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>

        {/* Compliance Checklist Sidebar */}
        <div>
          <Card>
            <CardContent className="p-6">
              <h3 className="mb-2 flex items-center gap-2 text-lg font-semibold text-gray-900 dark:text-white">
                <Shield className="h-5 w-5" />
                Compliance Checklist
              </h3>
              <p className="mb-4 text-sm text-gray-500">
                {emp.compliance_percentage}% complete (
                {emp.compliance_checklist?.filter((c: any) => c.is_completed).length}/
                {emp.compliance_checklist?.length})
              </p>
              {/* Progress bar */}
              <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                <div
                  className={`h-full rounded-full transition-all ${
                    emp.compliance_percentage >= 80
                      ? "bg-green-500"
                      : emp.compliance_percentage >= 50
                        ? "bg-yellow-500"
                        : "bg-red-500"
                  }`}
                  style={{ width: `${emp.compliance_percentage}%` }}
                />
              </div>
              <div className="space-y-2">
                {emp.compliance_checklist?.map((item: any) => (
                  <button
                    key={item.id}
                    className="flex w-full items-start gap-3 rounded-lg p-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
                    onClick={() => handleToggleChecklist(item.id, item.is_completed)}
                  >
                    {item.is_completed ? (
                      <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-green-500" />
                    ) : (
                      <Circle className="mt-0.5 h-4 w-4 shrink-0 text-gray-300" />
                    )}
                    <div>
                      <p
                        className={`text-sm ${item.is_completed ? "text-gray-400 line-through" : "text-gray-700 dark:text-gray-300"}`}
                      >
                        {item.item}
                      </p>
                      <span
                        className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-medium uppercase ${CATEGORY_COLORS[item.category] || "bg-gray-100 text-gray-500"}`}
                      >
                        {item.category}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
