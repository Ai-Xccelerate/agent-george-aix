/**
 * Formatting for George's outbound email. The signature itself is authored by
 * the agent (see the signature block in prompt.ts) — here we only enforce a
 * consistent house font across the whole message, since the model can't
 * reliably set font-family from prose. Wrapping (not appending) also means we
 * never double up on the signature the prompt already mandates.
 *
 * Font: a deliberately neutral stack, not a tenant's brand face. This used to
 * be documented as "Open Sans / Calibri per Onyx house style", which was one
 * tenant's typography applied to every tenant's outbound mail — the same class
 * of leak as the hardcoded company name in prompt.ts, quieter because nobody
 * reads a font and notices it is the wrong company's.
 *
 * Left as a stack rather than resolved per org because there is nowhere to
 * resolve it from: `orgs` carries brand_color and logos but no typography, and
 * inventing a column to hold a font nobody has asked to change would be
 * speculative. The stack below is chosen to be unobjectionable anywhere: system
 * UI faces first so mail renders natively on the reader's platform, with a
 * webfont-free fallback chain. When a tenant does want their own face, this is
 * the single place it plugs in.
 *
 * Replies can't carry HTML via the reply action's plain-text `comment`, so the
 * reply path creates the draft, then patches its body to HTML via
 * `OUTLOOK_UPDATE_EMAIL` (see composio-tools.ts). `injectReplyHtml` top-posts
 * George's message above the quoted thread, preserving threading + history.
 */

const EMAIL_FONT_STACK = `-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;

/** Wrap George's HTML body so the whole message renders in the house font. */
export function wrapGeorgeEmailHtml(bodyHtml: string): string {
  return `<div style="font-family:${EMAIL_FONT_STACK};font-size:15px;line-height:1.6;color:#141413;">${bodyHtml}</div>`;
}

/**
 * Place `topHtml` (George's reply + signature) above the quoted thread that
 * Outlook's createReply seeded into `originalHtml`, so we top-post without
 * dropping the conversation history. Inserts just inside <body> when present;
 * falls back to prepending (e.g. if the draft body couldn't be fetched).
 */
export function injectReplyHtml(originalHtml: string, topHtml: string): string {
  if (!originalHtml) return topHtml;
  const bodyOpen = originalHtml.match(/<body[^>]*>/i);
  if (bodyOpen && bodyOpen.index !== undefined) {
    const at = bodyOpen.index + bodyOpen[0].length;
    return originalHtml.slice(0, at) + topHtml + originalHtml.slice(at);
  }
  return topHtml + originalHtml;
}
