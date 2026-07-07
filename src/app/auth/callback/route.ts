import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { admitUser, isAllowedEmail } from "@/lib/auth/access-policy";

/**
 * Exchanges a magic-link / invite / OAuth code for a session cookie, then
 * runs the access policy: domain check → existing member / pending invite /
 * bootstrap. If the user can't be admitted, sign them out before redirecting.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeRedirectPath(url.searchParams.get("next"));

  // Behind Railway / any proxy the inbound `req.url` host is the internal
  // bind address (e.g. 0.0.0.0:8080) which is unreachable from the user's
  // browser. Prefer NEXT_PUBLIC_APP_URL when set so every redirect out of
  // this route lands on the public domain — same fix as the Composio OAuth
  // callback (src/app/api/integrations/composio/callback/route.ts).
  const redirectBase = process.env.NEXT_PUBLIC_APP_URL
    ? new URL(process.env.NEXT_PUBLIC_APP_URL)
    : url;

  if (!code) return NextResponse.redirect(new URL("/signin", redirectBase));

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.user) {
    const back = new URL("/signin", redirectBase);
    back.searchParams.set("error", error?.message ?? "auth_failed");
    return NextResponse.redirect(back);
  }

  // First-line defense: domain check before we even ask the policy.
  if (!isAllowedEmail(data.user.email)) {
    await supabase.auth.signOut();
    const back = new URL("/signin", redirectBase);
    back.searchParams.set("error", "domain_blocked");
    return NextResponse.redirect(back);
  }

  const admin = createSupabaseAdmin();
  const verdict = await admitUser(
    admin,
    data.user.id,
    data.user.email ?? null,
    (data.user.user_metadata?.full_name as string | undefined) ?? null,
    supabase,
  );

  if (!verdict.ok) {
    await supabase.auth.signOut();
    const back = new URL("/signin", redirectBase);
    back.searchParams.set("error", verdict.reason);
    return NextResponse.redirect(back);
  }

  return NextResponse.redirect(new URL(next, redirectBase));
}

/**
 * Sanitise a user-supplied redirect target so it can only resolve to a
 * same-origin path. Blocks protocol-relative URLs, absolute URLs, and
 * any other scheme that would send the browser off-site.
 */
function safeRedirectPath(raw: string | null): string {
  const fallback = "/dashboard";
  if (!raw) return fallback;
  const cleaned = raw.replace(/^[\s\\/]+/, "/");
  if (!cleaned.startsWith("/") || cleaned.startsWith("//")) return fallback;
  try {
    const url = new URL(cleaned, "http://localhost");
    if (url.hostname !== "localhost") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
