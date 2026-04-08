import { useState } from "react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/SelectField";
import { Modal } from "@/components/ui/Modal";
import { formatCurrency, formatMonth } from "@/lib/utils";
import { useMyPayslips } from "@/api/hooks";
import { apiPost } from "@/api/client";
import { Download, FileText, Loader2, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";

const now = new Date();
const currentFYStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
const FY_OPTIONS = Array.from({ length: 4 }, (_, i) => {
  const y = currentFYStart - i;
  return { value: `${y}`, label: `FY ${y}-${String(y + 1).slice(-2)}` };
});

export function MyPayslipsPage() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [disputeId, setDisputeId] = useState<string | null>(null);
  const [disputing, setDisputing] = useState(false);
  const [fyStart, setFyStart] = useState(String(currentFYStart));
  const { data: res, isLoading } = useMyPayslips();
  const allPayslips = res?.data?.data || [];

  // Filter by financial year (Apr-Mar)
  const fyStartNum = Number(fyStart);
  const payslips = allPayslips.filter((ps: any) => {
    if (ps.month >= 4) return ps.year === fyStartNum;
    return ps.year === fyStartNum + 1;
  });

  const parseJSON = (val: any) => {
    if (typeof val === "string")
      try {
        return JSON.parse(val);
      } catch {
        return [];
      }
    return val || [];
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader title="My Payslips" description="View and download your payslips" />

      <div className="flex gap-3">
        <div className="w-40">
          <SelectField
            id="fy-filter"
            label=""
            value={fyStart}
            onChange={(e) => setFyStart(e.target.value)}
            options={FY_OPTIONS}
          />
        </div>
      </div>

      {payslips.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="mx-auto h-12 w-12 text-gray-300" />
            <p className="mt-4 text-gray-500">No payslips available yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {payslips.map((ps: any) => {
            const earnings = parseJSON(ps.earnings);
            const deductions = parseJSON(ps.deductions);
            return (
              <Card key={ps.id}>
                <CardContent>
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-gray-900">
                        {formatMonth(ps.month, ps.year)}
                      </h3>
                      <p className="text-sm text-gray-500">
                        Gross: {formatCurrency(ps.gross_earnings)} &middot; Net:{" "}
                        <span className="text-brand-700 font-semibold">
                          {formatCurrency(ps.net_pay)}
                        </span>
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant={ps.status}>{ps.status}</Badge>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpanded(expanded === ps.id ? null : ps.id)}
                      >
                        {expanded === ps.id ? "Hide" : "Details"}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const url = `${import.meta.env.VITE_API_URL || "/api/v1"}/payslips/${ps.id}/pdf`;
                          window.open(
                            url + `?token=${localStorage.getItem("access_token")}`,
                            "_blank",
                          );
                        }}
                      >
                        <Download className="h-4 w-4" /> PDF
                      </Button>
                      {ps.status !== "disputed" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-500 hover:text-red-700"
                          onClick={() => setDisputeId(ps.id)}
                        >
                          <AlertTriangle className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                  </div>

                  {expanded === ps.id && (
                    <div className="mt-4 grid grid-cols-1 gap-4 border-t border-gray-100 pt-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold text-green-700">Earnings</h4>
                        {earnings.map((e: any) => (
                          <div key={e.code} className="flex justify-between text-sm">
                            <span className="text-gray-500">{e.name || e.code}</span>
                            <span className="text-gray-900">{formatCurrency(e.amount)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between border-t pt-1 text-sm font-semibold">
                          <span>Total Earnings</span>
                          <span>{formatCurrency(ps.gross_earnings)}</span>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold text-red-700">Deductions</h4>
                        {deductions.map((d: any) => (
                          <div key={d.code} className="flex justify-between text-sm">
                            <span className="text-gray-500">{d.name || d.code}</span>
                            <span className="text-red-600">{formatCurrency(d.amount)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between border-t pt-1 text-sm font-semibold">
                          <span>Total Deductions</span>
                          <span className="text-red-600">
                            {formatCurrency(ps.total_deductions)}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Dispute Modal */}
      <Modal
        open={!!disputeId}
        onClose={() => setDisputeId(null)}
        title="Raise Payslip Dispute"
        className="max-w-md"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            const reason = fd.get("reason") as string;
            if (!reason.trim()) {
              toast.error("Please provide a reason");
              return;
            }
            setDisputing(true);
            try {
              await apiPost(`/payslips/${disputeId}/dispute`, { reason });
              toast.success("Dispute raised. HR will review it.");
              setDisputeId(null);
            } catch (err: any) {
              toast.error(err.response?.data?.error?.message || "Failed to raise dispute");
            } finally {
              setDisputing(false);
            }
          }}
          className="space-y-4"
        >
          <p className="text-sm text-gray-500">
            If you believe there's an error in this payslip, describe the issue below. HR will
            review and respond.
          </p>
          <textarea
            name="reason"
            rows={4}
            required
            placeholder="Describe the issue (e.g., incorrect deduction, missing allowance...)"
            className="focus:border-brand-500 focus:ring-brand-500 w-full rounded-lg border border-gray-200 p-3 text-sm focus:outline-none focus:ring-1"
          />
          <div className="flex justify-end gap-3">
            <Button variant="outline" type="button" onClick={() => setDisputeId(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={disputing} className="bg-red-600 hover:bg-red-700">
              Raise Dispute
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
