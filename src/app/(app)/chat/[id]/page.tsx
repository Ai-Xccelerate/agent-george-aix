import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { ChatClient, type AttachmentMeta, type InitialMessage } from "../_chat-client";

export const dynamic = "force-dynamic";

type RowMsg = {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  content: string | null;
  content_json: { attachments?: AttachmentMeta[] } | null;
  created_at: string;
};

export default async function ChatSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/signin");
  const supabase = createSupabaseAdmin();

  // Allow human chat sessions and all autonomous-run sessions (inbound email,
  // transcript recaps, and proactive scans — all channel 'cron'/'email') so the
  // reviewer can open George's write-up and resume the thread. Scoped to the
  // caller's org so a session id from another tenant 404s.
  const session = await supabase
    .from("agent_sessions")
    .select("id, channel")
    .eq("id", id)
    .eq("org_id", user.orgId)
    .in("channel", ["chat", "email", "cron", "transcript"])
    .maybeSingle();
  if (!session.data) notFound();

  const messages = await supabase
    .from("agent_messages")
    .select("id, role, content, content_json, created_at")
    .eq("session_id", id)
    .order("created_at", { ascending: true })
    .limit(500);

  const initial: InitialMessage[] = (messages.data ?? [])
    .filter((m: RowMsg) => (m.role === "user" || m.role === "assistant") && m.content)
    .map((m: RowMsg) => ({
      id: m.id,
      role: m.role as "user" | "assistant",
      content: m.content ?? "",
      attachments: m.content_json?.attachments ?? [],
    }));

  return <ChatClient sessionId={id} initialMessages={initial} />;
}
