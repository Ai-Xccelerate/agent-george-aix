import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";

// Sign-in target is environment-driven via NEXT_PUBLIC_CLERK_SIGN_IN_URL:
//   - Staging/prod: set to Core's sign-in (an absolute https:// URL on
//     *.aiworkforce.md). We bounce there — the shared parent-domain Clerk
//     session logs the user in once for all agents, no George UI.
//   - Local dev: set to "/signin" (or unset). localhost can't share Core's
//     cookie cross-domain, so we render Clerk's <SignIn> in-place (same
//     domain → session sets directly → no redirect loop).
export default function SignInPage() {
  const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL;
  if (signInUrl && /^https?:\/\//.test(signInUrl)) {
    redirect(signInUrl);
  }
  return (
    <div className="flex justify-center">
      <SignIn />
    </div>
  );
}
