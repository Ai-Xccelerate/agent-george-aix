"use client";

import { useActionState } from "react";
import {
  POLICY_CATALOG,
  type Policy,
  type PolicyValue,
} from "@/lib/agent/operating-model";
import type { ActionResult } from "./actions";

type ServerAction = (state: ActionResult, formData: FormData) => Promise<ActionResult>;

type Props = {
  action: ServerAction;
  values: Record<string, PolicyValue>;
};

export function PolicyForm({ action, values }: Props) {
  const [state, formAction, pending] = useActionState<ActionResult, FormData>(action, {});

  const behavior = POLICY_CATALOG.filter((p) => p.group === "behavior");
  const limits = POLICY_CATALOG.filter((p) => p.group === "limits");
  const houseRules = POLICY_CATALOG.find((p) => p.group === "house_rules");

  return (
    <form action={formAction} className="space-y-6">
      <Group
        title="Behaviors"
        hint="Optional behaviors the team can switch on or off. Defaults are on."
      >
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
          {behavior.map((p) => (
            <ToggleRow key={p.id} policy={p} checked={Boolean(values[p.id])} />
          ))}
        </div>
      </Group>

      <Group
        title="Limits & framework"
        hint="The numbers and choices that shape how George operates."
      >
        <div className="space-y-4">
          {limits.map((p) => (
            <TunableRow key={p.id} policy={p} value={values[p.id]} />
          ))}
        </div>
      </Group>

      {houseRules && houseRules.kind === "text" && (
        <Group
          title="House rules"
          hint="Extra directives applied verbatim to every prompt. They add constraints — they can't relax a guardrail."
        >
          <textarea
            name={houseRules.id}
            rows={5}
            maxLength={houseRules.maxLength}
            defaultValue={String(values[houseRules.id] ?? "")}
            placeholder={houseRules.placeholder}
            className={`${inputClass} h-auto py-2 leading-relaxed`}
          />
          <span className="mt-1 block text-theme-xs text-gray-400 dark:text-gray-500">
            Up to {houseRules.maxLength} characters.
          </span>
        </Group>
      )}

      <Status state={state} />

      <button type="submit" disabled={pending} className={submitClass}>
        {pending ? "Saving…" : "Save operating model"}
      </button>
    </form>
  );
}

function ToggleRow({ policy, checked }: { policy: Policy; checked: boolean }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-3">
      <div className="min-w-0">
        <div className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{policy.label}</div>
        <div className="mt-0.5 text-theme-xs text-gray-400 dark:text-gray-500">
          {policy.description}
        </div>
      </div>
      {/* peer checkbox drives the visual switch */}
      <span className="relative mt-0.5 shrink-0">
        <input
          type="checkbox"
          name={policy.id}
          defaultChecked={checked}
          className="peer sr-only"
        />
        <span className="block h-5 w-9 rounded-full bg-gray-50 dark:bg-white/[0.03] transition-colors peer-checked:bg-brand-500" />
        <span className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
    </label>
  );
}

function TunableRow({ policy, value }: { policy: Policy; value: PolicyValue }) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <label htmlFor={policy.id} className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
          {policy.label}
        </label>
      </div>
      {policy.kind === "number" && (
        <div className="flex items-center gap-2">
          <input
            id={policy.id}
            name={policy.id}
            type="number"
            min={policy.min}
            max={policy.max}
            defaultValue={Number(value)}
            className={`${inputClass} max-w-[120px]`}
          />
          {policy.unit && (
            <span className="text-theme-xs text-gray-400 dark:text-gray-500">{policy.unit}</span>
          )}
        </div>
      )}
      {policy.kind === "select" && (
        <select id={policy.id} name={policy.id} defaultValue={String(value)} className={inputClass}>
          {policy.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {policy.kind === "text" && (
        <input
          id={policy.id}
          name={policy.id}
          type="text"
          maxLength={policy.maxLength}
          defaultValue={String(value)}
          placeholder={policy.placeholder}
          className={inputClass}
        />
      )}
      <span className="mt-1 block text-theme-xs text-gray-400 dark:text-gray-500">
        {policy.description}
      </span>
    </div>
  );
}

function Group({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <fieldset>
      <legend className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">{title}</legend>
      <p className="mt-0.5 mb-3 text-theme-xs text-gray-400 dark:text-gray-500">{hint}</p>
      {children}
    </fieldset>
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

const inputClass =
  "h-10 w-full rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 text-sm text-gray-800 dark:text-white/90 outline-none focus:border-brand-500 dark:focus:border-brand-400";

const submitClass =
  "h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900 disabled:opacity-60";
