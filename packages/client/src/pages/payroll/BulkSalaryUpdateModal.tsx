import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { useSalaryStructures, useBulkAssignSalary } from "@/api/hooks";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

interface BulkSalaryUpdateModalProps {
  open: boolean;
  onClose: () => void;
  employeeIds: string[];
  employeeNames?: string[];
}

export function BulkSalaryUpdateModal({
  open,
  onClose,
  employeeIds,
  employeeNames,
}: BulkSalaryUpdateModalProps) {
  const { data: structRes } = useSalaryStructures();
  const { mutate: bulkAssign, isPending } = useBulkAssignSalary();

  const [structureId, setStructureId] = useState(structRes?.data?.[0]?.id || "");
  const [ctc, setCTC] = useState(0);
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));

  const structures = structRes?.data || [];

  // Auto-calculate components from CTC
  // Basic = 40% of CTC, HRA = 50% of Basic, SA = remainder
  const monthly = ctc / 12;
  const monthlyBasic = Math.round(monthly * 0.4);
  const monthlyHRA = Math.round(monthlyBasic * 0.5);
  const monthlySA = Math.round(monthly - monthlyBasic - monthlyHRA);

  const comps = [
    { code: "BASIC", label: "Basic Salary", monthly: monthlyBasic },
    { code: "HRA", label: "House Rent Allowance", monthly: monthlyHRA },
    { code: "SA", label: "Special Allowance", monthly: monthlySA },
  ];

  const monthlyGross = monthlyBasic + monthlyHRA + monthlySA;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!structureId || !ctc || employeeIds.length === 0) {
      toast.error("Please fill all required fields");
      return;
    }

    const components = comps.map((c) => ({
      code: c.code,
      name: c.label,
      monthlyAmount: c.monthly,
      annualAmount: c.monthly * 12,
    }));

    bulkAssign(
      {
        employeeIds,
        structureId,
        ctc,
        components,
        effectiveFrom,
      },
      {
        onSuccess: (res: any) => {
          const { updated, failed } = res.data;
          if (failed === 0) {
            toast.success(`Updated salary for ${updated} employee(s)`);
          } else {
            toast.success(`Updated ${updated} employee(s), ${failed} failed`);
          }
          onClose();
        },
        onError: (err: any) => {
          const msg = err.response?.data?.error?.message || "Failed to update salary";
          toast.error(msg);
        },
      },
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Bulk Update Salary" className="max-w-lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="rounded-lg bg-blue-50 p-3">
          <p className="text-sm text-blue-700">
            Updating salary for <span className="font-semibold">{employeeIds.length}</span>{" "}
            employee(s)
          </p>
          {employeeNames && employeeNames.length > 0 && (
            <p className="mt-2 text-xs text-blue-600">
              {employeeNames.slice(0, 3).join(", ")}
              {employeeNames.length > 3 ? ` +${employeeNames.length - 3} more` : ""}
            </p>
          )}
        </div>

        <SelectField
          id="structure"
          label="Salary Structure"
          value={structureId}
          onChange={(e) => setStructureId(e.target.value)}
          options={structures.map((s: any) => ({ value: s.id, label: s.name }))}
          required
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
          <div className="space-y-3 rounded-lg border border-gray-200 bg-gray-50 p-4">
            <h4 className="text-sm font-semibold text-gray-700">
              Monthly Breakdown (Auto-Calculated)
            </h4>

            <div className="space-y-2">
              {comps.map((c) => (
                <div key={c.code} className="flex justify-between text-sm">
                  <span className="text-gray-600">{c.label}</span>
                  <span className="font-medium text-gray-900">{formatCurrency(c.monthly)}</span>
                </div>
              ))}

              <div className="border-t border-gray-200 pt-2">
                <div className="flex justify-between text-sm font-semibold text-gray-900">
                  <span>Monthly Gross</span>
                  <span>{formatCurrency(monthlyGross)}</span>
                </div>
              </div>

              <div className="border-t border-gray-200 pt-2">
                <div className="flex justify-between text-sm font-semibold text-indigo-600">
                  <span>Annual Gross</span>
                  <span>{formatCurrency(monthlyGross * 12)}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <Input
          id="effectiveFrom"
          label="Effective From"
          type="date"
          value={effectiveFrom}
          onChange={(e) => setEffectiveFrom(e.target.value)}
          required
        />

        <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!ctc || !structureId || isPending}
            className="flex items-center gap-2"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Update Salary
          </Button>
        </div>
      </form>
    </Modal>
  );
}
