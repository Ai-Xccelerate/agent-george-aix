/**
 * Verify the Nylas transport against George's real mailbox.
 *
 * Mocked tests prove the code shape; only this proves the integration. It
 * exercises the full draft lifecycle George's email policy depends on
 * (create -> read back -> update -> delete) plus reading the inbox and threads.
 *
 * SAFETY: it does not send anything by default. The draft it creates is
 * addressed to George itself and deleted at the end, so nothing reaches a real
 * person. Pass --send to additionally send one real email to --to=<address>.
 *
 * Usage:
 *   pnpm verify:nylas
 *   pnpm verify:nylas -- --send --to=you@example.com
 */
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", override: false });

const SEND = process.argv.includes("--send");
const TO = process.argv.find((a) => a.startsWith("--to="))?.slice(5) ?? null;

let passed = 0;
const failures: string[] = [];
const notes: string[] = [];

const ok = (l: string) => { passed++; console.log(`  ok    ${l}`); };
const bad = (l: string, d: string) => { failures.push(`${l} — ${d}`); console.log(`  FAIL  ${l}`); };
const note = (l: string) => { notes.push(l); console.log(`  note  ${l}`); };

async function main() {
  const { createNylasClient, isNylasEnabled, nylasConfig, nylasMissingVars, recipientEmails } =
    await import("@/lib/nylas/client");

  if (!isNylasEnabled()) {
    console.error(
      `Nylas is not configured. Missing: ${nylasMissingVars().join(", ")}\n\n` +
        `Set in .env.local:\n` +
        `  NYLAS_API_URL="https://api.us.nylas.com"\n` +
        `  NYLAS_API_KEY="nyk_v0_..."\n` +
        `  NYLAS_GRANT_ID="<the agent account grant id>"\n`,
    );
    process.exit(1);
  }

  const cfg = nylasConfig()!;
  const nylas = createNylasClient(cfg);
  console.log(`endpoint : ${cfg.base}`);
  console.log(`grant    : ${cfg.grantId}`);
  console.log(`mode     : ${SEND ? `WILL SEND to ${TO}` : "read-only + draft lifecycle"}\n`);

  // ---- the mailbox exists and is healthy -----------------------------
  const grant = await nylas.grant();
  if (!grant.ok) {
    bad("grant", grant.error);
    console.error("\nCannot reach the mailbox — aborting.");
    return;
  }
  ok(`grant is ${grant.data.grant_status ?? "?"} (${grant.data.email ?? "no address"})`);
  if (cfg.fromEmail && grant.data.email && cfg.fromEmail !== grant.data.email) {
    // A mismatch means NYLAS_FROM_EMAIL is lying about who George is, which
    // would confuse every log and audit row that records the sender.
    bad("address mismatch", `NYLAS_FROM_EMAIL=${cfg.fromEmail} but grant is ${grant.data.email}`);
  }

  // ---- reading -------------------------------------------------------
  const folders = await nylas.listFolders();
  if (!folders.ok) bad("listFolders", folders.error);
  else ok(`listFolders returned ${folders.data.length} folder(s)`);

  const messages = await nylas.listMessages({ limit: 10 });
  if (!messages.ok) {
    bad("listMessages", messages.error);
  } else {
    ok(`listMessages returned ${messages.data.length} message(s)`);
    if (messages.data.length === 0) {
      note("mailbox is empty — send it something before trusting the read path");
    } else {
      const first = messages.data[0];
      if (!first.id) bad("message shape", "no id");
      else ok(`messages carry id/subject ("${(first.subject ?? "").slice(0, 40)}")`);

      const got = await nylas.getMessage(first.id);
      if (!got.ok) bad("getMessage", got.error);
      else ok("getMessage fetches a single message");

      if (first.thread_id) {
        const thread = await nylas.listThreadMessages(first.thread_id);
        if (!thread.ok) bad("listThreadMessages", thread.error);
        else ok(`thread fetch returned ${thread.data.length} message(s) — threading works`);
      } else {
        note("first message had no thread_id, skipped the thread check");
      }
    }
  }

  // ---- the draft lifecycle George's policy depends on ----------------
  // Addressed to George itself so a mistake here cannot reach a customer.
  const selfAddress = grant.data.email ?? cfg.fromEmail ?? "";
  const draft = await nylas.createDraft({
    to: [{ email: selfAddress, name: "George (self-test)" }],
    subject: "[verify-nylas] draft lifecycle probe",
    body: "<p>Created by scripts/verify-nylas.ts. Deleted automatically.</p>",
  });
  if (!draft.ok) {
    bad("createDraft", draft.error);
  } else {
    ok(`createDraft returned id ${draft.data.id}`);

    // The guard re-reads a draft before sending, so this has to work and has to
    // report the real recipients.
    const read = await nylas.getDraft(draft.data.id);
    if (!read.ok) {
      bad("getDraft", read.error);
    } else {
      const rcpts = recipientEmails(read.data);
      if (!rcpts.includes(selfAddress.toLowerCase())) {
        bad("getDraft recipients", `expected ${selfAddress}, got ${JSON.stringify(rcpts)}`);
      } else {
        ok("getDraft reports the real recipients (what the send guard checks)");
      }
      if (read.data.from?.[0]?.email !== selfAddress) {
        note(`draft 'from' is ${JSON.stringify(read.data.from)} — Nylas fills this from the grant`);
      } else {
        ok("draft 'from' is George's own address");
      }
    }

    const updated = await nylas.updateDraft(draft.data.id, {
      to: [{ email: selfAddress }],
      subject: "[verify-nylas] draft lifecycle probe (edited)",
      body: "<p>edited</p>",
    });
    if (!updated.ok) bad("updateDraft", updated.error);
    else ok("updateDraft edits an existing draft");

    const del = await nylas.deleteDraft(draft.data.id);
    if (!del.ok) {
      bad("deleteDraft", del.error);
      note(`draft ${draft.data.id} left behind — delete it by hand`);
    } else {
      const gone = await nylas.getDraft(draft.data.id);
      if (gone.ok) bad("deleteDraft", "draft still readable after delete");
      else ok("deleteDraft removes it");
    }
  }

  // ---- failure handling ----------------------------------------------
  const missing = await nylas.getMessage("definitely-not-a-real-message-id");
  if (missing.ok) bad("missing message", "expected an error");
  else ok(`a missing message resolves an error, never throws ("${missing.error.slice(0, 60)}…")`);

  // ---- optional real send --------------------------------------------
  if (SEND) {
    if (!TO) {
      bad("--send", "pass --to=<address> as well");
    } else {
      const sent = await nylas.send({
        to: [{ email: TO }],
        subject: "[verify-nylas] real send check",
        body: "<p>Sent by scripts/verify-nylas.ts to prove the outbound path.</p>",
      });
      if (!sent.ok) bad("send", sent.error);
      else ok(`sent a real email to ${TO} (id ${sent.data.id})`);
    }
  } else {
    note("no real email sent — pass --send --to=<address> to test outbound");
  }
}

main()
  .catch((err) => failures.push(`HARNESS CRASHED — ${String(err)}`))
  .finally(() => {
    console.log("\n" + "=".repeat(64));
    console.log(`passed: ${passed}`);
    console.log(`failed: ${failures.length}`);
    if (notes.length) {
      console.log("\nNOTES:");
      for (const n of notes) console.log(`  - ${n}`);
    }
    if (failures.length) {
      console.log("\nFAILURES:");
      for (const f of failures) console.log(`  x ${f}`);
    }
    console.log("=".repeat(64));
    process.exit(failures.length > 0 ? 1 : 0);
  });
