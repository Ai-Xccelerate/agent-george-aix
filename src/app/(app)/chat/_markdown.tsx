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
    <h1 className="mb-2 mt-4 text-base font-semibold text-gray-800 dark:text-white/90 first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-4 text-base font-semibold text-gray-800 dark:text-white/90 first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1.5 mt-3 text-theme-sm font-semibold text-gray-800 dark:text-white/90 first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1.5 mt-3 text-theme-sm font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 first:mt-0">
      {children}
    </h4>
  ),

  // ---- Inline marks ------------------------------------------------
  strong: ({ children }) => (
    <strong className="font-semibold text-gray-800 dark:text-white/90">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  del: ({ children }) => (
    <del className="text-gray-400 dark:text-gray-500 line-through">{children}</del>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-brand-500 dark:text-brand-400 underline underline-offset-2 hover:text-brand-600 dark:hover:text-brand-300"
    >
      {children}
    </a>
  ),

  // ---- Lists -------------------------------------------------------
  ul: ({ children }) => (
    <ul className="my-2 ml-4 list-disc space-y-1 first:mt-0 last:mb-0 marker:text-gray-400 dark:marker:text-gray-500">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 ml-5 list-decimal space-y-1 first:mt-0 last:mb-0 marker:text-gray-400 dark:marker:text-gray-500">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="leading-[1.55]">{children}</li>,

  // ---- Quote -------------------------------------------------------
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-brand-500 dark:border-brand-400 bg-brand-50 dark:bg-brand-500/15/40 px-3 py-1.5 text-gray-500 dark:text-gray-400">
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
        <code className="block whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.5] text-gray-800 dark:text-white/90">
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-gray-50 dark:bg-white/[0.03] px-1.5 py-0.5 font-mono text-[12.5px] text-gray-800 dark:text-white/90">
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-white/[0.03] px-3 py-2 first:mt-0 last:mb-0">
      {children}
    </pre>
  ),

  // ---- Horizontal rule --------------------------------------------
  hr: () => (
    <hr className="my-3 border-0 border-t border-gray-200 dark:border-gray-800" />
  ),

  // ---- Tables (GFM) -----------------------------------------------
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-md border border-gray-200 dark:border-gray-800">
      <table className="w-full border-collapse text-left text-theme-sm">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-b border-gray-200 dark:border-gray-800 bg-gray-100 dark:bg-gray-800 text-theme-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
      {children}
    </thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-t border-gray-200 dark:border-gray-800 first:border-t-0">
      {children}
    </tr>
  ),
  th: ({ children, style }) => (
    <th className="px-3 py-2 font-medium" style={style}>
      {children}
    </th>
  ),
  td: ({ children, style }) => (
    <td className="px-3 py-2 align-top text-gray-800 dark:text-white/90" style={style}>
      {children}
    </td>
  ),
};

export function MessageMarkdown({ content }: { content: string }) {
  return (
    <div className="text-sm text-gray-800 dark:text-white/90">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
