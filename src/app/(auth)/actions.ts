"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createSupabaseServer } from "@/lib/supabase/server";
import { createSupabaseAdmin } from "@/lib/supabase/admin";
import { admitUser, isAllowedEmail } from "@/lib/auth/access-policy";

export type AuthResult = { error?: string; info?: string };

export async function signInAction(_: AuthResult, formData: FormData): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeRedirectPath(String(formData.get("next") ?? ""));

  if (!email || !password) return { error: "Email and password are required." };
  if (!isAllowedEmail(email)) {
    return { error: "This email isn't authorized for Agent George." };
  }

  const supabase = await createSupabaseServer();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  if (!data.user) return { error: "Sign-in failed." };

  const admin = createSupabaseAdmin();
  const verdict = await admitUser(
    admin,
    data.user.id,
    data.user.email ?? null,
    (data.user.user_metadata?.full_name as string | undefined) ?? null,
  );

  if (!verdict.ok) {
    await supabase.auth.signOut();
    return {
      error:
        verdict.reason === "domain_blocked"
          ? "This email isn't authorized for Agent George."
          : "Your account isn't linked to an org. Ask an admin to invite you.",
    };
  }

  redirect(next);
}

export async function magicLinkAction(_: AuthResult, formData: FormData): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email." };
  if (!isAllowedEmail(email)) {
    return { error: "This email isn't authorized for Agent George." };
  }

  const supabase = await createSupabaseServer();
  const origin = (await headers()).get("origin") ?? "http://localhost:3001";
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${origin}/auth/callback`,
      // Don't auto-create users — invite-only. If they don't exist, the
      // user will see a generic "check your inbox" but no email will arrive.
      shouldCreateUser: false,
    },
  });
  if (error) return { error: error.message };
  return { info: "If that email is registered, a magic link is on its way." };
}

export async function requestPasswordResetAction(
  _: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) return { error: "Enter your email." };
  if (!isAllowedEmail(email)) {
    return { error: "This email isn't authorized for Agent George." };
  }

  const supabase = await createSupabaseServer();
  const origin = (await headers()).get("origin") ?? "http://localhost:3001";
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/reset-password`,
  });
  if (error) return { error: error.message };
  return { info: "If that email is registered, a reset link is on its way." };
}

export async function updatePasswordAction(
  _: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (!password || password.length < 8) {
    return { error: "Password must be at least 8 characters." };
  }
  if (password !== confirm) {
    return { error: "Passwords don't match." };
  }

  const supabase = await createSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { error: "This reset link has expired. Request a new one." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  redirect("/dashboard");
}

export async function signOutAction() {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect("/signin");
}

/**
 * Sanitise a user-supplied redirect target so it can only resolve to a
 * same-origin path. Blocks protocol-relative URLs (`//evil.com`),
 * absolute URLs (`https://evil.com`), and any other scheme that would
 * send the browser off-site.
 */
function safeRedirectPath(raw: string): string {
  const fallback = "/dashboard";
  if (!raw) return fallback;
  // Strip leading whitespace and backslashes (IE compat quirk).
  const cleaned = raw.replace(/^[\s\\/]+/, "/");
  // Must start with a single `/` and NOT `//` (protocol-relative).
  if (!cleaned.startsWith("/") || cleaned.startsWith("//")) return fallback;
  try {
    const url = new URL(cleaned, "http://localhost");
    // If the resolved host isn't localhost, something is off.
    if (url.hostname !== "localhost") return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
