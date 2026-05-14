import Link from "next/link";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Inbox as InboxIcon,
  Mail,
  MessageSquare,
} from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseServer } from "@/lib/supabase/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type EventRow = {
  id: string;
  event_type: string;
  status: string;
  payload: Record<string, unknown> | null;
  session_id: string | null;
  created_at: string;
};

type AuditRow = {
  id: string;
  action: string;
  payload: Record<string, unknown> | null;
  customer_id: string | null;
  session_id: string | null;
  created_at: string;
};

type Item =
  | {
      kind: "inbound";
      key: string;
      eventId: string;
      created_at: string;
      from: string | null;
      subject: string | null;
      preview: string | null;
      status: string;
      sessionId: string | null;
    }
  | {
      kind: "outbound";
      key: string;
      auditId: string;
      created_at: string;
      action: "drafted" | "reply_drafted" | "sent";
      to: string | null;
      subject: string | null;
      draftId: string | null;
      sessionId: string | null;
    };

export default async function InboxPage({
  searchParams,
}: {
  searchParams?: Promise<{ filter?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const filter: "all" | "inbound" | "outbound" =
    sp.filter === "inbound" || sp.filter === "outbound" ? sp.filter : "all";

  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  const supabase = await createSupabaseServer();

  // Inbound: agent_events for inbound triggers. Tolerant of the table not
  // existing yet (migration 20260515000600 needs to be applied) and of
  // PostgREST returning an opaque {} on schema errors — any error here means
  // the inbound side isn't fully wired, so we surface the banner instead.
  let eventRows: EventRow[] = [];
  let eventsTableMissing = false;
  const eventsRes = await supabase
    .from("agent_events")
    .select("id, event_type, status, payload, session_id, created_at")
    .eq("org_id", user.orgId)
    // OUTLOOK_MESSAGE_TRIGGER is the current Composio slug; OUTLOOK_NEW_MESSAGE
    // is kept as the legacy alias used by older trigger registrations. The
    // webhook + processor accept both, so the inbox surfaces both too.
    .in("event_type", ["OUTLOOK_MESSAGE_TRIGGER", "OUTLOOK_NEW_MESSAGE"])
    .order("created_at", { ascending: false })
    .limit(200);
  if (eventsRes.error) {
    eventsTableMissing = true;
  } else {
    eventRows = (eventsRes.data ?? []) as EventRow[];
  }

  // Outbound: audit_log rows for email-related actions George logs.
  const auditRes = await supabase
    .from("audit_log")
    .select("id, action, payload, customer_id, session_id, created_at")
    .eq("org_id", user.orgId)
    .in("action", ["email.drafted", "email.reply_drafted", "email.sent"])
    .order("created_at", { ascending: false })
    .limit(200);
  const auditRows = (auditRes.data ?? []) as AuditRow[];

  const allItems: Item[] = [
    ...eventRows.map<Item>((e) => {
      const email = parseOutlookFields(e.payload);
      return {
        kind: "inbound",
        key: `e:${e.id}`,
        eventId: e.id,
        created_at: e.created_at,
        from: email.fromLabel,
        subject: email.subject,
        preview: email.preview,
        status: e.status,
        sessionId: e.session_id,
      };
    }),
    ...auditRows.map<Item>((a) => {
      const p = (a.payload ?? {}) as Record<string, unknown>;
      const toList = Array.isArray(p.to)
        ? (p.to as unknown[]).filter((x): x is string => typeof x === "string")
        : [];
      return {
        kind: "outbound",
        key: `a:${a.id}`,
        auditId: a.id,
        created_at: a.created_at,
        action: a.action.replace("email.", "") as
          | "drafted"
          | "reply_drafted"
          | "sent",
        to: toList.length > 0 ? toList.join(", ") : null,
        subject: (p.subject as string) ?? null,
        draftId: (p.draft_id as string) ?? null,
        sessionId: a.session_id,
      };
    }),
  ].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  const counts = {
    all: allItems.length,
    inbound: allItems.filter((i) => i.kind === "inbound").length,
    outbound: allItems.filter((i) => i.kind === "outbound").length,
  };
  const items =
    filter === "all" ? allItems : allItems.filter((i) => i.kind === filter);

  return (
    <div className="mx-auto max-w-[1180px] space-y-6 px-8 py-7">
      <header className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--color-fg)]">Inbox</h1>
          <p className="text-sm text-[var(--color-fg-secondary)]">
            Every email George touches — inbound to{" "}
            <code className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[12px]">
              george@onyx
            </code>{" "}
            and outbound drafts/sends. Click any row to open the chat
            session it lives in.
          </p>
        </div>
        <Link
          href="/chat"
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
        >
          <MessageSquare size={14} />
          Compose in chat
        </Link>
      </header>

      <FilterStrip current={filter} counts={counts} />

      {eventsTableMissing && (
        <div className="rounded-md border border-[var(--color-warning)]/40 bg-[var(--color-warning)]/10 px-4 py-3 text-[13px] text-[var(--color-fg-secondary)]">
          Inbound side isn&apos;t wired yet. Apply migration{" "}
          <code className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[12px]">
            20260515000600_agent_events.sql
          </code>{" "}
          and configure the Composio{" "}
          <code className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[12px]">
            OUTLOOK_NEW_MESSAGE
          </code>{" "}
          trigger to start seeing inbound items here (backlog #1).
        </div>
      )}

      {items.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <ul className="divide-y divide-[var(--color-border-subtle)] overflow-hidden rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
          {items.map((it) =>
            it.kind === "inbound" ? (
              <InboundRow key={it.key} item={it} />
            ) : (
              <OutboundRow key={it.key} item={it} />
            ),
          )}
        </ul>
      )}
    </div>
  );
}

function InboundRow({ item }: { item: Extract<Item, { kind: "inbound" }> }) {
  // Inbound always links to the dedicated email viewer at /inbox/[id].
  // Opening it in /chat/[sessionId] was wrong — the chat path renders the
  // raw HTML as plain text and frames it like a conversation, not mail.
  return (
    <li>
      <Link
        href={`/inbox/${item.eventId}`}
        className="flex items-start gap-3 px-4 py-3 text-[13px] hover:bg-[var(--color-surface-3)]"
      >
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-accent-light)] text-[var(--color-accent)]">
          <ArrowDownLeft size={13} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-[var(--color-fg)]">
              {item.subject ?? "(no subject)"}
            </span>
            <InboundStatusBadge status={item.status} />
          </div>
          <div className="mt-0.5 text-[12px] text-[var(--color-fg-secondary)]">
            from {item.from ?? "(unknown sender)"}
          </div>
          {item.preview && (
            <div className="mt-1 line-clamp-2 text-[12px] text-[var(--color-fg-muted)]">
              {item.preview}
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 text-[11px] text-[var(--color-fg-muted)]">
          <span>{relative(item.created_at)}</span>
          {item.sessionId && (
            <span className="inline-flex items-center gap-1 text-[var(--color-accent)]">
              <MessageSquare size={10} />
              Reviewed
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}

function OutboundRow({ item }: { item: Extract<Item, { kind: "outbound" }> }) {
  // Always route through the outbound viewer — it renders the draft body
  // (fetched live from Outlook) and offers a link into the chat session if
  // one exists. Linking straight to /chat skipped the email itself.
  return (
    <li>
      <Link
        href={`/inbox/outbound/${item.auditId}`}
        className="flex items-start gap-3 px-4 py-3 text-[13px] hover:bg-[var(--color-surface-3)]"
      >
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-2)] text-[var(--color-fg-secondary)]">
          <ArrowUpRight size={13} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-[var(--color-fg)]">
              {item.subject ?? "(no subject)"}
            </span>
            <OutboundStatusBadge action={item.action} />
          </div>
          <div className="mt-0.5 text-[12px] text-[var(--color-fg-secondary)]">
            {item.to ? `to ${item.to}` : "(no recipient captured)"}
          </div>
        </div>
        <div className="shrink-0 text-[11px] text-[var(--color-fg-muted)]">
          {relative(item.created_at)}
        </div>
      </Link>
    </li>
  );
}

function InboundStatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    { label: string; bg: string; fg: string }
  > = {
    pending: {
      label: "Pending",
      bg: "var(--color-warning)",
      fg: "var(--color-fg-inverse)",
    },
    processing: {
      label: "Processing",
      bg: "var(--color-info)",
      fg: "var(--color-fg-inverse)",
    },
    processed: {
      label: "Reviewed",
      bg: "var(--color-success-light)",
      fg: "var(--color-success)",
    },
    failed: {
      label: "Failed",
      bg: "var(--color-error)",
      fg: "var(--color-fg-inverse)",
    },
    skipped: {
      label: "Skipped",
      bg: "var(--color-surface-2)",
      fg: "var(--color-fg-muted)",
    },
  };
  const v = map[status] ?? {
    label: status,
    bg: "var(--color-surface-2)",
    fg: "var(--color-fg-muted)",
  };
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-[1px] text-[10px] font-medium"
      style={{ background: v.bg, color: v.fg }}
    >
      {v.label}
    </span>
  );
}

function OutboundStatusBadge({
  action,
}: {
  action: "drafted" | "reply_drafted" | "sent";
}) {
  if (action === "sent") {
    return (
      <span
        className="inline-flex items-center rounded-full px-2 py-[1px] text-[10px] font-medium"
        style={{
          background: "var(--color-success-light)",
          color: "var(--color-success)",
        }}
      >
        Sent
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-[1px] text-[10px] font-medium"
      style={{
        background: "var(--color-accent-light)",
        color: "var(--color-accent)",
      }}
    >
      Draft
    </span>
  );
}

function FilterStrip({
  current,
  counts,
}: {
  current: "all" | "inbound" | "outbound";
  counts: { all: number; inbound: number; outbound: number };
}) {
  const tabs: Array<{
    key: "all" | "inbound" | "outbound";
    label: string;
    count: number;
  }> = [
    { key: "all", label: "All", count: counts.all },
    { key: "inbound", label: "Inbound", count: counts.inbound },
    { key: "outbound", label: "Outbound", count: counts.outbound },
  ];

  return (
    <div
      role="tablist"
      aria-label="Inbox filter"
      className="flex flex-wrap gap-1 rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-1"
    >
      {tabs.map((t) => {
        const isActive = t.key === current;
        const href = t.key === "all" ? "/inbox" : `/inbox?filter=${t.key}`;
        return (
          <Link
            key={t.key}
            href={href}
            role="tab"
            aria-selected={isActive}
            className={
              isActive
                ? "inline-flex h-9 items-center gap-2 rounded-md bg-[var(--color-accent-light)] px-3 text-[13px] font-semibold text-[var(--color-accent)]"
                : "inline-flex h-9 items-center gap-2 rounded-md px-3 text-[13px] text-[var(--color-fg-secondary)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-fg)]"
            }
          >
            <span>{t.label}</span>
            <span
              className={
                isActive
                  ? "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-accent)] px-1.5 text-[11px] font-medium text-[var(--color-fg-inverse)]"
                  : "inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[var(--color-surface-3)] px-1.5 text-[11px] font-medium text-[var(--color-fg-secondary)]"
              }
            >
              {t.count}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function EmptyState({ filter }: { filter: "all" | "inbound" | "outbound" }) {
  const copy =
    filter === "inbound"
      ? {
          title: "No inbound emails yet",
          body: "Once Composio's OUTLOOK_NEW_MESSAGE trigger is wired up, inbound mail to george@onyx will land here for review.",
        }
      : filter === "outbound"
        ? {
            title: "No drafts or sends yet",
            body: "When George drafts a reply or sends a follow-up in chat, it lands here. Open a chat and ask him to draft something to see the first row.",
          }
        : {
            title: "Quiet in here",
            body: "Every email George picks up or sends will show here. Ask him to draft a follow-up in chat, or configure inbound forwarding to start the flow.",
          };

  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[12px] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-accent-light)] text-[var(--color-accent)]">
        <InboxIcon size={20} />
      </div>
      <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">
        {copy.title}
      </h2>
      <p className="max-w-[440px] text-sm text-[var(--color-fg-secondary)]">
        {copy.body}
      </p>
      <Link
        href="/chat"
        className="mt-1 inline-flex items-center gap-1.5 rounded-md bg-[var(--color-accent)] px-3 py-2 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)]"
      >
        <Mail size={14} />
        Compose in chat
      </Link>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseOutlookFields(payload: Record<string, unknown> | null | undefined): {
  fromLabel: string | null;
  subject: string | null;
  preview: string | null;
} {
  if (!payload) {
    return { fromLabel: null, subject: null, preview: null };
  }
  const candidates: Array<Record<string, unknown>> = [];
  const push = (v: unknown) => {
    if (v && typeof v === "object") candidates.push(v as Record<string, unknown>);
  };
  push(payload);
  push(payload.data);
  const inner = payload.payload as Record<string, unknown> | undefined;
  if (inner) {
    push(inner);
    push(inner.data);
  }

  const pick = <T,>(
    ...fns: Array<(o: Record<string, unknown>) => T | null | undefined>
  ): T | null => {
    for (const c of candidates) {
      for (const fn of fns) {
        try {
          const v = fn(c);
          if (v != null) return v;
        } catch {
          // ignore
        }
      }
    }
    return null;
  };

  const subject = pick<string>((o) => o.subject as string);

  const preview = pick<string>(
    (o) => o.bodyPreview as string,
    (o) => o.body_preview as string,
    (o) => {
      const b = o.body;
      if (typeof b === "string") return b.slice(0, 200);
      if (b && typeof b === "object") {
        const content = (b as { content?: string }).content;
        return content ? content.slice(0, 200) : null;
      }
      return null;
    },
  );

  const fromLabel = pick<string>(
    (o) => {
      const f = o.from;
      if (typeof f === "string") return f;
      if (f && typeof f === "object") {
        const obj = f as Record<string, unknown>;
        const ea = obj.emailAddress as Record<string, unknown> | undefined;
        const name = (ea?.name as string) ?? (obj.name as string) ?? null;
        const address =
          (ea?.address as string) ?? (obj.address as string) ?? null;
        if (name && address) return `${name} <${address}>`;
        return address ?? name ?? null;
      }
      return null;
    },
    (o) => {
      const sender = o.sender as Record<string, unknown> | undefined;
      const ea = sender?.emailAddress as Record<string, unknown> | undefined;
      const address = (ea?.address as string) ?? null;
      const name = (ea?.name as string) ?? null;
      if (name && address) return `${name} <${address}>`;
      return address ?? name ?? null;
    },
  );

  return { fromLabel, subject, preview };
}

function relative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
