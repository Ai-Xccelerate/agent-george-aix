"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Markdown renderer for assistant chat bubbles. GFM enables tables,
 * autolinks, strikethrough, and task lists — which is the bulk of what
 * George needs to format structured replies (counts, breakdowns, lists).
 *
 * Styling matches the chat font ladder (body = 14px / text-sm) and uses
 * design-system tokens so it reads correctly in both themes.
 */
const components: Components = {
  // ---- Block text ----------------------------------------------------
  p: ({ children }) => (
    <p className="my-2 first:mt-0 last:mb-0 leading-[1.6]">{children}</p>
  ),

  // ---- Headings — keep them lighter than the page h1; chat is body --
  h1: ({ children }) => (
    <h1 className="mb-2 mt-4 text-[16px] font-semibold text-[var(--color-fg)] first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-[15px] font-semibold text-[var(--color-fg)] first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-3 text-[14px] font-semibold text-[var(--color-fg)] first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1.5 mt-3 text-[13px] font-semibold uppercase tracking-wide text-[var(--color-fg-muted)] first:mt-0">
      {children}
    </h4>
  ),

  // ---- Inline marks ------------------------------------------------
  strong: ({ children }) => (
    <strong className="font-semibold text-[var(--color-fg)]">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => (
    <del className="text-[var(--color-fg-muted)] line-through">{children}</del>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-[var(--color-accent)] underline underline-offset-2 hover:text-[var(--color-accent-hover)]"
    >
      {children}
    </a>
  ),

  // ---- Lists -------------------------------------------------------
  ul: ({ children }) => (
    <ul className="my-2 ml-4 list-disc space-y-1 first:mt-0 last:mb-0 marker:text-[var(--color-fg-muted)]">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 ml-5 list-decimal space-y-1 first:mt-0 last:mb-0 marker:text-[var(--color-fg-muted)]">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-[1.55]">{children}</li>,

  // ---- Quote -------------------------------------------------------
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-[var(--color-accent)] bg-[var(--color-accent-light)]/40 px-3 py-1.5 text-[var(--color-fg-secondary)]">
      {children}
    </blockquote>
  ),

  // ---- Code -------------------------------------------------------
  code: (props) => {
    const { children, className } = props as {
      children?: React.ReactNode;
      className?: string;
    };
    const isBlock = !!className && /^language-/.test(className);
    if (isBlock) {
      return (
        <code className="block whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.5] text-[var(--color-fg)]">
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[12.5px] text-[var(--color-fg)]">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md border border-[var(--color-border-subtle)] bg-[var(--color-surface-2)] px-3 py-2 first:mt-0 last:mb-0">
      {children}
    </pre>
  ),

  // ---- Horizontal rule --------------------------------------------
  hr: () => (
    <hr className="my-3 border-0 border-t border-[var(--color-border-subtle)]" />
  ),

  // ---- Tables (GFM) -----------------------------------------------
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-md border border-[var(--color-border-subtle)]">
      <table className="w-full border-collapse text-left text-[13px]">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-[var(--color-border)] bg-[var(--color-surface-3)] text-[11px] uppercase tracking-wide text-[var(--color-fg-secondary)]">
      {children}
    </thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-t border-[var(--color-border-subtle)] first:border-t-0">
      {children}
    </tr>
  ),
  th: ({ children, style }) => (
    <th className="px-3 py-2 font-medium" style={style}>
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td className="px-3 py-2 align-top text-[var(--color-fg)]" style={style}>
      {children}
    </td>
  ),
};

export function MessageMarkdown({ content }: { content: string }) {
  return (
    <div className="text-sm text-[var(--color-fg)]">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
