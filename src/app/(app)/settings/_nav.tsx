"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bot,
  Building2,
  BookOpen,
  Globe2,
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
  approverOnly?: boolean;
};

type Section = { title: string; items: Item[] };

const SECTIONS: Section[] = [
  {
    title: "AIX George",
    items: [
      { href: "/settings/agent", label: "Identity", icon: Bot, adminOnly: true },
      { href: "/settings/agent/policy", label: "Operating model", icon: ScrollText, adminOnly: true },
      { href: "/settings/agent/domains", label: "Email domains", icon: Globe2, approverOnly: true },
      { href: "/settings/integrations", label: "Integrations", icon: Puzzle, adminOnly: true },
      { href: "/settings/knowledge", label: "Knowledge", icon: BookOpen, adminOnly: true },
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

export function SettingsNav({
  isAdmin,
  isApprover,
}: {
  isAdmin: boolean;
  isApprover: boolean;
}) {
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
        const visible = section.items.filter(
          (i) => (!i.adminOnly || isAdmin) && (!i.approverOnly || isApprover),
        );
        if (visible.length === 0) return null;
        return (
          <div key={section.title} className="space-y-0.5">
            <h3 className="mb-1.5 px-3 text-theme-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
              {section.title}
            </h3>
            {visible.map(({ href, label, icon: Icon, adminOnly, approverOnly }) => {
              const active = href === activeHref;
              return (
                <Link
                  key={href}
                  href={href}
                  className={cn(
                    "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors",
                    active
                      ? "bg-brand-50 dark:bg-brand-500/15 text-brand-500 dark:text-brand-400 font-semibold"
                      : "text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/[0.03]",
                  )}
                >
                  <Icon
                    size={16}
                    className={cn(
                      active ? "text-brand-500 dark:text-brand-400" : "text-gray-400 dark:text-gray-500",
                    )}
                  />
                  <span className="flex-1">{label}</span>
                  {(adminOnly || approverOnly) && (
                    <ShieldCheck
                      size={11}
                      className="text-gray-400 dark:text-gray-500"
                      aria-label={adminOnly ? "admin only" : "owner, admin, or CSM"}
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
