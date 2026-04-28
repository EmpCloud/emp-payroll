import { PageHeader } from "@/components/ui/PageHeader";
import { Card, CardHeader, CardContent, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { formatCurrency } from "@/lib/utils";
import { useMySalary } from "@/api/hooks";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Loader2 } from "lucide-react";

const COLORS = ["#6366F1", "#818CF8", "#A5B4FC", "#C7D2FE", "#E0E7FF"];

export function MySalaryPage() {
  const { data: res, isLoading } = useMySalary();

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="text-brand-600 h-8 w-8 animate-spin" />
      </div>
    );
  }

  const salary = res?.data;
  if (!salary) return <div className="p-8 text-gray-500">No salary information available</div>;

  const components =
    typeof salary.components === "string" ? JSON.parse(salary.components) : salary.components || [];
  const pieData = components.map((c: any, i: number) => ({
    name:
      c.code === "BASIC"
        ? "Basic Salary"
        : c.code === "HRA"
          ? "HRA"
          : c.code === "SA"
            ? "Special Allowance"
            : c.code,
    value: c.monthlyAmount,
    color: COLORS[i % COLORS.length],
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="My Salary" description="Your CTC breakdown and salary structure" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Annual Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3">
              {(() => {
                // CTC is the configured contractual figure (set by HR on the
                // salary structure). The annualised sum of components is what
                // the payroll engine derives after rounding each monthly
                // component to whole rupees, then × 12 — the two won't match
                // exactly when the resolver applies rounding. QA reported
                // ₹12,23,00,000 vs ₹12,22,78,404 (#7).
                //
                // Show both as distinct labelled lines so users understand
                // which is the source of truth (the configured CTC) and
                // which is the derived figure. Surface the delta inline if
                // it's non-trivial to avoid the silent "off by ~₹21k"
                // mystery the QA flagged.
                const ctc = Number(salary.ctc) || 0;
                const componentsAnnual = components.reduce(
                  (sum: number, c: any) => sum + Number(c.annualAmount || 0),
                  0,
                );
                const grossAnnual = Number(salary.gross_salary) || componentsAnnual;
                const delta = ctc - componentsAnnual;
                const showDelta = Math.abs(delta) >= 1;
                return (
                  <>
                    <div className="flex justify-between text-sm">
                      <dt className="text-gray-500">Annual CTC (configured)</dt>
                      <dd className="font-medium text-gray-900">{formatCurrency(ctc)}</dd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <dt className="text-gray-500">Annual gross from components</dt>
                      <dd className="font-medium text-gray-900">
                        {formatCurrency(componentsAnnual)}
                      </dd>
                    </div>
                    {showDelta && (
                      <p className="text-xs leading-snug text-gray-400">
                        Small differences between configured CTC and the sum of components are
                        expected — components are rounded to whole rupees per month before being
                        annualised.
                      </p>
                    )}
                    {grossAnnual !== componentsAnnual && (
                      <div className="flex justify-between text-sm">
                        <dt className="text-gray-500">Gross Salary (Annual)</dt>
                        <dd className="font-medium text-gray-900">{formatCurrency(grossAnnual)}</dd>
                      </div>
                    )}
                    {components.map((c: any) => (
                      <div key={c.code} className="flex justify-between text-sm">
                        <dt className="text-gray-500">
                          {`Monthly ${c.code === "BASIC" ? "Basic" : c.code === "HRA" ? "HRA" : c.code}`}
                        </dt>
                        <dd className="font-medium text-gray-900">
                          {formatCurrency(c.monthlyAmount)}
                        </dd>
                      </div>
                    ))}
                  </>
                );
              })()}
            </dl>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Monthly Salary Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-8">
              <div className="h-56 w-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    {/* activeIndex=-1 disables recharts' default click-active
                        sector, which was rendering an extra translucent
                        rectangle behind the slice when clicked (#211).
                        isAnimationActive=false also keeps the chart
                        from briefly resizing on rerender. */}
                    <Pie
                      data={pieData}
                      dataKey="value"
                      cx="50%"
                      cy="50%"
                      innerRadius={50}
                      outerRadius={80}
                      activeIndex={-1}
                      isAnimationActive={false}
                    >
                      {pieData.map((entry: any, i: number) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(v: number) => formatCurrency(v)}
                      cursor={false}
                      contentStyle={{
                        borderRadius: 8,
                        border: "1px solid rgb(229 231 235)",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2">
                {pieData.map((item: any) => (
                  <div key={item.name} className="flex items-center gap-2 text-sm">
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: item.color }}
                    />
                    <span className="text-gray-600">{item.name}</span>
                    <span className="ml-auto font-medium">{formatCurrency(item.value)}</span>
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Salary Components</CardTitle>
            <Badge variant="active">Effective from {salary.effective_from?.slice(0, 10)}</Badge>
          </div>
        </CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="pb-2 font-medium text-gray-500">Component</th>
                <th className="pb-2 text-right font-medium text-gray-500">Monthly</th>
                <th className="pb-2 text-right font-medium text-gray-500">Annual</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {components.map((c: any) => (
                <tr key={c.code}>
                  <td className="py-2 text-gray-900">
                    {c.code === "BASIC"
                      ? "Basic Salary"
                      : c.code === "HRA"
                        ? "HRA"
                        : c.code === "SA"
                          ? "Special Allowance"
                          : c.code}
                  </td>
                  <td className="py-2 text-right text-gray-900">
                    {formatCurrency(c.monthlyAmount)}
                  </td>
                  <td className="py-2 text-right text-gray-900">
                    {formatCurrency(c.annualAmount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
