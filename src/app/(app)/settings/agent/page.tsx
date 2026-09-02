import { redirect } from "next/navigation";
import {
  CalendarClock,
  Database,
  ListChecks,
  Lock,
  Mail,
  Mic,
  Plug,
  ShieldAlert,
  Target,
} from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getAgentSettings } from "@/lib/agent/agent-settings";
import { getScribeConnection } from "@/lib/agent/scribe";
import { getMailProviderStatus } from "@/lib/agent/mail-provider";
import { getAgentDbStatus, clerkOrgIdFor } from "@/lib/agent/agentdb";
import { georgeOrgIdFromEnv } from "@/lib/agent/tenancy";
import {
  isFirstValueConfigured,
  resolveTenantProcess,
  type TenantProcessMissingError,
} from "@/lib/agent/tenant-process";
import { DEFAULT_TIMEZONE } from "@/lib/agent/agent-settings";
import { AgentForm, AvatarUploadForm, type OwnerOption } from "./_agent-form";
import { TouchpointForm } from "./_touchpoint-form";
import {
  removeAgentAvatarAction,
  updateAgentSettingsAction,
  updateTouchpointCadenceAction,
  uploadAgentAvatarAction,
} from "./actions";

export const dynamic = "force-dynamic";

// No default address. It used to be a hardcoded mailbox at another company,
// which the Identity screen then presented as George's own whenever the real
// one was unavailable. An empty row is a smaller lie than a confident wrong one.
const NO_MAILBOX = "No mailbox configured";

export default async function AgentSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  if (user.role !== "owner" && user.role !== "admin") redirect("/settings/profile");

  const admin = createSupabaseAdmin();
  const agent = await getAgentSettings(admin, user.orgId);

  const { data: orgRow } = await admin
    .from("orgs")
    .select("default_timezone")
    .eq("id", user.orgId)
    .maybeSingle();
  const timezone = (orgRow?.default_timezone as string | null) ?? DEFAULT_TIMEZONE;

  const { data: memberRows } = await admin
    .from("org_members")
    .select("user_id, full_name, email")
    .eq("org_id", user.orgId)
    .order("full_name");
  const members: OwnerOption[] = (memberRows ?? []).map((m) => ({
    user_id: m.user_id as string,
    label: [m.full_name, m.email].filter(Boolean).join(" · ") || (m.user_id as string),
  }));

  const avatarUrl = publicUrl(admin, agent.avatar_path);

  // Which mailbox is George ACTUALLY operating from? Read from whichever
  // provider is live rather than assuming Composio: once George has its own
  // Nylas mailbox, showing a team member's Outlook address here would be a
  // straightforward lie, and someone would act on it. Read-only either way —
  // this page describes the accounts, it never edits them.
  const mail = await getMailProviderStatus(user.orgId);

  // Resolved for GEORGE'S OWN org, not the viewer's — and that difference is the
  // whole reason this row exists. The Integrations page necessarily shows the
  // signed-in user's organisation, so an org that is enabled for you while
  // George's own org is not looks identical to everything working. It is not:
  // autonomous runs (inbound mail, cron) act as George's org, so that is the one
  // whose access decides whether George can read the CRM unattended.
  const agentOrgId = georgeOrgIdFromEnv() ?? user.orgId;
  const agentdb = await getAgentDbStatus(await clerkOrgIdFor(admin, agentOrgId));
  const agentdbValue = !agentdb.configured
    ? `Not configured — ${agentdb.missingVars.join(" and ")} unset`
    : agentdb.enabled
      ? "Read-only access to the organisation's records"
      : agentdb.reachable
        ? "Not enabled for George's organisation yet"
        : agentdb.detail;
  const mailbox = mail.mailbox;
  // Scribe is a direct remote MCP server (not Composio) — status from env only.
  const scribe = getScribeConnection();

  // The onboarding process, and specifically whether this tenant has said what
  // first value means. Caught rather than thrown: resolveTenantProcess refuses
  // when there is no usable process, which is right when George is about to act
  // and wrong on a settings page — the page exists to tell you the thing is not
  // configured, so it must survive that being true.
  const process = await resolveTenantProcess(admin, user.orgId).catch(
    (e: unknown) => e as TenantProcessMissingError,
  );
  const processMissing = process instanceof Error;
  const firstValueTuned = !processMissing && isFirstValueConfigured(process);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">AIX George</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          George&apos;s identity as an employee — who he is, how he sounds, who he
          reports to, and the accounts he operates from. These shape every chat
          and email draft.
        </p>
      </header>

      {/* Identity card */}
      <section className="flex items-center gap-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-50 dark:bg-brand-500/15">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={agent.name} className="h-full w-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/george-avatar.png" alt={agent.name} className="h-full w-full object-contain p-0.5" />
          )}
        </div>
        <div>
          <div className="text-lg font-semibold text-gray-800 dark:text-white/90">{agent.name}</div>
          <div className="text-theme-sm text-gray-500 dark:text-gray-400">{agent.title}</div>
          {agent.bio && (
            <div className="mt-1 max-w-[560px] text-theme-xs text-gray-400 dark:text-gray-500">
              {agent.bio}
            </div>
          )}
        </div>
      </section>

      {/* Configuration */}
      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Configuration</h2>
        <p className="mt-1 mb-4 text-theme-xs text-gray-400 dark:text-gray-500">
          Name, title, bio, tone, default operating mode, and the human George
          reports to.
        </p>
        <AgentForm
          action={updateAgentSettingsAction}
          members={members}
          defaults={{
            name: agent.name,
            title: agent.title,
            bio: agent.bio ?? "",
            personality: agent.personality,
            operating_mode: agent.operating_mode,
            owner_user_id: agent.owner_user_id ?? "",
            timezone,
          }}
        />
      </section>

      {/*
        Onboarding process.

        Deliberately a state, not a warning. An untuned default is a legitimate
        place to be on day one — George works, and the process he follows is a
        reasonable generic one. What it is not is *this company's* process, and
        "George is working" and "George is working on your actual process" are
        different claims. Only one of them is worth demoing, so the difference
        is stated plainly rather than either hidden or alarmed about.
      */}
      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
          Onboarding process
        </h2>
        <p className="mt-1 mb-4 text-theme-xs text-gray-400 dark:text-gray-500">
          The stages, touchpoints and escalation rules George follows when
          onboarding a customer for this organisation.
        </p>

        {processMissing ? (
          <div className="flex items-start gap-3 rounded-lg border border-error-200 dark:border-error-500/30 bg-error-50 dark:bg-error-500/10 p-3">
            <ShieldAlert size={16} className="mt-0.5 shrink-0 text-error-500" />
            <div>
              <div className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
                No usable onboarding process
              </div>
              <div className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                George will refuse to onboard rather than invent one.{" "}
                {(process as TenantProcessMissingError).why}.
              </div>
            </div>
          </div>
        ) : (
          <dl className="space-y-3">
            <div className="flex items-start gap-3">
              <ListChecks size={16} className="mt-0.5 shrink-0 text-gray-400 dark:text-gray-500" />
              <div>
                <dt className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
                  {process.stages.length} stages · {process.touchpoints.length} touchpoints
                </dt>
                <dd className="text-theme-xs text-gray-500 dark:text-gray-400">
                  {process.objective}
                </dd>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Target size={16} className={`mt-0.5 shrink-0 ${firstValueTuned ? "text-success-500" : "text-warning-500"}`} />
              <div>
                <dt className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
                  {firstValueTuned
                    ? "First value defined for this organisation"
                    : "Using the default onboarding process"}
                </dt>
                <dd className="mt-0.5 text-theme-xs text-gray-500 dark:text-gray-400">
                  {firstValueTuned ? (
                    <>
                      <span className="text-gray-800 dark:text-white/90">
                        {process.firstValue.label}
                      </span>{" "}
                      — {process.firstValue.definition} Target: day{" "}
                      {process.firstValue.target_days}.
                    </>
                  ) : (
                    <>
                      First value has not been defined, so George can report what has
                      happened on an account but cannot say whether onboarding
                      succeeded — there is nothing to measure that against. Everything
                      else has a sensible generic default; this one is specific to what
                      you sell.
                    </>
                  )}
                </dd>
              </div>
            </div>
          </dl>
        )}

        {!processMissing && (
          <div className="mt-5 border-t border-gray-200 dark:border-gray-800 pt-5">
            <h3 className="text-theme-sm font-semibold text-gray-800 dark:text-white/90">
              Cadence
            </h3>
            <p className="mt-1 mb-3 text-theme-xs text-gray-400 dark:text-gray-500">
              When George reaches out, counted in days from the start of onboarding, and
              how long silence runs before it becomes a signal.
            </p>
            <TouchpointForm
              action={updateTouchpointCadenceAction}
              touchpoints={process.touchpoints}
              silenceDays={process.escalation.silence_days}
              silenceEscalateAfter={process.escalation.silence_escalate_after}
            />
          </div>
        )}
      </section>

      {/* Avatar */}
      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">Avatar</h2>
        <p className="mt-1 mb-4 text-theme-xs text-gray-400 dark:text-gray-500">
          A face makes George read like a teammate. Shown here on his profile;
          wiring it into chat and the app shell comes next.
        </p>
        <AvatarUploadForm
          action={uploadAgentAvatarAction}
          currentUrl={avatarUrl}
          name={agent.name}
        />
        {agent.avatar_path && (
          <form action={removeAgentAvatarAction} className="mt-3">
            <button
              type="submit"
              className="text-theme-xs font-medium text-gray-400 dark:text-gray-500 underline-offset-2 hover:text-error-500 hover:underline"
            >
              Remove avatar
            </button>
          </form>
        )}
      </section>

      {/* Accounts George operates from — bound to Integrations, not editable here */}
      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5">
        <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
          Accounts George operates from
        </h2>
        <p className="mt-1 mb-4 text-theme-xs text-gray-400 dark:text-gray-500">
          These belong to George, not to you. They&apos;re wired through Composio —
          manage them under{" "}
          <a
            href="/settings/integrations"
            className="font-medium text-brand-500 dark:text-brand-400 hover:underline"
          >
            Integrations
          </a>
          .
        </p>
        <div className="space-y-2">
          <AccountRow
            icon={Mail}
            label={
              mail.provider === "nylas" ? "Mailbox (George's own)" : "Mailbox & calendar"
            }
            value={
              mail.connected
                ? [mailbox, mail.detail].filter(Boolean).join(" · ")
                : (mail.detail ?? mailbox ?? NO_MAILBOX)
            }
            connected={mail.connected}
          />
          <AccountRow
            icon={CalendarClock}
            label="Calendar"
            value={mail.calendar ?? "Synced with the connected mailbox"}
            connected={mail.connected}
          />
          <AccountRow
            icon={Mic}
            label="Note-taker (Scribe)"
            value={
              scribe.connected
                ? (scribe.account ?? "Connected")
                : "Not connected"
            }
            connected={scribe.connected}
          />
          <AccountRow
            icon={Database}
            label="Customer database (George's own org)"
            value={agentdbValue}
            connected={agentdb.enabled}
          />
        </div>
      </section>

      {/* Pointer to the operating model — guardrails + policies live there */}
      <section className="flex items-center justify-between gap-4 rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5">
        <div className="flex items-start gap-2.5">
          <Lock size={15} className="mt-0.5 shrink-0 text-gray-400 dark:text-gray-500" />
          <div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
              Guardrails & operating policy
            </h2>
            <p className="mt-0.5 text-theme-xs text-gray-400 dark:text-gray-500">
              George&apos;s directives, do&apos;s and don&apos;ts, toggles, and
              house rules live in the Operating Model.
            </p>
          </div>
        </div>
        <a
          href="/settings/agent/policy"
          className="inline-flex h-9 shrink-0 items-center rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 text-theme-sm font-medium text-gray-800 dark:text-white/90 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
        >
          Open Operating Model
        </a>
      </section>
    </div>
  );
}

function AccountRow({
  icon: Icon,
  label,
  value,
  connected,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  connected: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 px-3 py-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 dark:bg-brand-500/15 text-brand-500 dark:text-brand-400">
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-theme-sm font-medium text-gray-800 dark:text-white/90">{label}</div>
        <div className="truncate text-theme-xs text-gray-400 dark:text-gray-500">{value}</div>
      </div>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-theme-xs font-medium ${
          connected
            ? "bg-success-50 dark:bg-success-500/15 text-success-500"
            : "bg-gray-50 dark:bg-white/[0.03] text-gray-400 dark:text-gray-500"
        }`}
      >
        <Plug size={10} />
        {connected ? "connected" : "not connected"}
      </span>
    </div>
  );
}

function publicUrl(
  admin: ReturnType<typeof createSupabaseAdmin>,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  return admin.storage.from("org-assets").getPublicUrl(path).data.publicUrl;
}
