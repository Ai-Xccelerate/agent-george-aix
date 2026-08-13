import { redirect } from "next/navigation";
import { CalendarClock, Lock, Mail, Mic, Plug } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getAgentSettings } from "@/lib/agent/agent-settings";
import { getScribeConnection } from "@/lib/agent/scribe";
import { DEFAULT_TIMEZONE } from "@/lib/agent/agent-settings";
import {
  listOrgIntegrations,
  type IntegrationSummary,
} from "@/lib/composio/connections";
import { AgentForm, AvatarUploadForm, type OwnerOption } from "./_agent-form";
import {
  removeAgentAvatarAction,
  updateAgentSettingsAction,
  uploadAgentAvatarAction,
} from "./actions";

export const dynamic = "force-dynamic";

const DEFAULT_MAILBOX = "agent.george@getonyx.ai";

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

  // Best-effort: what mailbox/note-taker is George actually wired to? This is
  // bound to the Composio connection, not free-text — so we read it, never edit
  // it here. Failure (bad key, outage) degrades to the default mailbox label.
  const integrationsResult = await listOrgIntegrations(user.orgId);
  const integrations = integrationsResult.ok ? integrationsResult.integrations : [];
  const mailbox = connectedAccountLabel(integrations, ["OUTLOOK", "MICROSOFTOUTLOOK", "GMAIL"]);
  // Scribe is a direct remote MCP server (not Composio) — status from env only.
  const scribe = getScribeConnection();

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
            label="Mailbox & calendar"
            value={mailbox ?? DEFAULT_MAILBOX}
            connected={Boolean(mailbox)}
          />
          <AccountRow
            icon={CalendarClock}
            label="Calendar"
            value={mailbox ? `Synced with ${mailbox}` : "Synced with the connected mailbox"}
            connected={Boolean(mailbox)}
          />
          <AccountRow
            icon={Mic}
            label="Note-taker (Scribe)"
            value={scribe.account ?? "Not connected"}
            connected={scribe.connected}
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

function connectedAccountLabel(
  integrations: IntegrationSummary[],
  toolkits: string[],
): string | null {
  const set = new Set(toolkits);
  const match = integrations.find(
    (i) => set.has(i.toolkit) && i.status === "connected",
  );
  if (!match) return null;
  return match.accountLabel ?? match.label;
}

function publicUrl(
  admin: ReturnType<typeof createSupabaseAdmin>,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  return admin.storage.from("org-assets").getPublicUrl(path).data.publicUrl;
}
