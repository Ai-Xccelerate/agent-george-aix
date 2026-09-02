/**
 * POST /api/onboarding/start — a human asks George to onboard an account.
 *
 * WHY A HUMAN ACTION AND NOT A CORE WEBHOOK
 * There is no "customer signed" event to subscribe to. Inventing a trigger that
 * fires on lifecycle changes would mean George starting to write to customers
 * because a field changed, which is how the 2026-08-20 queue came to exist.
 * Somebody presses a button, and that is the whole of the authorisation.
 *
 * NOTHING IS SENT HERE. The run ends with a draft and a decision on the
 * Needs-you queue.
 */
import { after, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { checkOnboardingPreconditions } from "@/lib/agent/onboarding-preconditions";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not_authenticated" }, { status: 401 });

  let customerId: string | null = null;
  try {
    const body = (await req.json()) as { customer_id?: unknown };
    if (typeof body.customer_id === "string") customerId = body.customer_id;
  } catch {
    // fall through to the 400 below
  }
  if (!customerId) {
    return NextResponse.json({ error: "customer_id is required" }, { status: 400 });
  }

  // Checked here as well as inside startOnboarding. This call is what decides
  // the HTTP status and the message the UI renders; re-checking inside the run
  // is what stops a race between two clicks. Neither is redundant.
  const admin = createSupabaseAdmin();
  const pre = await checkOnboardingPreconditions(admin, user.orgId, customerId);
  if (!pre.ok) {
    const notFound = pre.failures.some((f) => f.code === "customer_not_found");
    const conflict = pre.failures.some((f) => f.code === "already_running");
    return NextResponse.json(
      { error: "preconditions_not_met", failures: pre.failures },
      { status: notFound ? 404 : conflict ? 409 : 422 },
    );
  }

  // The run takes a minute or two. Answer immediately so the button is not
  // holding an HTTP connection open, and let the work finish in the background;
  // the queue is where the result appears either way.
  after(async () => {
    try {
      const { startOnboarding } = await import("@/lib/agent/run-onboarding");
      const res = await startOnboarding({
        orgId: user.orgId,
        customerId: customerId!,
        userId: user.id,
      });
      if (!res.ok) {
        console.warn("[onboarding] refused after accepting", {
          customerId,
          failures: res.failures,
        });
      }
    } catch (err) {
      // A failed run must leave a trace: without this the button appears to
      // work and nothing ever arrives in the queue.
      console.error("[onboarding] run failed", { customerId, error: (err as Error).message });
      await admin.from("audit_log").insert({
        org_id: user.orgId,
        actor: user.id,
        action: "onboarding.run_failed",
        payload: { customer_id: customerId, error: (err as Error).message },
      });
    }
  });

  return NextResponse.json(
    {
      status: "started",
      recipient: { email: pre.recipient.email, role: pre.recipient.role },
    },
    { status: 202 },
  );
}
