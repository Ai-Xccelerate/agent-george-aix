import { notFound } from "next/navigation";
import { createSupabaseServer } from "@/lib/supabase/server";
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
  const supabase = await createSupabaseServer();

  // Allow human-initiated chat sessions and autonomous-event sessions
  // (channel='email' today, 'transcript' later) so the reviewer can resume
  // an inbound email thread to approve / send a draft.
  const session = await supabase
    .from("agent_sessions")
    .select("id, channel")
    .eq("id", id)
    .in("channel", ["chat", "email"])
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
