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
  // Each entry carries explicit dark-mode classes so the badge text stays
  // readable in dark mode. The light-only `text-*-800` colors were near-black
  // and effectively invisible on dark backgrounds (e.g. the "Previous"
  // salary-history badge).
  const map: Record<string, string> = {
    active: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    inactive: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
    draft: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
    processing: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    computed: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
    approved: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    paid: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    cancelled: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    generated: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
    sent: "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300",
    viewed: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200",
    disputed: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
    resolved: "bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300",
    pending: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300",
    rejected: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300",
  };
  return map[status] || "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
}

/**
 * Sanitize a rich-text HTML body (announcements, policies — authored in the
 * EmpCloud editor) for rendering via dangerouslySetInnerHTML. Keeps basic
 * formatting tags (p, br, b, i, u, lists, headings, links) so the content shows
 * FORMATTED, but strips scripts, embedded objects, event handlers, and every
 * `style`/`class` attribute — which is what removes the `--tw-*` inline-style
 * pollution a paste-from-Tailwind can leave on elements like <br>.
 */
export function sanitizeRichHtml(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input);
  // Remove non-content elements together with their contents.
  s = s.replace(
    /<(script|style|head|noscript|svg|iframe|object|embed|link|meta)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,
    "",
  );
  s = s.replace(/<(svg|img|iframe|object|embed|link|meta)\b[^>]*\/?>/gi, "");
  s = s.replace(/<!--[\s\S]*?-->/g, "");
  // Strip on* event handlers and class/id attributes entirely.
  s = s.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  s = s.replace(/\s+(?:class|id)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // Scrub CSS custom properties (`--tw-*`) from inline styles but KEEP real
  // declarations (font-weight, font-size, color) — matches the EmpCloud server
  // sanitizer, so bold/size authored in the editor still renders here.
  s = s.replace(/\s+style\s*=\s*(?:"([^"]*)"|'([^']*)')/gi, (_m, dq, sq) => {
    const raw = dq !== undefined ? dq : sq;
    const kept = raw
      .split(";")
      .map((d: string) => d.trim())
      .filter((d: string) => d && !d.startsWith("--"))
      .join("; ");
    return kept ? ` style="${kept}"` : "";
  });
  // Neutralize javascript:/data: URIs on any surviving href.
  s = s.replace(
    /(href)\s*=\s*(?:"[^"]*(?:javascript|data):[^"]*"|'[^']*(?:javascript|data):[^']*')/gi,
    "",
  );
  return s.trim();
}

/**
 * Announcement/notification bodies come from a rich-text editor and can carry
 * HTML — including junk like a `<br>` with a giant inline Tailwind CSS-variable
 * style attribute (see the payroll self-service dashboard, where it leaked as
 * visible text). Wherever we present that body as PLAIN text (previews, cards,
 * line-clamped summaries), run it through here first: strip tags, decode the
 * common entities, and collapse whitespace. Not for rendering rich HTML — this
 * deliberately discards markup. For FORMATTED rendering use sanitizeRichHtml.
 */
export function htmlToPlainText(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input);
  // Drop non-content blocks entirely (with their inner text/attributes).
  s = s.replace(/<(script|style|head|noscript|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Block/line-break tags become newlines so paragraphs don't run together.
  s = s.replace(/<br\s*\/?>/gi, "\n");
  s = s.replace(/<\/(p|div|tr|li|h[1-6]|table|section|header|footer|blockquote)\s*>/gi, "\n");
  // Strip every remaining tag (this is what removes `<br style="--tw-...">`).
  s = s.replace(/<[^>]*>/g, " ");
  // Decode the handful of entities a rich-text editor emits.
  const entities: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "–",
    mdash: "—",
    hellip: "…",
    rsquo: "’",
    lsquo: "‘",
    ldquo: "“",
    rdquo: "”",
  };
  s = s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z][a-z0-9]*);/gi, (m, n) => entities[n.toLowerCase()] ?? m);
  // Tidy whitespace, preserving single line breaks.
  return s
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
