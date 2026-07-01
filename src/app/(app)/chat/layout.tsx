/**
 * A bare full-height wrapper for a single conversation view (/chat/[id]). The
 * old multi-session history rail is retired along with the standalone chat page
 * — George's general chat now lives in the floating bubble on every page.
 */
export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return <div className="h-full">{children}</div>;
}
