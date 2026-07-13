import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";

// Direct hits to /signin follow the same rule as the middleware:
//   - staging/prod (NEXT_PUBLIC_CLERK_SIGN_IN_URL is an absolute Core URL):
//     bounce to Core's sign-in with a redirect_url back to this app.
//   - local (/signin or unset): render the shared Clerk widget in-place
//     (same-domain → no cross-domain loop), force-redirect to /dashboard after.
export default function SignInPage() {
  const signInUrl = process.env.NEXT_PUBLIC_CLERK_SIGN_IN_URL;
  if (signInUrl && /^https?:\/\//.test(signInUrl)) {
    const app = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
    redirect(app ? `${signInUrl}?redirect_url=${encodeURIComponent(app)}` : signInUrl);
  }
  return (
    <div className="flex justify-center">
      <SignIn forceRedirectUrl="/dashboard" />
    </div>
  );
}
