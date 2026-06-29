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
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[12px] border-2 border-dashed px-4 py-12 text-center transition-colors ${
          dragging
            ? "border-[var(--color-accent)] bg-[var(--color-accent-light)]"
            : "border-[var(--color-border)] bg-[var(--color-surface-card)] hover:border-[var(--color-accent)]"
        }`}
      >
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--color-accent-light)] text-[var(--color-accent)]">
          <Upload size={18} />
        </div>
        <div className="text-sm font-medium text-[var(--color-fg)]">
          Drop .md files here, or click to choose
        </div>
        <div className="text-[12px] text-[var(--color-fg-muted)]">
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
          <div className="px-1 text-[12px] font-medium uppercase tracking-wide text-[var(--color-fg-muted)]">
            {files.length} file{files.length === 1 ? "" : "s"} ready
          </div>
          <ul className="divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
            {files.map((f) => (
              <li key={f.name} className="flex items-center gap-3 px-3 py-2.5">
                <FileText size={15} className="shrink-0 text-[var(--color-fg-muted)]" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-[var(--color-fg)]">
                  {f.name}
                </span>
                <span className="shrink-0 text-[12px] text-[var(--color-fg-muted)]">
                  {(f.size / 1024).toFixed(1)} KB
                </span>
                <button
                  type="button"
                  onClick={() => removeFile(f.name)}
                  className="shrink-0 rounded p-1 text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-error)]"
                  aria-label={`Remove ${f.name}`}
                >
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <label className="flex items-start gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-3">
        <input
          type="checkbox"
          checked={isCore}
          onChange={(e) => setIsCore(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-[var(--color-accent)]"
        />
        <div className="text-sm">
          <div className="font-medium text-[var(--color-fg)]">
            Pin all uploaded docs to the core playbook
          </div>
          <div className="text-[12px] text-[var(--color-fg-secondary)]">
            Marks every file in this batch as <strong>core</strong> (pinned to the top of
            the manifest). A file&apos;s own <code>is_core: true</code> frontmatter also
            pins it. Leave off for supplemental references.
          </div>
        </div>
      </label>

      {error && (
        <div className="rounded-md border border-[var(--color-error)] bg-[var(--color-error)]/10 px-3 py-2 text-[13px] text-[var(--color-error)]">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-2 rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-3 text-[13px]">
          {result.created.length > 0 && (
            <div className="flex items-start gap-2 text-[var(--color-success)]">
              <CheckCircle2 size={15} className="mt-0.5 shrink-0" />
              <div className="text-[var(--color-fg)]">
                Imported {result.created.length} doc
                {result.created.length === 1 ? "" : "s"}:{" "}
                <span className="text-[var(--color-fg-secondary)]">
                  {result.created.map((d) => d.path).join(", ")}
                </span>
              </div>
            </div>
          )}
          {result.failed.map((f) => (
            <div key={f.name} className="flex items-start gap-2 text-[var(--color-error)]">
              <XCircle size={15} className="mt-0.5 shrink-0" />
              <div className="text-[var(--color-fg)]">
                <span className="font-medium">{f.name}</span> — {f.reason}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] pt-4">
        <Link
          href="/settings/knowledge"
          className="inline-flex h-9 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
        >
          {result?.created.length ? "Done" : "Cancel"}
        </Link>
        <button
          type="button"
          onClick={onSubmit}
          disabled={pending || files.length === 0}
          className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          Upload {files.length > 0 ? `${files.length} file${files.length === 1 ? "" : "s"}` : ""}
        </button>
      </div>
    </div>
  );
}
