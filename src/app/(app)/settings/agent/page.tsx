import { redirect } from "next/navigation";
import { CalendarClock, Lock, Mail, Mic, Plug } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getAgentSettings } from "@/lib/agent/agent-settings";
import { getScribeConnection } from "@/lib/agent/scribe";
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
        <h1 className="text-[22px] font-bold text-[var(--color-fg)]">Agent George</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-secondary)]">
          George&apos;s identity as an employee — who he is, how he sounds, who he
          reports to, and the accounts he operates from. These shape every chat,
          email draft, and standing job.
        </p>
      </header>

      {/* Identity card */}
      <section className="flex items-center gap-4 rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--color-accent-light)] text-[var(--color-accent)]">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt={agent.name} className="h-full w-full object-cover" />
          ) : (
            <span className="text-[22px] font-bold">{agent.name.slice(0, 1).toUpperCase()}</span>
          )}
        </div>
        <div>
          <div className="text-[17px] font-semibold text-[var(--color-fg)]">{agent.name}</div>
          <div className="text-[13px] text-[var(--color-fg-secondary)]">{agent.title}</div>
          {agent.bio && (
            <div className="mt-1 max-w-[560px] text-[12px] text-[var(--color-fg-muted)]">
              {agent.bio}
            </div>
          )}
        </div>
      </section>

      {/* Configuration */}
      <section className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
        <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">Configuration</h2>
        <p className="mt-1 mb-4 text-[12px] text-[var(--color-fg-muted)]">
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
          }}
        />
      </section>

      {/* Avatar */}
      <section className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
        <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">Avatar</h2>
        <p className="mt-1 mb-4 text-[12px] text-[var(--color-fg-muted)]">
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
              className="text-[12px] font-medium text-[var(--color-fg-muted)] underline-offset-2 hover:text-[var(--color-error)] hover:underline"
            >
              Remove avatar
            </button>
          </form>
        )}
      </section>

      {/* Accounts George operates from — bound to Integrations, not editable here */}
      <section className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
        <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">
          Accounts George operates from
        </h2>
        <p className="mt-1 mb-4 text-[12px] text-[var(--color-fg-muted)]">
          These belong to George, not to you. They&apos;re wired through Composio —
          manage them under{" "}
          <a
            href="/settings/integrations"
            className="font-medium text-[var(--color-accent)] hover:underline"
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
      <section className="flex items-center justify-between gap-4 rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
        <div className="flex items-start gap-2.5">
          <Lock size={15} className="mt-0.5 shrink-0 text-[var(--color-fg-muted)]" />
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">
              Guardrails & operating policy
            </h2>
            <p className="mt-0.5 text-[12px] text-[var(--color-fg-muted)]">
              George&apos;s directives, do&apos;s and don&apos;ts, toggles, and
              house rules live in the Operating Model.
            </p>
          </div>
        </div>
        <a
          href="/settings/agent/policy"
          className="inline-flex h-9 shrink-0 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-[13px] font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
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
    <div className="flex items-center gap-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-3 py-2.5">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--color-accent-light)] text-[var(--color-accent)]">
        <Icon size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-medium text-[var(--color-fg)]">{label}</div>
        <div className="truncate text-[12px] text-[var(--color-fg-muted)]">{value}</div>
      </div>
      <span
        className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium ${
          connected
            ? "bg-[var(--color-success-light)] text-[var(--color-success)]"
            : "bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]"
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
