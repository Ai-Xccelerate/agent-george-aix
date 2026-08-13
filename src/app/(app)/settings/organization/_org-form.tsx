"use client";

import { useActionState } from "react";
import type { ActionResult } from "./actions";

type ServerAction = (state: ActionResult, formData: FormData) => Promise<ActionResult>;

const DAYS = [
  { value: "mon", label: "Mon" },
  { value: "tue", label: "Tue" },
  { value: "wed", label: "Wed" },
  { value: "thu", label: "Thu" },
  { value: "fri", label: "Fri" },
  { value: "sat", label: "Sat" },
  { value: "sun", label: "Sun" },
] as const;

type Props = {
  action: ServerAction;
  defaults: {
    name: string;
    display_name: string;
    customer_brand_name: string;
    domain: string;
    tagline: string;
    brand_color: string;
    default_timezone: string;
    bh_start: string;
    bh_end: string;
    bh_days: string[];
  };
};

export function OrgForm({ action, defaults }: Props) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});
  const selected = new Set(defaults.bh_days);

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Legal name">
          <input name="name" required defaultValue={defaults.name} className={inputClass} />
        </Field>
        <Field label="Display name">
          <input
            name="display_name"
            defaultValue={defaults.display_name}
            placeholder="AIX"
            className={inputClass}
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Customer-facing brand name">
          <input
            name="customer_brand_name"
            defaultValue={defaults.customer_brand_name}
            placeholder="AIX"
            className={inputClass}
          />
        </Field>
        <Field label="Primary domain">
          <input
            name="domain"
            defaultValue={defaults.domain}
            placeholder="getonyx.ai"
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Tagline / one-line description">
        <input
          name="tagline"
          defaultValue={defaults.tagline}
          maxLength={280}
          placeholder="AI-native partner support for Microsoft MSPs."
          className={inputClass}
        />
        <span className="mt-1 block text-theme-xs text-gray-400 dark:text-gray-500">
          Used by George when introducing the company in outbound copy.
        </span>
      </Field>

      <div className="grid grid-cols-[180px_1fr] gap-3">
        <Field label="Brand color">
          <div className="flex items-center gap-2">
            <input
              type="color"
              name="brand_color"
              defaultValue={defaults.brand_color || "#6D45F5"}
              className="h-10 w-12 cursor-pointer rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03]"
            />
            <span className="text-theme-xs text-gray-400 dark:text-gray-500">
              Hex (defaults to accent)
            </span>
          </div>
        </Field>
        <Field label="Default timezone">
          <input
            name="default_timezone"
            defaultValue={defaults.default_timezone}
            placeholder="America/Los_Angeles"
            className={inputClass}
          />
        </Field>
      </div>

      <fieldset className="rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-3">
        <legend className="px-1 text-theme-xs font-medium text-gray-500 dark:text-gray-400">
          Business hours
        </legend>
        <div className="mb-3 flex flex-wrap gap-2">
          {DAYS.map((d) => (
            <label
              key={d.value}
              className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-2.5 py-1 text-theme-xs text-gray-800 dark:text-white/90"
            >
              <input
                type="checkbox"
                name="bh_days"
                value={d.value}
                defaultChecked={selected.has(d.value)}
                className="accent-brand-500"
              />
              {d.label}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start">
            <input
              type="time"
              name="bh_start"
              defaultValue={defaults.bh_start}
              className={inputClass}
            />
          </Field>
          <Field label="End">
            <input
              type="time"
              name="bh_end"
              defaultValue={defaults.bh_end}
              className={inputClass}
            />
          </Field>
        </div>
      </fieldset>

      <Status state={state} />

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving…" : "Save organization"}
      </button>
    </form>
  );
}

type LogoFormProps = {
  action: ServerAction;
  variant: "square" | "wordmark";
  currentUrl: string | null;
};

export function LogoUploadForm({ action, variant, currentUrl }: LogoFormProps) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});
  const label = variant === "square" ? "Square logo" : "Wordmark";

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="variant" value={variant} />

      <div className="flex items-center gap-4">
        <div
          className={`flex items-center justify-center rounded-md border border-dashed border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 ${
            variant === "square" ? "h-16 w-16" : "h-16 w-40"
          }`}
        >
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={currentUrl}
              alt={label}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <span className="text-theme-xs text-gray-400 dark:text-gray-500">No {label.toLowerCase()}</span>
          )}
        </div>

        <div className="flex-1">
          <Field label={label}>
            <input
              type="file"
              name="file"
              accept="image/png,image/svg+xml,image/jpeg,image/webp"
              required
              className="block w-full text-theme-xs text-gray-800 dark:text-white/90 file:mr-3 file:rounded-md file:border-0 file:bg-brand-500 file:px-3 file:py-1.5 file:text-theme-xs file:font-medium file:text-white hover:file:bg-brand-600"
            />
            <span className="mt-1 block text-theme-xs text-gray-400 dark:text-gray-500">
              PNG, SVG, JPEG, or WebP. Max 1 MB.
            </span>
          </Field>
        </div>
      </div>

      <Status state={state} />

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Uploading…" : `Upload ${label.toLowerCase()}`}
      </button>
    </form>
  );
}

function Status({ state }: { state: ActionResult }) {
  if (state.error) {
    return (
      <div className="rounded-md border border-error-500/30 bg-error-500/10 px-3 py-2 text-theme-xs text-error-500">
        {state.error}
      </div>
    );
  }
  if (state.info) {
    return (
      <div className="rounded-md border border-success-500/30 bg-success-50 dark:bg-success-500/15 px-3 py-2 text-theme-xs text-success-500">
        {state.info}
      </div>
    );
  }
  return null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-theme-xs font-medium text-gray-500 dark:text-gray-400">
        {label}
      </span>
      {children}
    </label>
  );
}

const inputClass =
  "h-10 w-full rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 text-sm text-gray-800 dark:text-white/90 outline-none focus:border-brand-500 dark:focus:border-brand-400";

const submitClass =
  "h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900 disabled:opacity-60";
