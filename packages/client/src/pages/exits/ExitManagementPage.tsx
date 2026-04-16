import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Input } from "@/components/ui/Input";
import { SelectField } from "@/components/ui/SelectField";
import { Modal } from "@/components/ui/Modal";
import { apiGet, apiPost, apiPut } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  UserMinus,
  Plus,
  Loader2,
  CheckCircle,
  Circle,
  Calculator,
  FileCheck,
  Key,
  Package,
  FileText,
  CreditCard,
  Clock,
} from "lucide-react";
import toast from "react-hot-toast";
import { formatCurrency, formatDate } from "@/lib/utils";

const EXIT_TYPES = [
  { value: "resignation", label: "Resignation" },
  { value: "termination", label: "Termination" },
  { value: "retirement", label: "Retirement" },
  { value: "end_of_contract", label: "End of Contract" },
  { value: "mutual_separation", label: "Mutual Separation" },
];

const STATUS_COLORS: Record<string, string> = {
  initiated: "bg-blue-100 text-blue-700",
  in_progress: "bg-yellow-100 text-yellow-700",
  fnf_pending: "bg-orange-100 text-orange-700",
  fnf_processed: "bg-purple-100 text-purple-700",
  completed: "bg-green-100 text-green-700",
  cancelled: "bg-gray-100 text-gray-700",
};

const CHECKLIST_ITEMS = [
  { key: "notice_served", label: "Notice Period Served", icon: Clock },
  { key: "handover_complete", label: "Work Handover Complete", icon: FileCheck },
  { key: "assets_returned", label: "Company Assets Returned", icon: Package },
  { key: "access_revoked", label: "System Access Revoked", icon: Key },
  { key: "fnf_calculated", label: "FnF Calculated", icon: Calculator },
  { key: "fnf_paid", label: "FnF Paid", icon: CreditCard },
  { key: "experience_letter_issued", label: "Experience Letter Issued", icon: FileText },
  { key: "relieving_letter_issued", label: "Relieving Letter Issued", icon: FileText },
];

export function ExitManagementPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<string>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [empSearch, setEmpSearch] = useState("");
  const [empResults, setEmpResults] = useState<any[]>([]);
  const [selectedEmp, setSelectedEmp] = useState<any>(null);

  const { data: res, isLoading } = useQuery({
    queryKey: ["exits", tab],
    queryFn: () => apiGet<any>("/exits", tab !== "all" ? { status: tab } : {}),
  });

  const exits = res?.data || [];

  async function searchEmployees(q: string) {
    setEmpSearch(q);
    if (q.length < 2) {
      setEmpResults([]);
      return;
    }
    try {
      const r = await apiGet<any>("/employees/search", { q });
      setEmpResults(r.data || []);
    } catch {
      setEmpResults([]);
    }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!selectedEmp) {
      toast.error("Select an employee");
      return;
    }
    // Employee search results may come back with `id` (current server shape)
    // or `empcloudUserId` (legacy camelCase shape) — accept either so the
    // outbound payload always carries a real employeeId.
    const employeeId = selectedEmp.id ?? selectedEmp.empcloudUserId ?? selectedEmp.empcloud_user_id;
    if (!employeeId) {
      toast.error("Invalid employee selection");
      return;
    }
    const fd = new FormData(e.currentTarget);
    // FormData.get returns FormDataEntryValue | null — coerce to string and
    // fall back to the first exit-type option so a native <select> that
    // hasn't been touched still sends a valid value.
    const exitType = (fd.get("exitType") as string | null) || EXIT_TYPES[0].value;
    const resignationDate = (fd.get("resignationDate") as string | null) || undefined;
    const lastWorkingDate = (fd.get("lastWorkingDate") as string | null) || undefined;
    const reason = (fd.get("reason") as string | null) || undefined;
    setSubmitting(true);
    try {
      await apiPost("/exits", {
        employeeId,
        exitType,
        resignationDate,
        lastWorkingDate,
        reason,
      });
      toast.success("Exit initiated");
      setCreateOpen(false);
      setSelectedEmp(null);
      setEmpSearch("");
      qc.invalidateQueries({ queryKey: ["exits"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleChecklist(exit: any, key: string) {
    try {
      await apiPut(`/exits/${exit.id}`, { [key]: !exit[key] });
      qc.invalidateQueries({ queryKey: ["exits"] });
      if (detailItem?.id === exit.id) {
        setDetailItem({ ...detailItem, [key]: !exit[key] });
      }
    } catch {
      toast.error("Failed to update");
    }
  }

  async function handleCalculateFnF(exitId: string) {
    try {
      const r = await apiPost<any>(`/exits/${exitId}/calculate-fnf`);
      toast.success("FnF calculated");
      setDetailItem((prev: any) =>
        prev ? { ...prev, ...r.data, fnf_calculated: true, status: "fnf_pending" } : prev,
      );
      qc.invalidateQueries({ queryKey: ["exits"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    }
  }

  async function updateStatus(exitId: string, status: string) {
    try {
      await apiPut(`/exits/${exitId}`, { status });
      toast.success(`Status updated to ${status.replace("_", " ")}`);
      setDetailItem((prev: any) => (prev ? { ...prev, status } : prev));
      qc.invalidateQueries({ queryKey: ["exits"] });
    } catch {
      toast.error("Failed to update");
    }
  }

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
      </div>
    );
  }

  const tabs = [
    { key: "all", label: "All" },
    { key: "initiated", label: "Initiated" },
    { key: "in_progress", label: "In Progress" },
    { key: "fnf_pending", label: "FnF Pending" },
    { key: "completed", label: "Completed" },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exit Management"
        description="Employee offboarding & full and final settlement"
        actions={
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" /> Initiate Exit
          </Button>
        }
      />

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              tab === t.key
                ? "text-brand-700 bg-white shadow-sm"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {exits.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <UserMinus className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-4 text-gray-500">No exit records found</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {exits.map((exit: any) => {
            const checklistDone = CHECKLIST_ITEMS.filter((c) => exit[c.key]).length;
            const checklistTotal = CHECKLIST_ITEMS.length;
            return (
              <Card
                key={exit.id}
                className="hover:border-brand-200 cursor-pointer transition-colors"
                onClick={() => setDetailItem(exit)}
              >
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-3">
                        <h3 className="text-sm font-semibold text-gray-900">
                          {exit.employee_name}
                        </h3>
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[exit.status] || STATUS_COLORS.initiated}`}
                        >
                          {exit.status.replace(/_/g, " ")}
                        </span>
                        <Badge variant="pending">{exit.exit_type.replace(/_/g, " ")}</Badge>
                      </div>
                      <p className="mt-1 text-xs text-gray-500">
                        {exit.employee_code} &middot; {exit.employee_designation || "—"}
                        {exit.last_working_date && (
                          <> &middot; LWD: {formatDate(exit.last_working_date)}</>
                        )}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-400">Checklist</p>
                      <p className="text-sm font-semibold">
                        {checklistDone}/{checklistTotal}
                      </p>
                      {exit.fnf_total > 0 && (
                        <p className="text-brand-600 mt-1 text-xs font-medium">
                          FnF: {formatCurrency(exit.fnf_total)}
                        </p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detail Modal */}
      <Modal
        open={!!detailItem}
        onClose={() => setDetailItem(null)}
        title={`Exit: ${detailItem?.employee_name || ""}`}
        className="max-w-2xl"
      >
        {detailItem && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-gray-500">Employee</p>
                <p className="font-medium">
                  {detailItem.employee_name} ({detailItem.employee_code})
                </p>
              </div>
              <div>
                <p className="text-gray-500">Exit Type</p>
                <p className="font-medium capitalize">{detailItem.exit_type.replace(/_/g, " ")}</p>
              </div>
              <div>
                <p className="text-gray-500">Resignation Date</p>
                <p className="font-medium">
                  {detailItem.resignation_date ? formatDate(detailItem.resignation_date) : "—"}
                </p>
              </div>
              <div>
                <p className="text-gray-500">Last Working Date</p>
                <p className="font-medium">
                  {detailItem.last_working_date ? formatDate(detailItem.last_working_date) : "—"}
                </p>
              </div>
              {detailItem.reason && (
                <div className="col-span-2">
                  <p className="text-gray-500">Reason</p>
                  <p className="font-medium">{detailItem.reason}</p>
                </div>
              )}
            </div>

            {/* Checklist */}
            <div>
              <h4 className="mb-3 text-sm font-semibold text-gray-700">Offboarding Checklist</h4>
              <div className="grid grid-cols-2 gap-2">
                {CHECKLIST_ITEMS.map((item) => (
                  <button
                    key={item.key}
                    onClick={() => toggleChecklist(detailItem, item.key)}
                    className={`flex items-center gap-2 rounded-lg border p-3 text-sm transition-colors ${
                      detailItem[item.key]
                        ? "border-green-200 bg-green-50 text-green-700"
                        : "hover:border-brand-200 border-gray-200 text-gray-600"
                    }`}
                  >
                    {detailItem[item.key] ? (
                      <CheckCircle className="h-4 w-4 text-green-600" />
                    ) : (
                      <Circle className="h-4 w-4 text-gray-300" />
                    )}
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* FnF Section */}
            <div>
              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-sm font-semibold text-gray-700">Full & Final Settlement</h4>
                {!detailItem.fnf_calculated && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleCalculateFnF(detailItem.id)}
                  >
                    <Calculator className="h-4 w-4" /> Calculate FnF
                  </Button>
                )}
              </div>
              {detailItem.fnf_calculated ? (
                <div className="space-y-2 rounded-lg bg-gray-50 p-4">
                  {[
                    ["Pending Salary", detailItem.pending_salary],
                    ["Leave Encashment", detailItem.leave_encashment],
                    ["Gratuity", detailItem.gratuity],
                    ["Bonus Due", detailItem.bonus_due],
                    ["Deductions", -Number(detailItem.deductions)],
                  ].map(([label, amount]) => (
                    <div key={label as string} className="flex justify-between text-sm">
                      <span className="text-gray-500">{label}</span>
                      <span
                        className={`font-medium ${Number(amount) < 0 ? "text-red-600" : "text-gray-900"}`}
                      >
                        {formatCurrency(Math.abs(Number(amount)))}
                      </span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t pt-2 text-sm font-bold">
                    <span>Total FnF</span>
                    <span className="text-brand-700">{formatCurrency(detailItem.fnf_total)}</span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-gray-400">FnF not yet calculated</p>
              )}
            </div>

            {/* Status Actions */}
            <div className="flex justify-end gap-2 border-t pt-4">
              {detailItem.status === "initiated" && (
                <Button size="sm" onClick={() => updateStatus(detailItem.id, "in_progress")}>
                  Start Processing
                </Button>
              )}
              {detailItem.status === "fnf_pending" && (
                <Button size="sm" onClick={() => updateStatus(detailItem.id, "fnf_processed")}>
                  Mark FnF Processed
                </Button>
              )}
              {detailItem.status === "fnf_processed" && (
                <Button size="sm" onClick={() => updateStatus(detailItem.id, "completed")}>
                  Complete Exit
                </Button>
              )}
              {detailItem.status !== "completed" && detailItem.status !== "cancelled" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600"
                  onClick={() => updateStatus(detailItem.id, "cancelled")}
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Create Modal */}
      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          setSelectedEmp(null);
        }}
        title="Initiate Employee Exit"
        className="max-w-lg"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Employee</label>
            {selectedEmp ? (
              <div className="border-brand-200 bg-brand-50 flex items-center justify-between rounded-lg border p-3">
                <span className="text-sm font-medium">
                  {selectedEmp.first_name || selectedEmp.firstName}{" "}
                  {selectedEmp.last_name || selectedEmp.lastName} ({selectedEmp.email})
                </span>
                <button
                  type="button"
                  onClick={() => setSelectedEmp(null)}
                  className="text-xs text-red-500"
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="text"
                  value={empSearch}
                  onChange={(e) => searchEmployees(e.target.value)}
                  placeholder="Search by name or email..."
                  className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1"
                />
                {empResults.length > 0 && (
                  <div className="absolute z-10 mt-1 max-h-48 w-full overflow-auto rounded-lg border bg-white shadow-lg">
                    {empResults.map((emp: any) => (
                      <button
                        key={emp.id}
                        type="button"
                        onClick={() => {
                          setSelectedEmp(emp);
                          setEmpResults([]);
                          setEmpSearch("");
                        }}
                        className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50"
                      >
                        {emp.first_name || emp.firstName} {emp.last_name || emp.lastName} —{" "}
                        {emp.email}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <SelectField
            id="exitType"
            name="exitType"
            label="Exit Type"
            options={EXIT_TYPES}
            required
          />
          <div className="grid grid-cols-2 gap-4">
            <Input
              id="resignationDate"
              name="resignationDate"
              label="Resignation Date"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
            <Input
              id="lastWorkingDate"
              name="lastWorkingDate"
              label="Last Working Date"
              type="date"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Reason</label>
            <textarea
              name="reason"
              rows={3}
              placeholder="Exit reason..."
              className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-1"
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button
              variant="outline"
              type="button"
              onClick={() => {
                setCreateOpen(false);
                setSelectedEmp(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={submitting} disabled={!selectedEmp}>
              Initiate Exit
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
