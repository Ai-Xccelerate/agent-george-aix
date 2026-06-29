"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarClock,
  FileText,
  LayoutDashboard,
  Mail,
  MessageSquare,
  Users,
  Settings,
  HelpCircle,
  LogOut,
} from "lucide-react";
import { cn, initials } from "@/lib/utils";
import { signOutAction } from "@/app/(auth)/actions";
import { BrandLogo } from "@/components/brand-logo";

const primaryNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/chat", label: "Agent George", icon: MessageSquare },
  { href: "/customers", label: "Partners", icon: Users },
];

// George's communication channels — the surfaces he operates across.
const channelNav = [
  { href: "/mailbox", label: "Mailbox", icon: Mail },
  { href: "/calendar", label: "Calendar", icon: CalendarClock },
  { href: "/transcripts", label: "Transcripts", icon: FileText },
];

export type SidebarUser = { fullName: string; email: string | null; orgName: string };

export function Sidebar({
  user,
  onNavigate,
}: {
  user: SidebarUser;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col justify-between border-r border-[var(--color-border-subtle)] bg-[var(--color-surface)] px-4 py-5">
      <div className="space-y-6">
        <Link href="/dashboard" onClick={onNavigate} className="block px-2">
          <BrandLogo />
        </Link>

        <nav className="space-y-0.5">
          {primaryNav.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
          ))}

          <div className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
            Channels
          </div>
          {channelNav.map((item) => (
            <NavLink key={item.href} item={item} pathname={pathname} onNavigate={onNavigate} />
          ))}
        </nav>
      </div>

      <UserFooter user={user} onNavigate={onNavigate} pathname={pathname} />
    </aside>
  );
}

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
};

function NavLink({
  item,
  pathname,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const { href, label, icon: Icon } = item;
  const active = pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      onClick={onNavigate}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
        active
          ? "bg-[var(--color-accent-light)] text-[var(--color-accent)] font-semibold"
          : "text-[var(--color-fg-secondary)] hover:bg-[var(--color-surface-2)]",
      )}
    >
      <Icon
        size={18}
        className={cn(active ? "text-[var(--color-accent)]" : "text-[var(--color-fg-muted)]")}
      />
      {label}
    </Link>
  );
}

function UserFooter({
  user,
  onNavigate,
  pathname,
}: {
  user: SidebarUser;
  onNavigate?: () => void;
  pathname: string | null;
}) {
  const handle = user.email ? "@" + user.email.split("@")[0] : null;
  const settingsActive =
    pathname === "/settings" || (pathname?.startsWith("/settings/") ?? false);
  const helpActive =
    pathname === "/help" || (pathname?.startsWith("/help/") ?? false);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2.5 rounded-md px-2 py-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--color-accent)] text-[var(--color-fg-inverse)] text-[12px] font-semibold">
          {initials(user.fullName)}
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-[13px] font-semibold text-[var(--color-fg)]">
            {user.fullName}
          </div>
          {handle && (
            <div className="truncate text-[12px] text-[var(--color-fg-muted)]">
              {handle}
            </div>
          )}
        </div>
      </div>

      <div className="my-1 border-t border-[var(--color-border-subtle)]" />

      <Link
        href="/help"
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors",
          helpActive
            ? "bg-[var(--color-accent-light)] font-semibold text-[var(--color-accent)]"
            : "text-[var(--color-fg-secondary)] hover:bg-[var(--color-surface-2)]",
        )}
      >
        <HelpCircle
          size={16}
          className={cn(
            helpActive ? "text-[var(--color-accent)]" : "text-[var(--color-fg-muted)]",
          )}
        />
        Help & Docs
      </Link>

      <Link
        href="/settings"
        onClick={onNavigate}
        className={cn(
          "flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition-colors",
          settingsActive
            ? "bg-[var(--color-accent-light)] font-semibold text-[var(--color-accent)]"
            : "text-[var(--color-fg-secondary)] hover:bg-[var(--color-surface-2)]",
        )}
      >
        <Settings
          size={16}
          className={cn(
            settingsActive ? "text-[var(--color-accent)]" : "text-[var(--color-fg-muted)]",
          )}
        />
        Settings
      </Link>

      <form action={signOutAction}>
        <button
          type="submit"
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-[13px] text-[var(--color-fg-secondary)] hover:bg-[var(--color-surface-2)]"
        >
          <LogOut size={16} className="text-[var(--color-fg-muted)]" />
          Log out
        </button>
      </form>
    </div>
  );
}
