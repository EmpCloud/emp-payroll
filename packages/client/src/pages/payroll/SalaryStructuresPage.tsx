import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { useSalaryStructures } from "@/api/hooks";
import { apiGet, apiPost } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, ChevronDown, ChevronUp, Loader2, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

interface NewComponent {
  name: string;
  code: string;
  type: "earning" | "deduction" | "reimbursement";
  calculationType: "percentage" | "fixed";
  value: number;
  percentageOf: string;
}

const defaultComponents: NewComponent[] = [
  { name: "Basic Salary", code: "BASIC", type: "earning", calculationType: "percentage", value: 40, percentageOf: "CTC" },
  { name: "House Rent Allowance", code: "HRA", type: "earning", calculationType: "percentage", value: 50, percentageOf: "BASIC" },
  { name: "Special Allowance", code: "SA", type: "earning", calculationType: "fixed", value: 0, percentageOf: "" },
];

export function SalaryStructuresPage() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [components, setComponents] = useState<NewComponent[]>(defaultComponents);
  const [creating, setCreating] = useState(false);
  const { data: res, isLoading } = useSalaryStructures();
  const qc = useQueryClient();

  const structures = res?.data?.data || [];

  function addComponent() {
    setComponents([...components, { name: "", code: "", type: "earning", calculationType: "fixed", value: 0, percentageOf: "" }]);
  }

  function removeComponent(i: number) {
    setComponents(components.filter((_, idx) => idx !== i));
  }

  function updateComponent(i: number, field: string, value: any) {
    const updated = [...components];
    (updated[i] as any)[field] = value;
    setComponents(updated);
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setCreating(true);
    try {
      await apiPost("/salary-structures", {
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
      });
      toast.success("Salary structure created");
      setShowCreate(false);
      setComponents(defaultComponents);
      qc.invalidateQueries({ queryKey: ["salary-structures"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed to create structure");
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Salary Structures"
        description="Define how CTC is broken down into components"
        actions={
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" /> New Structure
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>
      ) : (
        <div className="space-y-4">
          {structures.map((ss: any) => (
            <StructureCard
              key={ss.id}
              structure={ss}
              expanded={expanded === ss.id}
              onToggle={() => setExpanded(expanded === ss.id ? null : ss.id)}
            />
          ))}
          {structures.length === 0 && (
            <p className="py-12 text-center text-gray-400">No salary structures yet. Create one to get started.</p>
          )}
        </div>
      )}

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="New Salary Structure" className="max-w-2xl">
        <form onSubmit={handleCreate} className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <Input id="name" name="name" label="Structure Name" placeholder="e.g. Standard - Engineering" required />
            <Input id="description" name="description" label="Description" placeholder="Default structure for..." />
          </div>

          <div>
            <div className="mb-3 flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-700">Components</h4>
              <Button type="button" variant="outline" size="sm" onClick={addComponent}>
                <Plus className="h-3 w-3" /> Add
              </Button>
            </div>
            <div className="space-y-3">
              {components.map((c, i) => (
                <div key={i} className="flex items-end gap-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <div className="flex-1">
                    <Input
                      id={`c-name-${i}`}
                      label={i === 0 ? "Name" : undefined}
                      placeholder="Component name"
                      value={c.name}
                      onChange={(e) => updateComponent(i, "name", e.target.value)}
                      required
                    />
                  </div>
                  <div className="w-24">
                    <Input
                      id={`c-code-${i}`}
                      label={i === 0 ? "Code" : undefined}
                      placeholder="CODE"
                      value={c.code}
                      onChange={(e) => updateComponent(i, "code", e.target.value.toUpperCase())}
                      required
                    />
                  </div>
                  <div className="w-28">
                    <SelectField
                      id={`c-type-${i}`}
                      label={i === 0 ? "Type" : undefined}
                      value={c.type}
                      onChange={(e) => updateComponent(i, "type", e.target.value)}
                      options={[
                        { value: "earning", label: "Earning" },
                        { value: "deduction", label: "Deduction" },
                        { value: "reimbursement", label: "Reimb." },
                      ]}
                    />
                  </div>
                  <div className="w-28">
                    <SelectField
                      id={`c-calc-${i}`}
                      label={i === 0 ? "Calc" : undefined}
                      value={c.calculationType}
                      onChange={(e) => updateComponent(i, "calculationType", e.target.value)}
                      options={[
                        { value: "percentage", label: "%" },
                        { value: "fixed", label: "Fixed" },
                      ]}
                    />
                  </div>
                  <div className="w-20">
                    <Input
                      id={`c-val-${i}`}
                      label={i === 0 ? "Value" : undefined}
                      type="number"
                      value={c.value}
                      onChange={(e) => updateComponent(i, "value", Number(e.target.value))}
                    />
                  </div>
                  {c.calculationType === "percentage" && (
                    <div className="w-24">
                      <Input
                        id={`c-of-${i}`}
                        label={i === 0 ? "Of" : undefined}
                        placeholder="BASIC"
                        value={c.percentageOf}
                        onChange={(e) => updateComponent(i, "percentageOf", e.target.value.toUpperCase())}
                      />
                    </div>
                  )}
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeComponent(i)} className="text-red-400 hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => { setShowCreate(false); setComponents(defaultComponents); }}>Cancel</Button>
            <Button type="submit" loading={creating}>Create Structure</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

function StructureCard({ structure: ss, expanded, onToggle }: { structure: any; expanded: boolean; onToggle: () => void }) {
  const { data: compRes } = useQuery({
    queryKey: ["structure-components", ss.id],
    queryFn: () => apiGet<any>(`/salary-structures/${ss.id}/components`),
    enabled: expanded,
  });

  const components = compRes?.data?.data || [];

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <CardTitle>{ss.name}</CardTitle>
            <Badge variant={ss.is_active ? "active" : "inactive"}>
              {ss.is_active ? "Active" : "Inactive"}
            </Badge>
            {ss.is_default && <Badge variant="approved">Default</Badge>}
          </div>
          <Button variant="ghost" size="sm" onClick={onToggle}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
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
                      <Badge variant={c.type === "earning" ? "approved" : c.type === "deduction" ? "pending" : "draft"}>
                        {c.type}
                      </Badge>
                    </td>
                    <td className="py-2 text-gray-600">
                      {c.calculation_type === "percentage" && c.percentage_of
                        ? `${c.value}% of ${c.percentage_of}`
                        : c.calculation_type === "fixed" && Number(c.value) > 0
                        ? `Fixed ₹${c.value}`
                        : "Balancing"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-gray-400">No components defined</p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
