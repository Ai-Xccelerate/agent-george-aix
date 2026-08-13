import { redirect } from "next/navigation";
import { Lock, ShieldCheck } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getAgentSettings } from "@/lib/agent/agent-settings";
import {
  GUARDRAILS,
  OPERATING_PRINCIPLES,
  resolvePolicies,
} from "@/lib/agent/operating-model";
import { PolicyForm } from "./_policy-form";
import { updateOperatingPolicyAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function OperatingModelPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (user.role !== "owner" && user.role !== "admin") redirect("/settings/profile");

  const admin = createSupabaseAdmin();
  const agent = await getAgentSettings(admin, user.orgId);
  const values = resolvePolicies(agent.operating_policy);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">Operating model</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          The directives that govern how George works. Guardrails and principles
          are always on; behaviors, limits, and house rules are yours to tune.
          Everything here flows into George&apos;s system prompt automatically.
        </p>
      </header>

      {/* Tier 1 — locked guardrails */}
      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5">
        <div className="flex items-center gap-2">
          <Lock size={15} className="text-gray-400 dark:text-gray-500" />
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Guardrails</h2>
          <span className="ml-1 rounded-full bg-gray-50 dark:bg-white/[0.03] px-2 py-0.5 text-theme-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
            Always on
          </span>
        </div>
        <p className="mt-1 mb-4 text-theme-xs text-gray-400 dark:text-gray-500">
          Safety rules built into George. They can&apos;t be switched off — every
          behavior and house rule below layers on top of these.
        </p>
        <ul className="space-y-2.5">
          {GUARDRAILS.map((g) => (
            <DirectiveItem key={g.title} title={g.title} detail={g.detail} />
          ))}
        </ul>
      </section>

      {/* Tier 1 — operating principles (do's / don'ts) */}
      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
          Operating principles
        </h2>
        <p className="mt-1 mb-4 text-theme-xs text-gray-400 dark:text-gray-500">
          The do&apos;s and don&apos;ts of how George communicates and decides.
          Always applied.
        </p>
        <ul className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
          {OPERATING_PRINCIPLES.map((p) => (
            <DirectiveItem key={p.title} title={p.title} detail={p.detail} />
          ))}
        </ul>
      </section>

      {/* Tier 2 + 3 — controllable */}
      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
          Behaviors, limits & house rules
        </h2>
        <p className="mt-1 mb-4 text-theme-xs text-gray-400 dark:text-gray-500">
          What the AIX team controls. Changes take effect on George&apos;s next
          action.
        </p>
        <PolicyForm action={updateOperatingPolicyAction} values={values} />
      </section>
    </div>
  );
}

function DirectiveItem({ title, detail }: { title: string; detail: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <ShieldCheck size={15} className="mt-0.5 shrink-0 text-brand-500 dark:text-brand-400" />
      <div>
        <div className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{title}</div>
        <div className="text-theme-xs text-gray-400 dark:text-gray-500">{detail}</div>
      </div>
    </li>
  );
}
