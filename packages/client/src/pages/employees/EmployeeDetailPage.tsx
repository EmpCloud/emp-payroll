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
} from "@/api/hooks";
import { apiGet, apiPost, apiDelete, apiPut } from "@/api/client";
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
  const { data: loansRes } = useQuery({
    queryKey: ["employee-loans", id],
    queryFn: () => apiGet<any>(`/loans/employee/${id}`),
    enabled: !!id,
  });
  const updateMutation = useUpdateEmployee(id!);
  const { data: structuresRes } = useSalaryStructures();
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
        title=""
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
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

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
            <Input
              id="department"
              name="department"
              label="Department"
              defaultValue={emp.department}
              required
            />
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
          structures={structuresRes?.data?.data || []}
          currentCTC={salary ? Number(salary.ctc) : undefined}
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
            setBankSaving(true);
            const fd = new FormData(e.currentTarget);
            try {
              await apiPut(`/employees/${id}/bank-details`, {
                bankName: fd.get("bankName") as string,
                accountNumber: fd.get("accountNumber") as string,
                ifscCode: fd.get("ifscCode") as string,
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
            required
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
                      href={`${import.meta.env.VITE_API_URL?.replace("/api/v1", "") || ""}${doc.file_url}`}
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
  loading,
  onSubmit,
  onCancel,
}: {
  employeeId: string;
  structures: any[];
  currentCTC?: number;
  loading: boolean;
  onSubmit: (data: any) => void;
  onCancel: () => void;
}) {
  const [structureId, setStructureId] = useState(structures[0]?.id || "");
  const [ctc, setCTC] = useState(currentCTC || 0);

  // Auto-calculate components from CTC
  const monthlyBasic = Math.round((ctc * 0.4) / 12);
  const monthlyHRA = Math.round(monthlyBasic * 0.5);
  const monthlyEPF = Math.round(Math.min(monthlyBasic, 15000) * 0.12);
  const monthlySA = Math.round(ctc / 12 - monthlyBasic - monthlyHRA - monthlyEPF);

  const comps = [
    { code: "BASIC", label: "Basic Salary", monthly: monthlyBasic },
    { code: "HRA", label: "HRA", monthly: monthlyHRA },
    { code: "SA", label: "Special Allowance", monthly: monthlySA },
  ];

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      employeeId,
      structureId,
      ctc,
      components: comps.map((c) => ({
        code: c.code,
        monthlyAmount: c.monthly,
        annualAmount: c.monthly * 12,
      })),
      effectiveFrom: new Date().toISOString().slice(0, 10),
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
        value={ctc || ""}
        onChange={(e) => setCTC(Number(e.target.value))}
        placeholder="e.g. 1200000"
        required
      />

      {ctc > 0 && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <h4 className="mb-3 text-sm font-semibold text-gray-700">
            Monthly Breakdown (auto-calculated)
          </h4>
          <div className="space-y-2">
            {comps.map((c) => (
              <div key={c.code} className="flex justify-between text-sm">
                <span className="text-gray-500">{c.label}</span>
                <span className="font-medium text-gray-900">{formatCurrency(c.monthly)}</span>
              </div>
            ))}
            <div className="flex justify-between border-t border-gray-200 pt-2 text-sm font-semibold">
              <span>Monthly Gross</span>
              <span>{formatCurrency(monthlyBasic + monthlyHRA + monthlySA)}</span>
            </div>
            <div className="flex justify-between text-sm text-red-600">
              <span>EPF Deduction</span>
              <span>-{formatCurrency(monthlyEPF)}</span>
            </div>
            <div className="text-brand-700 flex justify-between border-t border-gray-200 pt-2 text-sm font-bold">
              <span>Approx Net Pay</span>
              <span>
                {formatCurrency(monthlyBasic + monthlyHRA + monthlySA - monthlyEPF - 200)}
              </span>
            </div>
          </div>
        </div>
      )}

      <Input
        id="effective"
        label="Effective From"
        type="date"
        defaultValue={new Date().toISOString().slice(0, 10)}
        required
      />

      <div className="flex justify-end gap-3">
        <Button variant="outline" type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={loading} disabled={!ctc || !structureId}>
          {currentCTC ? "Apply Revision" : "Assign Salary"}
        </Button>
      </div>
    </form>
  );
}
