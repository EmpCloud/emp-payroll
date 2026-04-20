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
  return (
    <div className={cn("rounded-xl border border-gray-200 bg-white p-6 shadow-sm", className)}>
      {/* #136 — min-w-0 on text column + shrink-0 on icon so large currency
          values don't push the icon out of the card. break-words lets the
          amount wrap to a second line instead of overflowing. */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-gray-500">{title}</p>
          <p className="break-words text-2xl font-bold text-gray-900">{value}</p>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
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
