import { redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { createSupabaseServer } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * /chat itself doesn't render a chat — it picks the most recent session
 * and forwards to /chat/[id], or shows the empty-state "start a chat" tile
 * when the user has none yet. Starting a new chat is a server action on the
 * history rail; it always lands the user on /chat/[id].
 */
export default async function ChatIndex() {
  const supabase = await createSupabaseServer();
  const { data } = await supabase
    .from("agent_sessions")
    .select("id")
    .eq("channel", "chat")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (data?.id) {
    redirect(`/chat/${data.id}`);
  }

  return (
    <div className="flex h-full items-center justify-center px-6 py-8">
      <div className="max-w-[420px] text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl brand-gradient text-white shadow-[var(--shadow-cta)]">
          <Sparkles size={20} />
        </div>
        <h1 className="text-[20px] font-bold text-[var(--color-fg)]">
          Start a conversation with George
        </h1>
        <p className="mt-2 text-sm text-[var(--color-fg-secondary)]">
          Click <strong>New chat</strong> in the left rail to begin. Your conversations
          stay around so you can pick them back up whenever.
        </p>
      </div>
    </div>
  );
}
