import { SignIn } from "@clerk/nextjs";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { coreSignInUrl } from "@/lib/auth/core-signin";

// Direct hits to /signin follow the same rule as the middleware:
//   - deployed *.aiworkforce.md host: bounce to AIX Core's login with a
//     redirect_url back to this app (the shared session returns the user).
//   - localhost: render the embedded Clerk widget in-place (no shared cookie
//     across domains), force-redirect to /dashboard after.
export default async function SignInPage() {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const core = coreSignInUrl(host);

  if (core) {
    const app =
      (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "") ||
      (host ? `https://${host}` : "");
    const dest = new URL(core);
    if (app) dest.searchParams.set("redirect_url", `${app}/dashboard`);
    redirect(dest.toString());
  }

  return (
    <div className="flex justify-center">
      <SignIn forceRedirectUrl="/dashboard" />
    </div>
  );
}
