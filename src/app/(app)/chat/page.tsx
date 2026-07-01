import { redirect } from "next/navigation";

/**
 * The standalone "Agent George" chat page is retired — George now lives in the
 * floating chat bubble available on every page. /chat forwards to AI actions;
 * a specific conversation is still viewable at /chat/[id] (deep links from the
 * mailbox and partner pages).
 */
export default function ChatIndex() {
  redirect("/actions");
}
