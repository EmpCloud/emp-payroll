import { useState } from "react";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => React.ReactNode;
  className?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  onRowClick?: (row: T) => void;
  emptyMessage?: string;
  pageSize?: number;
  /** Total count from server — enables server-side pagination display */
  serverTotal?: number;
  serverPage?: number;
  onPageChange?: (page: number) => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  onRowClick,
  emptyMessage = "No data found",
  pageSize = 10,
  serverTotal,
  serverPage,
  onPageChange,
}: DataTableProps<T>) {
  const [localPage, setLocalPage] = useState(1);

  // Client-side pagination when no server pagination
  const isServerPaginated = serverTotal !== undefined && onPageChange !== undefined;
  const currentPage = isServerPaginated ? (serverPage || 1) : localPage;
  const totalItems = isServerPaginated ? serverTotal : data.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const showPagination = totalItems > pageSize;

  const displayData = isServerPaginated
    ? data
    : data.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function goTo(page: number) {
    const p = Math.max(1, Math.min(page, totalPages));
    if (isServerPaginated) {
      onPageChange!(p);
    } else {
      setLocalPage(p);
    }
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            {columns.map((col) => (
              <th key={col.key} className={cn("px-6 py-3 font-medium text-gray-500", col.className)}>
                {col.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {displayData.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-6 py-12 text-center text-gray-400">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            displayData.map((row, i) => (
              <tr
                key={i}
                onClick={() => onRowClick?.(row)}
                className={cn(
                  "transition-colors hover:bg-gray-50",
                  onRowClick && "cursor-pointer",
                )}
              >
                {columns.map((col) => (
                  <td key={col.key} className={cn("px-6 py-4 text-gray-700", col.className)}>
                    {col.render ? col.render(row) : String(row[col.key] ?? "")}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>

      {showPagination && (
        <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-6 py-3">
          <p className="text-sm text-gray-500">
            Showing {(currentPage - 1) * pageSize + 1}–{Math.min(currentPage * pageSize, totalItems)} of {totalItems}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => goTo(currentPage - 1)}
              disabled={currentPage <= 1}
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-200 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
              let page: number;
              if (totalPages <= 5) {
                page = i + 1;
              } else if (currentPage <= 3) {
                page = i + 1;
              } else if (currentPage >= totalPages - 2) {
                page = totalPages - 4 + i;
              } else {
                page = currentPage - 2 + i;
              }
              return (
                <button
                  key={page}
                  onClick={() => goTo(page)}
                  className={cn(
                    "h-8 w-8 rounded-lg text-sm font-medium",
                    page === currentPage
                      ? "bg-brand-600 text-white"
                      : "text-gray-600 hover:bg-gray-200"
                  )}
                >
                  {page}
                </button>
              );
            })}
            <button
              onClick={() => goTo(currentPage + 1)}
              disabled={currentPage >= totalPages}
              className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-200 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
