import type { LucideIcon } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: LucideIcon;
  trend?: { value: string; positive: boolean };
  className?: string;
  /** When set, the whole card becomes a react-router Link to this path. */
  to?: string;
  /** When set (and `to` is not), the card is a button with this handler. */
  onClick?: () => void;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  className,
  to,
  onClick,
}: StatCardProps) {
  const valueStr = typeof value === "string" ? value : String(value);

  // Layout guards for currency-heavy cards:
  // #136 — min-w-0 flex-1 on text column + shrink-0 on icon so big
  //        amounts can't push the icon outside the card.
  // #144/#145/#146 — truncation was clipping real payroll amounts (e.g.
  //        `-₹1,17,78...`, `₹12,23,0...`). Dropping the `truncate` class
  //        and scaling the font down for long strings keeps the full
  //        value readable at a glance. Tooltip via `title=` is preserved
  //        so hover reveals the exact value without reflow.
  const longValue = valueStr.length >= 10;
  const valueClass = longValue ? "text-lg" : "text-2xl";
  const body = (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium text-gray-500">{title}</p>
        <p className={cn("break-words font-bold text-gray-900", valueClass)} title={valueStr}>
          {value}
        </p>
        {subtitle && <p className="truncate text-sm text-gray-500">{subtitle}</p>}
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
  );

  // Cards clickable (#84 #85 #89 #91 #92 #96 #105 etc) — when `to` or
  // `onClick` is provided, render as an interactive element with a subtle
  // hover cue. focus-visible rings only (never persist after mouse click).
  // h-full keeps siblings the same height when one card has a short value
  // and another has a subtitle / longer string in the same grid row
  // (#229 Tax 'Total Employees', #232 Loans cards).
  const cardBase = "h-full rounded-xl border border-gray-200 bg-white p-6 shadow-sm transition";
  const interactive =
    "hover:-translate-y-0.5 hover:border-brand-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500";

  if (to) {
    return (
      <Link to={to} className={cn("block", cardBase, interactive, className)}>
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn("w-full text-left", cardBase, interactive, className)}
      >
        {body}
      </button>
    );
  }
  return <div className={cn(cardBase, className)}>{body}</div>;
}
