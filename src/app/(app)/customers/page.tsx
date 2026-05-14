import Link from "next/link";
import { ArrowUpRight, MessageSquare, Users } from "lucide-react";
import { createSupabaseServer } from "@/lib/supabase/server";
import { KindBadge, LifecycleBadge } from "@/components/ui/badge";
import { NewPartnerButton } from "./_partner-form";

export const dynamic = "force-dynamic";

type CustomerRow = {
  id: string;
  name: string;
  domain: string | null;
  lifecycle: string;
  customer_kind: "partner" | "end_customer";
  parent_customer_id: string | null;
  industry: string | null;
  size: string | null;
  updated_at: string;
};

export default async function CustomersPage() {
  const supabase = await createSupabaseServer();
  const { data: customers } = await supabase
    .from("customers")
    .select(
      "id, name, domain, lifecycle, customer_kind, parent_customer_id, industry, size, updated_at",
    )
    .order("updated_at", { ascending: false })
    .limit(200);

  const rows = (customers ?? []) as CustomerRow[];
  const byId = new Map(rows.map((r) => [r.id, r] as const));

  return (
    <div className="w-full space-y-6 px-8 py-7">
      <header className="flex items-end justify-between">
        <div>
          <h1 className="text-[22px] font-bold text-[var(--color-fg)]">Channel partners</h1>
          <p className="text-sm text-[var(--color-fg-secondary)]">
            Partners (MSPs) Onyx contracts with, and the end customers under each one.
            Drop a contract in chat to add a new partner.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/chat"
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
          >
            <MessageSquare size={14} />
            Add via chat
          </Link>
          <NewPartnerButton />
        </div>
      </header>

      {rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-hidden rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-3)] text-[12px] uppercase tracking-wide text-[var(--color-fg-secondary)]">
              <tr>
                <Th>Name</Th>
                <Th>Kind</Th>
                <Th>Lifecycle</Th>
                <Th>Partner</Th>
                <Th>Domain</Th>
                <Th>Industry</Th>
                <Th>Updated</Th>
                <Th>{""}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const parent = c.parent_customer_id
                  ? byId.get(c.parent_customer_id) ?? null
                  : null;
                return (
                  <tr
                    key={c.id}
                    className="group border-t border-[var(--color-border-subtle)] hover:bg-[var(--color-surface-3)]"
                  >
                    <Td>
                      <Link
                        href={`/customers/${c.id}`}
                        className="font-medium text-[var(--color-fg)] hover:text-[var(--color-accent)]"
                      >
                        {c.name}
                      </Link>
                    </Td>
                    <Td>
                      <KindBadge kind={c.customer_kind} />
                    </Td>
                    <Td>
                      <LifecycleBadge value={c.lifecycle} />
                    </Td>
                    <Td className="text-[var(--color-fg-secondary)]">
                      {parent ? (
                        <Link
                          href={`/customers/${parent.id}`}
                          className="hover:text-[var(--color-accent)]"
                        >
                          {parent.name}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="text-[var(--color-fg-secondary)]">{c.domain ?? "—"}</Td>
                    <Td className="text-[var(--color-fg-secondary)]">{c.industry ?? "—"}</Td>
                    <Td className="text-[var(--color-fg-muted)]">{formatDate(c.updated_at)}</Td>
                    <Td>
                      <Link
                        href={`/customers/${c.id}`}
                        className="opacity-0 transition group-hover:opacity-100"
                        aria-label="Open"
                      >
                        <ArrowUpRight size={14} className="text-[var(--color-fg-muted)]" />
                      </Link>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-2.5 font-medium">{children}</th>;
}
function Td({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-4 py-3 align-middle ${className ?? ""}`}>{children}</td>;
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-[12px] border border-dashed border-[var(--color-border-subtle)] bg-[var(--color-surface-card)] py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-[var(--color-accent-light)] text-[var(--color-accent)]">
        <Users size={20} />
      </div>
      <h2 className="text-[15px] font-semibold text-[var(--color-fg)]">No channel partners yet</h2>
      <p className="max-w-[360px] text-sm text-[var(--color-fg-secondary)]">
        Drop a signed partner contract into the George chat and he&apos;ll create the
        record, contacts, and onboarding plan. End customers get added under each
        partner once they sign.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <NewPartnerButton />
        <Link
          href="/chat"
          className="inline-flex h-9 items-center gap-1.5 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-card)] px-3 text-sm font-medium text-[var(--color-fg)] hover:bg-[var(--color-surface-2)]"
        >
          <MessageSquare size={14} />
          Or add via chat
        </Link>
      </div>
    </div>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
