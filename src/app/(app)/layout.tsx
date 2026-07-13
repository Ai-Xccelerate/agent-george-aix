import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { CoreAccessError } from "@/lib/aix-core/access";
import { CoreAccessDenied } from "./_core-access-denied";
import { FloatingChatBubble } from "./_bubble/floating-chat-bubble";
import { AppShell } from "./_shell";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let user;
  try {
    user = await getCurrentUser();
  } catch (err) {
    // Core denied or is unavailable — show the block screen, not a redirect loop.
    if (err instanceof CoreAccessError) return <CoreAccessDenied outcome={err.outcome} />;
    throw err;
  }
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
