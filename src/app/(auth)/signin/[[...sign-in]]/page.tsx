import { RedirectToSignIn } from "@clerk/nextjs";

// George does NOT host its own sign-in UI. Auth lives on AIX Core — the shared
// Clerk session across *.aiworkforce.md logs users in once for all agents.
// This route just bounces anyone who lands here to the Clerk-configured
// (Core) sign-in, matching the AIXDraw/Jules pattern. No env override of
// NEXT_PUBLIC_CLERK_SIGN_IN_URL — we use the instance default (Core).
export default function SignInPage() {
  return <RedirectToSignIn />;
}
