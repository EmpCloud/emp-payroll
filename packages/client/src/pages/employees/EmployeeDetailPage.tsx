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
import { useEmployee, useEmployeeSalary, useUpdateEmployee, useSalaryStructures } from "@/api/hooks";
import { apiGet, apiPost } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Mail, Phone, Building2, Calendar, CreditCard, Shield, Loader2, Pencil, Wallet, History, Banknote } from "lucide-react";
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

  if (isLoading) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>;
  }

  const emp = empRes?.data;
  if (!emp) return <div className="p-8 text-gray-500">Employee not found</div>;

  const salary = salaryRes?.data;
  const payslips = payslipsRes?.data?.data || [];
  const bankDetails = typeof emp.bank_details === "string" ? JSON.parse(emp.bank_details) : emp.bank_details || {};
  const taxInfo = typeof emp.tax_info === "string" ? JSON.parse(emp.tax_info) : emp.tax_info || {};
  const pfDetails = typeof emp.pf_details === "string" ? JSON.parse(emp.pf_details) : emp.pf_details || {};
  const components = salary?.components ? (typeof salary.components === "string" ? JSON.parse(salary.components) : salary.components) : [];
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
              <p className="text-sm text-gray-500">{emp.designation} &middot; {emp.department}</p>
              <div className="mt-3 flex flex-wrap gap-4 text-sm text-gray-600">
                <span className="flex items-center gap-1"><Mail className="h-4 w-4" />{emp.email}</span>
                {emp.phone && <span className="flex items-center gap-1"><Phone className="h-4 w-4" />{emp.phone}</span>}
                <span className="flex items-center gap-1"><Calendar className="h-4 w-4" />Joined {formatDate(emp.date_of_joining)}</span>
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
              <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" /> Salary Details</CardTitle>
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
          <CardHeader><CardTitle className="flex items-center gap-2"><CreditCard className="h-5 w-5" /> Bank & Tax</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-3">
              {[
                ["Bank", bankDetails.bankName || "—"],
                ["Account", bankDetails.accountNumber || "—"],
                ["IFSC", bankDetails.ifscCode || "—"],
                ["PAN", taxInfo.pan || "—"],
                ["PF Number", pfDetails.pfNumber || "N/A"],
                ["Tax Regime", taxInfo.regime === "old" ? "Old Regime" : "New Regime"],
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
          <CardHeader><CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" /> Statutory</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-3">
              {[
                ["UAN", taxInfo.uan || "N/A"],
                ["PF Number", pfDetails.pfNumber || "N/A"],
                ["PF Rate", pfDetails.contributionRate ? `${pfDetails.contributionRate}%` : "12%"],
                ["Employment Type", (emp.employment_type || "full_time").replace("_", " ")],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between text-sm">
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="font-medium text-gray-900 capitalize">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Recent Payslips</CardTitle></CardHeader>
          <CardContent>
            {payslips.length === 0 ? (
              <p className="text-sm text-gray-400">No payslips found</p>
            ) : (
              <div className="space-y-3">
                {payslips.slice(0, 6).map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg border border-gray-100 p-3">
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {new Date(p.year, p.month - 1).toLocaleString("en-IN", { month: "long", year: "numeric" })}
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
          <CardHeader><CardTitle className="flex items-center gap-2"><History className="h-5 w-5" /> Salary History</CardTitle></CardHeader>
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
                    <td className="px-6 py-3">{new Date(h.effective_from).toLocaleDateString("en-IN")}</td>
                    <td className="px-6 py-3">{h.structure_name}</td>
                    <td className="px-6 py-3 text-right font-medium">{formatCurrency(h.ctc)}</td>
                    <td className="px-6 py-3 text-right">{formatCurrency(h.gross_salary)}</td>
                    <td className="px-6 py-3">
                      <Badge variant={h.is_active ? "active" : "inactive"}>{h.is_active ? "Current" : "Previous"}</Badge>
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
          <CardHeader><CardTitle className="flex items-center gap-2"><Banknote className="h-5 w-5" /> Loans & Advances</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {(loansRes?.data?.data || []).map((loan: any) => (
                <div key={loan.id} className="flex items-center justify-between rounded-lg border border-gray-100 p-3">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{loan.description}</p>
                    <p className="text-xs text-gray-500">
                      {loan.type.replace("_", " ")} &middot; EMI: {formatCurrency(loan.emi_amount)}/mo &middot; {loan.installments_paid}/{loan.tenure_months} paid
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-orange-600">{formatCurrency(loan.outstanding_amount)}</p>
                    <Badge variant={loan.status === "active" ? "active" : "approved"}>{loan.status}</Badge>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Edit Modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit Employee" className="max-w-lg">
        <form onSubmit={handleEdit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Input id="firstName" name="firstName" label="First Name" defaultValue={emp.first_name} required />
            <Input id="lastName" name="lastName" label="Last Name" defaultValue={emp.last_name} required />
          </div>
          <Input id="phone" name="phone" label="Phone" defaultValue={emp.phone || ""} />
          <div className="grid grid-cols-2 gap-4">
            <Input id="department" name="department" label="Department" defaultValue={emp.department} required />
            <Input id="designation" name="designation" label="Designation" defaultValue={emp.designation} required />
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button type="submit" loading={updateMutation.isPending}>Save Changes</Button>
          </div>
        </form>
      </Modal>

      {/* Salary Assignment Modal */}
      <Modal open={salaryOpen} onClose={() => setSalaryOpen(false)} title={salary ? "Salary Revision" : "Assign Salary"} className="max-w-lg">
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
    </div>
  );
}

function SalaryAssignForm({ employeeId, structures, currentCTC, loading, onSubmit, onCancel }: {
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
  const monthlyBasic = Math.round(ctc * 0.40 / 12);
  const monthlyHRA = Math.round(monthlyBasic * 0.50);
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
          <h4 className="mb-3 text-sm font-semibold text-gray-700">Monthly Breakdown (auto-calculated)</h4>
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
            <div className="flex justify-between border-t border-gray-200 pt-2 text-sm font-bold text-brand-700">
              <span>Approx Net Pay</span>
              <span>{formatCurrency(monthlyBasic + monthlyHRA + monthlySA - monthlyEPF - 200)}</span>
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
        <Button variant="outline" type="button" onClick={onCancel}>Cancel</Button>
        <Button type="submit" loading={loading} disabled={!ctc || !structureId}>
          {currentCTC ? "Apply Revision" : "Assign Salary"}
        </Button>
      </div>
    </form>
  );
}
