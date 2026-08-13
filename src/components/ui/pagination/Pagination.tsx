"use client";

import React from "react";
import { ChevronLeftIcon } from "@/icons";

interface PaginationProps {
  currentPage: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  showPrevNext?: boolean;
  variant?: "default" | "compact";
}

const Pagination: React.FC<PaginationProps> = ({
  currentPage,
  totalPages,
  onPageChange,
  showPrevNext = true,
  variant = "default",
}) => {
  const goTo = (page: number) => {
    if (page < 1 || page > totalPages || page === currentPage) return;
    onPageChange(page);
  };

  const prevNextBtn =
    "flex h-9 items-center gap-1 rounded-lg border border-gray-300 px-3 text-sm text-gray-700 transition-colors duration-150 ease-out hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:cursor-not-allowed disabled:opacity-40 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03] dark:focus-visible:ring-offset-gray-900";

  if (variant === "compact") {
    return (
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => goTo(currentPage - 1)}
          disabled={currentPage === 1}
          className={prevNextBtn}
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Prev
        </button>
        <span className="px-2 text-sm text-gray-500 dark:text-gray-400">
          Page {currentPage} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => goTo(currentPage + 1)}
          disabled={currentPage === totalPages}
          className={prevNextBtn}
        >
          Next
          <ChevronLeftIcon className="h-4 w-4 rotate-180" />
        </button>
      </div>
    );
  }

  const pages = Array.from({ length: totalPages }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1
  );

  return (
    <div className="flex items-center gap-2">
      {showPrevNext && (
        <button
          type="button"
          onClick={() => goTo(currentPage - 1)}
          disabled={currentPage === 1}
          className={prevNextBtn}
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Prev
        </button>
      )}
      {pages.map((p, idx, arr) => (
        <React.Fragment key={p}>
          {idx > 0 && arr[idx - 1] !== p - 1 && (
            <span className="px-1 text-gray-500 dark:text-gray-400">…</span>
          )}
          <button
            type="button"
            onClick={() => goTo(p)}
            className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm transition-colors duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900 ${
              p === currentPage
                ? "bg-brand-500 text-white"
                : "border border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03]"
            }`}
          >
            {p}
          </button>
        </React.Fragment>
      ))}
      {showPrevNext && (
        <button
          type="button"
          onClick={() => goTo(currentPage + 1)}
          disabled={currentPage === totalPages}
          className={prevNextBtn}
        >
          Next
          <ChevronLeftIcon className="h-4 w-4 rotate-180" />
        </button>
      )}
    </div>
  );
};

export default Pagination;
