import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UaeGratuityLiabilityResult } from "@emp-payroll/shared";
import { apiGet } from "@/api/client";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { filsToAed } from "@/lib/uae-payroll";

const COLUMNS = [
  ["openingAccruedLiability", "Opening liability"],
  ["closingAccruedLiability", "Closing liability"],
  ["serviceAccrual", "Service accrual"],
  ["salaryRevaluation", "Salary revaluation"],
  ["accrualExpense", "Accrual expense"],
  ["settlementsPaid", "Settlements paid"],
  ["netMovement", "Net movement"],
  ["employerSavingsContributions", "Employer savings"],
] as const;
type LiabilityKey = (typeof COLUMNS)[number][0];
interface Report {
  month: number;
  year: number;
  items: (UaeGratuityLiabilityResult & { employeeId: string; employeeName: string })[];
  totals: Record<LiabilityKey, number | null>;
  warnings: string[];
}
export function UaeGratuityReport() {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState(
    `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
  );
  const [year, month] = period.split("-").map(Number);
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ["uae-gratuity-liability", period],
    queryFn: () => apiGet<Report>("/global/uae/gratuity-liability", { month, year }),
    enabled: open && !!month && !!year,
  });
  const report = data?.data;
  const display = (value: number | null | undefined) =>
    value == null ? "Needs review" : filsToAed(value);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        UAE gratuity liability
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="Monthly UAE gratuity liability"
        className="max-w-7xl"
      >
        <div className="space-y-4">
          <Input
            label="Reporting month"
            aria-label="Gratuity liability reporting month"
            type="month"
            min="2026-06"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
          />
          <p className="text-sm text-gray-500">
            Amounts are AED. The report separates retained gratuity liability, vested termination
            benefits and employer savings contributions. Missing service or settlement history
            requires review and is not treated as zero. Each employee needs a verified opening
            history dated exactly the previous month-end in their UAE profile.
          </p>
          {isFetching && <p role="status">Loading liability report…</p>}
          {error && (
            <div role="alert" className="space-y-2 text-sm text-amber-800">
              <p>Unable to load the liability report.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          )}
          {report && (
            <>
              {report.warnings?.map((warning, index) => (
                <p key={index} className="rounded bg-amber-50 p-3 text-sm text-amber-900">
                  {warning}
                </p>
              ))}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr>
                      <th className="p-2">Employee</th>
                      {COLUMNS.map(([key, label]) => (
                        <th key={key} className="p-2 text-right">
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {report.items.map((item) => (
                      <tr key={item.employeeId} className="border-t align-top">
                        <td className="min-w-48 p-2">
                          <p className="font-medium">{item.employeeName}</p>
                          <p>{item.status === "calculated" ? "Calculated" : "Needs review"}</p>
                          <p className="mt-1">
                            Vested: {display(item.openingVestedAmount)} →{" "}
                            {display(item.closingVestedAmount)}
                          </p>
                          {item.warnings.map((warning, index) => (
                            <p key={index} className="mt-1 text-amber-800">
                              {warning}
                            </p>
                          ))}
                        </td>
                        {COLUMNS.map(([key]) => (
                          <td key={key} className="whitespace-nowrap p-2 text-right font-mono">
                            {display(item[key])}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {report.items.length === 0 && (
                      <tr>
                        <td colSpan={COLUMNS.length + 1} className="p-4 text-center text-gray-500">
                          No UAE employees in this reporting period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  {report.totals && (
                    <tfoot>
                      <tr className="border-t font-semibold">
                        <td className="p-2">Report totals</td>
                        {COLUMNS.map(([key]) => (
                          <td key={key} className="whitespace-nowrap p-2 text-right font-mono">
                            {display(report.totals[key])}
                          </td>
                        ))}
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
