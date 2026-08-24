import { redirect } from "next/navigation";
import { Mail, Trash2, UserPlus, X } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { Badge } from "@/components/ui/badge";
import { initials } from "@/lib/utils";
import { resolveOrgIdentity } from "@/lib/agent/identity";
import {
  changeRoleAction,
  removeMemberAction,
  revokeInviteAction,
} from "./actions";
import { RoleSelect } from "./_role-select";

const CORE_URL = process.env.NEXT_PUBLIC_CORE_URL ?? "https://app-staging.aiworkforce.md";

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

  const admin = createSupabaseAdmin();

  // Which domains count as this org's own — resolved from the org row rather
  // than a hardcoded list, which previously named another company's domain.
  const internalDomains = [...(await resolveOrgIdentity(admin, user.orgId)).internalDomains];
  const [membersRes, invitesRes] = await Promise.all([
    admin
      .from("org_members")
      .select("user_id, role, full_name, email")
      .eq("org_id", user.orgId)
      .order("role"),
    admin
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
        <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">Users</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {user.orgName} is invite-only.{" "}
          {internalDomains.length > 0 ? (
            <>
              Access is limited to emails at{" "}
              {internalDomains.map((d, i) => (
                <span key={d}>
                  {i > 0 && (i === internalDomains.length - 1 ? " and " : ", ")}
                  <code className="rounded bg-gray-50 dark:bg-white/[0.03] px-1 py-0.5 text-theme-xs">
                    {d}
                  </code>
                </span>
              ))}
            </>
          ) : (
            <>
              No email domain is configured for this organisation yet, so George
              treats every address as external.
            </>
          )}
          .
        </p>
      </header>

      {isAdmin && (
        <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5">
          <div className="mb-2 flex items-center gap-2">
            <UserPlus size={16} className="text-brand-500 dark:text-brand-400" />
            <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
              Invite a teammate
            </h2>
          </div>
          <p className="mb-4 text-theme-sm text-gray-500 dark:text-gray-400">
            Teammates are invited and granted George access from the AIX Core
            dashboard. New members show up here once they sign in.
          </p>
          <a
            href={CORE_URL}
            className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900"
          >
            Manage access in AIX Core
          </a>
        </div>
      )}

      <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5">
        <h2 className="mb-4 text-base font-semibold text-gray-800 dark:text-white/90">
          Members ({members.length})
        </h2>
        <ul className="divide-y divide-gray-100 dark:divide-gray-800">
          {members.map((m) => (
            <li
              key={m.user_id}
              className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-500 text-theme-xs font-semibold text-white">
                {initials(m.full_name ?? m.email ?? "?")}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
                    {m.full_name ?? (m.user_id === user.id ? user.fullName : null) ?? "—"}
                  </span>
                  {m.user_id === user.id && (
                    <span className="text-theme-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
                      you
                    </span>
                  )}
                </div>
                <div className="text-theme-xs text-gray-400 dark:text-gray-500">{m.email}</div>
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
                      className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-white/[0.03] hover:text-error-500"
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
        <section className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold text-gray-800 dark:text-white/90">
            <Mail size={14} />
            Pending invites ({invites.length})
          </h2>
          <ul className="divide-y divide-gray-100 dark:divide-gray-800">
            {invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-50 dark:bg-white/[0.03] text-gray-400 dark:text-gray-500">
                  <Mail size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-theme-sm font-medium text-gray-800 dark:text-white/90">
                    {i.full_name ?? i.email}
                  </div>
                  <div className="text-theme-xs text-gray-400 dark:text-gray-500">
                    {i.email} · expires {formatRelative(i.expires_at)}
                  </div>
                </div>
                <Badge tone={ROLE_TONE[i.role] ?? "neutral"}>{i.role}</Badge>
                {isAdmin && (
                  <div className="ml-2 flex items-center gap-1">
                    <form action={revokeInviteAction}>
                      <input type="hidden" name="invite_id" value={i.id} />
                      <button
                        type="submit"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-white/[0.03] hover:text-error-500"
                        aria-label="Revoke invite"
                      >
                        <X size={14} />
                      </button>
                    </form>
                  </div>
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
