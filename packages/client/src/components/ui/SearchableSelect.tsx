import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SearchableOption {
  value: string;
  label: string;
  /** Optional secondary line shown under the label (e.g. designation). */
  sublabel?: string;
}

interface SearchableSelectProps {
  options: SearchableOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
  /** Allow clearing the current selection back to empty. */
  clearable?: boolean;
}

/**
 * A single-select dropdown with a type-to-filter search box — a drop-in
 * replacement for a native `<select>` when the option list is long enough that
 * scrolling it is painful (employee pickers, etc.). Keyboard accessible
 * (↑/↓/Enter/Escape), closes on outside-click, and themed for light + dark.
 */
export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No matches found",
  disabled = false,
  className,
  clearable = true,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listboxId = useId();

  const selected = options.find((o) => o.value === value) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.sublabel ? o.sublabel.toLowerCase().includes(q) : false),
    );
  }, [options, query]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // When opening, focus the search box and reset the highlight to the current
  // selection (or the top of the list).
  useEffect(() => {
    if (open) {
      setQuery("");
      const idx = selected ? options.findIndex((o) => o.value === selected.value) : 0;
      setActiveIndex(idx < 0 ? 0 : idx);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Keep the highlighted row scrolled into view.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${activeIndex}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function commit(idx: number) {
    const opt = filtered[idx];
    if (!opt) return;
    onChange(opt.value);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ")) {
      e.preventDefault();
      setOpen(true);
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(activeIndex);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
          "border-gray-300 bg-white text-gray-900 hover:border-gray-400",
          "dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:hover:border-gray-600",
          "focus:ring-brand-500/60 focus:border-brand-500 focus:outline-none focus:ring-2",
          disabled && "cursor-not-allowed opacity-60",
        )}
      >
        <span className={cn("truncate", !selected && "text-gray-400 dark:text-gray-500")}>
          {selected ? selected.label : placeholder}
        </span>
        <span className="flex items-center gap-1">
          {clearable && selected && !disabled && (
            <X
              className="h-4 w-4 shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
            />
          )}
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-gray-400" />
        </span>
      </button>

      {/* Popover */}
      {open && (
        <div
          className={cn(
            "absolute z-30 mt-1 w-full overflow-hidden rounded-lg border shadow-lg",
            "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900",
          )}
        >
          <div className="flex items-center gap-2 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
            <Search className="h-4 w-4 shrink-0 text-gray-400" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-gray-100"
            />
          </div>
          <ul ref={listRef} id={listboxId} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <li className="px-3 py-6 text-center text-sm text-gray-400 dark:text-gray-500">
                {emptyText}
              </li>
            ) : (
              filtered.map((opt, idx) => {
                const isSelected = opt.value === value;
                const isActive = idx === activeIndex;
                return (
                  <li
                    key={opt.value}
                    data-idx={idx}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIndex(idx)}
                    onClick={() => commit(idx)}
                    className={cn(
                      "flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm",
                      isActive
                        ? "bg-brand-50 dark:bg-brand-950/40"
                        : "hover:bg-gray-50 dark:hover:bg-gray-800/60",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-gray-900 dark:text-gray-100">{opt.label}</p>
                      {opt.sublabel && (
                        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
                          {opt.sublabel}
                        </p>
                      )}
                    </div>
                    {isSelected && (
                      <Check className="text-brand-600 dark:text-brand-400 h-4 w-4 shrink-0" />
                    )}
                  </li>
                );
              })
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

export default SearchableSelect;
