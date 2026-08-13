"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Download } from "lucide-react";

export function TranscriptPanel({
  text,
  title,
  status,
}: {
  text: string | null;
  title: string;
  status: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!text) {
    return (
      <p className="text-theme-sm text-gray-400 dark:text-gray-500">
        {status && status !== "completed"
          ? "Scribe is still processing this meeting — the transcript will appear after the next sync."
          : "No transcript text was returned for this meeting."}
      </p>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked — ignore */
    }
  };

  const download = () => {
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^\w.-]+/g, "_") || "transcript"}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const btn =
    "inline-flex items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-800 px-2.5 py-1 text-theme-xs font-medium text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.03] hover:text-gray-800 dark:hover:text-white/90";

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03]">
      <div className="flex items-center justify-between gap-2 px-4 py-2.5">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex items-center gap-1.5 text-theme-sm font-medium text-gray-800 dark:text-white/90"
        >
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          {open ? "Hide full transcript" : "Show full transcript"}
        </button>
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={copy} className={btn}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </button>
          <button type="button" onClick={download} className={btn}>
            <Download size={14} /> Download
          </button>
        </div>
      </div>
      {open && (
        <pre className="max-h-[560px] overflow-auto whitespace-pre-wrap border-t border-gray-200 dark:border-gray-800 p-4 font-sans text-theme-sm leading-relaxed text-gray-500 dark:text-gray-400">
          {text}
        </pre>
      )}
    </div>
  );
}
