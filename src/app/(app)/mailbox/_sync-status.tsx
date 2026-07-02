"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { syncMailboxNowAction } from "./actions";

export function SyncStatus({
  lastSyncedAt,
  intervalMs,
}: {
  lastSyncedAt: string | null;
  intervalMs: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: "error" | "info"; text: string } | null>(null);
  // Ticks every 30s so "3m ago" / "due in 4m" stay roughly live without a
  // full page refresh. Lazy initializer runs once at mount, not on every
  // render, and later updates only happen from the interval's own callback
  // (not synchronously inside the effect body).
  const [now, setNow] = useState<number | null>(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const lastMs = lastSyncedAt ? new Date(lastSyncedAt).getTime() : null;
  const nextMs = lastMs !== null ? lastMs + intervalMs : null;

  function handleSyncNow() {
    setMessage(null);
    startTransition(async () => {
      const result = await syncMailboxNowAction();
      if (result.error) setMessage({ tone: "error", text: result.error });
      else if (result.info) setMessage({ tone: "info", text: result.info });
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--color-fg-muted)]">
      <span>
        {lastMs === null
          ? "Never synced"
          : now === null
            ? "Last synced —"
            : `Last synced ${formatAgo(lastMs, now)}`}
      </span>
      <span aria-hidden>·</span>
      <span>
        {nextMs === null || now === null
          ? "Next sync pending"
          : nextMs <= now
            ? "Next sync due any moment"
            : `Next sync ${formatUntil(nextMs, now)}`}
      </span>
      <button
        type="button"
        onClick={handleSyncNow}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-2.5 py-1 text-[12px] font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)] disabled:opacity-60"
      >
        <RefreshCw size={12} className={pending ? "animate-spin" : ""} />
        {pending ? "Syncing…" : "Sync now"}
      </button>
      {message && (
        <span
          className={
            message.tone === "error"
              ? "text-[var(--color-error)]"
              : "text-[var(--color-success)]"
          }
        >
          {message.text}
        </span>
      )}
    </div>
  );
}

function minutesBetween(a: number, b: number): number {
  return Math.max(0, Math.round(Math.abs(a - b) / 60_000));
}

function formatAgo(pastMs: number, nowMs: number): string {
  const m = minutesBetween(nowMs, pastMs);
  if (m < 1) return "just now";
  return m === 1 ? "1 minute ago" : `${m} minutes ago`;
}

function formatUntil(futureMs: number, nowMs: number): string {
  const m = minutesBetween(futureMs, nowMs);
  if (m < 1) return "in under a minute";
  return m === 1 ? "in 1 minute" : `in ${m} minutes`;
}
