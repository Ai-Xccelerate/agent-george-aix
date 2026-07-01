import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Renders trusted markdown (George/Scribe-authored summaries) as styled HTML.
 * Headings, bold, and lists map to the Onyx type scale so a summary reads like
 * a document, not a raw ## blob.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        h1: (p) => (
          <h1 className="mb-2 mt-5 text-[19px] font-bold text-[var(--color-fg)] first:mt-0" {...p} />
        ),
        h2: (p) => (
          <h2 className="mb-2 mt-5 text-[16px] font-semibold text-[var(--color-fg)] first:mt-0" {...p} />
        ),
        h3: (p) => (
          <h3 className="mb-1.5 mt-4 text-[14px] font-semibold text-[var(--color-fg)] first:mt-0" {...p} />
        ),
        p: (p) => (
          <p className="mb-3 text-[14px] leading-relaxed text-[var(--color-fg-secondary)]" {...p} />
        ),
        ul: (p) => <ul className="mb-3 list-disc space-y-1 pl-5" {...p} />,
        ol: (p) => <ol className="mb-3 list-decimal space-y-1 pl-5" {...p} />,
        li: (p) => (
          <li className="text-[14px] leading-relaxed text-[var(--color-fg-secondary)]" {...p} />
        ),
        strong: (p) => <strong className="font-semibold text-[var(--color-fg)]" {...p} />,
        em: (p) => <em className="italic" {...p} />,
        a: (p) => (
          <a
            className="text-[var(--color-accent)] hover:underline"
            target="_blank"
            rel="noreferrer noopener"
            {...p}
          />
        ),
        code: (p) => (
          <code className="rounded bg-[var(--color-surface-2)] px-1 py-0.5 text-[12px]" {...p} />
        ),
        blockquote: (p) => (
          <blockquote
            className="mb-3 border-l-2 border-[var(--color-border)] pl-3 text-[var(--color-fg-muted)]"
            {...p}
          />
        ),
        hr: () => <hr className="my-4 border-[var(--color-border-subtle)]" />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
