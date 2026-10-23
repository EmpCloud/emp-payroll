import { useState } from "react";
import { api } from "@/api/client";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { SelectField } from "@/components/ui/SelectField";
import { filsToAed, saveUaeDownload, uaeRequestError } from "@/lib/uae-payroll";
import toast from "react-hot-toast";

export interface MyUaePayslip {
  id: string;
  runId: string;
  month: number;
  year: number;
  netSalary: number;
  currency: "AED";
  paymentStatus: string;
}
export function MyUaePayslips({ payslips }: { payslips: MyUaePayslip[] }) {
  const [year, setYear] = useState("");
  const [downloading, setDownloading] = useState<string | null>(null);
  const years = [...new Set(payslips.map((item) => item.year))].sort((a, b) => b - a);
  const download = async (payslip: MyUaePayslip, print: boolean) => {
    const preview = print ? window.open("", "_blank") : null;
    if (print && !preview) {
      toast.error("Allow pop-ups to view and print, or use Download payslip.");
      return;
    }
    if (preview) preview.opener = null;
    try {
      setDownloading(payslip.id);
      const { data } = await api.get<Blob>(`/global/my-payslips/${payslip.id}`, {
        responseType: "blob",
      });
      const html = new Blob([data], { type: "text/html;charset=utf-8" });
      if (preview) {
        const url = URL.createObjectURL(html);
        preview.location.href = url;
        window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      } else saveUaeDownload(html, `uae-payslip-${payslip.year}-${payslip.month}.html`);
    } catch (error) {
      preview?.close();
      toast.error(await uaeRequestError(error));
    } finally {
      setDownloading(null);
    }
  };
  if (!payslips.length) return null;
  return (
    <section aria-label="UAE payslips" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-semibold">UAE payslips</h2>
        <SelectField
          aria-label="UAE payslip calendar year"
          options={[
            { value: "", label: "All calendar years" },
            ...years.map((item) => ({ value: String(item), label: String(item) })),
          ]}
          value={year}
          onChange={(e) => setYear(e.target.value)}
        />
      </div>
      {payslips
        .filter((item) => !year || item.year === Number(year))
        .map((payslip) => (
          <Card key={payslip.id}>
            <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
              <div>
                <h3 className="font-medium">
                  {new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(
                    new Date(payslip.year, payslip.month - 1, 1),
                  )}
                </h3>
                <p className="text-sm">
                  Net AED {filsToAed(payslip.netSalary)} ·{" "}
                  {payslip.paymentStatus || "Awaiting payment evidence"}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!downloading}
                  onClick={() => download(payslip, false)}
                >
                  Download payslip
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!!downloading}
                  onClick={() => download(payslip, true)}
                >
                  View / print
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
    </section>
  );
}
