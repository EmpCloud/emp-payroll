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
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-brand-600" /></div>;
  }

  const salary = res?.data;
  if (!salary) return <div className="p-8 text-gray-500">No salary information available</div>;

  const components = typeof salary.components === "string" ? JSON.parse(salary.components) : salary.components || [];
  const pieData = components.map((c: any, i: number) => ({
    name: c.code === "BASIC" ? "Basic Salary" : c.code === "HRA" ? "HRA" : c.code === "SA" ? "Special Allowance" : c.code,
    value: c.monthlyAmount,
    color: COLORS[i % COLORS.length],
  }));

  return (
    <div className="space-y-6">
      <PageHeader title="My Salary" description="Your CTC breakdown and salary structure" />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Annual Summary</CardTitle></CardHeader>
          <CardContent>
            <dl className="space-y-3">
              {[
                ["Annual CTC", Number(salary.ctc)],
                ["Gross Salary (Annual)", Number(salary.gross_salary)],
                ...components.map((c: any) => [
                  `Monthly ${c.code === "BASIC" ? "Basic" : c.code === "HRA" ? "HRA" : c.code}`,
                  c.monthlyAmount,
                ]),
              ].map(([label, val]: any) => (
                <div key={label} className="flex justify-between text-sm">
                  <dt className="text-gray-500">{label}</dt>
                  <dd className="font-medium text-gray-900">{formatCurrency(val)}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Monthly Salary Breakdown</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-8">
              <div className="h-56 w-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={50} outerRadius={80}>
                      {pieData.map((entry: any, i: number) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v: number) => formatCurrency(v)} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2">
                {pieData.map((item: any) => (
                  <div key={item.name} className="flex items-center gap-2 text-sm">
                    <span className="h-3 w-3 rounded-full" style={{ backgroundColor: item.color }} />
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
                  <td className="py-2 text-gray-900">{c.code === "BASIC" ? "Basic Salary" : c.code === "HRA" ? "HRA" : c.code === "SA" ? "Special Allowance" : c.code}</td>
                  <td className="py-2 text-right text-gray-900">{formatCurrency(c.monthlyAmount)}</td>
                  <td className="py-2 text-right text-gray-900">{formatCurrency(c.annualAmount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
