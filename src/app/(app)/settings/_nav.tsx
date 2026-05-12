"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Building2,
  BookOpen,
  Clock,
  Puzzle,
  ShieldCheck,
  User,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

type Item = {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  adminOnly?: boolean;
};

const ITEMS: Item[] = [
  { href: "/settings/profile", label: "Your profile", icon: User },
  { href: "/settings/users", label: "Users", icon: Users, adminOnly: true },
  { href: "/settings/integrations", label: "Integrations", icon: Puzzle, adminOnly: true },
  { href: "/settings/knowledge", label: "Knowledge", icon: BookOpen, adminOnly: true },
  { href: "/settings/organization", label: "Organization", icon: Building2, adminOnly: true },
  { href: "/settings/jobs", label: "Standing jobs", icon: Clock, adminOnly: true },
];

export function SettingsNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();
  const visible = ITEMS.filter((i) => !i.adminOnly || isAdmin);

  return (
    <nav className="space-y-0.5">
      {visible.map(({ href, label, icon: Icon, adminOnly }) => {
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
              size={16}
              className={cn(
                active ? "text-[var(--color-accent)]" : "text-[var(--color-fg-muted)]",
              )}
            />
            <span className="flex-1">{label}</span>
            {adminOnly && (
              <ShieldCheck
                size={11}
                className="text-[var(--color-fg-muted)]"
                aria-label="admin only"
              />
            )}
          </Link>
        );
      })}
    </nav>
  );
}
