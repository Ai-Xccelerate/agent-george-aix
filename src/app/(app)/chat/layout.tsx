import { createSupabaseServer } from "@/lib/supabase/server";
import { HistoryRail, type HistoryItem } from "./_history-rail";

export const dynamic = "force-dynamic";

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServer();
  // Surface both human-initiated chats and inbound-event sessions (channel
  // 'email' today; 'transcript' / others later) in the same rail. The rail
  // marks non-chat sessions with a channel-specific icon so the reviewer
  // can spot autonomous George runs that need their attention.
  const { data } = await supabase
    .from("agent_sessions")
    .select("id, title, updated_at, channel")
    .in("channel", ["chat", "email"])
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
