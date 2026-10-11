"use client";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "./ui/button";

export function ResultPagination({
  count,
  page,
  pageSize,
  onPage,
  onPageSize,
}: {
  count: number;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / pageSize));
  return (
    <div className="result-pagination">
      <p role="status">
        {count
          ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, count)} of ${count} results`
          : "0 results"}
      </p>
      <label>
        Rows{" "}
        <select
          className="native-select"
          aria-label="Rows per page"
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
        >
          {[10, 25, 50].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
      <nav aria-label="Results pagination">
        <Button
          variant="outline"
          size="icon"
          aria-label="Previous page"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft size={16} />
        </Button>
        <span>
          Page {page} of {pages}
        </span>
        <Button
          variant="outline"
          size="icon"
          aria-label="Next page"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
        >
          <ChevronRight size={16} />
        </Button>
      </nav>
    </div>
  );
}
export function FilterChip({
  label,
  clear,
}: {
  label: string;
  clear: () => void;
}) {
  return (
    <button
      className="filter-chip"
      onClick={clear}
      aria-label={`Remove filter: ${label}`}
    >
      {label}
      <X size={13} aria-hidden="true" />
    </button>
  );
}
