import DOMPurify from "isomorphic-dompurify";

/**
 * Render George-produced email HTML safely.
 *
 * Sanitization is done via DOMPurify with a tight allowlist matching what
 * the `draft_email` tool's schema constrains George to ("simple inline
 * tags only"). Forces every link to open in a new tab with rel=noopener.
 *
 * Same primitive will be reused for inbound mail rendering (backlog #67)
 * — where the source is the wild internet — once we layer on the
 * "load remote images?" toggle.
 */
const ALLOWED_TAGS = [
  "p",
  "br",
  "ul",
  "ol",
  "li",
  "strong",
  "em",
  "b",
  "i",
  "a",
  "code",
  "h1",
  "h2",
  "h3",
  "h4",
  "blockquote",
  "hr",
  "div",
  "span",
];

const ALLOWED_ATTR = ["href", "target", "rel"];

export function SafeHtml({
  html,
  className,
}: {
  html: string;
  className?: string;
}) {
  const clean = DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: /^(https?:|mailto:)/i,
    ADD_ATTR: ["target", "rel"],
  });
  return (
    <div
      className={className}
      // DOMPurify-sanitized; ALLOWED_TAGS / ALLOWED_ATTR + URI scheme
      // restriction blocks every active-content vector.
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}
