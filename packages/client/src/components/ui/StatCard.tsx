import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: string; positive: boolean };
  className?: string;
}

export function StatCard({ title, value, subtitle, icon: Icon, trend, className }: StatCardProps) {
  const valueStr = typeof value === "string" ? value : String(value);
  return (
    <div className={cn("rounded-xl border border-gray-200 bg-white p-6 shadow-sm", className)}>
<<<<<<< HEAD
      {/* Layout guards for currency-heavy cards:
          #136 — min-w-0 flex-1 on text column + shrink-0 on icon so big
                 amounts can't push the icon outside the card.
          #129 — truncate (not wrap) so the minus sign and the currency
                 glyph stay on the same line; tooltip exposes the full
                 value when it doesn't fit. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="truncate text-2xl font-bold text-gray-900" title={valueStr}>
            {value}
          </p>
          {subtitle && <p className="truncate text-sm text-gray-500">{subtitle}</p>}
=======
      {/* Layout guards for currency-heavy cards:
          #136 — min-w-0 flex-1 on text column + shrink-0 on icon so big
                 amounts can't push the icon outside the card.
          #129 — truncate (not wrap) so the minus sign and the currency
                 glyph stay on the same line; tooltip exposes the full
                 value when it doesn't fit. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="truncate text-2xl font-bold text-gray-900" title={valueStr}>
            {value}
          </p>
          {subtitle && <p className="truncate text-sm text-gray-500">{subtitle}</p>}
>>>>>>> 8114680 (fix(statcard): no-wrap currency values, keep icon inside card (#136 #129))
          {trend && (
            <p
              className={cn(
                "text-sm font-medium",
                trend.positive ? "text-green-600" : "text-red-600",
              )}
            >
              {trend.positive ? "+" : ""}
              {trend.value}
            </p>
          )}
        </div>
        <div className="bg-brand-50 shrink-0 rounded-lg p-3">
          <Icon className="text-brand-600 h-6 w-6" />
        </div>
      </div>
    </div>
  );
}
