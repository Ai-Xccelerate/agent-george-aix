import { redirect } from "next/navigation";
import { Mail, Trash2, UserPlus, X } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseServer } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { initials } from "@/lib/utils";
import { ALLOWED_DOMAINS } from "@/lib/auth/access-policy";
import {
  changeRoleAction,
  inviteUserAction,
  removeMemberAction,
  revokeInviteAction,
} from "./actions";
import { InviteForm } from "./_invite-form";
import { RoleSelect } from "./_role-select";

export const dynamic = "force-dynamic";

type Member = {
  user_id: string;
  role: string;
  full_name: string | null;
  email: string | null;
};
type Invite = {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  status: string;
  created_at: string;
  expires_at: string;
};

const ROLE_TONE: Record<string, "accent" | "success" | "info" | "neutral"> = {
  owner: "accent",
  admin: "info",
  csm: "success",
  sales: "neutral",
  viewer: "neutral",
};

export default async function UsersSettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const isAdmin = user.role === "owner" || user.role === "admin";
  if (!isAdmin) redirect("/settings/profile");

  const supabase = await createSupabaseServer();
  const [membersRes, invitesRes] = await Promise.all([
    supabase
      .from("org_members")
      .select("user_id, role, full_name, email")
      .eq("org_id", user.orgId)
      .order("role"),
    supabase
      .from("invites")
      .select("id, email, full_name, role, status, created_at, expires_at")
      .eq("org_id", user.orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);
  const members = (membersRes.data ?? []) as Member[];
  const invites = (invitesRes.data ?? []) as Invite[];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[22px] font-bold text-[var(--color-fg)]">Users</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-secondary)]">
          {user.orgName} is invite-only. Access is limited to emails at{" "}
          {ALLOWED_DOMAINS.map((d, i) => (
            <span key={d}>
              {i > 0 && (i === ALLOWED_DOMAINS.length - 1 ? " and " : ", ")}
              <code className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[12px]">
                {d}
              </code>
            </span>
          ))}
          .
        </p>
      </header>

      {isAdmin && (
        <div className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
          <div className="mb-4 flex items-center gap-2">
            <UserPlus size={16} className="text-[var(--color-accent)]" />
            <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">
              Invite a teammate
            </h2>
          </div>
          <InviteForm action={inviteUserAction} />
        </div>
      )}

      <section className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
        <h2 className="mb-4 text-[15px] font-semibold text-[var(--color-fg)]">
          Members ({members.length})
        </h2>
        <ul className="divide-y divide-[var(--color-border-subtle)]">
          {members.map((m) => (
            <li
              key={m.user_id}
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-accent)] text-[12px] font-semibold text-[var(--color-fg-inverse)]">
                {initials(m.full_name ?? m.email ?? "?")}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[14px] font-medium text-[var(--color-fg)]">
                    {m.full_name ?? (m.user_id === user.id ? user.fullName : null) ?? "—"}
                  </span>
                  {m.user_id === user.id && (
                    <span className="text-[10px] uppercase tracking-wide text-[var(--color-fg-muted)]">
                      you
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-[var(--color-fg-muted)]">{m.email}</div>
              </div>

              <Badge tone={ROLE_TONE[m.role] ?? "neutral"}>{m.role}</Badge>

              {isAdmin && m.user_id !== user.id && m.role !== "owner" && (
                <div className="ml-2 flex items-center gap-1">
                  <RoleSelect
                    userId={m.user_id}
                    currentRole={m.role}
                    action={changeRoleAction}
                  />
                  <form action={removeMemberAction}>
                    <input type="hidden" name="user_id" value={m.user_id} />
                    <button
                      type="submit"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-error)]"
                      aria-label="Remove member"
                    >
                      <Trash2 size={13} />
                    </button>
                  </form>
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>

      {invites.length > 0 && (
        <section className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
          <h2 className="mb-4 flex items-center gap-2 text-[15px] font-semibold text-[var(--color-fg)]">
            <Mail size={14} />
            Pending invites ({invites.length})
          </h2>
          <ul className="divide-y divide-[var(--color-border-subtle)]">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-fg-muted)]">
                  <Mail size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-medium text-[var(--color-fg)]">
                    {i.full_name ?? i.email}
                  </div>
                  <div className="text-[12px] text-[var(--color-fg-muted)]">
                    {i.email} · expires {formatRelative(i.expires_at)}
                  </div>
                </div>
                <Badge tone={ROLE_TONE[i.role] ?? "neutral"}>{i.role}</Badge>
                {isAdmin && (
                  <form action={revokeInviteAction}>
                    <input type="hidden" name="invite_id" value={i.id} />
                    <button
                      type="submit"
                      className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-error)]"
                      aria-label="Revoke invite"
                    >
                      <X size={14} />
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

    </div>
  );
}

function formatRelative(iso: string) {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms < 0) return "expired";
  const days = Math.round(ms / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  return `in ${days} days`;
}
