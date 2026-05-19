import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { FloatingChatBubble } from "./_bubble/floating-chat-bubble";
import { AppShell } from "./_shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/signin");

  return (
    <>
      <AppShell
        user={{
          fullName: user.fullName ?? user.email ?? "Member",
          email: user.email,
          orgName: user.orgName,
        }}
      >
        {children}
      </AppShell>
      <FloatingChatBubble />
    </>
  );
}
