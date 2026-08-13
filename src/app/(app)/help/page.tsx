import Link from "next/link";
import {
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
        <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">Help &amp; docs</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          How George works and how to work with him. New here? Start with{" "}
          <span className="text-gray-400 dark:text-gray-500">Getting started</span>, then
          read <span className="text-gray-400 dark:text-gray-500">Chatting with George</span>{" "}
          to see him in action.
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
      className={`block rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5 transition-colors ${
        isStub
          ? "cursor-not-allowed opacity-70"
          : "hover:border-brand-500 dark:hover:border-brand-400/40 hover:bg-gray-50 dark:hover:bg-white/[0.03]"
      }`}
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-brand-50 dark:bg-brand-500/15 text-brand-500 dark:text-brand-400">
          <Icon size={18} />
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
              {topic.title}
            </h2>
            {isStub && (
              <span className="rounded-full bg-gray-50 dark:bg-white/[0.03] px-2 py-0.5 text-theme-xs uppercase tracking-wide text-gray-400 dark:text-gray-500">
                Coming soon
              </span>
            )}
          </div>
          <p className="mt-1 text-theme-sm leading-relaxed text-gray-500 dark:text-gray-400">
            {topic.description}
          </p>
        </div>
      </div>
    </Wrap>
  );
}
