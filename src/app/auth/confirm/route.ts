import { NextRequest, NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { admitUser, isAllowedEmail } from "@/lib/auth/access-policy";

/**
 * Verifies an email OTP link (invite / recovery / magic link) via `token_hash`
 * and establishes the session server-side.
 *
 * Why this exists separately from `/auth/callback`: server-generated links
 * (invite, password reset) and magic links opened in a different browser than
 * the one that requested them have NO PKCE `code_verifier` cookie, so
 * `exchangeCodeForSession` (the callback path) can't work for them. `verifyOtp`
 * needs only the `token_hash` from the URL, so it succeeds regardless of which
 * browser or device opens the link. The email templates point here.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const next = safeRedirectPath(url.searchParams.get("next"), type);

  // Behind Railway the inbound host is the internal bind address; prefer the
  // public URL so every redirect lands on the reachable domain. Same fix as
  // /auth/callback.
  const redirectBase = process.env.NEXT_PUBLIC_APP_URL
    ? new URL(process.env.NEXT_PUBLIC_APP_URL)
    : url;

  if (!tokenHash || !type) {
    const back = new URL("/signin", redirectBase);
    back.searchParams.set("error", "invalid_link");
    return NextResponse.redirect(back);
  }

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error || !data.user) {
    const back = new URL("/signin", redirectBase);
    back.searchParams.set("error", error?.message ?? "auth_failed");
    return NextResponse.redirect(back);
  }

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
 * Resolve the post-verification destination. A user-supplied `next` is
 * sanitised to a same-origin path; otherwise we default by link type —
 * invite/recovery land on the set-password screen (they have a session but
 * need to choose a password), everything else goes to the dashboard.
 */
function safeRedirectPath(raw: string | null, type: EmailOtpType | null): string {
  const fallback = type === "invite" || type === "recovery" ? "/reset-password" : "/dashboard";
  if (!raw) return fallback;
  const cleaned = raw.replace(/^[\s\\/]+/, "/");
  if (!cleaned.startsWith("/") || cleaned.startsWith("//")) return fallback;
  try {
    const parsed = new URL(cleaned, "http://localhost");
    if (parsed.hostname !== "localhost") return fallback;
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return fallback;
  }
}
