"use client";

/**
 * "Onboard this customer".
 *
 * Disabled with a visible reason rather than hidden, and rather than enabled
 * and then failing. A hidden button leaves someone wondering where the feature
 * went; a button that errors on click teaches people the UI is unreliable. A
 * disabled button that says what is missing is a to-do list.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Send, TriangleAlert } from "lucide-react";

export type Blocker = { code: string; reason: string; fix?: { label: string; href: string } };

export function OnboardButton({
  customerId,
  blockers,
  recipient,
}: {
  customerId: string;
  blockers: Blocker[];
  recipient: { email: string; role: string } | null;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "starting" | "started" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const blocked = blockers.length > 0;

  async function start() {
    setState("starting");
    setError(null);
    try {
      const res = await fetch("/api/onboarding/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customer_id: customerId }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          failures?: Blocker[];
          error?: string;
        };
        setError(body.failures?.[0]?.reason ?? body.error ?? "Could not start onboarding.");
        setState("error");
        return;
      }
      setState("started");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
      setState("error");
    }
  }

  return (
    <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-white/[0.03] p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-gray-800 dark:text-white/90">
            Onboarding
          </h2>
          <p className="mt-1 text-theme-xs text-gray-400 dark:text-gray-500">
            George reads the account, decides what moves it forward, and writes one email.
            Nothing is sent — it goes to AI actions for review.
          </p>
        </div>
        <button
          type="button"
          onClick={start}
          disabled={blocked || state === "starting" || state === "started"}
          className="shrink-0 inline-flex items-center gap-2 rounded-lg bg-brand-500 px-3.5 py-2 text-theme-sm font-medium text-white transition hover:bg-brand-600 disabled:cursor-not-allowed disabled:bg-gray-200 disabled:text-gray-400 dark:disabled:bg-white/[0.06] dark:disabled:text-gray-500"
        >
          <Send size={14} />
          {state === "starting"
            ? "Starting…"
            : state === "started"
              ? "Writing…"
              : "Onboard this customer"}
        </button>
      </div>

      {state === "started" && (
        <p className="mt-3 rounded-lg bg-success-50 dark:bg-success-500/10 p-3 text-theme-xs text-gray-600 dark:text-gray-300">
          George is writing. It takes a minute or two — the draft will appear in{" "}
          <Link href="/actions" className="font-medium underline underline-offset-2">
            AI actions
          </Link>{" "}
          for review.
        </p>
      )}

      {state === "error" && error && (
        <p className="mt-3 rounded-lg bg-error-50 dark:bg-error-500/10 p-3 text-theme-xs text-gray-600 dark:text-gray-300">
          {error}
        </p>
      )}

      {blocked && (
        <ul className="mt-3 space-y-2">
          {blockers.map((b) => (
            <li
              key={b.code}
              className="flex items-start gap-2.5 rounded-lg bg-gray-50 dark:bg-white/[0.03] p-3"
            >
              <TriangleAlert size={14} className="mt-0.5 shrink-0 text-warning-500" />
              <span className="text-theme-xs text-gray-600 dark:text-gray-300">
                {b.reason}
                {b.fix && (
                  <>
                    {" "}
                    <Link
                      href={b.fix.href}
                      className="font-medium text-brand-500 underline underline-offset-2"
                    >
                      {b.fix.label}
                    </Link>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {!blocked && recipient && state === "idle" && (
        <p className="mt-3 text-theme-xs text-gray-400 dark:text-gray-500">
          Will write to <span className="text-gray-700 dark:text-gray-200">{recipient.email}</span>{" "}
          — the {recipient.role.replace(/_/g, " ")} on this account.
        </p>
      )}
    </div>
  );
}
