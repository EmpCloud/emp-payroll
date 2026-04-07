import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { SelectField } from "@/components/ui/SelectField";
import { DataTable } from "@/components/ui/DataTable";
import { Modal } from "@/components/ui/Modal";
import { Card, CardContent } from "@/components/ui/Card";
import { formatCurrency, formatMonth } from "@/lib/utils";
import { apiGet } from "@/api/client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api/client";
import { Download, Eye, FileText, Loader2 } from "lucide-react";
import toast from "react-hot-toast";

const now = new Date();
const MONTHS = [
  { value: "", label: "All Months" },
  ...Array.from({ length: 12 }, (_, i) => ({
    value: String(i + 1),
    label: new Date(2026, i).toLocaleString("en-US", { month: "long" }),
  })),
];

const YEARS = Array.from({ length: 5 }, (_, i) => {
  const y = now.getFullYear() - i;
  return { value: String(y), label: String(y) };
});

export function PayslipListPage() {
  const [selected, setSelected] = useState<any | null>(null);
  const [month, setMonth] = useState("");
  const [year, setYear] = useState(String(now.getFullYear()));

  const { data: res, isLoading } = useQuery({
    queryKey: ["payslips", month, year],
    queryFn: () => {
      const params: any = { limit: 200 };
      if (month) params.month = month;
      if (year) params.year = year;
      return apiGet<any>("/payslips", params);
    },
  });

  const payslips = res?.data?.data || [];

  function openPDF(payslipId: string) {
    const url = `${import.meta.env.VITE_API_URL || "/api/v1"}/payslips/${payslipId}/pdf`;
    window.open(url + `?token=${localStorage.getItem("access_token")}`, "_blank");
  }

  const columns = [
    {
      key: "employee",
      header: "Employee",
      render: (row: any) => (
        <div>
          <p className="font-medium text-gray-900">
            {row.employee_name || row.first_name
              ? `${row.first_name} ${row.last_name}`
              : `ID: ${row.empcloud_user_id}`}
          </p>
          {(row.employee_code || row.department) && (
            <p className="text-xs text-gray-500">
              {[row.employee_code, row.department].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
      ),
    },
    {
      key: "period",
      header: "Period",
      render: (row: any) => formatMonth(row.month, row.year),
    },
    {
      key: "days",
      header: "Days",
      render: (row: any) => {
        const paid = Number(row.paid_days || 0);
        const total = Number(row.total_days || 0);
        const lop = Number(row.lop_days || 0);
        return (
          <div>
            <span>
              {paid}/{total}
            </span>
            {lop > 0 && <span className="ml-1 text-xs text-red-500">({lop} LOP)</span>}
          </div>
        );
      },
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
            onClick={(e) => {
              e.stopPropagation();
              setSelected(row);
            }}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title="View"
          >
            <Eye className="h-4 w-4" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              openPDF(row.id);
            }}
            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title="Download PDF"
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      ),
    },
  ];

  const parseJSON = (val: any) => {
    if (typeof val === "string")
      try {
        return JSON.parse(val);
      } catch {
        return [];
      }
    return val || [];
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payslips"
        description={isLoading ? "Loading..." : `${payslips.length} payslips`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                const { data } = await api.get("/payslips/export/csv", { responseType: "blob" });
                const url = URL.createObjectURL(new Blob([data]));
                const a = document.createElement("a");
                a.href = url;
                a.download = "payslips.csv";
                a.click();
                URL.revokeObjectURL(url);
                toast.success("Exported payslips CSV");
              } catch {
                toast.error("Export failed");
              }
            }}
          >
            <Download className="h-4 w-4" /> Export All
          </Button>
        }
      />

      {/* Filters */}
      <div className="flex gap-3">
        <div className="w-40">
          <SelectField
            id="month-filter"
            label=""
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            options={MONTHS}
          />
        </div>
        <div className="w-32">
          <SelectField
            id="year-filter"
            label=""
            value={year}
            onChange={(e) => setYear(e.target.value)}
            options={YEARS}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="flex h-64 items-center justify-center">
          <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={payslips}
          onRowClick={(row) => setSelected(row)}
          emptyMessage="No payslips found for the selected period"
        />
      )}

      {/* Payslip preview modal */}
      <Modal
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.employee_name || "Payslip"}` : ""}
        description={
          selected
            ? `${formatMonth(selected.month, selected.year)} — ${selected.employee_code || ""}`
            : ""
        }
        className="max-w-xl"
      >
        {selected && (
          <div className="space-y-4">
            {/* Days info */}
            {Number(selected.lop_days) > 0 && (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                Paid {selected.paid_days} of {selected.total_days} days — {selected.lop_days} LOP
                days deducted
              </div>
            )}

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

            <div className="bg-brand-50 flex items-center justify-between rounded-lg p-4">
              <span className="text-brand-900 text-lg font-bold">Net Pay</span>
              <span className="text-brand-700 text-lg font-bold">
                {formatCurrency(selected.net_pay)}
              </span>
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" size="sm" onClick={() => openPDF(selected.id)}>
                <FileText className="h-4 w-4" /> Print / Save PDF
              </Button>
              <Button size="sm" onClick={() => setSelected(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
