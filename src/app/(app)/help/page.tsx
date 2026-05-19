import Link from "next/link";
import {
  Clock,
  MessageSquare,
  Plug,
  Settings as SettingsIcon,
  Sparkles,
} from "lucide-react";

type Topic = {
  href: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  status?: "live" | "stub";
};

const TOPICS: Topic[] = [
  {
    href: "/help/standing-jobs",
    title: "Standing jobs",
    description:
      "How George works on his own — scheduled cadence prep, inbox triage, health sweeps. Writing directives, reading runs, what he can and can't do autonomously.",
    icon: Clock,
    status: "live",
  },
  {
    href: "/help/getting-started",
    title: "Getting started",
    description:
      "Sign in, invite teammates, connect M365 and Fireflies, and have your first conversation with George.",
    icon: Sparkles,
    status: "stub",
  },
  {
    href: "/help/chat",
    title: "Chatting with George",
    description:
      "How to give George context, the email draft-then-confirm pattern, when to use AskUserQuestion, and how he uses the knowledge base.",
    icon: MessageSquare,
    status: "stub",
  },
  {
    href: "/help/integrations",
    title: "Integrations",
    description:
      "Connecting Microsoft 365 (Outlook + Calendar), Fireflies, and OneDrive through Composio. Org-scoped — every teammate shares the same connection.",
    icon: Plug,
    status: "stub",
  },
  {
    href: "/help/settings",
    title: "Settings",
    description:
      "Profile, organization, users + roles, and admin-only screens. Who can do what.",
    icon: SettingsIcon,
    status: "stub",
  },
];

export default function HelpIndexPage() {
  return (
    <div className="mx-auto max-w-[1180px] space-y-6 px-4 py-5 sm:px-6 md:px-8 md:py-7">
      <header>
        <h1 className="text-[22px] font-bold text-[var(--color-fg)]">Help &amp; docs</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-secondary)]">
          How George works and how to work with him. New here? Start with{" "}
          <Link
            href="/help/standing-jobs"
            className="text-[var(--color-accent)] underline-offset-2 hover:underline"
          >
            Standing jobs
          </Link>{" "}
          to understand the autonomous side, then read{" "}
          <span className="text-[var(--color-fg-muted)]">Chatting with George</span> for
          the live side.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {TOPICS.map((t) => (
          <TopicCard key={t.href} topic={t} />
        ))}
      </div>
    </div>
  );
}

function TopicCard({ topic }: { topic: Topic }) {
  const isStub = topic.status === "stub";
  const Icon = topic.icon;
  const Wrap = isStub
    ? (props: React.HTMLAttributes<HTMLDivElement>) => <div {...props} />
    : (props: React.HTMLAttributes<HTMLAnchorElement>) => (
        <Link href={topic.href} {...props} />
      );
  return (
    <Wrap
      className={`block rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5 transition-colors ${
        isStub
          ? "cursor-not-allowed opacity-70"
          : "hover:border-[var(--color-accent)]/40 hover:bg-[var(--color-surface-2)]"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--color-accent-light)] text-[var(--color-accent)]">
          <Icon size={18} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">
              {topic.title}
            </h2>
            {isStub && (
              <span className="rounded-full bg-[var(--color-surface-2)] px-2 py-0.5 text-[10px] uppercase tracking-wide text-[var(--color-fg-muted)]">
                Coming soon
              </span>
            )}
          </div>
          <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-fg-secondary)]">
            {topic.description}
          </p>
        </div>
      </div>
    </Wrap>
  );
}
