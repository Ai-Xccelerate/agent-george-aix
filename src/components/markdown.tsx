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
          <h1 className="mb-2 mt-5 text-[19px] font-bold text-gray-800 dark:text-white/90 first:mt-0" {...p} />
        ),
        h2: (p) => (
          <h2 className="mb-2 mt-5 text-[16px] font-semibold text-gray-800 dark:text-white/90 first:mt-0" {...p} />
        ),
        h3: (p) => (
          <h3 className="mb-1.5 mt-4 text-[14px] font-semibold text-gray-800 dark:text-white/90 first:mt-0" {...p} />
        ),
        p: (p) => (
          <p className="mb-3 text-[14px] leading-relaxed text-gray-500 dark:text-gray-400" {...p} />
        ),
        ul: (p) => <ul className="mb-3 list-disc space-y-1 pl-5" {...p} />,
        ol: (p) => <ol className="mb-3 list-decimal space-y-1 pl-5" {...p} />,
        li: (p) => (
          <li className="text-[14px] leading-relaxed text-gray-500 dark:text-gray-400" {...p} />
        ),
        strong: (p) => <strong className="font-semibold text-gray-800 dark:text-white/90" {...p} />,
        em: (p) => <em className="italic" {...p} />,
        a: (p) => (
          <a
            className="text-brand-500 dark:text-brand-400 hover:underline"
            target="_blank"
            rel="noreferrer noopener"
            {...p}
          />
        ),
        code: (p) => (
          <code className="rounded bg-gray-50 dark:bg-white/[0.03] px-1 py-0.5 text-[12px]" {...p} />
        ),
        blockquote: (p) => (
          <blockquote
            className="mb-3 border-l-2 border-gray-200 dark:border-gray-800 pl-3 text-gray-400 dark:text-gray-500"
            {...p}
          />
        ),
        hr: () => <hr className="my-4 border-gray-200 dark:border-gray-800" />,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
