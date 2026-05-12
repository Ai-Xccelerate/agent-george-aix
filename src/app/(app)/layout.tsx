import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { FloatingChatBubble } from "./_bubble/floating-chat-bubble";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar
        user={{
          fullName: user.fullName ?? user.email ?? "Member",
          email: user.email,
          orgName: user.orgName,
        }}
      />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-auto bg-[var(--color-surface-2)]">{children}</main>
      </div>
      <FloatingChatBubble />
    </div>
  );
}
