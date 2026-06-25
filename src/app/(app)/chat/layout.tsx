import { createSupabaseServer } from "@/lib/supabase/server";
import { HistoryRail, type HistoryItem } from "./_history-rail";

export const dynamic = "force-dynamic";

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createSupabaseServer();
  // General conversations with George — the "talk to George about anything"
  // surface. Account-specific threads live in each partner's account hub, and
  // email threads live in the Inbox; both are excluded here so this stays the
  // general workspace (chat channel, not scoped to a customer).
  const { data } = await supabase
    .from("agent_sessions")
    .select("id, title, updated_at, channel")
    .eq("channel", "chat")
    .is("customer_id", null)
    .order("updated_at", { ascending: false })
    .limit(150);
  const sessions = (data ?? []) as HistoryItem[];

  return (
    <div className="flex h-full">
      <HistoryRail sessions={sessions} />
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}
