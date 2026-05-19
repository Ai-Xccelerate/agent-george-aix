"use client";

import { ArrowUpRight } from "lucide-react";

export function OpenInBubbleButton({
  sessionId,
  children,
}: {
  sessionId: string;
  children?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        window.dispatchEvent(
          new CustomEvent("george:open-session", { detail: { sessionId } }),
        );
      }}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-1.5 text-[12px] font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)]"
    >
      {children ?? (
        <>
          Open <ArrowUpRight size={11} />
        </>
      )}
    </button>
  );
}
