"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  BrainCircuit,
  Building2,
  BookOpen,
  Clock,
  Network,
  Puzzle,
  ScrollText,
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

type Section = { title: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    title: "Agent George",
    items: [
      { href: "/settings/agent", label: "Identity", icon: Bot, adminOnly: true },
      { href: "/settings/agent/policy", label: "Operating model", icon: ScrollText, adminOnly: true },
      { href: "/settings/agent/knowledge", label: "Knowledge review", icon: BrainCircuit, adminOnly: true },
      { href: "/settings/agent/graph", label: "Knowledge graph", icon: Network, adminOnly: true },
      { href: "/settings/integrations", label: "Integrations", icon: Puzzle, adminOnly: true },
      { href: "/settings/knowledge", label: "Knowledge", icon: BookOpen, adminOnly: true },
      { href: "/settings/jobs", label: "Standing jobs", icon: Clock, adminOnly: true },
    ],
  },
  {
    title: "Workspace",
    items: [
      { href: "/settings/profile", label: "Your profile", icon: User },
      { href: "/settings/users", label: "Users", icon: Users, adminOnly: true },
      { href: "/settings/organization", label: "Organization", icon: Building2, adminOnly: true },
    ],
  },
];

export function SettingsNav({ isAdmin }: { isAdmin: boolean }) {
  const pathname = usePathname();

  // Pick the single best-matching href (longest prefix) so nested routes like
  // /settings/agent/policy don't also light up the parent /settings/agent.
  const activeHref = SECTIONS.flatMap((s) => s.items)
    .map((i) => i.href)
    .filter((href) => pathname === href || pathname.startsWith(href + "/"))
    .sort((a, b) => b.length - a.length)[0];

  return (
    <nav className="space-y-5">
      {SECTIONS.map((section) => {
        const visible = section.items.filter((i) => !i.adminOnly || isAdmin);
        if (visible.length === 0) return null;
        return (
          <div key={section.title} className="space-y-0.5">
            <h3 className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
              {section.title}
            </h3>
            {visible.map(({ href, label, icon: Icon, adminOnly }) => {
              const active = href === activeHref;
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
          </div>
        );
      })}
    </nav>
  );
}
