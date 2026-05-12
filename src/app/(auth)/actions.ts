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
  const next = String(formData.get("next") ?? "/dashboard");

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

export async function signOutAction() {
  const supabase = await createSupabaseServer();
  await supabase.auth.signOut();
  redirect("/signin");
}
