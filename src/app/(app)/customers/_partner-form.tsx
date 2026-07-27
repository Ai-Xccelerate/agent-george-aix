"use client";

import { useRef, useState, useTransition } from "react";
import { Loader2, Plus } from "lucide-react";
import {
  Dialog,
  DialogField,
  dialogInputClass,
  dialogTextareaClass,
} from "@/components/ui/dialog";
import { createPartnerAction } from "./actions";

const LIFECYCLES = [
  { value: "prospect", label: "Prospect" },
  { value: "onboarding", label: "Onboarding" },
  { value: "active", label: "Active" },
  { value: "at_risk", label: "At risk" },
  { value: "churned", label: "Churned" },
];

export function NewPartnerButton({
  variant = "primary",
}: {
  variant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startSubmit] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  function close() {
    if (pending) return;
    setOpen(false);
    setError(null);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startSubmit(async () => {
      try {
        const res = await createPartnerAction(fd);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setOpen(false);
      } catch (err) {
        // A thrown server action (e.g. session/auth failure) would otherwise
        // reject silently — the spinner stops and nothing happens. Surface it.
        setError(err instanceof Error ? err.message : "Could not create customer. Try again.");
      }
    });
  }

  const buttonClass =
    variant === "primary"
      ? "inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)]"
      : "inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]";

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass}>
        <Plus size={14} />
        New customer
      </button>

      <Dialog
        open={open}
        onClose={close}
        title="New customer"
        description="Captures the basics. George can fill in contacts, contract, plan, and cadence afterwards."
        footer={
          <>
            <button
              type="button"
              onClick={close}
              disabled={pending}
              className="inline-flex h-9 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => formRef.current?.requestSubmit()}
              disabled={pending}
              className="inline-flex h-9 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)] disabled:opacity-50"
            >
              {pending && <Loader2 size={14} className="animate-spin" />}
              Create customer
            </button>
          </>
        }
      >
        <form ref={formRef} id="new-partner-form" onSubmit={onSubmit} className="space-y-4">
          <DialogField label="Name" required>
            <input
              name="name"
              required
              autoFocus
              placeholder="e.g. Acme Robotics"
              className={dialogInputClass}
            />
          </DialogField>

          <div className="grid grid-cols-2 gap-3">
            <DialogField label="Domain">
              <input
                name="domain"
                placeholder="acmerobotics.com"
                className={dialogInputClass}
              />
            </DialogField>
            <DialogField label="Lifecycle">
              <select
                name="lifecycle"
                defaultValue="prospect"
                className={dialogInputClass}
              >
                {LIFECYCLES.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
            </DialogField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <DialogField label="Industry">
              <input
                name="industry"
                placeholder="Manufacturing"
                className={dialogInputClass}
              />
            </DialogField>
            <DialogField label="Size" hint="Headcount band, e.g. 11-50">
              <input
                name="size"
                placeholder="11-50"
                className={dialogInputClass}
              />
            </DialogField>
          </div>

          <DialogField label="Notes">
            <textarea
              name="notes"
              rows={3}
              placeholder="Anything George should know on day one…"
              className={dialogTextareaClass}
            />
          </DialogField>

          {error && (
            <div className="rounded-md border border-[var(--color-error)]/40 bg-[var(--color-error)]/10 px-3 py-2 text-[13px] text-[var(--color-error)]">
              {error}
            </div>
          )}
        </form>
      </Dialog>
    </>
  );
}
