/**
 * Parchment panel for Settings → Knowledge.
 *
 * Server component. It resolves the org's knowledge base live during render, so
 * the page shows what George will actually do on the next question rather than a
 * stored flag that drifted. Every call fails open (the client never throws), so
 * an unreachable Parchment degrades this into an explanation and leaves the rest
 * of the page working.
 *
 * A side effect worth knowing: the resolve call provisions the org's default
 * workspace on first touch, so simply opening this page is enough to set an
 * organisation up. There is nothing to connect.
 *
 * The two-store split is stated plainly because it is what an admin needs to
 * understand before changing anything. Core playbooks are George's operating
 * instructions and stay in the repo, reviewed through PRs, so they survive an
 * outage of anything external. Organisational knowledge lives in Parchment,
 * which understands sections and hierarchy in a way chunked search cannot.
 */
import { Database } from "lucide-react";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { describeFailure, getParchmentStatus } from "@/lib/parchment/connection";
import { GroundingSwitch, WorkspacePicker } from "./_parchment-connect";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-right text-xs font-medium text-gray-800 dark:text-white/90">
        {value}
      </span>
    </div>
  );
}

function Badge({ tone, children }: { tone: "ok" | "warn" | "idle"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "bg-success-50 text-success-600 dark:bg-success-500/10 dark:text-success-400"
      : tone === "warn"
        ? "bg-warning-50 text-warning-600 dark:bg-warning-500/10 dark:text-warning-400"
        : "border border-gray-200 text-gray-500 dark:border-gray-800 dark:text-gray-400";
  return (
    <span
      className={`rounded-lg px-1.5 py-0.5 text-theme-xs font-medium uppercase tracking-wide ${cls}`}
    >
      {children}
    </span>
  );
}

function Shell({ badge, children }: { badge: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5 md:p-6 dark:border-gray-800 dark:bg-white/[0.03]">
      <div className="flex items-center gap-2">
        <Database className="size-4 text-gray-500 dark:text-gray-400" />
        <h2 className="text-base font-semibold tracking-tight text-gray-800 dark:text-white/90">
          Organisation knowledge
        </h2>
        {badge}
      </div>
      {children}
    </section>
  );
}

export default async function ParchmentPanel() {
  const user = await getCurrentUser();
  if (!user) return null;
  const isAdmin = user.role === "owner" || user.role === "admin";

  const status = await getParchmentStatus(createSupabaseAdmin(), user.orgId);

  // ---- unavailable, for one of three quite different reasons ------------
  if (!status.active) {
    const failure = status.failure;
    const optedOut = failure?.reason === "opted_out";

    return (
      <Shell badge={<Badge tone="idle">{optedOut ? "Turned off" : "Unavailable"}</Badge>}>
        <p className="mt-2 max-w-[640px] text-sm text-gray-500 dark:text-gray-400">
          George is answering from the core playbooks below and its own supplemental docs.
        </p>
        {failure ? (
          <p className="mt-2 max-w-[640px] text-xs text-gray-500 dark:text-gray-400">
            {describeFailure(failure)}
          </p>
        ) : null}
        {optedOut && isAdmin ? <GroundingSwitch enabled={false} /> : null}
      </Shell>
    );
  }

  // ---- active ----------------------------------------------------------
  return (
    <Shell
      badge={
        status.reachable ? <Badge tone="ok">Connected</Badge> : <Badge tone="warn">Unreachable</Badge>
      }
    >
      <p className="mt-2 max-w-[640px] text-sm text-gray-500 dark:text-gray-400">
        {status.reachable ? (
          <>
            <code>search_knowledge</code> queries your organisation&rsquo;s knowledge base and
            gets back whole sections with their hierarchy. The core playbooks below stay in
            this repo and are fetched with <code>read_knowledge_doc</code> — they are
            George&rsquo;s operating instructions, so they keep working even when the knowledge
            base does not.
          </>
        ) : (
          <>
            George has fallen back to its own supplemental docs. Core playbooks are
            unaffected. The reason is below — this panel checks on every load, so it reflects
            the state right now.
          </>
        )}
      </p>

      <div className="mt-4 divide-y divide-gray-100 border-t border-gray-200 dark:divide-gray-800 dark:border-gray-800">
        <Row label="Endpoint" value={<code className="text-theme-xs">{status.endpoint}</code>} />
        <Row label="Access" value="Read and propose (agent role)" />
        {status.reachable ? (
          <Row label="Documents" value={status.documents ?? "—"} />
        ) : (
          <Row
            label="Error"
            value={
              <span className="text-warning-600 dark:text-warning-400">{status.error}</span>
            }
          />
        )}
      </div>

      {status.reachable && status.documents === 0 ? (
        <p className="mt-3 max-w-[640px] text-xs text-gray-500 dark:text-gray-400">
          The knowledge base is reachable but empty, so searches return nothing yet. Add
          documents in Parchment and George will pick them up immediately — no setup here.
        </p>
      ) : null}

      {isAdmin ? (
        <>
          <WorkspacePicker
            workspaces={status.workspaces}
            selectedWorkspaceId={status.selectedWorkspaceId}
            defaultWorkspaceId={status.defaultWorkspaceId}
          />
          <GroundingSwitch enabled />
        </>
      ) : null}
    </Shell>
  );
}
