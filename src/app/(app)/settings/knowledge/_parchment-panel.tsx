/**
 * Parchment connection panel for Settings → Knowledge.
 *
 * Server component. It reads the org's stored connection and, when one exists,
 * queries the hub during render — so the page shows live state rather than a
 * flag that drifted from reality. Every call fails open (the client never
 * throws), so an unreachable hub degrades this panel into an explanation and
 * leaves the rest of the page working.
 *
 * Why the two-store split is stated plainly here: it is the thing an admin needs
 * to understand before they change anything. Core playbooks are George's
 * operating instructions and stay in the repo, reviewed through PRs, so they
 * survive an outage of anything external. Organisational knowledge lives in the
 * connected hub, which understands sections and hierarchy in a way chunked
 * search cannot.
 */
import { Database, ExternalLink } from "lucide-react";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createParchmentClient } from "@/lib/parchment/client";
import {
  getParchmentConnection,
  resolveParchmentConfig,
} from "@/lib/parchment/connection";
import { canStoreSecrets } from "@/lib/crypto/secret-box";
import { ParchmentConnectForm, ParchmentManageButtons } from "./_parchment-connect";

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <span className="text-xs text-gray-500 dark:text-gray-400">{label}</span>
      <span className="text-right text-xs font-medium text-gray-800 dark:text-white/90">{value}</span>
    </div>
  );
}

function Badge({ tone, children }: { tone: "ok" | "warn" | "idle"; children: React.ReactNode }) {
  const cls =
    tone === "ok"
      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "border border-gray-200 dark:border-gray-800 text-gray-500 dark:text-gray-400";
  return (
    <span className={`rounded px-1.5 py-0.5 text-theme-xs font-medium uppercase tracking-wide ${cls}`}>
      {children}
    </span>
  );
}

function Shell({
  badge,
  children,
}: {
  badge: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.03] p-4">
      <div className="flex items-center gap-2">
        <Database className="size-4 text-gray-500 dark:text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-800 dark:text-white/90">
          Parchment knowledge hub
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

  const admin = createSupabaseAdmin();
  const conn = await getParchmentConnection(admin, user.orgId);

  // ---- nothing connected ------------------------------------------------
  if (conn.source === "none") {
    return (
      <Shell badge={<Badge tone="idle">Not connected</Badge>}>
        <p className="mt-2 max-w-[640px] text-xs text-gray-500 dark:text-gray-400">
          George is answering from the core playbooks below and its own supplemental
          docs. Connect your Parchment hub and it will search your organisation&rsquo;s
          knowledge instead — whole sections with their hierarchy, rather than
          fragments.
        </p>
        {!isAdmin ? (
          <p className="mt-2 text-xs text-gray-400 dark:text-gray-500">
            An owner or admin can connect it.
          </p>
        ) : !canStoreSecrets() ? (
          <p className="mt-3 rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
            This deployment cannot store credentials yet — <code>APP_ENCRYPTION_KEY</code>{" "}
            is not set. An API key would have to be written in plaintext, so the form is
            hidden until that is configured.
          </p>
        ) : (
          <ParchmentConnectForm />
        )}
      </Shell>
    );
  }

  // ---- a deployment-wide default, not this org's own row -----------------
  if (conn.source === "environment") {
    return (
      <Shell badge={<Badge tone="ok">Connected</Badge>}>
        <p className="mt-2 max-w-[640px] text-xs text-gray-500 dark:text-gray-400">
          Using a hub configured for the whole deployment, not one connected here. It
          applies to every organisation on this instance.
        </p>
        <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800 border-t border-gray-200 dark:border-gray-800">
          <Row label="Endpoint" value={<code className="text-theme-xs">{conn.baseUrl}</code>} />
          <Row label="Key" value={<code className="text-theme-xs">{conn.keyFingerprint}</code>} />
          <Row label="Source" value="Environment variables" />
        </div>
        {isAdmin && canStoreSecrets() ? (
          <>
            <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
              Connect a hub for {user.orgName} specifically to override it:
            </p>
            <ParchmentConnectForm defaultBaseUrl={conn.baseUrl} />
          </>
        ) : null}
      </Shell>
    );
  }

  // ---- this org's own connection ----------------------------------------
  // Query it live so "connected" means connected now, not when it was saved.
  const cfg = await resolveParchmentConfig(admin, user.orgId);
  const live = cfg ? await createParchmentClient(cfg).documents() : null;
  const reachable = live?.ok === true;
  const docCount = live?.ok && Array.isArray(live.data) ? live.data.length : conn.documents;

  return (
    <Shell
      badge={
        reachable ? <Badge tone="ok">Connected</Badge> : <Badge tone="warn">Unreachable</Badge>
      }
    >
      <p className="mt-2 max-w-[640px] text-xs text-gray-500 dark:text-gray-400">
        {reachable ? (
          <>
            <code>search_knowledge</code> queries your hub and gets back whole sections
            with their hierarchy. The core playbooks below stay in this repo and are
            fetched with <code>read_knowledge_doc</code> — they are George&rsquo;s operating
            instructions, so they keep working even when the hub does not.
          </>
        ) : (
          <>
            George has fallen back to its own supplemental docs. Core playbooks are
            unaffected. The reason is below — this panel checks the hub on every load, so
            it reflects the state right now.
          </>
        )}
      </p>

      <div className="mt-3 divide-y divide-gray-100 dark:divide-gray-800 border-t border-gray-200 dark:border-gray-800">
        <Row label="Endpoint" value={<code className="text-theme-xs">{conn.baseUrl}</code>} />
        <Row label="Key" value={<code className="text-theme-xs">{conn.keyFingerprint ?? "—"}</code>} />
        <Row label="Documents" value={docCount ?? "—"} />
        {conn.connectedBy ? <Row label="Connected by" value={conn.connectedBy} /> : null}
        {conn.lastCheckedAt ? (
          <Row
            label="Last checked"
            value={new Date(conn.lastCheckedAt).toLocaleString()}
          />
        ) : null}
        {!reachable && live && !live.ok ? (
          <Row
            label="Error"
            value={<span className="text-amber-600 dark:text-amber-400">{live.error}</span>}
          />
        ) : null}
      </div>

      {reachable && docCount === 0 ? (
        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
          The hub is reachable but empty, so searches will return nothing. Ingest
          documents in Parchment first.
        </p>
      ) : null}

      {conn.baseUrl ? (
        <a
          href={conn.baseUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-brand-500 dark:text-brand-400 hover:underline"
        >
          Open Parchment
          <ExternalLink className="size-3" />
        </a>
      ) : null}

      {isAdmin ? <ParchmentManageButtons /> : null}
    </Shell>
  );
}
