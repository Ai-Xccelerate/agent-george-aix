import { redirect } from "next/navigation";
import Link from "next/link";
import { MailCheck, ShieldAlert, ShieldCheck } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getAgentSettings } from "@/lib/agent/agent-settings";
import {
  resolveTenantProcess,
  TenantProcessMissingError,
} from "@/lib/agent/tenant-process";
import { EMAIL_SENDING_EXPOSED } from "@/lib/features";
import { TouchpointsForm } from "./_touchpoints-form";
import { updateTouchpointsAction } from "./actions";

export const dynamic = "force-dynamic";

/**
 * Where "George may send unprompted" is decided — and the only place.
 *
 * WHY THIS IS ITS OWN SCREEN
 * The question "where is it configured that signup triggers two emails in the
 * first week?" had no answer you could point at. The data was in
 * `tenant_process.touchpoints` (migration 0004) and the only editor was four
 * number inputs under a "Cadence" subheading on the agent identity page — so
 * the schedule could be retimed but not changed, and the screen did not read as
 * the place where an irreversible thing gets decided.
 *
 * WHAT MAKES IT READ AS THAT
 * The page states the full set of conditions under which George writes without
 * being asked, INCLUDING the ones not editable here — the operating model, the
 * domain allowlist, whether the send tool is exposed at all. A settings screen
 * that shows one of four gates invites the belief that it is the only one, and
 * that belief is how somebody thinks they have switched sending off.
 *
 * The identity page now links here instead of embedding a partial editor, so
 * there is one destination and it is this one.
 */
export default async function TouchpointsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (user.role !== "owner" && user.role !== "admin") redirect("/settings/profile");

  const admin = createSupabaseAdmin();
  const [processOrError, agent, allowlistRes] = await Promise.all([
    // Caught, not thrown: the resolver refuses rather than inventing a process,
    // and this screen is where you would come to fix that — rendering the
    // refusal is more useful than a 500.
    resolveTenantProcess(admin, user.orgId).catch(
      (e: unknown) => e as TenantProcessMissingError,
    ),
    getAgentSettings(admin, user.orgId),
    admin
      .from("domain_allowlist")
      .select("domain")
      .eq("org_id", user.orgId)
      .eq("status", "approved")
      .limit(50),
  ]);

  const missing = processOrError instanceof TenantProcessMissingError;
  const process = missing ? null : processOrError;
  const approvedDomains = ((allowlistRes.data ?? []) as Array<{ domain: string }>).map(
    (d) => d.domain,
  );
  const operatorMode = agent.operating_mode === "operator";

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">
          Unprompted email
        </h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          This is the only place George&apos;s unprompted contacts are defined. Every
          email he starts on his own — rather than one you asked for in chat — comes
          from the schedule below. Nothing else in the app adds to it.
        </p>
      </header>

      {/* ── The four gates, all of them, whether or not they live here ──────
            A screen that shows one gate and stays quiet about the other three
            reads as complete. Somebody then turns a dial here, believes
            sending is handled, and is wrong in the direction that sends mail. */}
      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
          What has to be true before an unprompted email goes out
        </h2>
        <p className="mt-1 mb-4 text-theme-xs text-gray-400 dark:text-gray-500">
          All four. Turning any one of them off stops unprompted sending on its own.
        </p>
        <ul className="space-y-3">
          <Gate
            on={EMAIL_SENDING_EXPOSED}
            label="George can send at all"
            where={
              EMAIL_SENDING_EXPOSED
                ? "The send tool is registered."
                : "The send tool is not registered in this build, so nothing below can send — George drafts and a person sends from the mailbox. This is a code-level switch, not a setting."
            }
          />
          <Gate
            on={operatorMode}
            label="Operating model allows George to act first"
            where={
              operatorMode
                ? "Operator mode — George may start work without being asked."
                : "Assistant mode — George waits to be asked, so the schedule below does not fire."
            }
            href="/settings/agent/policy"
            hrefLabel="Operating model"
          />
          <Gate
            on={!missing && (process?.touchpoints.length ?? 0) > 0}
            label="A schedule exists"
            where={
              missing
                ? "No usable onboarding process, so George refuses to onboard."
                : `${process?.touchpoints.length} contact${
                    process?.touchpoints.length === 1 ? "" : "s"
                  } defined below.`
            }
          />
          <Gate
            on={approvedDomains.length > 0}
            label="The recipient's domain is approved"
            where={
              approvedDomains.length > 0
                ? `${approvedDomains.length} approved: ${approvedDomains.slice(0, 4).join(", ")}${
                    approvedDomains.length > 4 ? "…" : ""
                  }. Anything else is refused at send time.`
                : "No external domains approved, so only internal addresses can receive mail."
            }
            href="/settings/agent/domains"
            hrefLabel="Email domains"
          />
        </ul>
      </section>

      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
          The schedule
        </h2>
        <p className="mt-1 mb-4 text-theme-xs text-gray-400 dark:text-gray-500">
          Days are counted from the start of onboarding. One ask per email — a contact
          that asks for three things reliably gets none of them answered.
        </p>

        {missing ? (
          <div className="flex items-start gap-3 rounded-lg border border-error-200 dark:border-error-500/30 bg-error-50 dark:bg-error-500/10 p-3">
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-error-500" />
            <div>
              <div className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
                No usable onboarding process for this organisation
              </div>
              <div className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                {(processOrError as TenantProcessMissingError).why}. George refuses to
                onboard rather than invent a process, so there is nothing to schedule
                against yet. Migration 0004 seeds a record for every organisation — a
                missing one is the thing to fix first.
              </div>
            </div>
          </div>
        ) : (
          <TouchpointsForm
            action={updateTouchpointsAction}
            initial={process!.touchpoints}
            silenceDays={process!.escalation.silence_days}
            silenceEscalateAfter={process!.escalation.silence_escalate_after}
          />
        )}
      </section>
    </div>
  );
}

function Gate({
  on,
  label,
  where,
  href,
  hrefLabel,
}: {
  on: boolean;
  label: string;
  where: string;
  href?: string;
  hrefLabel?: string;
}) {
  return (
    <li className="flex items-start gap-3">
      <span className="mt-0.5 shrink-0">
        {on ? (
          <ShieldCheck size={16} className="text-success-500" />
        ) : (
          <MailCheck size={16} className="text-gray-400 dark:text-gray-500" />
        )}
      </span>
      <div className="min-w-0">
        <div className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
          {label}
          <span
            className={`ml-2 rounded-full px-1.5 py-[1px] text-theme-xs font-medium ${
              on
                ? "bg-success-50 text-success-600 dark:bg-success-500/15 dark:text-success-500"
                : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
            }`}
          >
            {on ? "allows" : "blocks"}
          </span>
        </div>
        <div className="mt-0.5 text-theme-xs leading-relaxed text-gray-500 dark:text-gray-400">
          {where}
          {href && hrefLabel && (
            <>
              {" "}
              <Link
                href={href}
                className="font-medium text-brand-500 underline-offset-2 hover:underline dark:text-brand-400"
              >
                {hrefLabel}
              </Link>
            </>
          )}
        </div>
      </div>
    </li>
  );
}
