"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Inbox,
  LayoutDashboard,
  MessageSquare,
  Users,
  Settings,
  HelpCircle,
  LogOut,
} from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { signOutAction } from "@/app/(auth)/actions";
import { BrandLogo } from "@/components/brand-logo";

const nav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/chat", label: "Agent George", icon: MessageSquare },
  { href: "/customers", label: "Channel partners", icon: Users },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/settings", label: "Settings", icon: Settings },
];

type SidebarUser = { fullName: string; email: string | null; orgName: string };

export function Sidebar({ user }: { user: SidebarUser }) {
  const pathname = usePathname();

  return (
    <aside className="flex w-60 shrink-0 flex-col justify-between border-r border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-5">
      <div className="space-y-6">
        <Link href="/dashboard" className="block px-2">
          <BrandLogo />
        </Link>

        <nav className="space-y-0.5">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-[var(--color-accent-light)] text-[var(--color-accent)] font-semibold"
                    : "text-[var(--color-fg-secondary)] hover:bg-[var(--color-surface-2)]",
                )}
              >
                <Icon
                  size={18}
                  className={cn(
                    active ? "text-[var(--color-accent)]" : "text-[var(--color-fg-muted)]",
                  )}
                />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="space-y-3">
        <Link
          href="/help"
          className="flex items-center gap-2 rounded-md px-3 py-2 text-[13px] text-[var(--color-fg-secondary)] hover:bg-[var(--color-surface-2)]"
        >
          <HelpCircle size={16} className="text-[var(--color-fg-muted)]" />
          Help & Docs
        </Link>

        <UserChip user={user} />
      </div>
    </aside>
  );
}

function UserChip({ user }: { user: SidebarUser }) {
  return (
    <div className="flex items-center gap-2.5 rounded-md px-3 py-2.5">
      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-fg-inverse)] text-xs font-semibold">
        {initials(user.fullName)}
      </div>
      <div className="min-w-0 flex-1 leading-tight">
        <div className="truncate text-[13px] font-medium text-[var(--color-fg)]">
          {user.fullName}
        </div>
        <div className="truncate text-xs text-[var(--color-fg-muted)]">{user.orgName}</div>
      </div>
      <form action={signOutAction}>
        <button
          aria-label="Sign out"
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--color-fg-muted)] hover:bg-[var(--color-surface-2)]"
        >
          <LogOut size={14} />
        </button>
      </form>
    </div>
  );
}
