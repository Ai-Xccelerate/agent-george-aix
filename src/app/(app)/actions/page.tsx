import Link from "next/link";
import { redirect } from "next/navigation";
import { Bell, Mail, Inbox, Sparkles } from "lucide-react";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { resolveEscalationAction, discardEscalationAction } from "../dashboard/actions";
import { SafeHtml } from "./_safe-html";
import { type InitialMessage } from "../chat/_chat-client";
import { GeorgePanel, type SuggestedAction } from "./_george-panel";
import { ResizableChat } from "./_resizable-chat";

export const dynamic = "force-dynamic";

/**
 * AI actions — a three-pane queue of what George needs from a human:
 *   1. the list (decisions George raised + email drafts to approve),
 *   2. the selected item's detail + approve/discard actions,
 *   3. a contextual chat with George on that item's originating conversation.
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
  suggestedActions?: SuggestedAction[];
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
        "id, title, detail, recommendation, suggested_actions, urgency, customer_id, session_id, created_at, customers(name)",
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
    suggestedActions: Array.isArray(e.suggested_actions) ? e.suggested_actions : [],
  }));

  const drafts: Item[] = ((draftRes.data ?? []) as RawDraft[])
    .filter((r) => {
      const id = r.payload?.draft_id;
      return id ? !sentDraftIds.has(id) : false;
    })
    .map((r) => ({
      key: `draft:${r.id}`,
      kind: "draft",
      title:
        r.payload?.subject ||
        (r.action === "email.reply_drafted" ? "Reply draft" : "(no subject)"),
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

  // Resolving/discarding is a decision the approver makes — the org owner today,
  // and CSMs going forward. Read-only roles (sales, viewer) see it but can't act.
  const canApprove = ["owner", "admin", "csm"].includes(user.role);

  // Seed the chat with a clean, plain-text opening from George (the finding +
  // his recommendation) rather than dumping the raw originating session, which
  // can contain HTML email bodies and long run logs. The real session still
  // backs the conversation, so George has full context when you reply.
  const chatSeed: InitialMessage[] = selected ? [seedMessage(selected)] : [];

  return (
    <div className="w-full px-4 py-5 sm:px-6 md:px-8 md:py-7 2xl:px-12">
      <header className="mb-5">
        <h1 className="font-display text-2xl font-semibold tracking-tight text-gray-800 dark:text-white/90">AI actions</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          What George needs from you across the book — decisions to make and drafts to
          review. Talk it through with George on the right, then resolve or discard.
        </p>
      </header>

      {items.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 dark:bg-brand-500/15 text-brand-500 dark:text-brand-400">
            <Inbox size={20} />
          </div>
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">All clear</h2>
          <p className="max-w-[420px] text-sm text-gray-500 dark:text-gray-400">
            No decisions or drafts waiting. George surfaces them here as they come up.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 items-start gap-4 xl:flex">
          {/* Column 1 — the queue */}
          <div className="space-y-4 xl:w-[300px] xl:shrink-0 xl:sticky xl:top-5">
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

          {/* Column 2 — detail + actions */}
          <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5 xl:min-w-0 xl:flex-1">
            {selected ? <Detail item={selected} approver={approver} canApprove={canApprove} /> : null}
          </div>

          {/* Column 3 — contextual chat with George (drag the left edge to resize) */}
          <ResizableChat>
            <div className="flex items-center gap-1.5 border-b border-gray-200 dark:border-gray-800 px-4 py-3 pl-5 text-theme-sm font-semibold text-gray-800 dark:text-white/90">
              <Sparkles size={14} className="text-brand-500 dark:text-brand-400" />
              Chat with George
            </div>
            <div className="min-h-0 flex-1">
              {selected && (
                <GeorgePanel
                  sessionId={selected.sessionId}
                  initialMessages={chatSeed}
                  suggestedActions={selected.suggestedActions ?? []}
                />
              )}
            </div>
          </ResizableChat>
        </div>
      )}
    </div>
  );
}

/**
 * A clean, plain-text opening message from George for the chat — the finding,
 * what it's based on, and his recommendation. Keeps the conversation human and
 * readable instead of replaying raw session history.
 */
function seedMessage(item: Item): InitialMessage {
  const parts: string[] = [];
  if (item.kind === "draft") {
    const to = item.to && item.to.length ? ` to ${item.to.join(", ")}` : "";
    parts.push(`I've drafted a reply${to} — the full draft is in the panel on the left.`);
    parts.push(
      "Here's what I can do:\n\n- **Send it** as-is\n- **Revise it** first — tell me what to change\n- **Hold off** for now",
    );
    parts.push("Which would you like?");
  } else if (item.detail || item.recommendation) {
    if (item.detail) parts.push(item.detail);
    if (item.recommendation) {
      parts.push(`**Here's what I'd suggest:**\n\n${item.recommendation}`);
    }
    parts.push(
      "Tell me which way to go and I'll take care of it — I can create or assign the user, update the owner, or send an email on your behalf. Just confirm and I'll do it (and I'll always show you before anything goes out externally).",
    );
  } else {
    parts.push(item.title, "How would you like to handle this?");
  }
  return { id: `seed-${item.key}`, role: "assistant", content: parts.join("\n\n") };
}

function Detail({
  item,
  approver,
  canApprove,
}: {
  item: Item;
  approver: string | null;
  canApprove: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          {item.kind === "decision" && item.urgency === "high" && (
            <span className="rounded-full bg-error-500/15 px-1.5 py-0.5 text-theme-xs font-medium uppercase tracking-wide text-error-500">
              high
            </span>
          )}
          {item.customerName && (
            <Link
              href={item.customerId ? `/customers/${item.customerId}` : "#"}
              className="inline-flex items-center gap-1 rounded-full bg-brand-50 dark:bg-brand-500/15 px-2.5 py-0.5 text-theme-xs font-semibold text-brand-500 dark:text-brand-400 hover:underline"
            >
              {item.customerName}
            </Link>
          )}
        </div>
        <h2 className="mt-1.5 text-base font-semibold text-gray-800 dark:text-white/90">{item.title}</h2>
        <p className="mt-0.5 text-theme-xs text-gray-400 dark:text-gray-500">
          {item.kind === "decision" ? "Decision for you" : "Draft awaiting review"} ·{" "}
          {fmt(item.createdAt)}
        </p>
      </div>

      {item.kind === "decision" ? (
        <>
          {item.detail && (
            <Field label="What George needs">
              <p className="whitespace-pre-wrap text-theme-sm leading-relaxed text-gray-500 dark:text-gray-400">
                {item.detail}
              </p>
            </Field>
          )}
          {item.recommendation && (
            <Field label="George's recommendation">
              <p className="whitespace-pre-wrap text-theme-sm leading-relaxed text-gray-500 dark:text-gray-400">
                {item.recommendation}
              </p>
            </Field>
          )}
        </>
      ) : (
        <>
          {item.to && item.to.length > 0 && (
            <Field label="To">
              <p className="text-theme-sm text-gray-500 dark:text-gray-400">{item.to.join(", ")}</p>
            </Field>
          )}
          {item.bodyHtml && (
            <Field label="Draft">
              <SafeHtml
                html={item.bodyHtml}
                className="rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 p-3 text-theme-sm leading-relaxed text-gray-500 dark:text-gray-400"
              />
            </Field>
          )}
        </>
      )}

      <Field label="Who approves">
        <p className="text-theme-sm text-gray-500 dark:text-gray-400">
          {approver ?? "No manager set — assign one in Settings → AIX George."}
        </p>
      </Field>

      <div className="flex flex-wrap items-center gap-2 border-t border-gray-200 dark:border-gray-800 pt-4">
        {item.kind === "decision" && item.escalationId && canApprove && (
          <>
            <form action={resolveEscalationAction}>
              <input type="hidden" name="id" value={item.escalationId} />
              <button
                type="submit"
                className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-brand-500 text-sm font-medium text-white shadow-theme-xs transition-colors duration-150 ease-out hover:bg-brand-600 active:bg-brand-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 focus-visible:ring-offset-2 focus-visible:ring-offset-white disabled:bg-brand-300 disabled:shadow-none dark:focus-visible:ring-offset-gray-900"
              >
                Mark resolved
              </button>
            </form>
            <form action={discardEscalationAction}>
              <input type="hidden" name="id" value={item.escalationId} />
              <button
                type="submit"
                className="inline-flex h-9 items-center rounded-md border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] px-3 text-sm font-medium text-gray-500 dark:text-gray-400 hover:border-error-500/40 hover:bg-error-500/10 hover:text-error-500"
              >
                Discard
              </button>
            </form>
          </>
        )}
        {item.kind === "decision" && item.escalationId && !canApprove && (
          <span className="text-theme-xs text-gray-400 dark:text-gray-500">
            Resolving or discarding is handled by the assigned CSM or owner
            {approver ? ` (${approver})` : ""}. You can still discuss it with George on the right.
          </span>
        )}
        {item.customerId && (
          <Link
            href={`/customers/${item.customerId}`}
            className="h-10 px-4 inline-flex items-center justify-center gap-2 rounded-lg bg-white text-sm font-medium text-gray-700 ring-1 ring-inset ring-gray-300 transition-colors duration-150 ease-out hover:bg-gray-50 hover:text-gray-800 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/50 dark:bg-white/[0.03] dark:text-gray-300 dark:ring-gray-700 dark:hover:bg-white/[0.06] dark:hover:text-white/90"
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
    <div className="overflow-hidden rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03]">
      <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-800 px-3 py-2.5 text-theme-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {icon}
        {label}
        <span className="text-gray-400 dark:text-gray-500">({count})</span>
      </div>
      {count === 0 ? (
        <p className="px-3 py-2.5 text-theme-xs text-gray-400 dark:text-gray-500">None.</p>
      ) : (
        <ul>{children}</ul>
      )}
    </div>
  );
}

function ListRow({ item, active }: { item: Item; active: boolean }) {
  return (
    <li>
      <Link
        href={`/actions?item=${encodeURIComponent(item.key)}`}
        className={`block border-l-2 border-b border-gray-200 dark:border-gray-800 px-3 py-2.5 last:border-b-0 ${
          active
            ? "border-l-brand-500 bg-gray-50 dark:bg-white/[0.03]"
            : "border-l-transparent hover:bg-gray-100 dark:hover:bg-gray-800"
        }`}
      >
        <div className="flex items-center gap-2">
          {item.kind === "decision" && item.urgency === "high" && (
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-error-500" />
          )}
          <span className="truncate text-theme-sm font-medium text-gray-800 dark:text-white/90">
            {item.title}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-2">
          {item.customerName && (
            <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-brand-50 dark:bg-brand-500/15 px-2 py-0.5 text-theme-xs font-medium text-brand-500 dark:text-brand-400">
              {item.customerName}
            </span>
          )}
          {item.sub && (
            <span className="truncate text-theme-xs text-gray-400 dark:text-gray-500">{item.sub}</span>
          )}
        </div>
      </Link>
    </li>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <div className="text-theme-xs font-medium uppercase tracking-wide text-gray-400 dark:text-gray-500">
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
  suggested_actions: SuggestedAction[] | null;
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
