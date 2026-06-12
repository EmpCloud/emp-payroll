import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Avatar } from "@/components/ui/Avatar";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { Modal } from "@/components/ui/Modal";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  useEmployee,
  useEmployeeSalary,
  useUpdateEmployee,
  useSalaryStructures,
  useOrgSettings,
} from "@/api/hooks";
import { getUser } from "@/api/auth";
import { apiGet, apiPost, apiDelete, apiPut } from "@/api/client";
import { useDepartments } from "@/api/hooks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Mail,
  Phone,
  Building2,
  Calendar,
  CreditCard,
  Shield,
  Loader2,
  Pencil,
  Wallet,
  History,
  Banknote,
  StickyNote,
  Send,
  Trash2,
  FileText,
  Upload,
  CheckCircle,
} from "lucide-react";
import { api } from "@/api/client";
import toast from "react-hot-toast";
import {
  resolveSalaryComponents,
  SalaryResolverError,
  type ResolverComponent,
} from "@emp-payroll/shared";

export function EmployeeDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: empRes, isLoading } = useEmployee(id!);
  const { data: salaryRes } = useEmployeeSalary(id!);
  const { data: payslipsRes } = useQuery({
    queryKey: ["employee-payslips", id],
    queryFn: () => apiGet<any>(`/payslips/employee/${id}`),
    enabled: !!id,
  });
  const { data: historyRes } = useQuery({
    queryKey: ["salary-history", id],
    queryFn: () => apiGet<any>(`/salary-structures/employee/${id}/history`),
    enabled: !!id,
  });
  // Delete-salary-revision confirmation state. Holds the id of the past
  // revision pending deletion (null = no dialog open).
  const [deleteSalaryId, setDeleteSalaryId] = useState<string | null>(null);
  const [deletingSalary, setDeletingSalary] = useState(false);
  async function confirmDeleteSalary() {
    if (!deleteSalaryId) return;
    setDeletingSalary(true);
    try {
      await apiDelete(`/salary-structures/employee/${id}/salary/${deleteSalaryId}`);
      await qc.invalidateQueries({ queryKey: ["salary-history", id] });
      toast.success("Salary revision deleted");
      setDeleteSalaryId(null);
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || "Failed to delete salary revision");
    } finally {
      setDeletingSalary(false);
    }
  }
  const { data: loansRes } = useQuery({
    queryKey: ["employee-loans", id],
    queryFn: () => apiGet<any>(`/loans/employee/${id}`),
    enabled: !!id,
  });
  const updateMutation = useUpdateEmployee(id!);
  const { data: structuresRes } = useSalaryStructures();
  const { data: deptsData } = useDepartments();
  // #365 — Pull org statutory overrides so the Salary Details card can
  // mirror the cap math used by the payroll engine + SalaryAssignForm
  // preview.
  const _user = getUser();
  const { data: orgSettingsRes } = useOrgSettings(_user?.orgId ? String(_user.orgId) : "");
  const deptOptions = (deptsData?.data?.data || deptsData?.data || []).map((d: any) => ({
    value: d.name,
    label: d.name,
  }));
  const [editOpen, setEditOpen] = useState(false);
  const [salaryOpen, setSalaryOpen] = useState(false);
  const [salaryAssigning, setSalaryAssigning] = useState(false);
  const [statutoryOpen, setStatutoryOpen] = useState(false);
  const [statutorySaving, setStatutorySaving] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  const [bankSaving, setBankSaving] = useState(false);

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
      </div>
    );
  }

  const emp = empRes?.data;
  if (!emp) return <div className="p-8 text-gray-500">Employee not found</div>;

  const salary = salaryRes?.data;
  const payslips = payslipsRes?.data?.data || [];
  const bankDetails =
    typeof emp.bank_details === "string" ? JSON.parse(emp.bank_details) : emp.bank_details || {};
  const taxInfo = typeof emp.tax_info === "string" ? JSON.parse(emp.tax_info) : emp.tax_info || {};
  const pfDetails =
    typeof emp.pf_details === "string" ? JSON.parse(emp.pf_details) : emp.pf_details || {};
  const esiDetails =
    typeof emp.esi_details === "string" ? JSON.parse(emp.esi_details) : emp.esi_details || {};
  const components = salary?.components
    ? typeof salary.components === "string"
      ? JSON.parse(salary.components)
      : salary.components
    : [];
  const monthlyBasic = components.find((c: any) => c.code === "BASIC")?.monthlyAmount || 0;
  const monthlyHRA = components.find((c: any) => c.code === "HRA")?.monthlyAmount || 0;
  // #365 — Monthly EPF displayed on the read-only Salary Details card,
  // mirroring the cap math used by both the payroll engine and the
  // SalaryAssignForm preview so HR sees the SAME number everywhere
  // (slip / Salary Details card / preview).
  // Resolution chain: opted out -> 0; rate from employee profile, falling
  // back to org default (12%); apply org wage-basis (full basic vs ₹15K
  // ceiling); finally cap with pfMaxEmployeeContribution.
  const _orgSettings: any = orgSettingsRes?.data;
  const _pfOptedOut = pfDetails?.isOptedOut === true;
  const _pfRate =
    Number(pfDetails?.contributionRate ?? _orgSettings?.pfDefaultEmployeeRate ?? 12) || 12;
  const _applyFullBasic = _orgSettings?.pfApplyFullBasic === true;
  const _maxCap =
    _orgSettings?.pfMaxEmployeeContribution != null
      ? Number(_orgSettings.pfMaxEmployeeContribution)
      : null;
  let monthlyEPFForCard = 0;
  if (!_pfOptedOut && monthlyBasic > 0) {
    const _pfBase = _applyFullBasic ? monthlyBasic : Math.min(monthlyBasic, 15000);
    monthlyEPFForCard = Math.round((_pfBase * _pfRate) / 100);
    if (_maxCap != null && Number.isFinite(_maxCap) && monthlyEPFForCard > _maxCap) {
      monthlyEPFForCard = Math.round(_maxCap);
    }
  }

  async function handleEdit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await updateMutation.mutateAsync({
        firstName: fd.get("firstName") as string,
        lastName: fd.get("lastName") as string,
        phone: fd.get("phone") as string,
        department: fd.get("department") as string,
        designation: fd.get("designation") as string,
      });
      toast.success("Employee updated");
      setEditOpen(false);
      qc.invalidateQueries({ queryKey: ["employee", id] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Update failed");
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`${emp.first_name} ${emp.last_name}`.trim() || "Employee"}
        description={
          emp.designation && emp.department ? `${emp.designation} · ${emp.department}` : undefined
        }
        actions={
          <Button variant="ghost" onClick={() => navigate("/employees")}>
            <ArrowLeft className="h-4 w-4" /> Back to Employees
          </Button>
        }
      />

      {/* Profile header */}
      <Card>
        <CardContent className="py-6">
          <div className="flex items-start gap-6">
            <Avatar name={`${emp.first_name} ${emp.last_name}`} size="lg" />
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h2 className="text-xl font-bold text-gray-900">
                  {emp.first_name} {emp.last_name}
                </h2>
                <Badge variant={emp.is_active ? "active" : "inactive"}>
                  {emp.is_active ? "Active" : "Inactive"}
                </Badge>
              </div>
              <p className="text-sm text-gray-500">
                {emp.designation} &middot; {emp.department}
              </p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm text-gray-600">
                <span className="flex items-center gap-1">
                  <Mail className="h-4 w-4" />
                  {emp.email}
                </span>
                {emp.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="h-4 w-4" />
                    {emp.phone}
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Calendar className="h-4 w-4" />
                  Joined {formatDate(emp.date_of_joining)}
                </span>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" /> Salary Details
              </CardTitle>
              <Button variant="outline" size="sm" onClick={() => setSalaryOpen(true)}>
                <Wallet className="h-4 w-4" /> {salary ? "Revise" : "Assign"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              {[
                ["Annual CTC", salary ? formatCurrency(salary.ctc) : "—"],
                ["Monthly Basic", monthlyBasic ? formatCurrency(monthlyBasic) : "—"],
                ["HRA", monthlyHRA ? formatCurrency(monthlyHRA) : "—"],
                ["Gross (Annual)", salary ? formatCurrency(salary.gross_salary) : "—"],
                // #365 — Show the cap-aware EPF figure HR sees on the
                // payslip and the Assign Salary preview, instead of the
                // raw 12%-of-basic value (which read as "broken" when an
                // org had pf_max_employee_contribution set).
                [
                  "Monthly EPF (Employee)",
                  _pfOptedOut
                    ? "Opted out"
                    : monthlyEPFForCard > 0
                      ? formatCurrency(monthlyEPFForCard)
                      : "—",
                ],
                ["Employee Code", emp.employee_code],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-sm">
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="font-medium text-gray-900">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-5 w-5" /> Bank Details
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setBankOpen(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              {[
                ["Bank Name", bankDetails.bankName || "—"],
                ["Account Number", bankDetails.accountNumber || "—"],
                ["IFSC Code", bankDetails.ifscCode || "—"],
                ["Account Type", bankDetails.accountType || "Savings"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-sm">
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="font-medium text-gray-900">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" /> Statutory
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => setStatutoryOpen(true)}>
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              {[
                ["Tax Regime", taxInfo.regime === "old" ? "Old Regime" : "New Regime"],
                ["PAN", taxInfo.pan || "N/A"],
                ["UAN", taxInfo.uan || "N/A"],
                ["Deduct TDS", taxInfo.deductTDS === false ? "No" : "Yes"],
                ["Deduct PT", taxInfo.deductPT === false ? "No" : "Yes"],
                ["State (PT override)", taxInfo.state || "Use org default"],
                ["PF Number", pfDetails.pfNumber || "N/A"],
                ["PF Rate", `${pfDetails.contributionRate || 12}%`],
                ["PF Opted Out", pfDetails.isOptedOut ? "Yes" : "No"],
                ["ESI Eligible", esiDetails.isEligible === false ? "No" : "Yes"],
                ["ESI Number", esiDetails.esiNumber || "N/A"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-sm">
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="font-medium capitalize text-gray-900">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        {/* YTD Summary */}
        {payslips.length > 0 &&
          (() => {
            const now = new Date();
            const fyStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
            const fyPayslips = payslips.filter(
              (p: any) => p.year > fyStart || (p.year === fyStart && p.month >= 4),
            );
            const ytdGross = fyPayslips.reduce(
              (s: number, p: any) => s + Number(p.gross_earnings || 0),
              0,
            );
            const ytdDed = fyPayslips.reduce(
              (s: number, p: any) => s + Number(p.total_deductions || 0),
              0,
            );
            const ytdNet = fyPayslips.reduce((s: number, p: any) => s + Number(p.net_pay || 0), 0);
            return (
              <Card>
                <CardHeader>
                  <CardTitle>
                    YTD Summary (FY {fyStart}-{fyStart + 1})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4 text-center">
                    <div>
                      <p className="text-xs text-gray-500">Gross Earnings</p>
                      <p className="text-lg font-bold text-gray-900">{formatCurrency(ytdGross)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Total Deductions</p>
                      <p className="text-lg font-bold text-red-600">{formatCurrency(ytdDed)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-500">Net Pay</p>
                      <p className="text-brand-700 text-lg font-bold">{formatCurrency(ytdNet)}</p>
                    </div>
                  </div>
                  <p className="mt-2 text-center text-xs text-gray-400">
                    {fyPayslips.length} payslips processed
                  </p>
                </CardContent>
              </Card>
            );
          })()}

        <Card>
          <CardHeader>
            <CardTitle>Recent Payslips</CardTitle>
          </CardHeader>
          <CardContent>
            {payslips.length === 0 ? (
              <p className="text-sm text-gray-400">No payslips found</p>
            ) : (
              <div className="space-y-3">
                {payslips.slice(0, 6).map((p: any) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded-lg border border-gray-100 p-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {new Date(p.year, p.month - 1).toLocaleString("en-IN", {
                          month: "long",
                          year: "numeric",
                        })}
                      </p>
                      <p className="text-xs text-gray-500">Net: {formatCurrency(p.net_pay)}</p>
                    </div>
                    <Badge variant={p.status}>{p.status}</Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Salary Revision History */}
      {(historyRes?.data || []).length > 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <History className="h-5 w-5" /> Salary History
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="px-6 py-3 text-left font-medium text-gray-500">Effective From</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">Structure</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">CTC</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500">Gross</th>
                  <th className="px-6 py-3 text-left font-medium text-gray-500">Status</th>
                  <th className="px-6 py-3 text-right font-medium text-gray-500"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(historyRes?.data || []).map((h: any, i: number) => (
                  <tr key={h.id} className={i === 0 ? "bg-brand-50/30" : ""}>
                    <td className="px-6 py-3">
                      {new Date(h.effective_from).toLocaleDateString("en-IN")}
                    </td>
                    <td className="px-6 py-3">{h.structure_name}</td>
                    <td className="px-6 py-3 text-right font-medium">{formatCurrency(h.ctc)}</td>
                    <td className="px-6 py-3 text-right">{formatCurrency(h.gross_salary)}</td>
                    <td className="px-6 py-3">
                      <Badge variant={h.is_active ? "active" : "inactive"}>
                        {h.is_active ? "Current" : "Previous"}
                      </Badge>
                    </td>
                    <td className="px-6 py-3 text-right">
                      {/* The current/active salary can't be deleted — revise it
                          instead. Past revisions get a delete to clean up junk. */}
                      {!h.is_active && (
                        <button
                          onClick={() => setDeleteSalaryId(h.id)}
                          className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
                          title="Delete this salary revision"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Delete-salary-revision confirmation */}
      <Modal
        open={!!deleteSalaryId}
        onClose={() => {
          if (!deletingSalary) setDeleteSalaryId(null);
        }}
        title="Delete salary revision?"
        description="This permanently removes this past salary record from the history. Already-computed payslips are not affected. This cannot be undone."
        className="max-w-md"
      >
        <div className="flex justify-end gap-3">
          <Button
            variant="outline"
            onClick={() => setDeleteSalaryId(null)}
            disabled={deletingSalary}
          >
            Cancel
          </Button>
          <Button variant="danger" onClick={confirmDeleteSalary} loading={deletingSalary}>
            Delete
          </Button>
        </div>
      </Modal>

      {/* Active Loans */}
      {(loansRes?.data?.data || []).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Banknote className="h-5 w-5" /> Loans & Advances
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(loansRes?.data?.data || []).map((loan: any) => (
                <div
                  key={loan.id}
                  className="flex items-center justify-between rounded-lg border border-gray-100 p-3"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-900">{loan.description}</p>
                    <p className="text-xs text-gray-500">
                      {loan.type.replace("_", " ")} &middot; EMI: {formatCurrency(loan.emi_amount)}
                      /mo &middot; {loan.installments_paid}/{loan.tenure_months} paid
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-orange-600">
                      {formatCurrency(loan.outstanding_amount)}
                    </p>
                    <Badge variant={loan.status === "active" ? "active" : "approved"}>
                      {loan.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Timeline */}
      <EmployeeTimeline
        emp={emp}
        payslips={payslips}
        salary={salary}
        history={historyRes?.data || []}
      />

      {/* Documents */}
      <EmployeeDocuments employeeId={id!} />

      {/* Notes */}
      <EmployeeNotes employeeId={id!} />

      {/* Edit Modal */}
      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Edit Employee"
        className="max-w-lg"
      >
        <form onSubmit={handleEdit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input
              id="firstName"
              name="firstName"
              label="First Name"
              defaultValue={emp.first_name}
              required
            />
            <Input
              id="lastName"
              name="lastName"
              label="Last Name"
              defaultValue={emp.last_name}
              required
            />
          </div>
          <Input id="phone" name="phone" label="Phone" defaultValue={emp.phone || ""} />
          <div className="grid grid-cols-2 gap-4">
            {deptOptions.length > 0 ? (
              <SelectField
                id="department"
                name="department"
                label="Department"
                defaultValue={emp.department || ""}
                options={[
                  { value: "", label: "— Select department —" },
                  ...(deptOptions.find((d: any) => d.value === emp.department)
                    ? deptOptions
                    : [
                        { value: emp.department, label: `${emp.department} (current)` },
                        ...deptOptions,
                      ]),
                ]}
                required
              />
            ) : (
              <Input
                id="department"
                name="department"
                label="Department"
                defaultValue={emp.department}
                required
              />
            )}
            <Input
              id="designation"
              name="designation"
              label="Designation"
              defaultValue={emp.designation}
              required
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={updateMutation.isPending}>
              Save Changes
            </Button>
          </div>
        </form>
      </Modal>

      {/* Salary Assignment Modal */}
      <Modal
        open={salaryOpen}
        onClose={() => setSalaryOpen(false)}
        title={salary ? "Salary Revision" : "Assign Salary"}
        className="max-w-lg"
      >
        <SalaryAssignForm
          employeeId={id!}
          structures={(() => {
            // Endpoint returns a paginated envelope; the array is at
            // res.data.data. Tolerate a flat shape too in case the
            // endpoint is ever simplified.
            const p: any = structuresRes?.data;
            return Array.isArray(p) ? p : Array.isArray(p?.data) ? p.data : [];
          })()}
          currentCTC={salary ? Number(salary.ctc) : undefined}
          pfDetails={pfDetails}
          taxInfo={taxInfo}
          loading={salaryAssigning}
          onSubmit={async (data) => {
            setSalaryAssigning(true);
            try {
              await apiPost("/salary-structures/assign", data);
              toast.success(salary ? "Salary revised" : "Salary assigned");
              setSalaryOpen(false);
              qc.invalidateQueries({ queryKey: ["employee-salary", id] });
            } catch (err: any) {
              toast.error(err.response?.data?.error?.message || "Failed");
            } finally {
              setSalaryAssigning(false);
            }
          }}
          onCancel={() => setSalaryOpen(false)}
        />
      </Modal>

      {/* Bank Details Modal */}
      <Modal
        open={bankOpen}
        onClose={() => setBankOpen(false)}
        title="Edit Bank Details"
        className="max-w-lg"
      >
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const bankName = (fd.get("bankName") as string) || "";
            // Letters (incl. accented), spaces, and . , & -
            const BANK_NAME_REGEX = /^[\p{L}\s.,&-]+$/u;
            if (!BANK_NAME_REGEX.test(bankName)) {
              toast.error("Bank name must only contain letters, spaces, and . , & -");
              return;
            }
            // #354 — IFSC: 11 chars, uppercase, 5th char must be 0.
            // RBI standard: 4 letters + "0" + 6 alphanumeric. Mirrors the
            // server-side validation in bank-file.service so HR sees the
            // problem on submit instead of when the bank file is generated.
            // #374 — IFSC is optional during initial onboarding (HR may
            // capture the account number first and circle back for IFSC
            // once the employee shares it), so only enforce the format
            // when a value was actually entered. Empty saves still go
            // through and the server-side bank-file generator will block
            // bank files for employees with no IFSC, which is the right
            // place to gate disbursal.
            const ifscRaw = (fd.get("ifscCode") as string) || "";
            const ifscCode = ifscRaw.toUpperCase().trim();
            const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
            if (ifscCode && !IFSC_REGEX.test(ifscCode)) {
              toast.error(
                "IFSC must be 11 characters: 4 letters + '0' + 6 letters/digits (e.g. HDFC0001234).",
              );
              return;
            }
            setBankSaving(true);
            try {
              await apiPut(`/employees/${id}/bank-details`, {
                bankName,
                accountNumber: fd.get("accountNumber") as string,
                ifscCode,
                accountType: fd.get("accountType") as string,
              });
              toast.success("Bank details updated");
              setBankOpen(false);
              qc.invalidateQueries({ queryKey: ["employee", id] });
            } catch (err: any) {
              toast.error(err.response?.data?.error?.message || "Update failed");
            } finally {
              setBankSaving(false);
            }
          }}
        >
          <Input
            id="bankName"
            name="bankName"
            label="Bank Name"
            defaultValue={bankDetails.bankName || ""}
            placeholder="e.g. HDFC Bank"
            pattern="^[A-Za-z\u00C0-\u024F\s.,&\-]+$"
            title="Letters, spaces, and . , & - only (no numbers)"
            required
          />
          <Input
            id="accountNumber"
            name="accountNumber"
            label="Account Number"
            defaultValue={bankDetails.accountNumber || ""}
            placeholder="e.g. 1234567890"
            required
          />
          <Input
            id="ifscCode"
            name="ifscCode"
            label="IFSC Code"
            defaultValue={bankDetails.ifscCode || ""}
            placeholder="e.g. HDFC0001234"
            // #374 — Three things were quietly breaking IFSC entry that #354
            // shipped:
            //   1. HTML5 `pattern` is implicitly anchored with ^(?:...)$, so
            //      the explicit ^…$ in the regex turned into ^(?:^…$)$ at the
            //      browser level. The trailing $$ never matches, so EVERY
            //      value (including a perfectly valid HDFC0001234) failed
            //      the constraint and the Save button reported a format
            //      error.
            //   2. The lowercase->uppercase coercion ran in onChange AFTER
            //      the browser had already evaluated the pattern against the
            //      lowercase keystroke, so typing "abcd0..." flagged a
            //      pattern mismatch even though the field would have been
            //      valid the moment the user blurred.
            //   3. minLength=11 + required made the field reject "" outright,
            //      but onboarding flows want to save bank rows incrementally
            //      (account number now, IFSC later). Make IFSC optional and
            //      only validate the format when something is actually typed.
            pattern="[A-Za-z]{4}0[A-Za-z0-9]{6}"
            maxLength={11}
            title="IFSC must be 11 characters: 4 letters + '0' + 6 letters/digits (e.g. HDFC0001234)"
            // Use `input` via onInput to coerce uppercase BEFORE the browser
            // re-evaluates validity for the next keystroke. Preserve the
            // caret so the user doesn't get bounced to the end of the field
            // on every keypress.
            onInput={(e) => {
              const el = e.currentTarget;
              const start = el.selectionStart;
              const end = el.selectionEnd;
              const upper = el.value.toUpperCase();
              if (el.value !== upper) {
                el.value = upper;
                if (start !== null && end !== null) {
                  el.setSelectionRange(start, end);
                }
              }
            }}
          />
          <SelectField
            id="accountType"
            name="accountType"
            label="Account Type"
            defaultValue={bankDetails.accountType || "savings"}
            options={[
              { value: "savings", label: "Savings" },
              { value: "current", label: "Current" },
              { value: "salary", label: "Salary Account" },
            ]}
          />
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setBankOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={bankSaving}>
              Save Bank Details
            </Button>
          </div>
        </form>
      </Modal>

      {/* Statutory Config Modal */}
      <Modal
        open={statutoryOpen}
        onClose={() => setStatutoryOpen(false)}
        title="Edit Statutory Details"
        className="max-w-lg"
      >
        <form
          className="space-y-5"
          onSubmit={async (e) => {
            e.preventDefault();
            setStatutorySaving(true);
            const fd = new FormData(e.currentTarget);
            try {
              await Promise.all([
                apiPut(`/employees/${id}/tax-info`, {
                  pan: (fd.get("pan") as string) || taxInfo.pan,
                  uan: (fd.get("uan") as string) || taxInfo.uan,
                  regime: fd.get("regime") as string,
                  // Per-employee deduction toggles (default true). The
                  // payroll compute reads these and skips the deduction
                  // when false. State override applies only to PT slab
                  // lookup -- empty means "use the org's primary state".
                  deductTDS: fd.get("deductTDS") === "true",
                  deductPT: fd.get("deductPT") === "true",
                  state: ((fd.get("ptState") as string) || "").trim() || null,
                }),
                apiPut(`/employees/${id}/pf-details`, {
                  pfNumber: fd.get("pfNumber") as string,
                  contributionRate: Number(fd.get("pfRate")) || 12,
                  isOptedOut: fd.get("pfOptOut") === "true",
                }),
                apiPut(`/employees/${id}/esi-details`, {
                  isEligible: fd.get("esiEligible") === "true",
                  esiNumber: fd.get("esiNumber") as string,
                  dispensary: fd.get("esiDispensary") as string,
                }),
              ]);
              toast.success("Statutory details updated");
              setStatutoryOpen(false);
              qc.invalidateQueries({ queryKey: ["employee", id] });
            } catch (err: any) {
              toast.error(err.response?.data?.error?.message || "Update failed");
            } finally {
              setStatutorySaving(false);
            }
          }}
        >
          <div>
            <h4 className="mb-2 text-sm font-semibold text-gray-700">Tax</h4>
            <div className="grid grid-cols-2 gap-3">
              <Input
                id="pan"
                name="pan"
                label="PAN"
                defaultValue={taxInfo.pan || ""}
                placeholder="ABCDE1234F"
                maxLength={10}
                pattern="[A-Z]{5}[0-9]{4}[A-Z]{1}"
                title="PAN must be 10 characters: 5 letters, 4 digits, 1 letter (e.g., ABCDE1234F)"
                onChange={(e) => {
                  e.currentTarget.value = e.currentTarget.value.toUpperCase();
                }}
              />
              <SelectField
                id="regime"
                name="regime"
                label="Tax Regime"
                defaultValue={taxInfo.regime || "new"}
                options={[
                  { value: "new", label: "New Regime (Default)" },
                  { value: "old", label: "Old Regime" },
                ]}
              />
              <SelectField
                id="deductTDS"
                name="deductTDS"
                label="Deduct TDS?"
                defaultValue={taxInfo.deductTDS === false ? "false" : "true"}
                options={[
                  { value: "true", label: "Yes — withhold monthly TDS" },
                  { value: "false", label: "No — skip TDS for this employee" },
                ]}
              />
              <SelectField
                id="deductPT"
                name="deductPT"
                label="Deduct Professional Tax?"
                defaultValue={taxInfo.deductPT === false ? "false" : "true"}
                options={[
                  { value: "true", label: "Yes — apply state slab" },
                  { value: "false", label: "No — no PT (e.g. Delhi/Haryana)" },
                ]}
              />
              <SelectField
                id="ptState"
                name="ptState"
                label="State for PT (override)"
                defaultValue={taxInfo.state || ""}
                options={[
                  { value: "", label: "Use org default" },
                  { value: "AP", label: "Andhra Pradesh" },
                  { value: "AS", label: "Assam" },
                  { value: "BR", label: "Bihar" },
                  { value: "CG", label: "Chhattisgarh" },
                  { value: "DL", label: "Delhi (No PT)" },
                  { value: "GA", label: "Goa" },
                  { value: "GJ", label: "Gujarat" },
                  { value: "HR", label: "Haryana (No PT)" },
                  { value: "HP", label: "Himachal Pradesh (No PT)" },
                  { value: "JH", label: "Jharkhand" },
                  { value: "JK", label: "Jammu & Kashmir (No PT)" },
                  { value: "KA", label: "Karnataka" },
                  { value: "KL", label: "Kerala" },
                  { value: "MP", label: "Madhya Pradesh" },
                  { value: "MH", label: "Maharashtra" },
                  { value: "MN", label: "Manipur" },
                  { value: "ML", label: "Meghalaya" },
                  { value: "OD", label: "Odisha" },
                  { value: "PB", label: "Punjab" },
                  { value: "RJ", label: "Rajasthan" },
                  { value: "SK", label: "Sikkim" },
                  { value: "TN", label: "Tamil Nadu" },
                  { value: "TS", label: "Telangana" },
                  { value: "TR", label: "Tripura" },
                  { value: "UP", label: "Uttar Pradesh (No PT)" },
                  { value: "UK", label: "Uttarakhand (No PT)" },
                  { value: "WB", label: "West Bengal" },
                ]}
              />
            </div>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold text-gray-700">Provident Fund</h4>
            <div className="grid grid-cols-2 gap-3">
              <Input id="uan" name="uan" label="UAN" defaultValue={taxInfo.uan || ""} />
              <Input
                id="pfNumber"
                name="pfNumber"
                label="PF Number"
                defaultValue={pfDetails.pfNumber || ""}
              />
              <Input
                id="pfRate"
                name="pfRate"
                label="PF Rate (%)"
                type="number"
                defaultValue={String(pfDetails.contributionRate || 12)}
              />
              <SelectField
                id="pfOptOut"
                name="pfOptOut"
                label="PF Opted Out?"
                defaultValue={pfDetails.isOptedOut ? "true" : "false"}
                options={[
                  { value: "false", label: "No — deduct PF" },
                  { value: "true", label: "Yes — opt out" },
                ]}
              />
            </div>
          </div>
          <div>
            <h4 className="mb-2 text-sm font-semibold text-gray-700">ESI</h4>
            <div className="grid grid-cols-2 gap-3">
              <SelectField
                id="esiEligible"
                name="esiEligible"
                label="ESI Eligible?"
                defaultValue={esiDetails.isEligible === false ? "false" : "true"}
                options={[
                  { value: "true", label: "Yes" },
                  { value: "false", label: "No" },
                ]}
              />
              <Input
                id="esiNumber"
                name="esiNumber"
                label="ESI Number"
                defaultValue={esiDetails.esiNumber || ""}
              />
              <Input
                id="esiDispensary"
                name="esiDispensary"
                label="Dispensary"
                defaultValue={esiDetails.dispensary || ""}
              />
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setStatutoryOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={statutorySaving}>
              Save Statutory Details
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function EmployeeDocuments({ employeeId }: { employeeId: string }) {
  const [uploading, setUploading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const qc = useQueryClient();

  const { data: docsRes, isLoading } = useQuery({
    queryKey: ["employee-documents", employeeId],
    queryFn: () => apiGet<any>(`/uploads/employees/${employeeId}/documents`),
    enabled: !!employeeId,
  });
  const docs = docsRes?.data?.data || [];

  const DOC_TYPES = [
    { value: "aadhaar", label: "Aadhaar Card" },
    { value: "pan", label: "PAN Card" },
    { value: "offer_letter", label: "Offer Letter" },
    { value: "id_proof", label: "ID Proof" },
    { value: "address_proof", label: "Address Proof" },
    { value: "education", label: "Education Certificate" },
    { value: "experience", label: "Experience Letter" },
    { value: "other", label: "Other" },
  ];

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const file = fd.get("file") as File;
    if (!file || !file.size) {
      toast.error("Select a file");
      return;
    }

    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("name", (fd.get("docName") as string) || file.name);
      formData.append("type", fd.get("docType") as string);
      await api.post(`/uploads/employees/${employeeId}/documents`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Document uploaded");
      setShowUpload(false);
      qc.invalidateQueries({ queryKey: ["employee-documents", employeeId] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleVerify(docId: string) {
    try {
      await apiPost(`/uploads/employees/${employeeId}/documents/${docId}/verify`);
      toast.success("Document verified");
      qc.invalidateQueries({ queryKey: ["employee-documents", employeeId] });
    } catch {
      toast.error("Failed to verify");
    }
  }

  async function handleDelete(docId: string) {
    try {
      await apiDelete(`/uploads/employees/${employeeId}/documents/${docId}`);
      toast.success("Document deleted");
      qc.invalidateQueries({ queryKey: ["employee-documents", employeeId] });
    } catch {
      toast.error("Failed to delete");
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" /> Documents
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => setShowUpload(true)}>
            <Upload className="h-4 w-4" /> Upload
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : docs.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">No documents uploaded</p>
        ) : (
          <div className="space-y-2">
            {docs.map((doc: any) => (
              <div
                key={doc.id}
                className="group flex items-center justify-between rounded-lg border border-gray-100 p-3"
              >
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-gray-400" />
                  <div>
                    <a
                      // #355 — Build the document URL robustly. The previous
                      // version stripped only "/api/v1" from VITE_API_URL,
                      // which produced "/uploads/<file>" when the env var
                      // was unset (dev) and the host:port-prefixed URL when
                      // it pointed at an absolute API host (prod). Both
                      // worked when the SPA and API shared a host, but
                      // when the API is on a different subdomain (or the
                      // SPA is being viewed from a CDN that lacks a static
                      // /uploads route), opening the link landed on the
                      // SPA's catch-all 404. Rebuild the absolute URL when
                      // VITE_API_URL is absolute, otherwise use the
                      // current origin — matches what `apiGet` does for
                      // every other request.
                      href={(() => {
                        const apiBase = (import.meta.env.VITE_API_URL || "/api/v1").replace(
                          /\/api\/v1\/?$/,
                          "",
                        );
                        const fileUrl = String(doc.file_url || "");
                        if (/^https?:\/\//i.test(fileUrl)) return fileUrl;
                        if (/^https?:\/\//i.test(apiBase)) return `${apiBase}${fileUrl}`;
                        // Relative API base — fall back to current origin so
                        // the new tab navigates somewhere that can serve the
                        // file (or at least returns a real 404, not the
                        // SPA's catch-all "page not found").
                        return `${window.location.origin}${fileUrl}`;
                      })()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-brand-600 text-sm font-medium hover:underline"
                    >
                      {doc.name}
                    </a>
                    <p className="text-xs text-gray-400">
                      {doc.type.replace("_", " ")} &middot; {formatDate(doc.created_at)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {doc.is_verified ? (
                    <Badge variant="approved">
                      <CheckCircle className="mr-1 h-3 w-3" /> Verified
                    </Badge>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleVerify(doc.id)}
                      className="text-green-600"
                    >
                      <CheckCircle className="h-4 w-4" />
                    </Button>
                  )}
                  <button
                    onClick={() => handleDelete(doc.id)}
                    className="text-gray-400 opacity-0 hover:text-red-500 group-hover:opacity-100"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <Modal
          open={showUpload}
          onClose={() => setShowUpload(false)}
          title="Upload Document"
          className="max-w-md"
        >
          <form onSubmit={handleUpload} className="space-y-4">
            <SelectField id="docType" name="docType" label="Document Type" options={DOC_TYPES} />
            <Input
              id="docName"
              name="docName"
              label="Document Name"
              placeholder="e.g. Aadhaar front"
            />
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">File</label>
              <input
                type="file"
                name="file"
                accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                required
                className="file:bg-brand-50 file:text-brand-700 w-full rounded-lg border border-gray-200 p-2 text-sm file:mr-3 file:rounded file:border-0 file:px-3 file:py-1 file:text-sm file:font-medium"
              />
              <p className="mt-1 text-xs text-gray-400">PDF, JPG, PNG, DOC up to 10MB</p>
            </div>
            <div className="flex justify-end gap-3">
              <Button variant="outline" type="button" onClick={() => setShowUpload(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={uploading}>
                Upload
              </Button>
            </div>
          </form>
        </Modal>
      </CardContent>
    </Card>
  );
}

function EmployeeTimeline({
  emp,
  payslips,
  salary,
  history,
}: {
  emp: any;
  payslips: any[];
  salary: any;
  history: any[];
}) {
  const events: {
    date: string;
    label: string;
    type: "join" | "salary" | "payslip" | "revision";
  }[] = [];

  // Joining event
  events.push({
    date: emp.date_of_joining,
    label: `Joined as ${emp.designation} in ${emp.department}`,
    type: "join",
  });

  // Salary revisions
  for (const h of history) {
    events.push({
      date: h.effective_from,
      label: `Salary revised to ${formatCurrency(h.ctc)}/yr (${h.structure_name})`,
      type: "revision",
    });
  }

  // Recent payslips
  for (const p of payslips.slice(0, 3)) {
    const d = new Date(p.year, p.month - 1, 28).toISOString();
    events.push({
      date: d,
      label: `Payslip: ${formatCurrency(p.net_pay)} net (${new Date(p.year, p.month - 1).toLocaleString("en-IN", { month: "short", year: "numeric" })})`,
      type: "payslip",
    });
  }

  events.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  if (events.length <= 1) return null;

  const typeColors = {
    join: "bg-green-500",
    salary: "bg-brand-500",
    payslip: "bg-blue-500",
    revision: "bg-amber-500",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5" /> Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative ml-3 border-l-2 border-gray-200 pl-6">
          {events.slice(0, 10).map((event, i) => (
            <div key={i} className="relative mb-5 last:mb-0">
              <div
                className={`absolute -left-[31px] top-1 h-3 w-3 rounded-full ${typeColors[event.type]}`}
              />
              <p className="text-sm text-gray-900">{event.label}</p>
              <p className="text-xs text-gray-400">{formatDate(event.date)}</p>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function EmployeeNotes({ employeeId }: { employeeId: string }) {
  const [content, setContent] = useState("");
  const [category, setCategory] = useState("general");
  const [submitting, setSubmitting] = useState(false);
  const qc = useQueryClient();
  const { data: notesRes, isLoading } = useQuery({
    queryKey: ["employee-notes", employeeId],
    queryFn: () => apiGet<any>(`/employees/${employeeId}/notes`),
    enabled: !!employeeId,
  });
  const notes = notesRes?.data || [];

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSubmitting(true);
    try {
      await apiPost(`/employees/${employeeId}/notes`, { content, category });
      setContent("");
      toast.success("Note added");
      qc.invalidateQueries({ queryKey: ["employee-notes", employeeId] });
    } catch {
      toast.error("Failed to add note");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(noteId: string) {
    try {
      await apiDelete(`/employees/${employeeId}/notes/${noteId}`);
      qc.invalidateQueries({ queryKey: ["employee-notes", employeeId] });
      toast.success("Note deleted");
    } catch {
      toast.error("Failed to delete");
    }
  }

  const categoryColors: Record<string, string> = {
    general: "bg-gray-100 text-gray-700",
    performance: "bg-blue-100 text-blue-700",
    hr: "bg-purple-100 text-purple-700",
    finance: "bg-green-100 text-green-700",
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <StickyNote className="h-5 w-5" /> Notes
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleAdd} className="mb-4 flex gap-2">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
          >
            <option value="general">General</option>
            <option value="performance">Performance</option>
            <option value="hr">HR</option>
            <option value="finance">Finance</option>
          </select>
          <input
            type="text"
            placeholder="Add a note..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="focus:border-brand-500 focus:ring-brand-500 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1"
          />
          <Button type="submit" size="sm" loading={submitting} disabled={!content.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>

        {isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
          </div>
        ) : notes.length === 0 ? (
          <p className="py-4 text-center text-sm text-gray-400">No notes yet</p>
        ) : (
          <div className="space-y-3">
            {notes.map((note: any) => (
              <div
                key={note.id}
                className="group flex items-start gap-3 rounded-lg border border-gray-100 p-3"
              >
                <div className="flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">
                      {note.author_first_name} {note.author_last_name}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${categoryColors[note.category] || categoryColors.general}`}
                    >
                      {note.category}
                    </span>
                    <span className="text-xs text-gray-400">{formatDate(note.created_at)}</span>
                  </div>
                  <p className="text-sm text-gray-700">{note.content}</p>
                </div>
                <button
                  onClick={() => handleDelete(note.id)}
                  className="text-gray-400 opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SalaryAssignForm({
  employeeId,
  structures,
  currentCTC,
  pfDetails,
  taxInfo,
  loading,
  onSubmit,
  onCancel,
}: {
  employeeId: string;
  structures: any[];
  currentCTC?: number;
  pfDetails?: { isOptedOut?: boolean; contributionRate?: number | string };
  // Only `deductPT` is consumed here — the preview honours the per-employee
  // "Deduct Professional Tax?" toggle so it doesn't show a ₹200 PT line for
  // employees that have PT switched off.
  taxInfo?: { deductPT?: boolean };
  loading: boolean;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const [structureId, setStructureId] = useState(structures[0]?.id || "");
  const [ctc, setCTC] = useState(currentCTC || 0);

  // Pull the org's PF/ESI overrides so the EPF preview matches what the
  // payroll engine actually computes. The previous version hardcoded the
  // ₹15,000 wage ceiling in the preview, so any HR who flipped
  // "PF Wage Calculation = Apply to actual" or set a custom max-cap saw a
  // PREVIEW that disagreed with the resulting payslip.
  const user = getUser();
  const { data: orgSettingsRes } = useOrgSettings(user?.orgId ? String(user.orgId) : "");
  const orgSettings = orgSettingsRes?.data;

  // Pull the selected structure's components so the preview reflects what the
  // server will actually compute (including Balance, percentage chains, etc.).
  const { data: compsRes } = useQuery({
    queryKey: ["salary-structure-components", structureId],
    queryFn: () => apiGet<any>(`/salary-structures/${structureId}/components`),
    enabled: !!structureId,
  });
  const definitions: ResolverComponent[] = (compsRes?.data?.data || []).map((c: any) => ({
    code: c.code,
    name: c.name,
    type: c.type,
    calculationType: c.calculation_type,
    value: Number(c.value) || 0,
    percentageOf: c.percentage_of || undefined,
  }));

  // The resolver returns each component with its `type` ("earning" /
  // "deduction" / "reimbursement"). Older code lumped all rows together
  // under "Monthly Breakdown" AND summed everything into Monthly Gross,
  // so a structure with WELFARE / CANTEEN deductions showed those as
  // earnings and inflated gross by their value. Track the type and
  // bucket properly below.
  let resolved: {
    code: string;
    name: string;
    type: "earning" | "deduction" | "reimbursement";
    monthlyAmount: number;
  }[] = [];
  let resolveError: string | null = null;
  // #359 — Hide intermediate "components exceed CTC" / "balance underflow"
  // errors while the user is still typing a small number into the CTC
  // field (e.g. typed "1", "12", "120", before reaching "120000"). Only
  // surface a resolver error once the CTC is at least ₹12,000/year
  // (₹1,000/month) -- below that the structure can't possibly fit
  // realistic component values and the error is just typing noise.
  if (ctc >= 12000 && definitions.length) {
    try {
      resolved = resolveSalaryComponents(definitions, ctc);
    } catch (err) {
      resolveError =
        err instanceof SalaryResolverError ? err.message : "Could not compute breakdown.";
    }
  } else if (ctc > 0 && definitions.length) {
    // Try resolving silently — show the breakdown if it works, but don't
    // surface a typing-time error.
    try {
      resolved = resolveSalaryComponents(definitions, ctc);
    } catch {
      /* swallow */
    }
  }
  const earningRows = resolved.filter((c) => c.type === "earning");
  const reimbursementRows = resolved.filter((c) => c.type === "reimbursement");
  // #365 — Apply org's EPF max-cap to structure-defined EPF deductions in
  // the preview so HR sees the same number that payroll will actually
  // deduct. Without this, a structure with "EPF = 12% of BASIC" showed
  // the raw uncapped value (e.g. ₹2,700) in the deductions list while
  // the actual payslip honoured the ₹1,800 org cap.
  const _normCodeEpf = (code: string | undefined) =>
    (code || "").toUpperCase().replace(/[^A-Z]/g, "");
  const _isEpfishCode = (code: string | undefined) => {
    const c = _normCodeEpf(code);
    if (!c) return false;
    if (c.includes("EPF")) return true;
    return c === "PF" || c.startsWith("PFE") || c.startsWith("PFC");
  };
  const deductionRows = resolved
    .filter((c) => c.type === "deduction")
    .map((c) => {
      if (!_isEpfishCode(c.code)) return c;
      const cap =
        orgSettings?.pfMaxEmployeeContribution != null
          ? Number(orgSettings.pfMaxEmployeeContribution)
          : null;
      if (cap != null && Number.isFinite(cap) && cap >= 0 && c.monthlyAmount > cap) {
        return { ...c, monthlyAmount: Math.round(cap) };
      }
      return c;
    });
  const monthlyBasic = earningRows.find((c) => c.code === "BASIC")?.monthlyAmount || 0;
  // Monthly Gross is EARNINGS only -- deductions reduce net, reimbursements
  // are paid on top but not part of taxable gross.
  const monthlyGross = earningRows.reduce((s, c) => s + c.monthlyAmount, 0);
  const monthlyStructureDeductions = deductionRows.reduce((s, c) => s + c.monthlyAmount, 0);
  const monthlyReimbursements = reimbursementRows.reduce((s, c) => s + c.monthlyAmount, 0);
  // EPF preview math -- mirrors the server's india-statutory.service so
  // the preview never lies about what payroll will actually deduct.
  // Resolution order (the preview honours all of them):
  //   1. employee opted out  -> EPF = 0
  //   2. employee contributionRate -> overrides default (default 12%)
  //   3. org pfDefaultEmployeeRate -> overrides 12% across the org
  //   4. org pfApplyFullBasic == true  -> use the FULL basic, no ceiling
  //      org pfApplyFullBasic == false / unset -> apply the ₹15,000 ceiling
  //   5. org pfMaxEmployeeContribution -> hard rupee cap on the result
  //      (e.g. ₹1,800 = the conservative "12% of ₹15K" cap most orgs use)
  const pfOptedOut = pfDetails?.isOptedOut === true;
  const orgDefaultRate = orgSettings?.pfDefaultEmployeeRate;
  const employeeRate = pfDetails?.contributionRate;
  const pfRate = Number(employeeRate ?? orgDefaultRate ?? 12) || 12;
  const applyFullBasic = orgSettings?.pfApplyFullBasic === true;
  const maxCap =
    orgSettings?.pfMaxEmployeeContribution != null
      ? Number(orgSettings.pfMaxEmployeeContribution)
      : null;

  let monthlyEPF = 0;
  if (!pfOptedOut) {
    const pfBase = applyFullBasic ? monthlyBasic : Math.min(monthlyBasic, 15000);
    monthlyEPF = Math.round((pfBase * pfRate) / 100);
    if (maxCap != null && Number.isFinite(maxCap)) {
      monthlyEPF = Math.min(monthlyEPF, maxCap);
    }
  }
  // Professional Tax — flat ₹200/month estimate. PT is state-specific
  // (₹200 is the common top slab; some states levy less, Delhi/Haryana
  // none) and the engine computes the real figure at payroll-run time.
  // The preview used to subtract this ₹200 *silently* inside "Approx Net
  // Pay", so the breakdown never reconciled — Gross − EPF was always ₹200
  // above the shown Net. Now it's its own line AND it honours the
  // employee's "Deduct PT" toggle: when PT is off, no ₹200 is applied.
  const ptDeducted = taxInfo?.deductPT !== false;
  const monthlyPT = ptDeducted ? 200 : 0;
  // Employer-side preview — Indian PF: employer also pays 12% of PF wages,
  // split as 8.33% to EPS (capped at ₹15K basic = ₹1,250) and the REMAINDER
  // to EPF. The EPF share is `12% total − EPS`, not a direct 3.67% — the
  // direct rate mis-rounds (3.67% of ₹15,000 = ₹550.5 → ₹551; correct is
  // ₹1,800 − ₹1,250 = ₹550). Plus EDLI 0.5% (cap ₹75) and Admin 0.5% (cap
  // ₹75). Both ESI: 3.25% of gross capped at ESI ceiling (₹21,000).
  // Surfaces these on the preview so HR and the employee see the full Cost
  // to Company, not just take-home. Mirrors what india-statutory.service
  // computes at payroll-run time -- numbers in the preview match the payslip.
  const monthlyEmployerEPS = pfOptedOut
    ? 0
    : Math.round((Math.min(monthlyBasic, 15000) * 8.33) / 100);
  const monthlyEmployerEPF = pfOptedOut
    ? 0
    : Math.max(
        0,
        Math.round(((applyFullBasic ? monthlyBasic : Math.min(monthlyBasic, 15000)) * 12) / 100) -
          monthlyEmployerEPS,
      );
  // EDLI / PF Admin are also gated by the org's per-charge toggles
  // (migration 034). `!== false` so a not-yet-loaded orgSettings keeps
  // them on -- matching the engine default and the old behaviour.
  const edliEnabled = orgSettings?.pfEdliEnabled !== false;
  const pfAdminEnabled = orgSettings?.pfAdminEnabled !== false;
  const monthlyEDLI =
    pfOptedOut || !edliEnabled
      ? 0
      : Math.min(75, Math.round((Math.min(monthlyBasic, 15000) * 0.5) / 100));
  const monthlyPFAdmin =
    pfOptedOut || !pfAdminEnabled
      ? 0
      : Math.min(75, Math.round((Math.min(monthlyBasic, 15000) * 0.5) / 100));
  const totalEmployerContribution =
    monthlyEmployerEPS + monthlyEmployerEPF + monthlyEDLI + monthlyPFAdmin;
  const employerPfInCtc = !!orgSettings?.employerPfInCtc;

  // Effective From defaults to today but MAY be backdated — HR often
  // records a revision after the fact (e.g. an increment effective from the
  // 1st of a month that's already started, or a back-dated appraisal). The
  // earlier hard "no past dates" guard (#360) blocked that legitimate case,
  // so it's been removed. Server-side `assignToEmployee` deactivates the
  // prior active row and inserts the new one at this effective_from (past
  // or not); the FY-projection helper orders segments by effective_from,
  // so a back-dated revision slots into the timeline correctly.
  const todayStr = new Date().toISOString().slice(0, 10);
  const [effectiveFrom, setEffectiveFrom] = useState<string>(todayStr);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Don't pre-compute components — let the server resolve from the structure
    // so the math stays in one place (and `balance` is honored authoritatively).
    onSubmit({
      employeeId,
      structureId,
      ctc,
      effectiveFrom,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <SelectField
        id="structure"
        label="Salary Structure"
        value={structureId}
        onChange={(e) => setStructureId(e.target.value)}
        options={structures.map((s: any) => ({ value: s.id, label: s.name }))}
      />

      <Input
        id="ctc"
        label="Annual CTC (₹)"
        type="number"
        // #359 — Keep the input fully controlled with a string value so
        // React doesn't flip from "uncontrolled" (value="") to
        // "controlled" (value=number) when the user types into an
        // empty field. The previous `value={ctc || ""}` mixed a string
        // and a number which surfaced a React warning + on some
        // browsers the field briefly cleared mid-keystroke.
        // Coerce defensively so partial/invalid input ("12.", "1e",
        // etc.) doesn't throw downstream when the resolver runs.
        value={ctc > 0 ? String(ctc) : ""}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            setCTC(0);
            return;
          }
          const n = Number(raw);
          setCTC(Number.isFinite(n) && n >= 0 ? n : 0);
        }}
        min={0}
        // step={1} (not 1000) — a 1000-step makes the browser's native
        // number validation reject any CTC that isn't a round thousand
        // (e.g. "823392" → "the two nearest valid values are 823000 and
        // 824000"). HR enters exact negotiated CTCs, so allow any whole
        // rupee value.
        step={1}
        placeholder="e.g. 1200000"
        required
      />

      {ctc > 0 && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <h4 className="mb-3 text-sm font-semibold text-gray-700">
            Monthly Breakdown (from structure)
          </h4>
          {resolveError ? (
            <p className="text-sm text-red-600">{resolveError}</p>
          ) : resolved.length === 0 ? (
            <p className="text-sm text-gray-400">Select a structure to see the breakdown.</p>
          ) : (
            <div className="space-y-2">
              {/* Earnings */}
              {earningRows.map((c) => (
                <div key={c.code} className="flex justify-between text-sm">
                  <span className="text-gray-500">{c.name}</span>
                  <span className="font-medium text-gray-900">
                    {formatCurrency(c.monthlyAmount)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between border-t border-gray-200 pt-2 text-sm font-semibold">
                <span>Monthly Gross</span>
                <span>{formatCurrency(monthlyGross)}</span>
              </div>

              {/* Reimbursements -- on top of gross, not taxable wages */}
              {reimbursementRows.length > 0 && (
                <>
                  <div className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Reimbursements
                  </div>
                  {reimbursementRows.map((c) => (
                    <div key={c.code} className="flex justify-between text-sm">
                      <span className="text-gray-500">{c.name}</span>
                      <span className="font-medium text-emerald-700">
                        +{formatCurrency(c.monthlyAmount)}
                      </span>
                    </div>
                  ))}
                </>
              )}

              {/* Structure-defined deductions (Welfare Fund, Canteen, etc.).
                  Statutory deductions (EPF, ESI, PT, TDS) are computed at
                  payroll-run time and shown separately below. */}
              {deductionRows.length > 0 && (
                <>
                  <div className="pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                    Deductions (from structure)
                  </div>
                  {deductionRows.map((c) => (
                    <div key={c.code} className="flex justify-between text-sm">
                      <span className="text-gray-500">{c.name}</span>
                      <span className="font-medium text-red-600">
                        -{formatCurrency(c.monthlyAmount)}
                      </span>
                    </div>
                  ))}
                </>
              )}

              <div className="flex justify-between text-sm text-red-600">
                <span>
                  EPF Deduction
                  {pfOptedOut
                    ? " (opted out)"
                    : (() => {
                        // Spell out which org override is in effect so HR
                        // can verify the preview matches the rule they set
                        // on Settings > Statutory Overrides. Order: cap >
                        // wage-mode > rate.
                        const bits: string[] = [];
                        if (pfRate !== 12) bits.push(`${pfRate}%`);
                        bits.push(applyFullBasic ? "on actual Basic" : "₹15K ceiling");
                        if (
                          maxCap != null &&
                          Math.round(
                            ((applyFullBasic ? monthlyBasic : Math.min(monthlyBasic, 15000)) *
                              pfRate) /
                              100,
                          ) > maxCap
                        ) {
                          bits.push(`capped at ₹${maxCap}/mo`);
                        }
                        return bits.length > 0 ? ` (${bits.join(", ")})` : "";
                      })()}
                </span>
                <span>{monthlyEPF > 0 ? `-${formatCurrency(monthlyEPF)}` : formatCurrency(0)}</span>
              </div>
              <div className="flex justify-between text-sm text-red-600">
                <span>Professional Tax (est.){ptDeducted ? "" : " (not deducted)"}</span>
                <span>{monthlyPT > 0 ? `-${formatCurrency(monthlyPT)}` : formatCurrency(0)}</span>
              </div>
              <div className="text-brand-700 flex justify-between border-t border-gray-200 pt-2 text-sm font-bold">
                <span>Approx Net Pay</span>
                <span>
                  {formatCurrency(
                    monthlyGross +
                      monthlyReimbursements -
                      monthlyStructureDeductions -
                      monthlyEPF -
                      monthlyPT,
                  )}
                </span>
              </div>

              {/* Employer Contributions — informational only, NOT deducted
                  from the employee's take-home. The label below the total
                  switches based on the org's "Employer PF in CTC" toggle so
                  HR knows whether the offer-letter CTC already covers it. */}
              {totalEmployerContribution > 0 && (
                <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 p-3">
                  <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-blue-700">
                    Employer Contributions (paid by company)
                  </div>
                  <div className="space-y-1">
                    {monthlyEmployerEPF > 0 && (
                      <div className="flex justify-between text-xs text-blue-900">
                        <span>Employer EPF (3.67%)</span>
                        <span>{formatCurrency(monthlyEmployerEPF)}</span>
                      </div>
                    )}
                    {monthlyEmployerEPS > 0 && (
                      <div className="flex justify-between text-xs text-blue-900">
                        <span>Employer EPS (8.33%, capped at ₹15K basic)</span>
                        <span>{formatCurrency(monthlyEmployerEPS)}</span>
                      </div>
                    )}
                    {monthlyEDLI > 0 && (
                      <div className="flex justify-between text-xs text-blue-900">
                        <span>EDLI (0.5%)</span>
                        <span>{formatCurrency(monthlyEDLI)}</span>
                      </div>
                    )}
                    {monthlyPFAdmin > 0 && (
                      <div className="flex justify-between text-xs text-blue-900">
                        <span>PF Admin (0.5%)</span>
                        <span>{formatCurrency(monthlyPFAdmin)}</span>
                      </div>
                    )}
                    <div className="flex justify-between border-t border-blue-200 pt-1 text-xs font-semibold text-blue-900">
                      <span>Total Employer Contribution / month</span>
                      <span>{formatCurrency(totalEmployerContribution)}</span>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-blue-700">
                    {employerPfInCtc
                      ? "Already included in the negotiated CTC. Total Cost to Company = Gross."
                      : `Paid by the company on top of CTC. Total Cost to Company = ${formatCurrency(monthlyGross + totalEmployerContribution)} / month.`}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <Input
        id="effective"
        label="Effective From"
        type="date"
        value={effectiveFrom}
        onChange={(e) => setEffectiveFrom(e.target.value)}
        required
      />

      <div className="flex justify-end gap-3">
        <Button variant="outline" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={loading} disabled={!ctc || !structureId || !!resolveError}>
          {currentCTC ? "Apply Revision" : "Assign Salary"}
        </Button>
      </div>
    </form>
  );
}
