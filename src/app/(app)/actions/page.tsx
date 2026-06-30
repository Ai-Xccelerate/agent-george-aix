import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, Mail, MessageSquare, Inbox } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveEscalationAction } from "../dashboard/actions";
import { SafeHtml } from "./_safe-html";

export const dynamic = "force-dynamic";

/**
 * AI actions — the lean queue of what George needs from a human, as a
 * master-detail: the list on the left, the selected item's detail + who
 * approves + the action on the right. Two real sources, no demo data:
 *   - escalations George raised (decisions to make)
 *   - email drafts not yet sent (replies to approve)
 * Customer-specific work also surfaces on that partner's page; this is the
 * cross-book catch-all.
 */
type Item = {
  key: string;
  kind: "decision" | "draft";
  title: string;
  sub: string | null;
  customerId: string | null;
  customerName: string | null;
  sessionId: string | null;
  createdAt: string;
  detail?: string | null;
  recommendation?: string | null;
  urgency?: string;
  escalationId?: string;
  to?: string[];
  bodyHtml?: string | null;
};

export default async function ActionsPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const admin = createSupabaseAdmin();
  const { item: selectedKey } = await searchParams;

  const [escRes, draftRes, sentRes, ownerRes] = await Promise.all([
    admin
      .from("escalations")
      .select(
        "id, title, detail, recommendation, urgency, customer_id, session_id, created_at, customers(name)",
      )
      .eq("org_id", user.orgId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(50),
    admin
      .from("audit_log")
      .select("id, action, payload, customer_id, session_id, created_at, customers(name)")
      .eq("org_id", user.orgId)
      .in("action", ["email.drafted", "email.reply_drafted"])
      .order("created_at", { ascending: false })
      .limit(50),
    admin
      .from("audit_log")
      .select("payload")
      .eq("org_id", user.orgId)
      .eq("action", "email.sent")
      .limit(500),
    admin
      .from("agent_settings")
      .select("owner_user_id")
      .eq("org_id", user.orgId)
      .eq("agent_slug", "george")
      .maybeSingle(),
  ]);

  let approver: string | null = null;
  const ownerId = ownerRes.data?.owner_user_id as string | null | undefined;
  if (ownerId) {
    const m = await admin
      .from("org_members")
      .select("full_name, email")
      .eq("org_id", user.orgId)
      .eq("user_id", ownerId)
      .maybeSingle();
    approver = [m.data?.full_name, m.data?.email].filter(Boolean).join(" · ") || null;
  }

  const sentDraftIds = new Set(
    ((sentRes.data ?? []) as Array<{ payload: { draft_id?: string } | null }>)
      .map((r) => r.payload?.draft_id)
      .filter((x): x is string => !!x),
  );

  const decisions: Item[] = ((escRes.data ?? []) as RawEsc[]).map((e) => ({
    key: `decision:${e.id}`,
    kind: "decision",
    title: e.title,
    sub: null,
    customerId: e.customer_id,
    customerName: name(e.customers),
    sessionId: e.session_id,
    createdAt: e.created_at,
    detail: e.detail,
    recommendation: e.recommendation,
    urgency: e.urgency,
    escalationId: e.id,
  }));

  const drafts: Item[] = ((draftRes.data ?? []) as RawDraft[])
    .filter((r) => {
      const id = r.payload?.draft_id;
      return id ? !sentDraftIds.has(id) : false;
    })
    .map((r) => ({
      key: `draft:${r.id}`,
      kind: "draft",
      title: r.payload?.subject || "(no subject)",
      sub: (r.payload?.to ?? []).join(", ") || null,
      customerId: r.customer_id,
      customerName: name(r.customers),
      sessionId: r.session_id,
      createdAt: r.created_at,
      to: r.payload?.to ?? [],
      bodyHtml: r.payload?.body_html ?? null,
    }));

  const items = [...decisions, ...drafts];
  const selected = items.find((i) => i.key === selectedKey) ?? items[0] ?? null;

  return (
    <div className="w-full px-4 py-5 sm:px-6 md:px-8 md:py-7 2xl:px-12">
      <header className="mb-5">
        <h1 className="text-[22px] font-bold text-[var(--color-fg)]">AI actions</h1>
        <p className="mt-1 text-sm text-[var(--color-fg-secondary)]">
          What George needs from you across the book — decisions to make and drafts to
          review. Anything tied to one partner also shows on that partner&apos;s page.
        </p>
      </header>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-[12px] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-accent-light)] text-[var(--color-accent)]">
            <Inbox size={20} />
          </div>
          <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">All clear</h2>
          <p className="max-w-[420px] text-sm text-[var(--color-fg-secondary)]">
            No decisions or drafts waiting. George surfaces them here as they come up.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-4">
            <ListGroup label="Decisions" count={decisions.length} icon={<Bell size={13} />}>
              {decisions.map((d) => (
                <ListRow key={d.key} item={d} active={selected?.key === d.key} />
              ))}
            </ListGroup>
            <ListGroup label="Drafts to review" count={drafts.length} icon={<Mail size={13} />}>
              {drafts.map((d) => (
                <ListRow key={d.key} item={d} active={selected?.key === d.key} />
              ))}
            </ListGroup>
          </div>

          <div className="rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] p-5">
            {selected ? <Detail item={selected} approver={approver} /> : null}
          </div>
        </div>
      )}
    </div>
  );
}

function Detail({ item, approver }: { item: Item; approver: string | null }) {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {item.kind === "decision" && item.urgency === "high" && (
            <span className="rounded-full bg-[var(--color-error)]/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-error)]">
              high
            </span>
          )}
          {item.customerName && (
            <Link
              href={item.customerId ? `/customers/${item.customerId}` : "#"}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--color-accent-light)] px-2.5 py-0.5 text-[12px] font-semibold text-[var(--color-accent)] hover:underline"
            >
              {item.customerName}
            </Link>
          )}
        </div>
        <h2 className="mt-1.5 text-[16px] font-semibold text-[var(--color-fg)]">{item.title}</h2>
        <p className="mt-0.5 text-[12px] text-[var(--color-fg-muted)]">
          {item.kind === "decision" ? "Decision for you" : "Draft awaiting review"} ·{" "}
          {fmt(item.createdAt)}
        </p>
      </div>

      {item.kind === "decision" ? (
        <>
          {item.detail && (
            <Field label="What George needs">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-fg-secondary)]">
                {item.detail}
              </p>
            </Field>
          )}
          {item.recommendation && (
            <Field label="George's recommendation">
              <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-fg-secondary)]">
                {item.recommendation}
              </p>
            </Field>
          )}
        </>
      ) : (
        <>
          {item.to && item.to.length > 0 && (
            <Field label="To">
              <p className="text-[13px] text-[var(--color-fg-secondary)]">{item.to.join(", ")}</p>
            </Field>
          )}
          {item.bodyHtml && (
            <Field label="Draft">
              <SafeHtml
                html={item.bodyHtml}
                className="rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 text-[13px] leading-relaxed text-[var(--color-fg-secondary)]"
              />
            </Field>
          )}
        </>
      )}

      <Field label="Who approves">
        <p className="text-[13px] text-[var(--color-fg-secondary)]">
          {approver ?? "No manager set — assign one in Settings → Agent George."}
        </p>
      </Field>

      <div className="flex flex-wrap items-center gap-2 border-t border-[var(--color-border-subtle)] pt-4">
        {item.kind === "decision" && item.escalationId && (
          <form action={resolveEscalationAction}>
            <input type="hidden" name="id" value={item.escalationId} />
            <button
              type="submit"
              className="inline-flex h-9 items-center rounded-md bg-[var(--color-accent)] px-3 text-sm font-semibold text-[var(--color-fg-inverse)] shadow-[var(--shadow-cta)] hover:bg-[var(--color-accent-hover)]"
            >
              Mark resolved
            </button>
          </form>
        )}
        {item.sessionId && (
          <Link
            href={`/chat/${item.sessionId}`}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
          >
            <MessageSquare size={14} />
            Open conversation
          </Link>
        )}
        {item.customerId && (
          <Link
            href={`/customers/${item.customerId}`}
            className="inline-flex h-9 items-center rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
          >
            Open partner
          </Link>
        )}
      </div>
    </div>
  );
}

function ListGroup({
  label,
  count,
  icon,
  children,
}: {
  label: string;
  count: number;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-center gap-2 px-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--color-fg-muted)]">
        {icon}
        {label}
        <span className="text-[var(--color-fg-muted)]">({count})</span>
      </div>
      {count === 0 ? (
        <p className="px-1 text-[12px] text-[var(--color-fg-muted)]">None.</p>
      ) : (
        <ul className="overflow-hidden rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
          {children}
        </ul>
      )}
    </div>
  );
}

function ListRow({ item, active }: { item: Item; active: boolean }) {
  return (
    <li>
      <Link
        href={`/actions?item=${encodeURIComponent(item.key)}`}
        className={`block border-b border-[var(--color-border-subtle)] px-3 py-2.5 last:border-b-0 ${
          active ? "bg-[var(--color-accent-light)]" : "hover:bg-[var(--color-surface-3)]"
        }`}
      >
        <div className="flex items-center gap-2">
          {item.kind === "decision" && item.urgency === "high" && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--color-error)]" />
          )}
          <span
            className={`truncate text-[13px] ${
              active
                ? "font-semibold text-[var(--color-accent)]"
                : "font-medium text-[var(--color-fg)]"
            }`}
          >
            {item.title}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          {item.customerName && (
            <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-[var(--color-accent-light)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-accent)]">
              {item.customerName}
            </span>
          )}
          {item.sub && (
            <span className="truncate text-[12px] text-[var(--color-fg-muted)]">{item.sub}</span>
          )}
        </div>
      </Link>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--color-fg-muted)]">
        {label}
      </div>
      {children}
    </div>
  );
}

type RawEsc = {
  id: string;
  title: string;
  detail: string | null;
  recommendation: string | null;
  urgency: string;
  customer_id: string | null;
  session_id: string | null;
  created_at: string;
  customers: { name: string }[] | { name: string } | null;
};
type RawDraft = {
  id: string;
  action: string;
  payload: { draft_id?: string; subject?: string; to?: string[]; body_html?: string } | null;
  customer_id: string | null;
  session_id: string | null;
  created_at: string;
  customers: { name: string }[] | { name: string } | null;
};

function name(c: { name: string }[] | { name: string } | null): string | null {
  if (!c) return null;
  return Array.isArray(c) ? c[0]?.name ?? null : c.name ?? null;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
