import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { Modal } from "@/components/ui/Modal";
import { formatCurrency } from "@/lib/utils";
import { apiGet, apiPost } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Upload, FileCheck, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

const SECTIONS = [
  { value: "80C", label: "80C — PPF, ELSS, LIC, etc." },
  { value: "80CCD_1B", label: "80CCD(1B) — NPS" },
  { value: "80D", label: "80D — Medical Insurance" },
  { value: "80E", label: "80E — Education Loan Interest" },
  { value: "80G", label: "80G — Donations" },
  { value: "80TTA", label: "80TTA — Savings Interest" },
  { value: "HRA", label: "HRA — House Rent" },
];

export function MyDeclarationsPage() {
  const [showAdd, setShowAdd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const qc = useQueryClient();

  const { data: res, isLoading } = useQuery({
    queryKey: ["my-declarations"],
    queryFn: () => apiGet<any>("/self-service/tax/declarations"),
  });

  const declarations = res?.data?.data || [];
  const totalDeclared = declarations.reduce((s: number, d: any) => s + Number(d.declared_amount || 0), 0);
  const totalApproved = declarations.reduce((s: number, d: any) => s + Number(d.approved_amount || 0), 0);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitting(true);
    const fd = new FormData(e.currentTarget);

    try {
      const now = new Date();
      const fy = now.getMonth() >= 3 ? `${now.getFullYear()}-${now.getFullYear() + 1}` : `${now.getFullYear() - 1}-${now.getFullYear()}`;

      await apiPost("/self-service/tax/declarations", {
        financialYear: fy,
        declarations: [{
          section: fd.get("section") as string,
          description: fd.get("description") as string,
          declaredAmount: Number(fd.get("amount")),
        }],
      });
      toast.success("Declaration submitted");
      setShowAdd(false);
      qc.invalidateQueries({ queryKey: ["my-declarations"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to submit declaration");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tax Declarations"
        description="FY 2025-26 — Submit investment proofs and claims"
        actions={
          <Button size="sm" onClick={() => setShowAdd(true)}>
            <Plus className="h-4 w-4" /> New Declaration
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-gray-500">Total Declared</p>
            <p className="text-xl font-bold text-gray-900">{formatCurrency(totalDeclared)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-gray-500">Total Approved</p>
            <p className="text-xl font-bold text-green-600">{formatCurrency(totalApproved)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4">
            <p className="text-sm text-gray-500">Pending Approval</p>
            <p className="text-xl font-bold text-orange-600">{formatCurrency(totalDeclared - totalApproved)}</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>Declarations</CardTitle></CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex h-32 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-brand-600" /></div>
          ) : declarations.length === 0 ? (
            <div className="py-12 text-center text-gray-400">
              No declarations yet. Click "New Declaration" to submit your first investment proof.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-gray-50 text-left">
                  <th className="px-6 py-3 font-medium text-gray-500">Section</th>
                  <th className="px-6 py-3 font-medium text-gray-500">Description</th>
                  <th className="px-6 py-3 font-medium text-gray-500">Declared</th>
                  <th className="px-6 py-3 font-medium text-gray-500">Approved</th>
                  <th className="px-6 py-3 font-medium text-gray-500">Proof</th>
                  <th className="px-6 py-3 font-medium text-gray-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {declarations.map((d: any) => (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-6 py-3 font-mono text-xs text-gray-500">{d.section}</td>
                    <td className="px-6 py-3 text-gray-900">{d.description}</td>
                    <td className="px-6 py-3">{formatCurrency(d.declared_amount)}</td>
                    <td className="px-6 py-3">{Number(d.approved_amount) > 0 ? formatCurrency(d.approved_amount) : "—"}</td>
                    <td className="px-6 py-3">
                      {d.proof_submitted ? (
                        <FileCheck className="h-4 w-4 text-green-500" />
                      ) : (
                        <Button variant="ghost" size="sm">
                          <Upload className="h-3 w-3" /> Upload
                        </Button>
                      )}
                    </td>
                    <td className="px-6 py-3">
                      <Badge variant={d.approval_status}>{d.approval_status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <Modal open={showAdd} onClose={() => setShowAdd(false)} title="New Declaration">
        <form className="space-y-4" onSubmit={handleSubmit}>
          <SelectField id="section" name="section" label="Section" options={SECTIONS} />
          <Input id="description" name="description" label="Description" placeholder="e.g. PPF Contribution" required />
          <Input id="amount" name="amount" label="Amount" type="number" placeholder="150000" required />
          <div>
            <label className="block text-sm font-medium text-gray-700">Proof Document</label>
            <div className="mt-1 flex items-center justify-center rounded-lg border-2 border-dashed border-gray-300 p-6">
              <div className="text-center">
                <Upload className="mx-auto h-8 w-8 text-gray-400" />
                <p className="mt-1 text-sm text-gray-500">Click to upload or drag and drop</p>
                <p className="text-xs text-gray-400">PDF, JPG up to 5MB</p>
              </div>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setShowAdd(false)}>Cancel</Button>
            <Button type="submit" loading={submitting}>Submit Declaration</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
