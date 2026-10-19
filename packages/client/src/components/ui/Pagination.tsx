import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./Button";
import { useTranslation } from "react-i18next";

export interface PaginationProps {
  page: number;
  totalPages: number;
  total?: number;
  limit?: number;
  onChange: (page: number) => void;
  disabled?: boolean;
}

export function Pagination({
  page,
  totalPages,
  total,
  limit,
  onChange,
  disabled,
}: PaginationProps) {
  const { t } = useTranslation();
  const safePages = Math.max(1, totalPages || 1);
  const safePage = Math.min(Math.max(1, page || 1), safePages);
  const showRange =
    total != null && limit
      ? t("pagination.range", {
          start: total === 0 ? 0 : (safePage - 1) * limit + 1,
          end: Math.min(safePage * limit, total),
          total,
        })
      : null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 px-4 py-3 text-sm dark:border-gray-700">
      <p className="text-gray-600 dark:text-gray-400">
        {showRange ? showRange : t("pagination.pageOf", { page: safePage, totalPages: safePages })}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || safePage <= 1}
          onClick={() => onChange(safePage - 1)}
          aria-label={t("pagination.previousPage")}
        >
          <ChevronLeft className="h-4 w-4" /> {t("pagination.previous")}
        </Button>
        <span className="text-xs text-gray-500">
          {safePage} / {safePages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={disabled || safePage >= safePages}
          onClick={() => onChange(safePage + 1)}
          aria-label={t("pagination.nextPage")}
        >
          {t("pagination.next")} <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
