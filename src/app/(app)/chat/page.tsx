import { redirect } from "next/navigation";

/**
 * The standalone "Agent George" chat page is retired — George now lives in the
 * floating chat bubble available on every page. A specific conversation is
 * still viewable at /chat/[id] (deep links from the mailbox and partner pages).
 *
 * This used to forward to /actions. That queue is switched off
 * (AI_ACTIONS_QUEUE_ENABLED), so the forward now lands on the customer list —
 * the surface that replaced it, and the one place George's work is visible.
 */
export default function ChatIndex() {
  redirect("/customers");
}
