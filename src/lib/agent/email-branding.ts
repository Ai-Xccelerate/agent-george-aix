/**
 * Formatting for George's outbound email. The signature itself is authored by
 * the agent (see the signature block in prompt.ts) — here we only enforce a
 * consistent house font across the whole message, since the model can't
 * reliably set font-family from prose. Wrapping (not appending) also means we
 * never double up on the signature the prompt already mandates.
 *
 * Font: Open Sans / Calibri per Onyx house style. Open Sans is a webfont most
 * mail clients won't load, so the stack falls back to Calibri (renders on
 * Outlook / Windows, where getonyx.ai reads mail) then system sans elsewhere.
 *
 * Replies can't carry HTML via the reply action's plain-text `comment`, so the
 * reply path creates the draft, then patches its body to HTML via
 * `OUTLOOK_UPDATE_EMAIL` (see composio-tools.ts). `injectReplyHtml` top-posts
 * George's message above the quoted thread, preserving threading + history.
 */

const EMAIL_FONT_STACK = `'Open Sans', Calibri, 'Segoe UI', Arial, sans-serif`;

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
