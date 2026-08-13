"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import Select from "@/components/form/Select";
import { AngleDownIcon, AngleUpIcon, ChevronLeftIcon, TrashBinIcon } from "@/icons";

export interface Column<T> {
  key: keyof T;
  header: string;
  sortable?: boolean;
  render?: (row: T) => React.ReactNode;
}

export interface TableView<T> {
  label: string;
  filter?: (row: T) => boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  searchPlaceholder?: string;
  pageSizeOptions?: number[];
  /** Optional saved-view tabs rendered above the table. */
  views?: TableView<T>[];
  /** Row selection + bulk actions (default on). */
  selectable?: boolean;
}

type SortDirection = "asc" | "desc";

const checkbox =
  "size-4 shrink-0 cursor-pointer accent-brand-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50";

export default function DataTableOne<T extends Record<string, unknown>>({
  columns,
  data,
  searchPlaceholder = "Search...",
  pageSizeOptions = [10, 25, 50],
  views,
  selectable = true,
}: DataTableProps<T>) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<keyof T | null>(null);
  const [sortDir, setSortDir] = useState<SortDirection>("asc");
  const [pageSize, setPageSize] = useState(pageSizeOptions[0]);
  const [page, setPage] = useState(1);
  const [activeView, setActiveView] = useState(0);
  const [selected, setSelected] = useState<Set<T>>(new Set());
  const [removed, setRemoved] = useState<Set<T>>(new Set());
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [colMenu, setColMenu] = useState(false);

  const colMenuRef = useRef<HTMLDivElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const visibleColumns = columns.filter((c) => !hidden.has(String(c.key)));
  const viewFilter = views?.[activeView]?.filter;

  const filtered = useMemo(() => {
    let rows = data.filter((r) => !removed.has(r));
    if (viewFilter) rows = rows.filter(viewFilter);
    if (search.trim()) {
      const q = search.toLowerCase();
      rows = rows.filter((row) =>
        columns.some((col) =>
          String(row[col.key] ?? "")
            .toLowerCase()
            .includes(q)
        )
      );
    }
    return rows;
  }, [data, removed, search, columns, viewFilter]);

  const sorted = useMemo(() => {
    if (!sortKey) return filtered;
    const copy = [...filtered];
    copy.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      return sortDir === "asc"
        ? String(av).localeCompare(String(bv))
        : String(bv).localeCompare(String(av));
    });
    return copy;
  }, [filtered, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * pageSize;
  const pageRows = sorted.slice(start, start + pageSize);

  const toggleSort = (key: keyof T) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
    setPage(1);
  };

  // Selection (operates on the current page).
  const allPageSelected =
    pageRows.length > 0 && pageRows.every((r) => selected.has(r));
  const somePageSelected =
    pageRows.some((r) => selected.has(r)) && !allPageSelected;

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = somePageSelected;
  }, [somePageSelected]);

  useEffect(() => {
    if (!colMenu) return;
    const onDown = (e: MouseEvent) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) {
        setColMenu(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [colMenu]);

  const toggleSelectAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) pageRows.forEach((r) => next.delete(r));
      else pageRows.forEach((r) => next.add(r));
      return next;
    });
  const toggleRow = (r: T) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(r)) next.delete(r);
      else next.add(r);
      return next;
    });
  const clearSelection = () => setSelected(new Set());
  const deleteSelected = () => {
    setRemoved((prev) => new Set([...prev, ...selected]));
    setSelected(new Set());
  };
  const toggleColumn = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const selectedCount = selected.size;
  const colCount = visibleColumns.length + (selectable ? 1 : 0);

  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-white/[0.03]">
      {/* Saved-view tabs */}
      {views && views.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b border-gray-100 px-3 pt-3 dark:border-gray-800">
          {views.map((v, i) => (
            <button
              key={v.label}
              type="button"
              onClick={() => {
                setActiveView(i);
                setPage(1);
                clearSelection();
              }}
              aria-current={activeView === i ? "page" : undefined}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-500/50 ${
                activeView === i
                  ? "border-brand-500 text-brand-700 dark:text-brand-400"
                  : "border-transparent text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}

      {/* Toolbar OR contextual bulk-action bar */}
      {selectedCount > 0 ? (
        <div className="flex flex-col gap-3 border-b border-gray-100 bg-brand-50/60 px-5 py-3 dark:border-gray-800 dark:bg-brand-500/[0.08] sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm font-medium text-brand-800 dark:text-brand-300">
            {selectedCount} selected
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={clearSelection}
              className="flex h-9 items-center rounded-lg border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 transition-colors duration-150 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-white/[0.03]"
            >
              Export
            </button>
            <button
              type="button"
              onClick={deleteSelected}
              className="flex h-9 items-center gap-1.5 rounded-lg bg-error-500 px-3 text-sm font-medium text-white transition-colors duration-150 hover:bg-error-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-error-500/50"
            >
              <TrashBinIcon className="size-4" />
              Delete
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="flex h-9 items-center rounded-lg px-2 text-sm font-medium text-gray-500 transition-colors duration-150 hover:text-gray-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40 dark:text-gray-400 dark:hover:text-gray-200"
            >
              Clear
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-4 border-b border-gray-100 px-5 py-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
            <span>Show</span>
            <div className="w-[4.5rem]">
              <Select
                variant="field"
                size="sm"
                value={String(pageSize)}
                onChange={(v) => {
                  setPageSize(Number(v));
                  setPage(1);
                }}
                ariaLabel="Rows per page"
                options={pageSizeOptions.map((size) => ({
                  value: String(size),
                  label: String(size),
                }))}
              />
            </div>
            <span>entries</span>
          </div>
          <div className="flex items-center gap-2">
            {/* Column visibility */}
            <div className="relative" ref={colMenuRef}>
              <button
                type="button"
                onClick={() => setColMenu((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={colMenu}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-700 transition-colors duration-150 hover:border-gray-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-600"
              >
                <svg className="size-4" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                  <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                Columns
              </button>
              {colMenu && (
                <div
                  role="menu"
                  className="glass-popover absolute right-0 z-40 mt-2 w-52 rounded-xl border border-gray-200 p-2 shadow-theme-lg dark:border-gray-800"
                >
                  {columns.map((col) => (
                    <label
                      key={String(col.key)}
                      className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-gray-700 transition-colors duration-150 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
                    >
                      <input
                        type="checkbox"
                        className={checkbox}
                        checked={!hidden.has(String(col.key))}
                        onChange={() => toggleColumn(String(col.key))}
                      />
                      {col.header}
                    </label>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <input
                type="text"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
                placeholder={searchPlaceholder}
                className="h-9 w-full rounded-lg border border-gray-300 bg-transparent px-3 text-sm text-gray-700 transition-colors duration-150 ease-out placeholder:text-gray-500 hover:border-gray-400 focus:border-brand-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:border-gray-700 dark:text-gray-300 dark:placeholder:text-gray-500 dark:hover:border-gray-600 sm:w-56"
              />
            </div>
          </div>
        </div>
      )}

      {/* Desktop table */}
      <div className="hidden max-w-full overflow-x-auto md:block">
        <Table>
          <TableHeader className="border-b border-gray-100 dark:border-gray-800">
            <TableRow>
              {selectable && (
                <TableCell isHeader className="w-10 px-5 py-3">
                  <input
                    ref={selectAllRef}
                    type="checkbox"
                    aria-label="Select all rows on this page"
                    className={checkbox}
                    checked={allPageSelected}
                    onChange={toggleSelectAll}
                  />
                </TableCell>
              )}
              {visibleColumns.map((col) => (
                <TableCell
                  key={String(col.key)}
                  isHeader
                  className="px-5 py-3 text-left text-theme-xs font-medium text-gray-500 dark:text-gray-400"
                >
                  {col.sortable ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(col.key)}
                      className="-mx-1 flex items-center gap-1 rounded-lg px-1 font-medium text-gray-500 transition-colors duration-150 ease-out hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                      {col.header}
                      <span className="flex flex-col">
                        <AngleUpIcon
                          className={`h-2 w-2 ${
                            sortKey === col.key && sortDir === "asc"
                              ? "text-brand-500"
                              : "text-gray-400 dark:text-gray-600"
                          }`}
                        />
                        <AngleDownIcon
                          className={`h-2 w-2 ${
                            sortKey === col.key && sortDir === "desc"
                              ? "text-brand-500"
                              : "text-gray-400 dark:text-gray-600"
                          }`}
                        />
                      </span>
                    </button>
                  ) : (
                    col.header
                  )}
                </TableCell>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody className="divide-y divide-gray-100 dark:divide-gray-800">
            {pageRows.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={colCount}
                  className="px-5 py-12 text-center text-sm text-gray-500 dark:text-gray-400"
                >
                  No matching records found
                </TableCell>
              </TableRow>
            ) : (
              pageRows.map((row, i) => {
                const isSel = selected.has(row);
                return (
                  <TableRow
                    key={i}
                    className={`transition-colors duration-150 ease-out ${
                      isSel
                        ? "bg-brand-50/50 dark:bg-brand-500/[0.06]"
                        : "hover:bg-gray-50 dark:hover:bg-white/[0.02]"
                    }`}
                  >
                    {selectable && (
                      <TableCell className="w-10 px-5 py-4">
                        <input
                          type="checkbox"
                          aria-label="Select row"
                          className={checkbox}
                          checked={isSel}
                          onChange={() => toggleRow(row)}
                        />
                      </TableCell>
                    )}
                    {visibleColumns.map((col) => (
                      <TableCell
                        key={String(col.key)}
                        className="px-5 py-4 text-theme-sm text-gray-700 dark:text-gray-300"
                      >
                        {col.render ? col.render(row) : String(row[col.key] ?? "")}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: each row as a stacked card — no horizontal scroll. */}
      <div className="divide-y divide-gray-100 md:hidden dark:divide-gray-800">
        {pageRows.length === 0 ? (
          <p className="px-5 py-12 text-center text-sm text-gray-500 dark:text-gray-400">
            No matching records found
          </p>
        ) : (
          pageRows.map((row, i) => (
            <div key={i} className="flex items-start gap-3 px-5 py-4">
              {selectable && (
                <input
                  type="checkbox"
                  aria-label="Select row"
                  className={`${checkbox} mt-0.5`}
                  checked={selected.has(row)}
                  onChange={() => toggleRow(row)}
                />
              )}
              <div className="min-w-0 flex-1">
                <div className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
                  {visibleColumns[0].render
                    ? visibleColumns[0].render(row)
                    : String(row[visibleColumns[0].key] ?? "")}
                </div>
                <dl className="mt-2 space-y-1.5">
                  {visibleColumns.slice(1).map((col) => (
                    <div
                      key={String(col.key)}
                      className="flex items-start justify-between gap-3"
                    >
                      <dt className="text-theme-xs text-gray-500 dark:text-gray-400">
                        {col.header}
                      </dt>
                      <dd className="text-right text-theme-sm text-gray-700 dark:text-gray-300">
                        {col.render ? col.render(row) : String(row[col.key] ?? "")}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex flex-col gap-4 border-t border-gray-100 px-5 py-4 dark:border-gray-800 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Showing {sorted.length === 0 ? 0 : start + 1} to{" "}
          {Math.min(start + pageSize, sorted.length)} of {sorted.length} entries
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="flex h-9 items-center gap-1 rounded-lg border border-gray-300 px-3 text-sm text-gray-700 transition-colors duration-150 ease-out hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03] dark:focus-visible:ring-offset-gray-900 dark:active:bg-white/[0.06]"
          >
            <ChevronLeftIcon className="h-4 w-4" />
            Prev
          </button>
          {Array.from({ length: totalPages }, (_, i) => i + 1)
            .filter(
              (p) => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1
            )
            .map((p, idx, arr) => (
              <React.Fragment key={p}>
                {idx > 0 && arr[idx - 1] !== p - 1 && (
                  <span className="px-1 text-gray-500 dark:text-gray-400">…</span>
                )}
                <button
                  type="button"
                  onClick={() => setPage(p)}
                  aria-current={p === currentPage ? "page" : undefined}
                  className={`flex h-9 w-9 items-center justify-center rounded-lg text-sm transition-colors duration-150 ease-out focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-gray-900 ${
                    p === currentPage
                      ? "bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700"
                      : "border border-gray-300 text-gray-700 hover:bg-gray-50 active:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03] dark:active:bg-white/[0.06]"
                  }`}
                >
                  {p}
                </button>
              </React.Fragment>
            ))}
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="flex h-9 items-center gap-1 rounded-lg border border-gray-300 px-3 text-sm text-gray-700 transition-colors duration-150 ease-out hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white active:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent dark:border-gray-700 dark:text-gray-300 dark:hover:bg-white/[0.03] dark:focus-visible:ring-offset-gray-900 dark:active:bg-white/[0.06]"
          >
            Next
            <ChevronLeftIcon className="h-4 w-4 rotate-180" />
          </button>
        </div>
      </div>
    </div>
  );
}
