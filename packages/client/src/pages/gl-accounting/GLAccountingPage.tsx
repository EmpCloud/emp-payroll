import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { DataTable } from "@/components/ui/DataTable";
import { StatCard } from "@/components/ui/StatCard";
import { formatCurrency, formatDate } from "@/lib/utils";
import { apiGet, apiPost, apiPut, apiDelete } from "@/api/client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, BookOpen, FileText, Download, ArrowRightLeft, Loader2, Trash2 } from "lucide-react";
import toast from "react-hot-toast";

export function GLAccountingPage() {
  // #174 — "Exported" stat card now drills into a dedicated sub-tab that
  // lists only journals with status="exported". "Total Approved" card was
  // removed — it was always 0 in practice and had no meaningful drill-in.
  const [tab, setTab] = useState<"mappings" | "journals" | "exported">("mappings");
  const [showCreateMapping, setShowCreateMapping] = useState(false);
  const [showGenerateJournal, setShowGenerateJournal] = useState(false);
  const [creating, setCreating] = useState(false);
  const qc = useQueryClient();

  const { data: mappingsRes, isLoading: mappingsLoading } = useQuery({
    queryKey: ["gl-mappings"],
    queryFn: () => apiGet<any>("/gl/mappings"),
  });

  const { data: journalsRes, isLoading: journalsLoading } = useQuery({
    queryKey: ["gl-journals"],
    queryFn: () => apiGet<any>("/gl/journals"),
  });

  const { data: runsRes } = useQuery({
    queryKey: ["payroll-runs"],
    queryFn: () => apiGet<any>("/payroll"),
  });

  const mappings = mappingsRes?.data || [];
  const journals = journalsRes?.data || [];
  // /payroll returns { success, data: { data: [...], total } } — one extra level of nesting
  const runs = runsRes?.data?.data || [];

  async function handleCreateMapping(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const glAccountCode = String(fd.get("glAccountCode") || "").trim();

    // #107 — Account codes are accounting ledger identifiers (e.g. 4001, 5100).
    // Negative or non-numeric values have no accounting meaning, so reject
    // them client-side before hitting the API.
    if (!/^[0-9]+$/.test(glAccountCode)) {
      toast.error(
        "GL Account Code must be a positive number (no negative signs, letters, or spaces)",
      );
      return;
    }

    setCreating(true);
    try {
      await apiPost("/gl/mappings", {
        payComponent: fd.get("payComponent"),
        glAccountCode,
        glAccountName: fd.get("glAccountName"),
        description: fd.get("description"),
      });
      toast.success("GL mapping created");
      setShowCreateMapping(false);
      qc.invalidateQueries({ queryKey: ["gl-mappings"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    } finally {
      setCreating(false);
    }
  }

  async function handleGenerateJournal(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    const fd = new FormData(e.currentTarget);
    try {
      await apiPost("/gl/journals/generate", {
        payrollRunId: fd.get("payrollRunId"),
      });
      toast.success("Journal entry generated");
      setShowGenerateJournal(false);
      qc.invalidateQueries({ queryKey: ["gl-journals"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    } finally {
      setCreating(false);
    }
  }

  async function deleteMapping(id: string) {
    try {
      await apiDelete(`/gl/mappings/${id}`);
      toast.success("Mapping deleted");
      qc.invalidateQueries({ queryKey: ["gl-mappings"] });
    } catch (err: any) {
      toast.error(err.response?.data?.error?.message || "Failed");
    }
  }

  function exportJournal(id: string, format: string) {
    const token = localStorage.getItem("access_token");
    const base = import.meta.env.VITE_API_URL || "/api/v1";
    window.open(`${base}/gl/journals/${id}/export/${format}?token=${token}`, "_blank");
  }

  const mappingColumns = [
    {
      key: "pay_component",
      header: "Pay Component",
      render: (r: any) => <span className="font-medium text-gray-900">{r.pay_component}</span>,
    },
    {
      key: "gl_account_code",
      header: "GL Account Code",
      render: (r: any) => (
        <code className="rounded bg-gray-100 px-2 py-0.5 text-sm">{r.gl_account_code}</code>
      ),
    },
    { key: "gl_account_name", header: "GL Account Name" },
    { key: "description", header: "Description" },
    {
      key: "actions",
      header: "",
      render: (r: any) => (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => deleteMapping(r.id)}
          className="text-red-600"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      ),
    },
  ];

  const journalColumns = [
    { key: "entry_date", header: "Date", render: (r: any) => formatDate(r.entry_date) },
    {
      key: "payroll_run_id",
      header: "Payroll Run",
      render: (r: any) => (
        <span className="font-mono text-xs">{r.payroll_run_id?.slice(0, 8)}...</span>
      ),
    },
    {
      key: "total_debit",
      header: "Total Debit",
      render: (r: any) => formatCurrency(r.total_debit),
    },
    {
      key: "total_credit",
      header: "Total Credit",
      render: (r: any) => formatCurrency(r.total_credit),
    },
    {
      key: "status",
      header: "Status",
      render: (r: any) => (
        <Badge
          variant={
            r.status === "exported" ? "approved" : r.status === "posted" ? "active" : "draft"
          }
        >
          {r.status}
        </Badge>
      ),
    },
    {
      key: "export",
      header: "Export",
      render: (r: any) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => exportJournal(r.id, "tally")}
            title="Export to Tally"
          >
            <Download className="mr-1 h-3 w-3" /> Tally
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => exportJournal(r.id, "quickbooks")}
            title="Export to QuickBooks"
          >
            QB
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => exportJournal(r.id, "zoho")}
            title="Export to Zoho"
          >
            Zoho
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title="GL / Accounting"
        description="Map payroll components to GL accounts and generate journal entries"
        actions={
          <div className="flex gap-2">
            <Button onClick={() => setShowGenerateJournal(true)}>
              <FileText className="mr-2 h-4 w-4" /> Generate Journal
            </Button>
            <Button onClick={() => setShowCreateMapping(true)}>
              <Plus className="mr-2 h-4 w-4" /> Add Mapping
            </Button>
          </div>
        }
      />

      {/* Stats — cards drill into matching tab (#105, #174). "Approved" was
          removed — it was always 0 in this org's data and had no useful
          destination. "Exported" now opens its own Exported tab sitting
          beside Journal Entries so users can find just those rows. */}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          title="GL Mappings"
          value={mappings.length}
          icon={ArrowRightLeft}
          onClick={() => setTab("mappings")}
        />
        <StatCard
          title="Journal Entries"
          value={journals.length}
          icon={BookOpen}
          onClick={() => setTab("journals")}
        />
        <StatCard
          title="Exported"
          value={journals.filter((j: any) => j.status === "exported").length}
          icon={Download}
          onClick={() => setTab("exported")}
        />
      </div>

      {/* Tabs */}
      <div className="mb-4 flex gap-2 border-b border-gray-200">
        <button
          onClick={() => setTab("mappings")}
          className={`px-4 py-2 text-sm font-medium ${tab === "mappings" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          GL Mappings ({mappings.length})
        </button>
        <button
          onClick={() => setTab("journals")}
          className={`px-4 py-2 text-sm font-medium ${tab === "journals" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          Journal Entries ({journals.length})
        </button>
        <button
          onClick={() => setTab("exported")}
          className={`px-4 py-2 text-sm font-medium ${tab === "exported" ? "border-brand-600 text-brand-600 border-b-2" : "text-gray-500"}`}
        >
          Exported ({journals.filter((j: any) => j.status === "exported").length})
        </button>
      </div>

      {tab === "mappings" && (
        <Card>
          <CardContent className="p-0">
            {mappingsLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
              </div>
            ) : (
              <DataTable
                columns={mappingColumns}
                data={mappings}
                emptyMessage="No GL mappings configured"
              />
            )}
          </CardContent>
        </Card>
      )}

      {tab === "journals" && (
        <Card>
          <CardContent className="p-0">
            {journalsLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
              </div>
            ) : (
              <DataTable
                columns={journalColumns}
                data={journals}
                emptyMessage="No journal entries generated"
              />
            )}
          </CardContent>
        </Card>
      )}

      {tab === "exported" && (
        <Card>
          <CardContent className="p-0">
            {journalsLoading ? (
              <div className="flex h-32 items-center justify-center">
                <Loader2 className="text-brand-600 h-6 w-6 animate-spin" />
              </div>
            ) : (
              <DataTable
                columns={journalColumns}
                data={journals.filter((j: any) => j.status === "exported")}
                emptyMessage="No journals have been exported yet"
              />
            )}
          </CardContent>
        </Card>
      )}

      {/* Create Mapping Modal */}
      <Modal
        open={showCreateMapping}
        onClose={() => setShowCreateMapping(false)}
        title="Add GL Mapping"
      >
        <form onSubmit={handleCreateMapping} className="space-y-4">
          <Input
            label="Pay Component Code"
            name="payComponent"
            placeholder="e.g., BASIC, HRA, EPF, TDS"
            required
          />
          <Input label="GL Account Code" name="glAccountCode" placeholder="e.g., 4001" required />
          <Input
            label="GL Account Name"
            name="glAccountName"
            placeholder="e.g., Salary Expense"
            required
          />
          <Input label="Description" name="description" />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowCreateMapping(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Mapping
            </Button>
          </div>
        </form>
      </Modal>

      {/* Generate Journal Modal */}
      <Modal
        open={showGenerateJournal}
        onClose={() => setShowGenerateJournal(false)}
        title="Generate Journal Entry"
      >
        <form onSubmit={handleGenerateJournal} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">Payroll Run</label>
            <select
              name="payrollRunId"
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Select a payroll run...</option>
              {runs.map((r: any) => (
                <option key={r.id} value={r.id}>
                  {r.name} — {r.status} ({formatCurrency(r.total_net)})
                </option>
              ))}
            </select>
          </div>
          <p className="text-sm text-gray-500">
            This will generate journal entries from the selected payroll run using your configured
            GL mappings.
          </p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setShowGenerateJournal(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Generate
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
