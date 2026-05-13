import { createSupabaseServer } from "@/lib/supabase/server";
import { HistoryRail, type HistoryItem } from "./_history-rail";

export const dynamic = "force-dynamic";

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServer();
  // Agent George rail shows human-initiated chats only. Email-channel
  // sessions live in /inbox — surfacing them here too is noisy and
  // contradicts the "inbox is the triage surface" model.
  const { data } = await supabase
    .from("agent_sessions")
    .select("id, title, updated_at, channel")
    .eq("channel", "chat")
    .order("updated_at", { ascending: false })
    .limit(100);
  const sessions = (data ?? []) as HistoryItem[];

  return (
    <div className="flex h-full">
      <HistoryRail sessions={sessions} />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
