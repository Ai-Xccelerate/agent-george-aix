/**
 * Whether an account can be onboarded, and if not, exactly what is missing.
 *
 * WHY THIS IS ONE FUNCTION AND NOT TWO CHECKS
 * The button needs it to decide whether to be disabled and what to say; the
 * endpoint needs it to refuse. If those were separate implementations they
 * would disagree eventually, and the failure would be a button that looks
 * clickable and an endpoint that rejects it — which teaches people the UI
 * lies. One function, two callers.
 *
 * WHY THE REASONS ARE SPECIFIC
 * "Cannot start onboarding" is a dead end for whoever is looking at it. Every
 * refusal here names the missing thing and what to do about it, so the UI can
 * render a next step rather than an apology.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveTenantProcess, TenantProcessMissingError } from "./tenant-process";

export type PreconditionFailure = {
  /** Stable key, so the UI can link to the right place without parsing prose. */
  code:
    | "customer_not_found"
    | "no_contact_with_role"
    | "no_contract"
    | "no_process"
    | "already_running";
  /** Written for the person looking at the screen, not for a log. */
  reason: string;
  /** Where they go to fix it, when there is somewhere. */
  fix?: { label: string; href: string };
};

export type PreconditionResult =
  | { ok: true; recipient: { id: string; email: string; name: string | null; role: string } }
  | { ok: false; failures: PreconditionFailure[] };

/**
 * The recipient rule, in one place.
 *
 * A contact is only a candidate if it has BOTH an email and a role. The role
 * requirement is the whole point of migration 0004: `contacts.title` is free
 * text a human typed, and choosing a recipient by reading it means inferring a
 * role from prose. That inference is what assembled a recipient list from a
 * transcript on 2026-08-20.
 *
 * Preference order is by role, not by `is_primary` and never by array position.
 * The existing customer page does `contacts.find(is_primary) ?? contacts[0]`,
 * which silently promotes whoever happens to be first — fine for displaying a
 * name, not fine for deciding who receives mail.
 */
const ROLE_PREFERENCE = [
  "champion",
  "project_manager",
  "technical_lead",
  "executive_sponsor",
  "economic_buyer",
  "end_user",
  "billing",
  "other",
];

type ContactRow = {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string | null;
};

export function pickRecipient(contacts: ContactRow[]): ContactRow | null {
  const eligible = contacts.filter((c) => c.email?.trim() && c.role);
  if (!eligible.length) return null;
  return (
    eligible
      .slice()
      .sort((a, b) => {
        const ai = ROLE_PREFERENCE.indexOf(a.role!);
        const bi = ROLE_PREFERENCE.indexOf(b.role!);
        // Unknown roles sort last rather than first — a role we do not
        // recognise is not evidence that this is the right person.
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      })[0] ?? null
  );
}

export async function checkOnboardingPreconditions(
  admin: SupabaseClient,
  orgId: string,
  customerId: string,
): Promise<PreconditionResult> {
  const failures: PreconditionFailure[] = [];

  const { data: customer } = await admin
    .from("customers")
    .select("id, name")
    .eq("org_id", orgId)
    .eq("id", customerId)
    .maybeSingle();

  if (!customer) {
    return {
      ok: false,
      failures: [
        { code: "customer_not_found", reason: "This customer does not exist in your organisation." },
      ],
    };
  }

  const [contactsRes, contractsRes, runningRes] = await Promise.all([
    admin.from("contacts").select("id, full_name, email, role").eq("customer_id", customerId),
    admin.from("contracts").select("id, signed_at, start_date").eq("customer_id", customerId).limit(1),
    admin
      .from("onboarding_touchpoint")
      .select("id")
      .eq("customer_id", customerId)
      .in("status", ["drafted", "awaiting_approval"])
      .limit(1),
  ]);

  const contacts = (contactsRes.data ?? []) as ContactRow[];
  const recipient = pickRecipient(contacts);
  if (!recipient) {
    const haveContacts = contacts.length > 0;
    failures.push({
      code: "no_contact_with_role",
      reason: haveContacts
        ? `${customer.name} has contacts, but none with both an email address and a role. ` +
          `George will not pick a recipient from a job title — a role has to be set explicitly.`
        : `${customer.name} has no contacts yet. George needs someone to write to, named on the account.`,
      fix: { label: "Add a contact", href: `/customers/${customerId}` },
    });
  }

  if (!(contractsRes.data ?? []).length) {
    failures.push({
      code: "no_contract",
      reason:
        "No contract on this account. The signature date is what onboarding is measured from, " +
        "so without it there is no day one.",
      fix: { label: "Record a contract", href: `/customers/${customerId}` },
    });
  }

  try {
    await resolveTenantProcess(admin, orgId);
  } catch (e) {
    failures.push({
      code: "no_process",
      reason:
        e instanceof TenantProcessMissingError
          ? `No onboarding process for your organisation: ${e.why}.`
          : "The onboarding process could not be read.",
      fix: { label: "Review the process", href: "/settings/agent" },
    });
  }

  if ((runningRes.data ?? []).length) {
    failures.push({
      code: "already_running",
      reason:
        "There is already a drafted email waiting for review on this account. Approve or " +
        "decline that one before George writes another.",
      fix: { label: "Go to AI actions", href: "/actions" },
    });
  }

  if (failures.length) return { ok: false, failures };

  return {
    ok: true,
    recipient: {
      id: recipient!.id,
      email: recipient!.email!.trim(),
      name: recipient!.full_name,
      role: recipient!.role!,
    },
  };
}
