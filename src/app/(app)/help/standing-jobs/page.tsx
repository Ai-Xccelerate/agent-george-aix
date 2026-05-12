import Link from "next/link";
import { ArrowLeft, Clock } from "lucide-react";

export const dynamic = "force-static";

export default function StandingJobsHelpPage() {
  return (
    <article className="space-y-8 pb-12">
      <Link
        href="/help"
        className="inline-flex items-center gap-1.5 text-[12px] font-medium text-[var(--color-fg-muted)] hover:text-[var(--color-fg)]"
      >
        <ArrowLeft size={12} /> All help topics
      </Link>

      <header className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-[var(--color-accent-light)] text-[var(--color-accent)]">
            <Clock size={20} />
          </div>
          <h1 className="text-[26px] font-bold text-[var(--color-fg)]">
            Standing jobs
          </h1>
        </div>
        <p className="max-w-prose text-[15px] leading-relaxed text-[var(--color-fg-secondary)]">
          Recurring tasks George runs on his own, on a schedule, without anyone
          typing in chat. This is what turns him from a chatbot you talk to into
          a teammate who shows up to work.
        </p>
      </header>

      <Section title="Why this exists">
        <Prose>
          <p>
            By default George is reactive — he only does anything when a human
            opens <Code>/chat</Code>. Standing jobs flip that. A job is a
            natural-language directive plus a schedule. When the schedule fires,
            George spawns himself, executes the directive against your real
            data and integrations, and leaves a record of what he did.
          </p>
          <p>
            Concrete things that become possible with this in place:
          </p>
          <ul>
            <li>
              <strong>Cadence prep.</strong> The night before every partner
              call, pull utilization deltas from the Support Hub, build the
              cadence deck, and surface anything notable.
            </li>
            <li>
              <strong>Morning inbox triage.</strong> Every weekday at 8am, scan
              <Code>george@onyx</Code>, categorize overnight email, draft
              replies for the easy ones, flag the rest.
            </li>
            <li>
              <strong>30 / 60 / 90 sprint check-ins.</strong> Fire on day 30,
              60, and 90 post-start-date. Compare actual ramp vs expected and
              draft the check-in.
            </li>
            <li>
              <strong>Health sweeps.</strong> Daily scan for at-risk signals —
              utilization drops, missed cadences, aging flags, no transcript in
              30 days. Surface the list.
            </li>
            <li>
              <strong>Onboarding nudges.</strong> Step in-progress past its
              target date? Nudge the partner contact and the internal owner.
            </li>
          </ul>
          <p>
            The honest framing: without jobs, George can only respond. With
            them, he can show up to work.
          </p>
        </Prose>
      </Section>

      <Section title="Creating a job">
        <Prose>
          <p>
            Head to{" "}
            <Link
              href="/settings/jobs"
              className="text-[var(--color-accent)] underline-offset-2 hover:underline"
            >
              Settings → Standing jobs
            </Link>
            . You'll need to be an org admin or owner.
          </p>
          <p>Four fields:</p>
          <ul>
            <li>
              <strong>Job name.</strong> A short label for humans — what shows
              up in lists and run records. Example: <Code>Morning utilization sweep</Code>.
            </li>
            <li>
              <strong>Directive.</strong> Plain English. Tell George what to
              do the same way you would in chat. See the next section for how
              to write a good one.
            </li>
            <li>
              <strong>Cron schedule.</strong> Standard 5-field cron. See the
              cheatsheet below.
            </li>
            <li>
              <strong>Timezone (optional).</strong> IANA timezone like{" "}
              <Code>America/Los_Angeles</Code>. If you leave it blank, George
              uses the org's default timezone from{" "}
              <Link
                href="/settings/organization"
                className="text-[var(--color-accent)] underline-offset-2 hover:underline"
              >
                organization settings
              </Link>
              , falling back to UTC. So if you set <Code>0 9 * * 1-5</Code>{" "}
              and the org timezone is <Code>America/Los_Angeles</Code>, that
              means 9am Pacific every weekday — what you'd expect.
            </li>
          </ul>
        </Prose>
      </Section>

      <Section title="Writing a good directive">
        <Prose>
          <p>
            A directive is just a prompt — but unlike chat, there's nobody to
            answer follow-up questions. George won't ask you "which customer?"
            mid-run; he'll make a reasonable assumption and note it in the
            summary. So writing the directive well matters.
          </p>
          <p>Good directives are:</p>
          <ul>
            <li>
              <strong>Specific about scope.</strong> "All active customers"
              beats "customers." "Customers in <Code>onboarding</Code> with no
              activity in the last 14 days" is even better.
            </li>
            <li>
              <strong>Explicit about output.</strong> Say what you want at the
              end — a list, a draft email, a created record. George's summary
              follows the structure of what you asked for.
            </li>
            <li>
              <strong>Bounded.</strong> A job runs for up to ~4 minutes. "Draft
              the kickoff email for any customer whose contract was signed
              yesterday" finishes in time. "Re-analyze every transcript ever
              recorded" does not.
            </li>
          </ul>
          <Heading>Examples that work</Heading>
          <DirectiveExample
            name="Morning utilization sweep"
            cron="0 8 * * 1-5"
            text={`Every weekday morning, list customers in lifecycle 'active'. For each, look up the latest health_check and the previous one. If the active_users dropped more than 20% week-over-week, draft a check-in email to the primary contact and add it as 'awaiting review' in your summary. If no health checks exist for a customer, mention that too — the CSM may need to run one manually.`}
          />
          <DirectiveExample
            name="Onboarding stalls"
            cron="0 9 * * 1-5"
            text={`Find every onboarding plan with status 'active' where the most recent in_progress step is older than 7 days. For each, draft a nudge email to the partner contact AND a separate Teams-style note to the internal owner. List all of them in your summary with customer name, step name, and days stalled.`}
          />
          <DirectiveExample
            name="Weekly cadence prep — Acme"
            cron="0 17 * * 1"
            text={`Acme's cadence call is Tuesday 10am Pacific. Pull last week's utilization for Acme: active users, messages, flags, recalls. Compare to the previous week and to the rolling 4-week average. Draft the cadence deck content (sections: Headline, Wins, Concerns, Asks) as a single email to me. Don't send.`}
          />
          <DirectiveExample
            name="All-partners cadence prep"
            cron="0 6 * * *"
            text={`Call list_upcoming_cadences with within_days=2. For every cadence whose next meeting is in the next ~36 hours, pull the customer's latest health check and contract context, and draft a one-page brief email to the cadence owner with: meeting time, attendees from contacts, recent activity, open onboarding steps, anything notable. Skip cadences flagged as ad_hoc.`}
          />
          <Heading>Things to avoid</Heading>
          <ul>
            <li>
              <strong>"Send the email."</strong> George can't send autonomously
              under any circumstance. Phrase it as "draft" and trust the
              human-review step.
            </li>
            <li>
              <strong>"Ask me if you're not sure."</strong> There is no UI to
              answer. He'll make an assumption.
            </li>
            <li>
              <strong>"Process all transcripts from the last year."</strong>{" "}
              Unbounded scans hit the time budget. Scope to a window.
            </li>
          </ul>
        </Prose>
      </Section>

      <Section title="What George can and can't do in autonomous mode">
        <Prose>
          <p>
            George's behavior in a scheduled run is intentionally narrower than
            in chat. The reason is simple: nobody is reading output, and the
            email send rule (draft → human confirms → send) requires a human.
            Without that guard, the system would silently send a customer
            email it shouldn't.
          </p>
          <Heading>He WILL</Heading>
          <ul>
            <li>Read from the database (customers, contacts, contracts, onboarding plans, health checks, knowledge).</li>
            <li>Write internal records — create customers, log health checks, advance onboarding steps, write audit entries.</li>
            <li>Draft emails in Outlook (visible to you in <Code>george@onyx</Code> drafts).</li>
            <li>Create calendar events when explicitly directed (these go through without confirmation).</li>
            <li>Fetch URLs and search the web.</li>
            <li>Pull meeting transcripts from Fireflies.</li>
          </ul>
          <Heading>He WILL NOT</Heading>
          <ul>
            <li>
              <strong>Send any email.</strong> <Code>send_email_draft</Code> is
              removed from the tool allowlist in autonomous mode. Even if you
              tell him to send, he can't.
            </li>
            <li>
              <strong>Ask you a question.</strong> The structured-question tool
              is disabled. He'll log assumptions in the run summary instead.
            </li>
            <li>
              <strong>Talk to a human in real time.</strong> Nobody is reading
              the stream.
            </li>
          </ul>
        </Prose>
      </Section>

      <Section title="Reading a run">
        <Prose>
          <p>
            Every job execution becomes a row in the recent-runs panel on the
            job card. Click the "Recent runs" disclosure to expand. Each run
            shows:
          </p>
          <ul>
            <li>
              <strong>Status badge.</strong>{" "}
              <Code>succeeded</Code> / <Code>failed</Code> /{" "}
              <Code>timed_out</Code> / <Code>running</Code> /{" "}
              <Code>pending</Code>.
            </li>
            <li>
              <strong>Trigger.</strong> <Code>schedule</Code> (cron fired it)
              or <Code>manual</Code> (you clicked Run now).
            </li>
            <li>
              <strong>Timings.</strong> Started, finished.
            </li>
            <li>
              <strong>Summary.</strong> George's final assistant message,
              structured as:
              <SummaryTemplate />
            </li>
            <li>
              <strong>Error.</strong> If the run failed, the underlying message
              (auth error, missing integration, etc.).
            </li>
          </ul>
          <p>
            The summary is the trust-building surface. You don't have to take
            George's word for what he did — every internal write also lands in
            the audit log, and every email draft is visible in Outlook drafts.
            The summary is the human-readable index.
          </p>
        </Prose>
      </Section>

      <Section title="Run now vs scheduled">
        <Prose>
          <p>
            "Run now" on a job card fires the same code path as the cron tick
            — same prompt, same tools, same time budget — but with{" "}
            <Code>trigger=manual</Code> on the run record. The schedule isn't
            advanced; the next scheduled fire still happens normally.
          </p>
          <p>Use Run now when you:</p>
          <ul>
            <li>Just created a job and want to see what it does without waiting for the next tick.</li>
            <li>Need a fresh result before the next scheduled run (e.g., right before a call).</li>
            <li>The schedule didn't fire (we hadn't deployed yet, or there was an outage).</li>
          </ul>
          <p>
            The button blocks until the run finishes — up to 4 minutes. The
            page refreshes when the run completes and you'll see the new entry
            in the recent-runs panel.
          </p>
        </Prose>
      </Section>

      <Section title="Cron cheatsheet">
        <Prose>
          <p>
            Standard 5-field cron:{" "}
            <Code>minute hour day-of-month month day-of-week</Code>. Use{" "}
            <Code>*</Code> to mean "every," ranges like <Code>1-5</Code>, lists
            like <Code>1,3,5</Code>, and steps like <Code>*/15</Code>.
          </p>
          <CronTable
            rows={[
              ["0 * * * *", "Every hour, on the hour"],
              ["0 9 * * *", "9am every day"],
              ["0 9 * * 1-5", "9am Monday through Friday"],
              ["30 8 * * 1,3,5", "8:30am Monday, Wednesday, Friday"],
              ["0 17 * * 5", "5pm every Friday"],
              ["0 9 1 * *", "9am on the 1st of every month"],
              ["*/15 9-17 * * 1-5", "Every 15 min, business hours, weekdays"],
              ["0 0 * * 0", "Midnight every Sunday (weekly batch)"],
            ]}
          />
          <p>
            Day-of-week: <Code>0</Code> or <Code>7</Code> = Sunday,{" "}
            <Code>1</Code> = Monday, … <Code>6</Code> = Saturday.
          </p>
          <p className="text-[12px] text-[var(--color-fg-muted)]">
            Times are evaluated in the job's timezone (or the org default).
            The cron is validated when you save the job — bad syntax errors out
            before the job is created.
          </p>
        </Prose>
      </Section>

      <Section title="Limits and gotchas">
        <Prose>
          <ul>
            <li>
              <strong>4-minute ceiling per run.</strong> Jobs are spawned
              inside a Vercel Function with a 300-second cap. The runner
              budgets 240s of agent work and reserves the rest to write the
              run record. Jobs that exceed the budget end up as{" "}
              <Code>timed_out</Code>. Multi-hour analyses need to wait for
              cloud-managed agents (backlog #17).
            </li>
            <li>
              <strong>One run per job at a time.</strong> If a cron tick fires
              while a previous run is still going, the new one is skipped
              (the atomic claim on the job row prevents double-spawn). You'll
              see this as a skipped status in the cron response.
            </li>
            <li>
              <strong>Per-tick budget.</strong> The cron entry point processes
              due jobs sequentially. If there are too many to finish in 240s,
              the remainder is deferred to the next tick — no work is lost,
              just delayed.
            </li>
            <li>
              <strong>Schedule vs deployment.</strong> Jobs only fire on a
              deployed environment with{" "}
              <Code>vercel.json</Code> active. In local dev, use Run now or hit{" "}
              <Code>/api/cron/run-jobs</Code> with the bearer token. See
              "Testing locally" below.
            </li>
            <li>
              <strong>Missing integrations.</strong> If a directive needs
              Composio (email, calendar, Fireflies) and it isn't connected,
              the tool returns "not connected" and George moves on. He won't
              retry endlessly. Connect it in{" "}
              <Link
                href="/settings/integrations"
                className="text-[var(--color-accent)] underline-offset-2 hover:underline"
              >
                Settings → Integrations
              </Link>
              .
            </li>
          </ul>
        </Prose>
      </Section>

      <Section title="How George works with you on a job">
        <Prose>
          <p>
            A scheduled run doesn't replace the CSM — it produces material for
            the CSM to act on. The handoff pattern is:
          </p>
          <ol>
            <li>
              <strong>George runs.</strong> Reads data, makes decisions, drafts
              emails, writes internal records.
            </li>
            <li>
              <strong>You skim the run summary.</strong> Three sections:{" "}
              <em>Actions taken</em> (what's already written),{" "}
              <em>Awaiting review</em> (drafts and decisions that need you),{" "}
              <em>Notes</em> (assumptions, missing data, errors).
            </li>
            <li>
              <strong>You handle "Awaiting review."</strong> Open Outlook
              drafts and send (or edit + send) the ones that look good. Discard
              the ones that don't. Update records where George guessed wrong.
            </li>
            <li>
              <strong>Iterate the directive.</strong> If a job is producing
              poor drafts or wrong scope, edit it. The directive is plain
              English — adjusting it is like coaching a teammate.
            </li>
          </ol>
          <p>
            Over time the goal is jobs you trust enough that the "Awaiting
            review" section is short — most actions land in "Actions taken,"
            and the human's role becomes spot-checks rather than full review.
            We're not there yet; expect to read every summary for the first
            few weeks of any new job.
          </p>
        </Prose>
      </Section>

      <Section title="Testing locally">
        <Prose>
          <p>
            On a dev machine, scheduled runs don't fire (no Vercel Cron). Two
            ways to trigger a run:
          </p>
          <ol>
            <li>
              Click <strong>Run now</strong> on the job card.
            </li>
            <li>
              Hit the cron endpoint directly with the bearer token from{" "}
              <Code>.env.local</Code>:
              <CodeBlock>{`curl -H "Authorization: Bearer $CRON_SECRET" \\
  http://localhost:3001/api/cron/run-jobs`}</CodeBlock>
              This processes every due job at once and returns the run results
              as JSON.
            </li>
          </ol>
          <p>
            Both paths execute the same runner. So if a job works locally via
            Run now, it'll work the same way when the cron fires on Vercel.
          </p>
        </Prose>
      </Section>

      <Section title="Troubleshooting">
        <Prose>
          <ul>
            <li>
              <strong>Run shows <Code>failed</Code> with an auth error.</strong>{" "}
              Almost always Composio — the Outlook or Fireflies connection
              expired. Re-link in Settings → Integrations.
            </li>
            <li>
              <strong>Run shows <Code>timed_out</Code>.</strong> Directive is
              too broad. Narrow the scope or split into multiple jobs (e.g.,
              "active customers A–M" / "active customers N–Z" each on its own
              schedule).
            </li>
            <li>
              <strong>Summary is empty or vague.</strong> The directive
              probably didn't specify what to output. Rewrite the last sentence
              as "List in your summary: …" or "Final answer should include …".
            </li>
            <li>
              <strong>Schedule didn't fire on Vercel.</strong> Confirm{" "}
              <Code>CRON_SECRET</Code> is set as a production env var and that
              your Vercel plan supports the schedule you picked. Hobby plans
              have stricter cron limits than Pro.
            </li>
            <li>
              <strong>George skipped emailing a customer in a draft batch.</strong>{" "}
              Look for the customer in the "Notes" section — he likely flagged
              missing data (no primary contact email, etc.). Fix the record
              and re-run.
            </li>
          </ul>
        </Prose>
      </Section>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-[18px] font-semibold text-[var(--color-fg)]">{title}</h2>
      {children}
    </section>
  );
}

function Prose({ children }: { children: React.ReactNode }) {
  return (
    <div className="max-w-prose space-y-3 text-[14px] leading-relaxed text-[var(--color-fg-secondary)] [&_strong]:font-semibold [&_strong]:text-[var(--color-fg)] [&_em]:text-[var(--color-fg)] [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5">
      {children}
    </div>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-4 text-[14px] font-semibold text-[var(--color-fg)]">
      {children}
    </h3>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[12px] text-[var(--color-fg)]">
      {children}
    </code>
  );
}

function CodeBlock({ children }: { children: React.ReactNode }) {
  return (
    <pre className="mt-2 overflow-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 font-mono text-[12px] text-[var(--color-fg)]">
      {children}
    </pre>
  );
}

function DirectiveExample({
  name,
  cron,
  text,
}: {
  name: string;
  cron: string;
  text: string;
}) {
  return (
    <div className="mt-3 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3">
      <div className="flex flex-wrap items-center gap-3 text-[12px] text-[var(--color-fg-muted)]">
        <span className="font-semibold text-[var(--color-fg)]">{name}</span>
        <span>
          Schedule <Code>{cron}</Code>
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-[var(--color-fg-secondary)]">
        {text}
      </p>
    </div>
  );
}

function CronTable({ rows }: { rows: Array<[string, string]> }) {
  return (
    <div className="mt-2 overflow-hidden rounded-md border border-[var(--color-border-subtle)]">
      <table className="w-full text-[13px]">
        <thead className="bg-[var(--color-surface-2)]">
          <tr className="text-left text-[12px] uppercase tracking-wide text-[var(--color-fg-muted)]">
            <th className="px-3 py-2">Expression</th>
            <th className="px-3 py-2">Means</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([expr, meaning]) => (
            <tr
              key={expr}
              className="border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-card)]"
            >
              <td className="px-3 py-2 font-mono text-[12px] text-[var(--color-fg)]">
                {expr}
              </td>
              <td className="px-3 py-2 text-[var(--color-fg-secondary)]">{meaning}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryTemplate() {
  return (
    <pre className="my-2 rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 font-mono text-[12px] text-[var(--color-fg-secondary)]">
      {`Actions taken:
  - <one line per action; include IDs where relevant>

Awaiting review:
  - <draft emails, decisions, or items a human needs to confirm>

Notes:
  - <assumptions, missing data, errors>`}
    </pre>
  );
}
