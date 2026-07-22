import { SignIn } from "@clerk/nextjs";

// Fallback sign-in surface. On deployed *.aiworkforce.md hosts, proxy.ts's
// auth.protect() sends unauthenticated users to AIX Core (CLERK_SIGN_IN_URL),
// so this page is only rendered where CLERK_SIGN_IN_URL points here — i.e. local
// dev — as the embedded Clerk widget. Same Clerk app as Core.
export default function SignInPage() {
  return (
    <div className="flex justify-center">
      <SignIn forceRedirectUrl="/dashboard" />
    </div>
  );
}
