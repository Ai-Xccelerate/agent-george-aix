"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Loader2, Save, Trash2 } from "lucide-react";

type Props = {
  mode: "create" | "edit";
  initial?: {
    id: string;
    path: string;
    title: string;
    content_md: string;
    is_core: boolean;
    version: number;
    source: string;
  };
  saveAction: (formData: FormData) => Promise<void>;
  deleteAction?: (formData: FormData) => Promise<void>;
};

export function DocForm({ mode, initial, saveAction, deleteAction }: Props) {
  const [path, setPath] = useState(initial?.path ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [content, setContent] = useState(initial?.content_md ?? "");
  const [isCore, setIsCore] = useState(initial?.is_core ?? false);
  const [error, setError] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [deleting, startDelete] = useTransition();

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startSave(async () => {
      try {
        await saveAction(fd);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed.");
      }
    });
  };

  const onDelete = () => {
    if (!initial || !deleteAction) return;
    if (!confirm(`Delete "${initial.title || initial.path}"? This can't be undone.`)) return;
    const fd = new FormData();
    fd.set("id", initial.id);
    startDelete(async () => {
      try {
        await deleteAction(fd);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Delete failed.");
      }
    });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {initial && <input type="hidden" name="id" value={initial.id} />}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Path" hint="e.g. playbooks/renewal-cadence.md">
          <input
            name="path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            required
            placeholder="folder/slug.md"
            className="w-full rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 py-2 font-mono text-theme-sm text-gray-800 dark:text-white/90 outline-none focus:border-brand-500 dark:focus:border-brand-400"
          />
        </Field>
        <Field
          label="Title"
          hint="Optional — defaults to the first # heading, else the path."
        >
          <input
            name="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Display title"
            className="w-full rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 py-2 text-sm text-gray-800 dark:text-white/90 outline-none focus:border-brand-500 dark:focus:border-brand-400"
          />
        </Field>
      </div>

      <label className="flex items-start gap-3 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-3">
        <input
          type="checkbox"
          name="is_core"
          checked={isCore}
          onChange={(e) => setIsCore(e.target.checked)}
          className="mt-0.5 h-4 w-4 accent-brand-500"
        />
        <div className="text-sm">
          <div className="font-medium text-gray-800 dark:text-white/90">
            Pin to the core playbook
          </div>
          <div className="text-theme-xs text-gray-500 dark:text-gray-400">
            Marks the doc as <strong>core</strong>. Every chat session starts with a
            manifest of all knowledge docs; core docs are pinned to the top as
            &ldquo;read these first&rdquo;. George still fetches the full content on
            demand with <code>read_knowledge_doc</code> — there&apos;s no &ldquo;always
            loaded&rdquo; tier anymore. Reserve this for foundational role / process /
            lifecycle docs.
          </div>
        </div>
      </label>

      <Field
        label="Markdown"
        hint={
          initial
            ? `Version ${initial.version} · source: ${initial.source}`
            : "Write the doc body in Markdown. The first # heading becomes the title if you leave Title blank."
        }
      >
        <textarea
          name="content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          required
          rows={24}
          spellCheck={false}
          className="w-full rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 py-2 font-mono text-theme-sm leading-relaxed text-gray-800 dark:text-white/90 outline-none focus:border-brand-500 dark:focus:border-brand-400"
          placeholder={"# My doc\n\nGeorge will read this when…"}
        />
      </Field>

      {error && (
        <div className="rounded-md border border-error-500 bg-error-500/10 px-3 py-2 text-theme-sm text-error-500">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-3 border-t border-gray-200 dark:border-gray-800 pt-4">
        <div>
          {mode === "edit" && deleteAction && (
            <button
              type="button"
              onClick={onDelete}
              disabled={deleting || saving}
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 text-sm font-medium text-error-500 hover:bg-gray-50 dark:hover:bg-white/[0.03] disabled:opacity-50"
            >
              {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Delete doc
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/settings/knowledge"
            className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-white text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition-colors duration-150 ease-out hover:bg-gray-50 hover:text-gray-800 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:bg-white/[0.03] dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-white/90"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={saving || deleting}
            className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            {mode === "create" ? "Create doc" : "Save changes"}
          </button>
        </div>
      </div>
    </form>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-theme-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label}
      </label>
      {children}
      {hint && <p className="text-theme-xs text-gray-400 dark:text-gray-500">{hint}</p>}
    </div>
  );
}
