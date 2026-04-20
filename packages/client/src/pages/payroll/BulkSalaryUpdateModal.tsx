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

  const structures = Array.isArray(structRes?.data) ? structRes.data : [];
  const [structureId, setStructureId] = useState(structures[0]?.id || "");
  const [effectiveFrom, setEffectiveFrom] = useState(new Date().toISOString().slice(0, 10));
  const [ctcMap, setCtcMap] = useState<Record<string, number>>(
    Object.fromEntries(employeeIds.map((id) => [id, 0])),
  );

  function handleCtcChange(employeeId: string, value: number) {
    setCtcMap((prev) => ({ ...prev, [employeeId]: value }));
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!structureId) {
      toast.error("Please select a salary structure");
      return;
    }

    const assignments = employeeIds
      .filter((id) => (ctcMap[id] || 0) > 0)
      .map((id) => ({ employeeId: id, ctc: ctcMap[id] }));

    if (assignments.length === 0) {
      toast.error("Please enter CTC for at least one employee");
      return;
    }

    bulkAssign(
      {
        structureId,
        effectiveFrom,
        assignments,
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
          setCtcMap(Object.fromEntries(employeeIds.map((id) => [id, 0])));
        },
        onError: (err: any) => {
          const msg = err.response?.data?.error?.message || "Failed to update salary";
          toast.error(msg);
        },
      },
    );
  }

  return (
    <Modal open={open} onClose={onClose} title="Bulk Update Salary" className="max-w-3xl">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <SelectField
            id="structure"
            label="Salary Structure"
            value={structureId}
            onChange={(e) => setStructureId(e.target.value)}
            options={structures.map((s: any) => ({ value: s.id, label: s.name }))}
            required
          />
          <Input
            id="effectiveFrom"
            label="Effective From"
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            required
          />
        </div>

        <div className="overflow-hidden rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-gray-700">Employee</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Annual CTC (₹)</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-700">Monthly Gross</th>
              </tr>
            </thead>
            <tbody>
              {employeeIds.map((empId, idx) => {
                const name = employeeNames?.[idx] || `Employee ${idx + 1}`;
                const ctc = ctcMap[empId] || 0;
                const monthlyGross = ctc > 0 ? Math.round(ctc / 12) : 0;
                return (
                  <tr key={empId} className="border-b border-gray-200 hover:bg-gray-50">
                    <td className="px-4 py-3 text-gray-900">{name}</td>
                    <td className="px-4 py-3 text-right">
                      <input
                        type="number"
                        value={ctc || ""}
                        onChange={(e) => handleCtcChange(empId, Number(e.target.value))}
                        placeholder="0"
                        className="w-full rounded border border-gray-300 px-2 py-1 text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
                        min="0"
                      />
                    </td>
                    <td className="px-4 py-3 text-right text-gray-600">
                      {monthlyGross > 0 ? formatCurrency(monthlyGross) : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-end gap-3 border-t border-gray-100 pt-4">
          <Button variant="outline" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={!structureId || Object.values(ctcMap).every((c) => c === 0) || isPending}
            className="flex items-center gap-2"
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Update {employeeIds.length} Employee(s)
          </Button>
        </div>
      </form>
    </Modal>
  );
}
