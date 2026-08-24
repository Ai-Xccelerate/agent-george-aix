/**
 * Which mail provider George uses — chosen, not inferred.
 *
 * DELETING A CREDENTIAL MUST NEVER CHANGE PROVIDERS. IT MUST DISABLE THE
 * PROVIDER.
 *
 * Until now the choice was implicit:
 *
 *     const mailTools = isNylasEnabled() ? nylasTools : composioTools;
 *     // isNylasEnabled() === "NYLAS_API_KEY and NYLAS_GRANT_ID are PRESENT"
 *
 * So removing a Nylas variable did not switch George's mailbox off, it silently
 * switched George onto Composio — a different mailbox, belonging to a person,
 * with its own live OAuth connection. That is a provider swap disguised as a
 * config cleanup, and nothing in the system would have announced it.
 *
 * It nearly happened. After the 20 August incident the Nylas key was replaced
 * with a placeholder rather than deleted, purely because deleting it would have
 * armed Composio and George could have resumed sending down a second path. A
 * placeholder holding a system safe is not a control; it is a note nobody can
 * read, and it survives exactly until someone tidies it up.
 *
 * So the provider is now stated. A missing credential means the chosen provider
 * cannot work, which disables mail — it never elects a different mailbox.
 *
 * This is also what makes the per-org integration toggles honest: "off" can mean
 * the tools are absent, rather than the tools being present and some other
 * provider quietly taking over.
 */
import { isNylasEnabled } from "@/lib/nylas/client";

export type MailProvider = "nylas" | "composio" | "none";

export type MailSelection = {
  /** The provider this deployment is configured to use. */
  provider: MailProvider;
  /** Whether that provider's credentials are actually present. */
  configured: boolean;
  /** True only when the chosen provider can be used. */
  usable: boolean;
  /** Where the choice came from, for diagnostics and the settings screen. */
  source: "explicit" | "inferred";
  /** Present when the choice cannot be honoured. */
  problem: string | null;
};

function readExplicit(): MailProvider | null {
  const raw = process.env.MAIL_PROVIDER?.trim().toLowerCase();
  if (raw === "nylas" || raw === "composio" || raw === "none") return raw;
  return null;
}

/** Composio's own credentials, independent of any per-org connected account. */
function composioConfigured(): boolean {
  return !!process.env.COMPOSIO_API_KEY?.trim();
}

/**
 * Resolve the provider.
 *
 * When MAIL_PROVIDER is unset we still infer, so that deploying this change does
 * not silently take mail away from an environment that has not been updated —
 * but the inference is announced, and it is the only path that can ever pick a
 * provider on its own. Set MAIL_PROVIDER and inference stops entirely.
 */
export function mailSelection(): MailSelection {
  const explicit = readExplicit();

  if (explicit === "none") {
    return { provider: "none", configured: true, usable: false, source: "explicit", problem: null };
  }

  if (explicit) {
    const configured = explicit === "nylas" ? isNylasEnabled() : composioConfigured();
    return {
      provider: explicit,
      configured,
      usable: configured,
      source: "explicit",
      problem: configured
        ? null
        : `MAIL_PROVIDER is "${explicit}" but its credentials are missing, so George has no mailbox. ` +
          `This does NOT fall back to another provider — set the credentials, or set MAIL_PROVIDER explicitly.`,
    };
  }

  // Unset: behave as before, and say so.
  const inferred: MailProvider = isNylasEnabled()
    ? "nylas"
    : composioConfigured()
      ? "composio"
      : "none";

  return {
    provider: inferred,
    configured: inferred !== "none",
    usable: inferred !== "none",
    source: "inferred",
    problem:
      inferred === "none"
        ? "No mail provider is configured and MAIL_PROVIDER is unset."
        : null,
  };
}

/** True when George should use its own Nylas mailbox. */
export function usingNylas(): boolean {
  const s = mailSelection();
  return s.provider === "nylas" && s.usable;
}

/** True when George should use a Composio-linked account. */
export function usingComposio(): boolean {
  const s = mailSelection();
  return s.provider === "composio" && s.usable;
}

/**
 * True when no mail provider is usable — George has no mailbox at all.
 *
 * Callers must treat this as "mail is off", not as "try the other one".
 */
export function mailDisabled(): boolean {
  return !mailSelection().usable;
}
