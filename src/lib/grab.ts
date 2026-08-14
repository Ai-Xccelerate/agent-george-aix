/**
 * Grab — visual bug reporting widget.
 *
 * The vendor snippet installs a queue shim, loads widget.js async, and the real
 * widget drains anything queued in the meantime. We reproduce that shim rather
 * than pasting their inline <script>, because inline script injection in layouts
 * is blocked by a security hook (see AGENTS.md). Loading is done with
 * next/script (external src, allowed) and identification from a client effect.
 */

export type GrabIdentity = {
  email: string | null;
  name: string | null;
  userId: string;
};

type GrabQueueEntry = [string, ...unknown[]];

type GrabApi = {
  q?: GrabQueueEntry[];
  identify?: (identity: GrabIdentity) => void;
  reset?: () => void;
};

declare global {
  interface Window {
    Grab?: GrabApi;
  }
}

/** The publishable key. Absent = the widget is simply not installed. */
export const GRAB_KEY = process.env.NEXT_PUBLIC_GRAB_KEY;

export function grabScriptSrc(key: string): string {
  return `https://grab-api.aiworkforce.md/widget.js?key=${encodeURIComponent(key)}`;
}

/** Vendor's shim: queue calls made before widget.js finishes loading. */
function ensureGrab(): GrabApi | null {
  if (typeof window === "undefined") return null;
  if (!window.Grab) {
    window.Grab = {
      q: [],
      identify(...args: unknown[]) {
        this.q?.push(["identify", ...args]);
      },
    } as GrabApi;
  }
  return window.Grab;
}

export function identifyGrabUser(identity: GrabIdentity): void {
  ensureGrab()?.identify?.(identity);
}

/**
 * Called on sign-out so the next person on this browser isn't attributed to the
 * previous one.
 *
 * It also drops any queued identify that hasn't been drained yet. Without that,
 * a slow widget load could resolve *after* sign-out and attribute reports to the
 * user who just left — the exact thing reset() exists to prevent.
 */
export function resetGrab(): void {
  if (typeof window === "undefined") return;
  const grab = window.Grab;
  if (!grab) return;
  if (Array.isArray(grab.q)) {
    grab.q = grab.q.filter((entry) => entry[0] !== "identify");
  }
  grab.reset?.();
}
