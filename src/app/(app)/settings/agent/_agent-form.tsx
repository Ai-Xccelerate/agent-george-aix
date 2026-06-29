"use client";

import { useActionState } from "react";
import {
  OPERATING_MODE_OPTIONS,
  PERSONALITY_OPTIONS,
} from "@/lib/agent/agent-settings";
import type { ActionResult } from "./actions";

type ServerAction = (state: ActionResult, formData: FormData) => Promise<ActionResult>;

export type OwnerOption = { user_id: string; label: string };

type Props = {
  action: ServerAction;
  members: OwnerOption[];
  defaults: {
    name: string;
    title: string;
    bio: string;
    personality: string;
    operating_mode: string;
    owner_user_id: string;
  };
};

export function AgentForm({ action, members, defaults }: Props) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name">
          <input name="name" required defaultValue={defaults.name} className={inputClass} />
        </Field>
        <Field label="Title / role">
          <input
            name="title"
            required
            defaultValue={defaults.title}
            placeholder="AI Customer Success Teammate"
            className={inputClass}
          />
        </Field>
      </div>

      <Field label="Short bio / description">
        <textarea
          name="bio"
          rows={3}
          maxLength={400}
          defaultValue={defaults.bio}
          placeholder="One or two lines on who George is and what he's responsible for. Shown to the team; informs how he introduces himself."
          className={`${inputClass} h-auto py-2 leading-relaxed`}
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Personality / tone">
          <select name="personality" defaultValue={defaults.personality} className={inputClass}>
            {PERSONALITY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Hint>Layers on top of the locked tone rules — it can&apos;t relax them.</Hint>
        </Field>
        <Field label="Default operating mode">
          <select name="operating_mode" defaultValue={defaults.operating_mode} className={inputClass}>
            {OPERATING_MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <Hint>
            {OPERATING_MODE_OPTIONS.find((o) => o.value === defaults.operating_mode)?.hint ??
              "How George acts when the PM hasn't said which mode applies."}
          </Hint>
        </Field>
      </div>

      <Field label="Human owner / escalation contact">
        <select name="owner_user_id" defaultValue={defaults.owner_user_id} className={inputClass}>
          <option value="">— None —</option>
          {members.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {m.label}
            </option>
          ))}
        </select>
        <Hint>Who George escalates to and drafts under when a human needs to sign.</Hint>
      </Field>

      <Status state={state} />

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving…" : "Save identity"}
      </button>
    </form>
  );
}

type AvatarFormProps = {
  action: ServerAction;
  currentUrl: string | null;
  name: string;
};

export function AvatarUploadForm({ action, currentUrl, name }: AvatarFormProps) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3">
      <div className="flex items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-full border border-dashed border-[var(--color-border)] bg-[var(--color-surface)]">
          {currentUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={currentUrl} alt={name} className="h-full w-full object-cover" />
          ) : (
            <span className="text-[18px] font-semibold text-[var(--color-fg-muted)]">
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
        </div>
        <div className="flex-1">
          <Field label="Avatar">
            <input
              type="file"
              name="file"
              accept="image/png,image/jpeg,image/webp"
              required
              className="block w-full text-[12px] text-[var(--color-fg)] file:mr-3 file:rounded-md file:border-0 file:bg-[var(--color-accent)] file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-[var(--color-fg-inverse)] hover:file:bg-[var(--color-accent-hover)]"
            />
            <Hint>PNG, JPEG, or WebP. Square works best. Max 1 MB.</Hint>
          </Field>
        </div>
      </div>

      <Status state={state} />

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Uploading…" : "Upload avatar"}
      </button>
    </form>
  );
}

function Status({ state }: { state: ActionResult }) {
  if (state.error) {
    return (
      <div className="rounded-md border border-[var(--color-error)]/30 bg-[var(--color-error)]/10 px-3 py-2 text-[12px] text-[var(--color-error)]">
        {state.error}
      </div>
    );
  }
  if (state.info) {
    return (
      <div className="rounded-md border border-[var(--color-success)]/30 bg-[var(--color-success-light)] px-3 py-2 text-[12px] text-[var(--color-success)]">
        {state.info}
      </div>
    );
  }
  return null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-[var(--color-fg-secondary)]">
        {label}
      </span>
      {children}
    </label>
  );
}

function Hint({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-1 block text-[11px] text-[var(--color-fg-muted)]">{children}</span>
  );
}

const inputClass =
  "h-10 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm text-[var(--color-fg)] outline-none focus:border-[var(--color-accent)]";

const submitClass =
  "inline-flex h-10 items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-4 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)] disabled:opacity-60";
