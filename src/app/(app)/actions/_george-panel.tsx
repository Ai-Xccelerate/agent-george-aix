"use client";

import { ChatClient, type InitialMessage } from "../chat/_chat-client";

export type SuggestedAction = { label: string; kind?: string };

/**
 * The right-hand George panel on the AI actions page: the contextual chat, with
 * George's suggested next-actions rendered as one-click buttons just above the
 * composer (inside ChatClient). Clicking one hands the instruction to George,
 * who acts on it — still confirming before anything external goes out.
 */
export function GeorgePanel({
  sessionId,
  initialMessages,
  suggestedActions,
}: {
  sessionId: string | null;
  initialMessages: InitialMessage[];
  suggestedActions: SuggestedAction[];
}) {
  if (!sessionId) {
    return (
      <div className="h-full overflow-y-auto whitespace-pre-wrap px-4 py-4 text-[13px] leading-relaxed text-[var(--color-fg-secondary)]">
        {initialMessages[0]?.content}
      </div>
    );
  }
  return (
    <ChatClient
      key={sessionId}
      sessionId={sessionId}
      initialMessages={initialMessages}
      embedded
      suggestedActions={suggestedActions}
    />
  );
}
