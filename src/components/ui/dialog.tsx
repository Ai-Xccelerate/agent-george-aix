"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  /** Footer slot (typically Cancel + primary action). */
  footer?: ReactNode;
  /** Form id used when a footer submit button needs to drive a form in body. */
  className?: string;
  children: ReactNode;
};

/**
 * Native &lt;dialog&gt;-backed modal. We use showModal/close so we get focus
 * trapping, ESC handling, and inert background for free. Backdrop click
 * (i.e. clicking outside the inner content) closes.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  className,
  children,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
    } else if (!open && el.open) {
      el.close();
    }
  }, [open]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = () => onClose();
    el.addEventListener("close", handler);
    return () => el.removeEventListener("close", handler);
  }, [onClose]);

  function onBackdropMouseDown(e: React.MouseEvent<HTMLDialogElement>) {
    if (e.target === ref.current) onClose();
  }

  return (
    <dialog
      ref={ref}
      onMouseDown={onBackdropMouseDown}
      className={cn(
        // `m-auto` is required: Tailwind's preflight resets the native
        // <dialog>'s default `margin: auto` which is what centers it on
        // screen. Without this, the dialog opens at the top-left corner.
        "m-auto max-h-[90vh] w-full max-w-[520px] overflow-hidden rounded-[16px] border border-[var(--color-border)] bg-[var(--color-surface-card)] p-0 text-[var(--color-fg)] shadow-2xl backdrop:bg-black/50 backdrop:backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex max-h-[90vh] flex-col">
        <header className="flex items-start justify-between gap-4 border-b border-[var(--color-border-subtle)] px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold text-[var(--color-fg)]">
              {title}
            </h2>
            {description && (
              <p className="mt-0.5 text-[12px] text-[var(--color-fg-secondary)]">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="-m-1 flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
          >
            <X size={15} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {children}
        </div>

        {footer && (
          <footer className="flex items-center justify-end gap-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  );
}

export function DialogField({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-1 text-[12px] font-medium uppercase tracking-wide text-[var(--color-fg-muted)]">
        {label}
        {required && <span className="text-[var(--color-error)]">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-[var(--color-fg-muted)]">{hint}</p>}
    </div>
  );
}

export const dialogInputClass =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]";

export const dialogTextareaClass =
  "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 py-2 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]";
