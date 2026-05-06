import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * Compact axis-tick formatter for Recharts. BUG-018: the previous
 * `(v / 100000).toFixed(0) + "L"` rounded everything below ₹1L to "0L",
 * so a chart with values in the 5-90K range showed an axis of 0L, 0L,
 * 0L, 0L. This picks the right unit (₹ / K / L / Cr) AND the right
 * precision (1 decimal under 10 of the unit, 0 above) so adjacent
 * ticks differ.
 */
export function formatAxisAmount(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  if (abs >= 10000000) {
    const cr = value / 10000000;
    return `${cr >= 10 || cr <= -10 ? cr.toFixed(0) : cr.toFixed(1)}Cr`;
  }
  if (abs >= 100000) {
    const lk = value / 100000;
    return `${lk >= 10 || lk <= -10 ? lk.toFixed(0) : lk.toFixed(1)}L`;
  }
  if (abs >= 1000) {
    const k = value / 1000;
    return `${k >= 10 || k <= -10 ? k.toFixed(0) : k.toFixed(1)}K`;
  }
  return `${Math.round(value)}`;
}

export function formatDate(date: string | Date): string {
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(date));
}

export function formatMonth(month: number, year: number): string {
  return new Intl.DateTimeFormat("en-IN", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1));
}

export function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

export function statusColor(status: string): string {
  const map: Record<string, string> = {
    active: "bg-green-100 text-green-800",
    inactive: "bg-gray-100 text-gray-800",
    draft: "bg-yellow-100 text-yellow-800",
    processing: "bg-blue-100 text-blue-800",
    computed: "bg-purple-100 text-purple-800",
    approved: "bg-green-100 text-green-800",
    paid: "bg-green-100 text-green-800",
    cancelled: "bg-red-100 text-red-800",
    generated: "bg-blue-100 text-blue-800",
    sent: "bg-indigo-100 text-indigo-800",
    viewed: "bg-gray-100 text-gray-800",
    disputed: "bg-red-100 text-red-800",
    resolved: "bg-green-100 text-green-800",
    pending: "bg-yellow-100 text-yellow-800",
    rejected: "bg-red-100 text-red-800",
  };
  return map[status] || "bg-gray-100 text-gray-800";
}
