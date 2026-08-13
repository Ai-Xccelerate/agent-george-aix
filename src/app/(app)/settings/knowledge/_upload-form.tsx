"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { CheckCircle2, FileText, Loader2, Upload, X, XCircle } from "lucide-react";
import type { UploadResult } from "./actions";

type Props = {
  uploadAction: (formData: FormData) => Promise<UploadResult>;
};

export function UploadForm({ uploadAction }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [isCore, setIsCore] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [pending, start] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const addFiles = (incoming: FileList | null) => {
    if (!incoming) return;
    const md = Array.from(incoming).filter((f) => /\.(md|markdown)$/i.test(f.name));
    if (md.length === 0) {
      setError("Only Markdown files (.md / .markdown) are supported.");
      return;
    }
    setError(null);
    setResult(null);
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name));
      return [...prev, ...md.filter((f) => !seen.has(f.name))];
    });
  };

  const removeFile = (name: string) =>
    setFiles((prev) => prev.filter((f) => f.name !== name));

  const onSubmit = () => {
    if (files.length === 0) {
      setError("Choose at least one .md file.");
      return;
    }
    setError(null);
    const fd = new FormData();
    for (const f of files) fd.append("files", f);
    if (isCore) fd.set("is_core", "on");
    start(async () => {
      try {
        const res = await uploadAction(fd);
        setResult(res);
        // Drop the files that succeeded; keep failures so they can be retried.
        const failedNames = new Set(res.failed.map((f) => f.name));
        setFiles((prev) => prev.filter((f) => failedNames.has(f.name)));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed.");
      }
    });
  };

  return (
    <div className="space-y-5">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed px-4 py-12 text-center transition-colors ${
          dragging
            ? "border-brand-500 dark:border-brand-400 bg-brand-50 dark:bg-brand-500/15"
            : "border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] hover:border-brand-500 dark:hover:border-brand-400"
        }`}
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-500/15 text-brand-500 dark:text-brand-400">
          <Upload size={18} />
        </div>
        <div className="text-sm font-medium text-gray-800 dark:text-white/90">
          Drop .md files here, or click to choose
        </div>
        <div className="text-theme-xs text-gray-400 dark:text-gray-500">
          Multiple files supported · up to 1 MB each · path is derived from the filename
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".md,.markdown,text/markdown"
          multiple
          hidden
          onChange={(e) => {
            addFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {files.length > 0 && (
        <div className="space-y-1.5">
          <div className="px-1 text-theme-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
            {files.length} file{files.length === 1 ? "" : "s"} ready
          </div>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800 overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03]">
            {files.map((f) => (
              <li key={f.name} className="flex items-center gap-3 px-3 py-2.5">
                <FileText size={15} className="shrink-0 text-gray-400 dark:text-gray-500" />
                <span className="min-w-0 flex-1 truncate text-theme-sm text-gray-800 dark:text-white/90">
                  {f.name}
                </span>
                <span className="shrink-0 text-theme-xs text-gray-400 dark:text-gray-500">
                  {(f.size / 1024).toFixed(1)} KB
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(f.name)}
                  className="shrink-0 rounded p-1 text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-white/[0.03] hover:text-error-500"
                  aria-label={`Remove ${f.name}`}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="flex items-start gap-3 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-3">
        <input
          type="checkbox"
          checked={isCore}
          onChange={(e) => setIsCore(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-brand-500"
        />
        <div className="text-sm">
          <div className="font-medium text-gray-800 dark:text-white/90">
            Pin all uploaded docs to the core playbook
          </div>
          <div className="text-theme-xs text-gray-500 dark:text-gray-400">
            Marks every file in this batch as <strong>core</strong> (pinned to the top of
            the manifest). A file&apos;s own <code>is_core: true</code> frontmatter also
            pins it. Leave off for supplemental references.
          </div>
        </div>
      </label>

      {error && (
        <div className="rounded-md border border-error-500 bg-error-500/10 px-3 py-2 text-theme-sm text-error-500">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-2 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-3 text-theme-sm">
          {result.created.length > 0 && (
            <div className="flex items-start gap-2 text-success-500">
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
              <div className="text-gray-800 dark:text-white/90">
                Imported {result.created.length} doc
                {result.created.length === 1 ? "" : "s"}:{" "}
                <span className="text-gray-500 dark:text-gray-400">
                  {result.created.map((d) => d.path).join(", ")}
                </span>
              </div>
            </div>
          )}
          {result.failed.map((f) => (
            <div key={f.name} className="flex items-start gap-2 text-error-500">
              <XCircle size={15} className="mt-0.5 shrink-0" />
              <div className="text-gray-800 dark:text-white/90">
                <span className="font-medium">{f.name}</span> — {f.reason}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-gray-200 dark:border-gray-800 pt-4">
        <Link
          href="/settings/knowledge"
          className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-white text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition-colors duration-150 ease-out hover:bg-gray-50 hover:text-gray-800 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:bg-white/[0.03] dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-white/90"
        >
          {result?.created.length ? "Done" : "Cancel"}
        </Link>
        <button
          type="button"
          onClick={onSubmit}
          disabled={pending || files.length === 0}
          className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900 disabled:opacity-50"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          Upload {files.length > 0 ? `${files.length} file${files.length === 1 ? "" : "s"}` : ""}
        </button>
      </div>
    </div>
  );
}
