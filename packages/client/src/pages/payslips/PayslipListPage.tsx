import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Card, CardContent } from "@/components/ui/Card";
import { formatCurrency, formatMonth } from "@/lib/utils";
import { usePayslips } from "@/api/hooks";
import { api } from "@/api/client";
import { Download, Eye, FileText, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

export function PayslipListPage() {
  const [selected, setSelected] = useState<any | null>(null);
  const { data: res, isLoading } = usePayslips({ limit: 100 });

  const payslips = res?.data?.data || [];

  const columns = [
    {
      key: "employee",
      header: "Employee",
      render: (row: any) => (
        <div>
          <p className="font-medium text-gray-900">{row.employee_id?.slice(0, 8)}...</p>
        </div>
      ),
    },
    {
      key: "period",
      header: "Period",
      render: (row: any) => formatMonth(row.month, row.year),
    },
    {
      key: "gross",
      header: "Gross",
      render: (row: any) => formatCurrency(row.gross_earnings),
    },
    {
      key: "total_deductions",
      header: "Deductions",
      render: (row: any) => formatCurrency(row.total_deductions),
    },
    {
      key: "net_pay",
      header: "Net Pay",
      render: (row: any) => (
        <span className="font-semibold text-gray-900">{formatCurrency(row.net_pay)}</span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row: any) => <Badge variant={row.status}>{row.status}</Badge>,
    },
    {
      key: "actions",
      header: "",
      render: (row: any) => (
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => { e.stopPropagation(); setSelected(row); }}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => e.stopPropagation()}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  const parseJSON = (val: any) => {
    if (typeof val === "string") try { return JSON.parse(val); } catch { return []; }
    return val || [];
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payslips"
        description={isLoading ? "Loading..." : `${payslips.length} payslips`}
        actions={
          <Button variant="outline" size="sm" onClick={async () => {
            try {
              const { data } = await api.get("/payslips/export/csv", { responseType: "blob" });
              const url = URL.createObjectURL(new Blob([data]));
              const a = document.createElement("a"); a.href = url; a.download = "payslips.csv"; a.click();
              URL.revokeObjectURL(url);
              toast.success("Exported payslips CSV");
            } catch { toast.error("Export failed"); }
          }}>
            <Download className="h-4 w-4" /> Export All
          </Button>
        }
      />

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-brand-600" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={payslips}
          onRowClick={(row) => setSelected(row)}
        />
      )}

      {/* Payslip preview modal */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `Payslip` : ""}
        description={selected ? formatMonth(selected.month, selected.year) : ""}
        className="max-w-xl"
      >
        {selected && (
          <div className="space-y-4">
            <Card>
              <CardContent className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-900">Earnings</h4>
                {parseJSON(selected.earnings).map((e: any) => (
                  <div key={e.code} className="flex justify-between text-sm">
                    <span className="text-gray-500">{e.name || e.code}</span>
                    <span className="text-gray-900">{formatCurrency(e.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-gray-100 pt-2 text-sm font-semibold">
                  <span>Gross Pay</span>
                  <span>{formatCurrency(selected.gross_earnings)}</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-2">
                <h4 className="text-sm font-semibold text-gray-900">Deductions</h4>
                {parseJSON(selected.deductions).map((d: any) => (
                  <div key={d.code} className="flex justify-between text-sm">
                    <span className="text-gray-500">{d.name || d.code}</span>
                    <span className="text-red-600">-{formatCurrency(d.amount)}</span>
                  </div>
                ))}
                <div className="flex justify-between border-t border-gray-100 pt-2 text-sm font-semibold">
                  <span>Total Deductions</span>
                  <span className="text-red-600">-{formatCurrency(selected.total_deductions)}</span>
                </div>
              </CardContent>
            </Card>

            <div className="flex items-center justify-between rounded-lg bg-brand-50 p-4">
              <span className="text-lg font-bold text-brand-900">Net Pay</span>
              <span className="text-lg font-bold text-brand-700">{formatCurrency(selected.net_pay)}</span>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => {
                const url = `${import.meta.env.VITE_API_URL || "/api/v1"}/payslips/${selected.id}/pdf`;
                window.open(url + `?token=${localStorage.getItem("access_token")}`, "_blank");
              }}>
                <FileText className="h-4 w-4" /> Download PDF
              </Button>
              <Button size="sm" onClick={() => setSelected(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
