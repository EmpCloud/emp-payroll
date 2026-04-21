import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { useSalaryStructures } from "@/api/hooks";
import { apiGet, apiPost, apiPut, apiDelete } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  ChevronDown,
  ChevronUp,
  Loader2,
  Trash2,
  Pencil,
  Copy,
  GripVertical,
} from "lucide-react";
import toast from "react-hot-toast";

interface ComponentRow {
  name: string;
  code: string;
  type: "earning" | "deduction" | "reimbursement";
  calculationType: "percentage" | "fixed";
  value: number;
  percentageOf: string;
}

const DEFAULT_COMPONENTS: ComponentRow[] = [
  {
    name: "Basic Salary",
    code: "BASIC",
    type: "earning",
    calculationType: "percentage",
    value: 40,
    percentageOf: "CTC",
  },
  {
    name: "House Rent Allowance",
    code: "HRA",
    type: "earning",
    calculationType: "percentage",
    value: 50,
    percentageOf: "BASIC",
  },
  {
    name: "Special Allowance",
    code: "SA",
    type: "earning",
    calculationType: "fixed",
    value: 0,
    percentageOf: "",
  },
];

const PRESET_COMPONENTS = [
  { name: "Basic Salary", code: "BASIC", type: "earning" as const },
  { name: "House Rent Allowance", code: "HRA", type: "earning" as const },
  { name: "Special Allowance", code: "SA", type: "earning" as const },
  { name: "Conveyance Allowance", code: "CA", type: "earning" as const },
  { name: "Medical Allowance", code: "MA", type: "earning" as const },
  { name: "Leave Travel Allowance", code: "LTA", type: "earning" as const },
  { name: "Performance Bonus", code: "BONUS", type: "earning" as const },
  { name: "Canteen Deduction", code: "CANTEEN", type: "deduction" as const },
  { name: "Welfare Fund", code: "WELFARE", type: "deduction" as const },
  { name: "Advance Recovery", code: "ADV_REC", type: "deduction" as const },
];

export function SalaryStructuresPage() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingStructure, setEditingStructure] = useState<any>(null);
  const [components, setComponents] = useState<ComponentRow[]>(DEFAULT_COMPONENTS);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const { data: res, isLoading } = useSalaryStructures();
  const qc = useQueryClient();

  const structures = res?.data?.data || [];

  function addComponent(preset?: (typeof PRESET_COMPONENTS)[0]) {
    setComponents([
      ...components,
      {
        name: preset?.name || "",
        code: preset?.code || "",
        type: preset?.type || "earning",
        calculationType: "fixed",
        value: 0,
        percentageOf: "",
      },
    ]);
  }

  function removeComponent(i: number) {
    setComponents(components.filter((_, idx) => idx !== i));
  }

  function updateComponent(i: number, field: string, value: any) {
    const updated = [...components];
    (updated[i] as any)[field] = value;
    setComponents(updated);
  }

  function openCreate() {
    setEditingStructure(null);
    setComponents(DEFAULT_COMPONENTS);
    setShowCreate(true);
  }

  function openEdit(ss: any, comps: any[]) {
    setEditingStructure(ss);
    setComponents(
      comps.map((c: any) => ({
        name: c.name,
        code: c.code,
        type: c.type || "earning",
        calculationType: c.calculation_type || "fixed",
        value: Number(c.value) || 0,
        percentageOf: c.percentage_of || "",
      })),
    );
    setShowCreate(true);
  }

  function closeModal() {
    setShowCreate(false);
    setEditingStructure(null);
    setComponents(DEFAULT_COMPONENTS);
  }

  async function handleSave(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setSaving(true);

    const payload = {
      name: fd.get("name") as string,
      description: fd.get("description") as string,
      isDefault: false,
      components: components
        .filter((c) => c.name && c.code)
        .map((c, i) => ({
          name: c.name,
          code: c.code,
          type: c.type,
          calculationType: c.calculationType,
          value: c.value,
          percentageOf: c.percentageOf || undefined,
          isTaxable: c.type === "earning",
          isStatutory: false,
          isProratable: true,
          sortOrder: i,
        })),
    };

    try {
      if (editingStructure) {
        await apiPut(`/salary-structures/${editingStructure.id}`, payload);
        toast.success("Salary structure updated");
      } else {
        await apiPost("/salary-structures", payload);
        toast.success("Salary structure created");
      }
      closeModal();
      qc.invalidateQueries({ queryKey: ["salary-structures"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this salary structure? Employees assigned to it will not be affected."))
      return;
    setDeleting(id);
    try {
      await apiDelete(`/salary-structures/${id}`);
      toast.success("Salary structure deleted");
      qc.invalidateQueries({ queryKey: ["salary-structures"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to delete");
    } finally {
      setDeleting(null);
    }
  }

  async function handleDuplicate(ss: any) {
    try {
      await apiPost(`/salary-structures/${ss.id}/duplicate`, {
        name: `${ss.name} (Copy)`,
      });
      toast.success("Structure duplicated");
      qc.invalidateQueries({ queryKey: ["salary-structures"] });
    } catch (err: any) {
      toast.error(err?.response?.data?.error?.message || "Failed to duplicate");
    }
  }

  // Compute preview totals for the modal
  const earningTotal = components
    .filter((c) => c.type !== "deduction")
    .reduce((s, c) => s + c.value, 0);
  const deductionTotal = components
    .filter((c) => c.type === "deduction")
    .reduce((s, c) => s + c.value, 0);
  const unusedPresets = PRESET_COMPONENTS.filter((p) => !components.find((c) => c.code === p.code));

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Salary Structures"
        description={`${structures.length} structure${structures.length !== 1 ? "s" : ""} configured`}
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /> New Structure
          </Button>
        }
      />

      {structures.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-gray-400">
            No salary structures yet. Create one to get started.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {structures.map((ss: any) => (
            <StructureCard
              key={ss.id}
              structure={ss}
              expanded={expanded === ss.id}
              onToggle={() => setExpanded(expanded === ss.id ? null : ss.id)}
              onEdit={openEdit}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              isDeleting={deleting === ss.id}
            />
          ))}
        </div>
      )}

      {/* Create / Edit Modal */}
      <Modal
        open={showCreate}
        onClose={closeModal}
        title={editingStructure ? "Edit Salary Structure" : "New Salary Structure"}
        className="max-w-3xl"
      >
        <form className="flex h-full min-h-0 flex-col" onSubmit={handleSave}>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
            <div className="grid grid-cols-2 gap-4">
              <Input
                id="name"
                name="name"
                label="Structure Name"
                placeholder="e.g. Standard India CTC"
                defaultValue={editingStructure?.name || ""}
                required
              />
              <Input
                id="description"
                name="description"
                label="Description"
                placeholder="For full-time employees"
                defaultValue={editingStructure?.description || ""}
              />
            </div>

            {/* Components */}
            <div>
              {/* #104 — Use flex-wrap + gap so the header row doesn't smush
                  the preset dropdown on top of the "Components" label when
                  the modal content is narrow, and shrink-0 on the actions so
                  they don't collapse onto a single pixel. */}
              <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                <h4 className="text-sm font-semibold text-gray-700">Components</h4>
                <div className="flex shrink-0 items-center gap-2">
                  {unusedPresets.length > 0 && (
                    <select
                      aria-label="Add preset component"
                      className="focus:border-brand-500 focus:ring-brand-500 h-8 rounded-md border border-gray-300 px-2 text-xs focus:outline-none focus:ring-1"
                      value=""
                      onChange={(e) => {
                        const preset = PRESET_COMPONENTS.find((p) => p.code === e.target.value);
                        if (preset) addComponent(preset);
                        e.target.value = "";
                      }}
                    >
                      <option value="">+ Add preset...</option>
                      {unusedPresets.map((p) => (
                        <option key={p.code} value={p.code}>
                          {p.name} ({p.type})
                        </option>
                      ))}
                    </select>
                  )}
                  <Button type="button" variant="outline" size="sm" onClick={() => addComponent()}>
                    <Plus className="h-3.5 w-3.5" /> Custom
                  </Button>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border border-gray-200">
                {/* Header */}
                <div className="grid grid-cols-[1fr_80px_100px_90px_70px_90px_36px] gap-2 bg-gray-50 px-3 py-2 text-xs font-medium text-gray-500">
                  <span>Name</span>
                  <span>Code</span>
                  <span>Type</span>
                  <span>Calc</span>
                  <span>Value</span>
                  <span>% Of</span>
                  <span></span>
                </div>

                {/* Rows */}
                <div className="divide-y divide-gray-100">
                  {components.map((c, i) => (
                    <div
                      key={i}
                      className="grid grid-cols-[1fr_80px_100px_90px_70px_90px_36px] items-center gap-2 px-3 py-2"
                    >
                      <input
                        className="focus:border-brand-500 focus:ring-brand-500 w-full rounded border border-gray-200 px-2 py-1.5 text-sm focus:outline-none focus:ring-1"
                        placeholder="Component name"
                        value={c.name}
                        onChange={(e) => updateComponent(i, "name", e.target.value)}
                        required
                      />
                      <input
                        className="focus:border-brand-500 focus:ring-brand-500 w-full rounded border border-gray-200 px-2 py-1.5 font-mono text-sm focus:outline-none focus:ring-1"
                        placeholder="CODE"
                        value={c.code}
                        onChange={(e) => updateComponent(i, "code", e.target.value.toUpperCase())}
                        required
                      />
                      <select
                        className="focus:border-brand-500 focus:ring-brand-500 w-full rounded border border-gray-200 px-1 py-1.5 text-sm focus:outline-none focus:ring-1"
                        value={c.type}
                        onChange={(e) => updateComponent(i, "type", e.target.value)}
                      >
                        <option value="earning">Earning</option>
                        <option value="deduction">Deduction</option>
                        <option value="reimbursement">Reimb.</option>
                      </select>
                      <select
                        className="focus:border-brand-500 focus:ring-brand-500 w-full rounded border border-gray-200 px-1 py-1.5 text-sm focus:outline-none focus:ring-1"
                        value={c.calculationType}
                        onChange={(e) => updateComponent(i, "calculationType", e.target.value)}
                      >
                        <option value="percentage">%</option>
                        <option value="fixed">Fixed</option>
                      </select>
                      <input
                        className="focus:border-brand-500 focus:ring-brand-500 w-full rounded border border-gray-200 px-2 py-1.5 text-right text-sm focus:outline-none focus:ring-1"
                        type="number"
                        value={c.value}
                        onChange={(e) => updateComponent(i, "value", Number(e.target.value))}
                      />
                      <input
                        className="focus:border-brand-500 focus:ring-brand-500 w-full rounded border border-gray-200 px-2 py-1.5 font-mono text-sm focus:outline-none focus:ring-1 disabled:bg-gray-50 disabled:text-gray-300"
                        placeholder="CTC"
                        value={c.percentageOf}
                        onChange={(e) =>
                          updateComponent(i, "percentageOf", e.target.value.toUpperCase())
                        }
                        disabled={c.calculationType !== "percentage"}
                      />
                      <button
                        type="button"
                        onClick={() => removeComponent(i)}
                        className="flex h-8 w-8 items-center justify-center rounded text-red-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* Summary */}
              {components.length > 0 && (
                <div className="mt-3 flex gap-4 text-xs text-gray-500">
                  <span>{components.filter((c) => c.type === "earning").length} earnings</span>
                  {components.filter((c) => c.type === "deduction").length > 0 && (
                    <span>
                      {components.filter((c) => c.type === "deduction").length} deductions
                    </span>
                  )}
                  {components.filter((c) => c.type === "reimbursement").length > 0 && (
                    <span>
                      {components.filter((c) => c.type === "reimbursement").length} reimbursements
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Info box */}
            <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700 dark:bg-blue-950 dark:text-blue-300">
              <strong>Note:</strong> Statutory deductions (EPF, ESI, PT, TDS) are computed
              automatically during payroll and do not need to be added here. Use "Deduction" type
              for recurring non-statutory deductions like canteen fees or welfare fund.
            </div>
          </div>

          <div className="mt-4 flex shrink-0 justify-end gap-3 border-t border-gray-100 bg-white pt-4 dark:border-gray-800 dark:bg-gray-900">
            <Button variant="outline" type="button" onClick={closeModal}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {editingStructure ? "Update Structure" : "Create Structure"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function StructureCard({
  structure: ss,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onDuplicate,
  isDeleting,
}: {
  structure: any;
  expanded: boolean;
  onToggle: () => void;
  onEdit: (ss: any, comps: any[]) => void;
  onDelete: (id: string) => void;
  onDuplicate: (ss: any) => void;
  isDeleting: boolean;
}) {
  const { data: compRes } = useQuery({
    queryKey: ["structure-components", ss.id],
    queryFn: () => apiGet<any>(`/salary-structures/${ss.id}/components`),
    enabled: expanded,
  });

  const components = compRes?.data?.data || [];
  const earningCount = components.filter((c: any) => c.type === "earning").length;
  const deductionCount = components.filter((c: any) => c.type === "deduction").length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex cursor-pointer items-center gap-3" onClick={onToggle}>
            <CardTitle>{ss.name}</CardTitle>
            <Badge variant={ss.is_active ? "active" : "inactive"}>
              {ss.is_active ? "Active" : "Inactive"}
            </Badge>
            {ss.is_default && <Badge variant="approved">Default</Badge>}
            <span className="text-xs text-gray-400">
              {earningCount > 0 && `${earningCount} earnings`}
              {deductionCount > 0 && ` · ${deductionCount} deductions`}
            </span>
          </div>
          <div className="flex items-center gap-1">
            {/* Duplicate works without needing the components preloaded — server copies line items */}
            <Button variant="ghost" size="sm" onClick={() => onDuplicate(ss)} title="Duplicate">
              <Copy className="h-3.5 w-3.5" />
            </Button>
            {expanded && (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onEdit(ss, components)}
                  title="Edit"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                {!ss.is_default && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDelete(ss.id)}
                    loading={isDeleting}
                    className="text-red-400 hover:text-red-600"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </>
            )}
            <Button variant="ghost" size="sm" onClick={onToggle}>
              {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        {ss.description && <p className="text-sm text-gray-500">{ss.description}</p>}
      </CardHeader>

      {expanded && (
        <CardContent>
          {components.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 text-left">
                  <th className="pb-2 font-medium text-gray-500">Component</th>
                  <th className="pb-2 font-medium text-gray-500">Code</th>
                  <th className="pb-2 font-medium text-gray-500">Type</th>
                  <th className="pb-2 font-medium text-gray-500">Calculation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {components.map((c: any) => (
                  <tr key={c.id}>
                    <td className="py-2 text-gray-900">{c.name}</td>
                    <td className="py-2 font-mono text-xs text-gray-500">{c.code}</td>
                    <td className="py-2">
                      <Badge
                        variant={
                          c.type === "earning"
                            ? "approved"
                            : c.type === "deduction"
                              ? "pending"
                              : "draft"
                        }
                      >
                        {c.type}
                      </Badge>
                    </td>
                    <td className="py-2 text-gray-600">
                      {c.calculation_type === "percentage" && c.percentage_of
                        ? `${c.value}% of ${c.percentage_of}`
                        : c.calculation_type === "fixed" && Number(c.value) > 0
                          ? `Fixed ₹${Number(c.value).toLocaleString("en-IN")}`
                          : "Balancing"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-gray-400">No components defined</p>
          )}

          {/* Statutory note */}
          <div className="mt-4 rounded bg-gray-50 p-3 text-xs text-gray-500 dark:bg-gray-800">
            EPF, ESI, Professional Tax, and TDS are computed automatically during payroll — they are
            not part of the salary structure.
          </div>
        </CardContent>
      )}
    </Card>
  );
}
